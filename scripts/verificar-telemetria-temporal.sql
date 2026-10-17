/* Verificación de sólo lectura de 20261016_telemetria_temporal.sql. */
SET NOCOUNT ON;

SELECT c.name AS Columna,t.name AS Tipo,c.is_nullable,c.max_length
FROM sys.columns c
JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE c.object_id=OBJECT_ID('dbo.IncidenteIntento')
  AND c.name IN ('IdIntentoPregunta','SesionClienteId','SecuenciaCliente','Codigo','VersionContrato')
ORDER BY c.column_id;

SELECT Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior,Activo
FROM dbo.TipoEventoTelemetria
ORDER BY Tipo;

SELECT i.name,i.is_unique,i.has_filter,i.filter_definition
FROM sys.indexes i
WHERE i.object_id=OBJECT_ID('dbo.IncidenteIntento')
  AND i.name IN ('UQ_IncidenteIntento_Intento_Evento',
                 'UX_IncidenteIntento_Intento_Sesion_Secuencia',
                 'IX_IncidenteIntento_Intento_Tipo_Pregunta_Fecha')
ORDER BY i.name;

SELECT fk.name AS ForeignKey
FROM sys.foreign_keys fk
WHERE fk.parent_object_id=OBJECT_ID('dbo.IncidenteIntento')
  AND fk.name IN ('FK_IncidenteIntento_IntentoPregunta','FK_IncidenteIntento_TipoEvento')
ORDER BY fk.name;

SELECT cc.name AS CheckConstraint,cc.definition
FROM sys.check_constraints cc
WHERE cc.parent_object_id=OBJECT_ID('dbo.IncidenteIntento')
  AND cc.name IN ('CHK_IncidenteIntento_SesionSecuencia',
                  'CHK_IncidenteIntento_VersionContrato','CHK_IncidenteIntento_Fechas')
ORDER BY cc.name;

-- El render debe entregar tanto la instancia sorteada como la pregunta de origen.
SELECT column_ordinal,name,system_type_name,is_nullable
FROM sys.dm_exec_describe_first_result_set_for_object(
  OBJECT_ID('dbo.SP_Intento_ObtenerExamenDinamico'),0
)
WHERE name IN ('IdIntentoPregunta','IdPregunta')
ORDER BY column_ordinal;

SELECT
  SUM(CASE WHEN SesionClienteId IS NULL AND SecuenciaCliente IS NULL THEN 1 ELSE 0 END) AS EventosLegacy,
  SUM(CASE WHEN SesionClienteId IS NOT NULL AND SecuenciaCliente IS NOT NULL THEN 1 ELSE 0 END) AS EventosNuevos,
  SUM(CASE WHEN (SesionClienteId IS NULL AND SecuenciaCliente IS NOT NULL)
             OR (SesionClienteId IS NOT NULL AND SecuenciaCliente IS NULL) THEN 1 ELSE 0 END) AS SesionesInconsistentes,
  COUNT(*) AS Total
FROM dbo.IncidenteIntento;

-- Detecta duplicados que deberían resultar imposibles con ambos índices únicos.
SELECT IdIntento,EventoId,COUNT(*) AS Cantidad
FROM dbo.IncidenteIntento
GROUP BY IdIntento,EventoId
HAVING COUNT(*)>1;

SELECT IdIntento,SesionClienteId,SecuenciaCliente,COUNT(*) AS Cantidad
FROM dbo.IncidenteIntento
WHERE SesionClienteId IS NOT NULL AND SecuenciaCliente IS NOT NULL
GROUP BY IdIntento,SesionClienteId,SecuenciaCliente
HAVING COUNT(*)>1;

-- Intervalos solapados: su existencia es válida; la API debe unirlos al sumar.
SELECT TOP (50) A.IdIntento,A.Tipo,A.Id AS EventoA,B.Id AS EventoB,
  A.FechaInicioCliente AS InicioA,A.FechaFinCliente AS FinA,
  B.FechaInicioCliente AS InicioB,B.FechaFinCliente AS FinB
FROM dbo.IncidenteIntento A
JOIN dbo.IncidenteIntento B ON B.IdIntento=A.IdIntento AND B.Tipo=A.Tipo AND B.Id>A.Id
JOIN dbo.TipoEventoTelemetria T ON T.Tipo=A.Tipo AND T.EsIntervalo=1
WHERE A.Estado='completado' AND B.Estado='completado'
  AND A.FechaInicioCliente<B.FechaFinCliente
  AND B.FechaInicioCliente<A.FechaFinCliente
ORDER BY A.IdIntento,A.Tipo,A.Id,B.Id;

-- Duración efectiva de intervalos completados después de unir solapamientos.
-- Permite contrastar el resumen de GET /eventos sin modificar datos.
;WITH Base AS (
  SELECT E.Id,E.IdIntento,E.Tipo,E.FechaInicioCliente,E.FechaFinCliente,
    MAX(E.FechaFinCliente) OVER (
      PARTITION BY E.IdIntento,E.Tipo
      ORDER BY E.FechaInicioCliente,E.Id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS MaxFinAnterior
  FROM dbo.IncidenteIntento E
  JOIN dbo.TipoEventoTelemetria T ON T.Tipo=E.Tipo AND T.EsIntervalo=1
  WHERE E.Estado='completado'
), Marcas AS (
  SELECT *,CASE WHEN MaxFinAnterior IS NULL OR FechaInicioCliente>MaxFinAnterior
    THEN 1 ELSE 0 END AS NuevoGrupo
  FROM Base
), Grupos AS (
  SELECT *,SUM(NuevoGrupo) OVER (
    PARTITION BY IdIntento,Tipo
    ORDER BY FechaInicioCliente,Id ROWS UNBOUNDED PRECEDING
  ) AS Grupo
  FROM Marcas
), Islas AS (
  SELECT IdIntento,Tipo,Grupo,MIN(FechaInicioCliente) AS Inicio,
    MAX(FechaFinCliente) AS Fin
  FROM Grupos
  GROUP BY IdIntento,Tipo,Grupo
)
SELECT IdIntento,Tipo,COUNT(*) AS IntervalosEfectivos,
  SUM(DATEDIFF_BIG(MILLISECOND,Inicio,Fin)) AS DuracionEfectivaMilisegundos
FROM Islas
GROUP BY IdIntento,Tipo
ORDER BY IdIntento,Tipo;
