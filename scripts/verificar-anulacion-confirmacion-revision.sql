/* Verificación de sólo lectura posterior a 20261015_anulacion_confirmacion_revision.sql. */
SET NOCOUNT ON;

SELECT c.name AS Columna,t.name AS Tipo,c.is_nullable,c.max_length
FROM sys.columns c
JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE c.object_id=OBJECT_ID('dbo.Intento')
  AND c.name IN ('CorreccionConfirmada','CorreccionConfirmadaPor',
                 'FechaCorreccionConfirmada','OrigenConfirmacionCorreccion')
ORDER BY c.column_id;

SELECT o.name AS Objeto,o.type_desc
FROM sys.objects o
WHERE o.name IN ('HistorialEstadoCorreccionIntento','AnulacionIntentoIncidente',
                 'SP_Intento_FinalizarExamen')
ORDER BY o.name;

SELECT
  CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.SP_Intento_FinalizarExamen'))
    LIKE '%CorreccionConfirmada%' THEN 1 ELSE 0 END AS SpActualizaConfirmacion,
  CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.SP_Intento_FinalizarExamen'))
    LIKE '%confirmacion_automatica%' THEN 1 ELSE 0 END AS SpAuditaConfirmacionAutomatica;

SELECT fk.name AS ForeignKey
FROM sys.foreign_keys fk
WHERE fk.parent_object_id IN (
  OBJECT_ID('dbo.Intento'),OBJECT_ID('dbo.HistorialEstadoCorreccionIntento'),
  OBJECT_ID('dbo.AnulacionIntentoIncidente')
)
ORDER BY fk.name;

SELECT cc.name AS CheckConstraint,OBJECT_NAME(cc.parent_object_id) AS Tabla,cc.definition
FROM sys.check_constraints cc
WHERE cc.name IN ('CHK_Intento_ConfirmacionCorreccion','CHK_HistorialEstadoCorreccion_Accion',
                  'CHK_AnulacionIntentoIncidente_Tipo','CHK_AnulacionIntentoIncidente_Motivo',
                  'CHK_IncidenteIntento_Tipo')
ORDER BY Tabla,CheckConstraint;

SELECT
  SUM(CASE WHEN CorreccionConfirmada=1 THEN 1 ELSE 0 END) AS Confirmados,
  SUM(CASE WHEN CorreccionConfirmada=0 THEN 1 ELSE 0 END) AS Pendientes,
  SUM(CASE WHEN CorreccionConfirmada=1 AND FechaCorreccionConfirmada IS NULL THEN 1 ELSE 0 END)
    AS ConfirmadosSinFecha,
  SUM(CASE WHEN CorreccionConfirmada=0 AND
    (CorreccionConfirmadaPor IS NOT NULL OR FechaCorreccionConfirmada IS NOT NULL
      OR OrigenConfirmacionCorreccion IS NOT NULL) THEN 1 ELSE 0 END) AS PendientesInconsistentes
FROM dbo.Intento;

SELECT TOP (20) IdIntento,EstadoAnterior,EstadoNuevo,Accion,ModificadoPor,FechaModificacion
FROM dbo.HistorialEstadoCorreccionIntento
ORDER BY Id DESC;

SELECT TOP (20) IdIntento,EventoId,TipoIncidente,Motivo,AnuladoPor,FechaAnulacion
FROM dbo.AnulacionIntentoIncidente
ORDER BY Id DESC;
