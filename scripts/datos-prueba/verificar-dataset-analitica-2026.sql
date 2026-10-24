/*
  Verificador EXCLUSIVAMENTE DE LECTURA para generar-dataset-analitica-2026.sql.
  No modifica datos, no crea temporales y no ejecuta procedimientos almacenados.
*/
SET NOCOUNT ON;

DECLARE @BaseObjetivo SYSNAME=N'GestionExamio';
DECLARE @LoteId UNIQUEIDENTIFIER='7D7DFF9A-7E02-4FB0-9C8F-202603102026';

IF DB_NAME()<>@BaseObjetivo
  THROW 53100,'Base incorrecta para la verificación.',1;
IF OBJECT_ID(N'dbo.ExamioTestDataLote',N'U') IS NULL OR
   OBJECT_ID(N'dbo.ExamioTestDataEntidad',N'U') IS NULL
  THROW 53101,'No existen las tablas auxiliares del dataset sintético.',1;
IF NOT EXISTS (SELECT 1 FROM dbo.ExamioTestDataLote WHERE LoteId=@LoteId)
  THROW 53102,'El lote configurado no existe.',1;

/* 1. Identidad persistente y configuración exacta del lote. */
SELECT LoteId,ConfigHash,ConfigJson,FechaCreacionUtc,Advertencia
FROM dbo.ExamioTestDataLote WHERE LoteId=@LoteId;

SELECT Tipo,COUNT(*) AS Entidades,MIN(IdEntidad) AS IdMinimo,MAX(IdEntidad) AS IdMaximo
FROM dbo.ExamioTestDataEntidad WHERE LoteId=@LoteId
GROUP BY Tipo ORDER BY Tipo;

/* 2. Distribución por mes, carrera, materia y comisión. */
;WITH Pubs AS (
  SELECT CONVERT(INT,E.IdEntidad) AS IdPublicacion
  FROM dbo.ExamioTestDataEntidad E
  WHERE E.LoteId=@LoteId AND E.Tipo='publicacion'
)
SELECT YEAR(Z.FechaInicioLocal) AS AnioLocal,MONTH(Z.FechaInicioLocal) AS MesLocal,
  C.Id AS IdCarrera,C.Nombre AS Carrera,M.Id AS IdMateria,M.Nombre AS Materia,
  MD.Id AS IdComision,DV.Descripcion AS Division,MD.IdDocente,
  COUNT(*) AS Publicaciones,COUNT(DISTINCT A.Id) AS Actividades,
  COUNT(DISTINCT I.Id) AS Intentos,COUNT(DISTINCT I.IdAlumno) AS AlumnosConIntento
FROM Pubs X JOIN dbo.Publicacion P ON P.Id=X.IdPublicacion
CROSS APPLY (SELECT CONVERT(DATETIME2(3),(P.FechaInicio AT TIME ZONE 'UTC')
  AT TIME ZONE 'Argentina Standard Time') AS FechaInicioLocal) Z
JOIN dbo.Actividad A ON A.Id=P.IdActividad
JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
JOIN dbo.Materia M ON M.Id=MD.IdMateria JOIN dbo.Carrera C ON C.Id=M.IdCarrera
LEFT JOIN dbo.Division DV ON DV.Id=MD.IdDivision
LEFT JOIN dbo.Intento I ON I.IdPublicacion=P.Id
GROUP BY YEAR(Z.FechaInicioLocal),MONTH(Z.FechaInicioLocal),C.Id,C.Nombre,M.Id,M.Nombre,
  MD.Id,DV.Descripcion,MD.IdDocente
ORDER BY AnioLocal,MesLocal,C.Id,M.Id,MD.Id;

/* 3. Deben existir al menos dos publicaciones por comisión y mes incluido. */
;WITH Pubs AS (
  SELECT CONVERT(INT,E.IdEntidad) AS IdPublicacion
  FROM dbo.ExamioTestDataEntidad E WHERE E.LoteId=@LoteId AND E.Tipo='publicacion'
)
SELECT P.IdMateriaDivision,YEAR(Z.FechaInicioLocal) AS AnioLocal,MONTH(Z.FechaInicioLocal) AS MesLocal,
  COUNT(*) AS Publicaciones,
  CAST(CASE WHEN COUNT(*)>=2 THEN 1 ELSE 0 END AS BIT) AS CumpleMinimo
FROM Pubs X JOIN dbo.Publicacion P ON P.Id=X.IdPublicacion
CROSS APPLY (SELECT CONVERT(DATETIME2(3),(P.FechaInicio AT TIME ZONE 'UTC')
  AT TIME ZONE 'Argentina Standard Time') AS FechaInicioLocal) Z
GROUP BY P.IdMateriaDivision,YEAR(Z.FechaInicioLocal),MONTH(Z.FechaInicioLocal)
ORDER BY P.IdMateriaDivision,AnioLocal,MesLocal;

/* 4. Selección válida: override primero; en su ausencia, último entregado. */
;WITH Pubs AS (
  SELECT CONVERT(INT,E.IdEntidad) AS IdPublicacion FROM dbo.ExamioTestDataEntidad E
  WHERE E.LoteId=@LoteId AND E.Tipo='publicacion'
), Pares AS (
  SELECT DISTINCT I.IdPublicacion,I.IdAlumno FROM dbo.Intento I JOIN Pubs P ON P.IdPublicacion=I.IdPublicacion
), Validos AS (
  SELECT P.IdPublicacion,P.IdAlumno,COALESCE(O.IdIntento,V.Id) AS IdIntentoValido,
    CASE WHEN O.IdIntento IS NULL THEN 'automatico' ELSE 'override' END AS Seleccion
  FROM Pares P LEFT JOIN dbo.IntentoValidoOverride O
    ON O.IdPublicacion=P.IdPublicacion AND O.IdAlumno=P.IdAlumno
  OUTER APPLY (SELECT TOP (1) I.Id FROM dbo.Intento I
    WHERE I.IdPublicacion=P.IdPublicacion AND I.IdAlumno=P.IdAlumno AND I.Estado='entregado'
    ORDER BY I.FechaFin DESC,I.NumeroIntento DESC,I.Id DESC) V
)
SELECT V.IdPublicacion,
  COUNT(*) AS AlumnosConAlgunIntento,
  SUM(CASE WHEN V.IdIntentoValido IS NOT NULL THEN 1 ELSE 0 END) AS ConIntentoValidoEntregado,
  SUM(CASE WHEN V.Seleccion='override' THEN 1 ELSE 0 END) AS Overrides,
  SUM(CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END) AS ResultadosConsiderados,
  SUM(CASE WHEN I.Id IS NOT NULL AND (I.CorreccionConfirmada=0 OR I.NotaFinal IS NULL) THEN 1 ELSE 0 END) AS ResultadosPendientes,
  SUM(CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal>=A.NotaAprobacion THEN 1 ELSE 0 END) AS Aprobados,
  SUM(CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal<A.NotaAprobacion THEN 1 ELSE 0 END) AS Desaprobados
FROM Validos V LEFT JOIN dbo.Intento I ON I.Id=V.IdIntentoValido
JOIN dbo.Publicacion PU ON PU.Id=V.IdPublicacion JOIN dbo.Actividad A ON A.Id=PU.IdActividad
GROUP BY V.IdPublicacion ORDER BY V.IdPublicacion;

/* 5. Pendientes operativos de todos los intentos. Las categorías se superponen. */
;WITH IntentosLote AS (
  SELECT I.* FROM dbo.ExamioTestDataEntidad E JOIN dbo.Intento I ON I.Id=E.IdEntidad
  WHERE E.LoteId=@LoteId AND E.Tipo='intento'
)
SELECT COUNT(*) AS IntentosTotales,
  SUM(CASE WHEN Estado='en_progreso' THEN 1 ELSE 0 END) AS EnProgreso,
  SUM(CASE WHEN Estado='entregado' AND CorreccionConfirmada=0 THEN 1 ELSE 0 END) AS PendientesConfirmacion,
  SUM(CASE WHEN Estado='entregado' AND NotaFinal IS NULL THEN 1 ELSE 0 END) AS SinNota,
  SUM(CASE WHEN EXISTS(SELECT 1 FROM dbo.IntentoPregunta IP WHERE IP.IdIntento=I.Id AND IP.PuntajeObtenido IS NULL)
    THEN 1 ELSE 0 END) AS ConPreguntasSinPuntaje,
  SUM(CASE WHEN Estado='entregado' AND (CorreccionConfirmada=0 OR NotaFinal IS NULL OR EXISTS(
    SELECT 1 FROM dbo.IntentoPregunta IP WHERE IP.IdIntento=I.Id AND IP.PuntajeObtenido IS NULL))
    THEN 1 ELSE 0 END) AS UnionEntregadosPendientes
FROM IntentosLote I;

/* 6. Coherencia de puntajes y notas. Todos los contadores de error deben ser cero. */
;WITH IntentosLote AS (
  SELECT I.* FROM dbo.ExamioTestDataEntidad E JOIN dbo.Intento I ON I.Id=E.IdEntidad
  WHERE E.LoteId=@LoteId AND E.Tipo='intento'
), Totales AS (
  SELECT I.Id,I.Estado,I.NotaFinalCalculada,I.NotaFinalManual,I.NotaFinal,I.CorreccionConfirmada,
    SUM(IP.PuntajeObtenido) AS SumaPuntajes,
    SUM(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS Pendientes,
    SUM(CASE WHEN IP.PuntajeObtenido<0 OR IP.PuntajeObtenido>IP.PuntajeMaximoSnapshot THEN 1 ELSE 0 END) AS FueraRango
  FROM IntentosLote I LEFT JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
  GROUP BY I.Id,I.Estado,I.NotaFinalCalculada,I.NotaFinalManual,I.NotaFinal,I.CorreccionConfirmada
)
SELECT
  SUM(CASE WHEN FueraRango>0 THEN 1 ELSE 0 END) AS IntentosConPuntajesFueraRango,
  SUM(CASE WHEN Pendientes=0 AND Estado='entregado' AND
    (NotaFinalCalculada IS NULL OR ABS(NotaFinalCalculada-SumaPuntajes)>0.001) THEN 1 ELSE 0 END) AS NotasCalculadasIncoherentes,
  SUM(CASE WHEN Pendientes>0 AND NotaFinalCalculada IS NOT NULL THEN 1 ELSE 0 END) AS PendientesConNotaCalculada,
  SUM(CASE WHEN NotaFinalManual IS NULL AND NotaFinalCalculada IS NOT NULL AND
    ABS(NotaFinal-NotaFinalCalculada)>0.001 THEN 1 ELSE 0 END) AS NotasEfectivasIncoherentes,
  SUM(CASE WHEN NotaFinalManual IS NOT NULL AND ABS(NotaFinal-NotaFinalManual)>0.001 THEN 1 ELSE 0 END) AS OverridesNotaIncoherentes,
  SUM(CASE WHEN CorreccionConfirmada=1 AND Pendientes>0 THEN 1 ELSE 0 END) AS ConfirmadosConPreguntasPendientes
FROM Totales;

/* 7. Muestra oficial por pregunta/contenido: omisiones con cero sí cuentan. */
;WITH Pubs AS (
  SELECT CONVERT(INT,E.IdEntidad) AS IdPublicacion FROM dbo.ExamioTestDataEntidad E
  WHERE E.LoteId=@LoteId AND E.Tipo='publicacion'
), Pares AS (
  SELECT DISTINCT I.IdPublicacion,I.IdAlumno FROM dbo.Intento I JOIN Pubs P ON P.IdPublicacion=I.IdPublicacion
), Validos AS (
  SELECT P.IdPublicacion,P.IdAlumno,COALESCE(O.IdIntento,V.Id) AS IdIntento
  FROM Pares P LEFT JOIN dbo.IntentoValidoOverride O ON O.IdPublicacion=P.IdPublicacion AND O.IdAlumno=P.IdAlumno
  OUTER APPLY (SELECT TOP (1) I.Id FROM dbo.Intento I WHERE I.IdPublicacion=P.IdPublicacion
    AND I.IdAlumno=P.IdAlumno AND I.Estado='entregado' ORDER BY I.FechaFin DESC,I.NumeroIntento DESC,I.Id DESC) V
), Muestras AS (
  SELECT IP.ContenidoHashSnapshot,MIN(IP.IdPregunta) AS IdPreguntaRepresentativa,
    COUNT(*) AS Presentadas,
    SUM(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS ExcluidasSinPuntaje,
    SUM(CASE WHEN IP.PuntajeObtenido IS NOT NULL AND ISNULL(IP.PuntajeMaximoSnapshot,0)<=0 THEN 1 ELSE 0 END) AS ExcluidasSinMaximo,
    SUM(CASE WHEN IP.PuntajeObtenido IS NOT NULL AND IP.PuntajeMaximoSnapshot>0 THEN 1 ELSE 0 END) AS MuestrasConfirmadas,
    SUM(CASE WHEN IP.PuntajeObtenido IS NOT NULL AND IP.PuntajeMaximoSnapshot>0
      THEN IP.PuntajeObtenido ELSE 0 END) AS PuntajeObtenido,
    SUM(CASE WHEN IP.PuntajeObtenido IS NOT NULL AND IP.PuntajeMaximoSnapshot>0
      THEN IP.PuntajeMaximoSnapshot ELSE 0 END) AS PuntajeMaximo
  FROM Validos V JOIN dbo.Intento I ON I.Id=V.IdIntento AND I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL
  JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
  GROUP BY IP.ContenidoHashSnapshot
)
SELECT *,CAST(PuntajeObtenido*100.0/NULLIF(PuntajeMaximo,0) AS DECIMAL(9,2)) AS PorcentajePuntaje,
  CAST(CASE WHEN MuestrasConfirmadas>=10 AND PuntajeObtenido*100.0/NULLIF(PuntajeMaximo,0)<30 THEN 1 ELSE 0 END AS BIT)
    AS HallazgoBajoRendimiento
FROM Muestras ORDER BY HallazgoBajoRendimiento DESC,MuestrasConfirmadas DESC,ContenidoHashSnapshot;

/* 8. Variantes: diferencias descriptivas, sin inferencia pedagógica automática. */
;WITH IntentosLote AS (
  SELECT I.Id FROM dbo.ExamioTestDataEntidad E JOIN dbo.Intento I ON I.Id=E.IdEntidad
  WHERE E.LoteId=@LoteId AND E.Tipo='intento' AND I.Estado='entregado' AND I.CorreccionConfirmada=1
)
SELECT IP.GrupoTituloSnapshot,IP.ContenidoHashSnapshot,MIN(IP.IdPregunta) AS IdPregunta,
  COUNT(*) AS Muestras,SUM(IP.PuntajeObtenido) AS PuntajeObtenido,
  SUM(IP.PuntajeMaximoSnapshot) AS PuntajeMaximo,
  CAST(SUM(IP.PuntajeObtenido)*100.0/NULLIF(SUM(IP.PuntajeMaximoSnapshot),0) AS DECIMAL(9,2)) AS Porcentaje
FROM IntentosLote I JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
WHERE IP.PuntajeObtenido IS NOT NULL AND IP.PuntajeMaximoSnapshot>0
GROUP BY IP.GrupoTituloSnapshot,IP.ContenidoHashSnapshot
ORDER BY IP.GrupoTituloSnapshot,IP.ContenidoHashSnapshot;

/* 9. Integridad estructural y hash canónico. Todos los errores deben ser cero. */
;WITH Pubs AS (
  SELECT CONVERT(INT,E.IdEntidad) AS IdPublicacion FROM dbo.ExamioTestDataEntidad E
  WHERE E.LoteId=@LoteId AND E.Tipo='publicacion'
), Actividades AS (
  SELECT DISTINCT P.IdActividad FROM Pubs X JOIN dbo.Publicacion P ON P.Id=X.IdPublicacion
), Preguntas AS (
  SELECT PR.* FROM Actividades A JOIN dbo.GrupoPregunta G ON G.IdActividad=A.IdActividad
  JOIN dbo.Pregunta PR ON PR.IdGrupoPregunta=G.Id
), Hashes AS (
  SELECT P.Id,P.ContenidoHash,CONVERT(CHAR(64),HASHBYTES('SHA2_256',CONVERT(NVARCHAR(MAX),
    CONCAT(N'v1|',P.Tipo,N'|',P.Enunciado,N'|',P.ModoJustificacion,N'|',P.EstrategiaCorreccion,N'|',
      P.TratamientoJustificacion,N'|',COALESCE((SELECT ROW_NUMBER() OVER(ORDER BY O.Id) AS posicion,
        O.Texto AS texto,O.EsCorrecta AS esCorrecta FROM dbo.Opcion O WHERE O.IdPregunta=P.Id
        ORDER BY O.Id FOR JSON PATH),N'[]')))),2) AS HashCalculado
  FROM Preguntas P
)
SELECT
  (SELECT COUNT(*) FROM Pubs X LEFT JOIN dbo.Publicacion P ON P.Id=X.IdPublicacion WHERE P.Id IS NULL) AS PublicacionesFaltantes,
  (SELECT COUNT(*) FROM Actividades A OUTER APPLY (SELECT COUNT(*) C FROM dbo.GrupoPregunta G WHERE G.IdActividad=A.IdActividad) G
    WHERE G.C<10) AS ActividadesConMenosDeDiezGrupos,
  (SELECT COUNT(*) FROM Hashes WHERE ContenidoHash IS NULL OR ContenidoHash<>HashCalculado) AS HashesInvalidos,
  (SELECT COUNT(*) FROM dbo.ExamioTestDataEntidad E JOIN dbo.Intento I ON I.Id=E.IdEntidad
    LEFT JOIN dbo.IntentoPoliticaSupervision S ON S.IdIntento=I.Id
    LEFT JOIN dbo.EstadoSupervisionIntento ES ON ES.IdIntento=I.Id
    WHERE E.LoteId=@LoteId AND E.Tipo='intento' AND (S.IdIntento IS NULL OR ES.IdIntento IS NULL)) AS IntentosSinSupervision,
  (SELECT COUNT(*) FROM dbo.ExamioTestDataEntidad E JOIN dbo.Intento I ON I.Id=E.IdEntidad
    JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
    WHERE E.LoteId=@LoteId AND E.Tipo='intento' AND
      (IP.ContenidoHashSnapshot IS NULL OR IP.EnunciadoSnapshot IS NULL OR IP.TipoSnapshot IS NULL)) AS SnapshotsIncompletos,
  (SELECT COUNT(*) FROM (SELECT R.IdIntento,R.IdPregunta
    FROM dbo.Respuesta R JOIN dbo.ExamioTestDataEntidad E ON E.IdEntidad=R.IdIntento
    WHERE E.LoteId=@LoteId AND E.Tipo='intento'
    GROUP BY R.IdIntento,R.IdPregunta HAVING COUNT(*)>1) D) AS RespuestasDuplicadas;

/* 10. Reconciliación global versus carrera/materia/comisión. Debe dar cero diferencia. */
;WITH Pubs AS (
  SELECT CONVERT(INT,E.IdEntidad) AS IdPublicacion FROM dbo.ExamioTestDataEntidad E
  WHERE E.LoteId=@LoteId AND E.Tipo='publicacion'
), Pares AS (
  SELECT DISTINCT I.IdPublicacion,I.IdAlumno FROM dbo.Intento I JOIN Pubs P ON P.IdPublicacion=I.IdPublicacion
), Validos AS (
  SELECT P.IdPublicacion,P.IdAlumno,COALESCE(O.IdIntento,V.Id) IdIntento
  FROM Pares P LEFT JOIN dbo.IntentoValidoOverride O ON O.IdPublicacion=P.IdPublicacion AND O.IdAlumno=P.IdAlumno
  OUTER APPLY (SELECT TOP (1) I.Id FROM dbo.Intento I WHERE I.IdPublicacion=P.IdPublicacion
    AND I.IdAlumno=P.IdAlumno AND I.Estado='entregado' ORDER BY I.FechaFin DESC,I.NumeroIntento DESC,I.Id DESC) V
), Base AS (
  SELECT C.Id IdCarrera,M.Id IdMateria,MD.Id IdComision,
    CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END Considerado,
    CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal>=A.NotaAprobacion THEN 1 ELSE 0 END Aprobado,
    CASE WHEN I.Id IS NOT NULL AND (I.CorreccionConfirmada=0 OR I.NotaFinal IS NULL) THEN 1 ELSE 0 END Pendiente
  FROM Validos V LEFT JOIN dbo.Intento I ON I.Id=V.IdIntento
  JOIN dbo.Publicacion P ON P.Id=V.IdPublicacion JOIN dbo.Actividad A ON A.Id=P.IdActividad
  JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision JOIN dbo.Materia M ON M.Id=MD.IdMateria
  JOIN dbo.Carrera C ON C.Id=M.IdCarrera
), Global AS (SELECT SUM(Considerado) C,SUM(Aprobado) A,SUM(Pendiente) P FROM Base),
PorComision AS (SELECT IdComision,SUM(Considerado) C,SUM(Aprobado) A,SUM(Pendiente) P FROM Base GROUP BY IdComision),
Suma AS (SELECT SUM(C) C,SUM(A) A,SUM(P) P FROM PorComision)
SELECT G.C AS ConsideradosGlobal,S.C AS ConsideradosComisiones,G.C-S.C AS DiferenciaConsiderados,
  G.A AS AprobadosGlobal,S.A AS AprobadosComisiones,G.A-S.A AS DiferenciaAprobados,
  G.P AS PendientesGlobal,S.P AS PendientesComisiones,G.P-S.P AS DiferenciaPendientes
FROM Global G CROSS JOIN Suma S;
