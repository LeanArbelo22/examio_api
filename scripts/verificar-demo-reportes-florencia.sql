/* Verificación de sólo lectura para cargar-demo-reportes-florencia.sql */
USE [GestionExamio-Migracion];
SET NOCOUNT ON;

DECLARE @Marca NVARCHAR(100)=N'[DEMO-REPORTES-109000]';

/* 1. Padrón nominal: permite contrastar el conteo exacto de alumnos. */
SELECT MD.Id AS IdMateriaDivision,M.Nombre AS Materia,D.Descripcion AS Division,
  A.Matricula,A.Apellido,A.Nombre,A.Correo,
  CAST(CASE WHEN A.Correo LIKE N'demo.reportes.%@cervantes.edu.ar' THEN 1 ELSE 0 END AS bit)
    AS EsAlumnoDemo
FROM dbo.MateriaDivision MD
JOIN dbo.Materia M ON M.Id=MD.IdMateria
JOIN dbo.Division D ON D.Id=MD.IdDivision
JOIN dbo.InscripcionMateria IM ON IM.IdMateriaDivision=MD.Id
JOIN dbo.Alumno A ON A.Matricula=IM.IdAlumno
WHERE MD.Id IN (32,42) AND MD.IdDocente=109000
ORDER BY MD.Id,A.Matricula;

SELECT MD.Id AS IdMateriaDivision,COUNT(*) AS FilasInscripcion,
  COUNT(DISTINCT IM.IdAlumno) AS AlumnosDistintos,
  SUM(CASE WHEN A.Correo LIKE N'demo.reportes.%@cervantes.edu.ar' THEN 1 ELSE 0 END)
    AS AlumnosDemo
FROM dbo.MateriaDivision MD
JOIN dbo.InscripcionMateria IM ON IM.IdMateriaDivision=MD.Id
JOIN dbo.Alumno A ON A.Matricula=IM.IdAlumno
WHERE MD.Id IN (32,42) AND MD.IdDocente=109000
GROUP BY MD.Id ORDER BY MD.Id;

/* 2. Estructura creada. */
SELECT MD.Id AS IdMateriaDivision,M.Nombre AS Materia,A.Id AS IdActividad,A.Titulo,
  A.EscalaCalificacion,A.NotaAprobacion,A.Estado,
  P.Id AS IdPublicacion,P.FechaInicio,P.FechaFin,
  COUNT(DISTINCT GP.Id) AS Grupos,COUNT(DISTINCT PR.Id) AS Variantes
FROM dbo.Actividad A
JOIN dbo.Publicacion P ON P.IdActividad=A.Id
JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
JOIN dbo.Materia M ON M.Id=MD.IdMateria
LEFT JOIN dbo.GrupoPregunta GP ON GP.IdActividad=A.Id
LEFT JOIN dbo.Pregunta PR ON PR.IdGrupoPregunta=GP.Id
WHERE A.Descripcion=@Marca
GROUP BY MD.Id,M.Nombre,A.Id,A.Titulo,A.EscalaCalificacion,A.NotaAprobacion,A.Estado,
  P.Id,P.FechaInicio,P.FechaFin
ORDER BY MD.Id,P.FechaInicio;

/* 3. Intentos y resultados por publicación. */
SELECT P.Id AS IdPublicacion,A.Titulo,
  COUNT(*) AS IntentosTotales,
  COUNT(DISTINCT I.IdAlumno) AS AlumnosQueRindieron,
  SUM(CASE WHEN I.NumeroIntento>1 THEN 1 ELSE 0 END) AS SegundosIntentos,
  SUM(CASE WHEN I.Estado='entregado' AND I.CorreccionConfirmada=1
    AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END) AS ResultadosConfirmados,
  SUM(CASE WHEN I.NotaFinal>=A.NotaAprobacion THEN 1 ELSE 0 END) AS AprobadosTodosIntentos,
  SUM(CASE WHEN I.NotaFinal<A.NotaAprobacion THEN 1 ELSE 0 END) AS DesaprobadosTodosIntentos,
  MIN(I.NotaFinal) AS NotaMinima,MAX(I.NotaFinal) AS NotaMaxima,
  CAST(AVG(CAST(I.NotaFinal AS DECIMAL(10,2))) AS DECIMAL(10,2)) AS NotaPromedio
FROM dbo.Actividad A
JOIN dbo.Publicacion P ON P.IdActividad=A.Id
JOIN dbo.Intento I ON I.IdPublicacion=P.Id
WHERE A.Descripcion=@Marca
GROUP BY P.Id,A.Titulo,A.NotaAprobacion
ORDER BY P.Id;

/* 4. Selección canónica y resultados oficiales. */
;WITH Seleccion AS (
  SELECT I.IdPublicacion,I.IdAlumno,
    COALESCE(IVO.IdIntento,(
      SELECT TOP (1) I2.Id FROM dbo.Intento I2
      WHERE I2.IdPublicacion=I.IdPublicacion AND I2.IdAlumno=I.IdAlumno
        AND I2.Estado='entregado'
      ORDER BY I2.FechaFin DESC,I2.NumeroIntento DESC,I2.Id DESC
    )) AS IdIntentoValido
  FROM dbo.Intento I
  JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
  JOIN dbo.Actividad A ON A.Id=P.IdActividad
  LEFT JOIN dbo.IntentoValidoOverride IVO
    ON IVO.IdPublicacion=I.IdPublicacion AND IVO.IdAlumno=I.IdAlumno
  WHERE A.Descripcion=@Marca
  GROUP BY I.IdPublicacion,I.IdAlumno,IVO.IdIntento
)
SELECT S.IdPublicacion,
  COUNT(*) AS IntentosValidosEntregados,
  SUM(CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END)
    AS ResultadosConsiderados,
  SUM(CASE WHEN I.CorreccionConfirmada=0 OR I.NotaFinal IS NULL THEN 1 ELSE 0 END)
    AS ResultadosPendientes,
  SUM(CASE WHEN I.NotaFinal>=A.NotaAprobacion THEN 1 ELSE 0 END) AS Aprobados,
  SUM(CASE WHEN I.NotaFinal<A.NotaAprobacion THEN 1 ELSE 0 END) AS Desaprobados
FROM Seleccion S
JOIN dbo.Intento I ON I.Id=S.IdIntentoValido AND I.Estado='entregado'
JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
JOIN dbo.Actividad A ON A.Id=P.IdActividad
GROUP BY S.IdPublicacion
ORDER BY S.IdPublicacion;

/* 5. Rendimiento por grupo/variante. Debe existir al menos un hallazgo <30 con >=10 muestras. */
;WITH Seleccion AS (
  SELECT I.IdPublicacion,I.IdAlumno,
    COALESCE(IVO.IdIntento,(
      SELECT TOP (1) I2.Id FROM dbo.Intento I2
      WHERE I2.IdPublicacion=I.IdPublicacion AND I2.IdAlumno=I.IdAlumno
        AND I2.Estado='entregado'
      ORDER BY I2.FechaFin DESC,I2.NumeroIntento DESC,I2.Id DESC
    )) AS IdIntentoValido
  FROM dbo.Intento I
  JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
  JOIN dbo.Actividad A ON A.Id=P.IdActividad
  LEFT JOIN dbo.IntentoValidoOverride IVO
    ON IVO.IdPublicacion=I.IdPublicacion AND IVO.IdAlumno=I.IdAlumno
  WHERE A.Descripcion=@Marca
  GROUP BY I.IdPublicacion,I.IdAlumno,IVO.IdIntento
), Muestras AS (
  SELECT I.IdPublicacion,IP.GrupoTituloSnapshot,IP.ContenidoHashSnapshot,
    COUNT(*) AS PresentacionesOficiales,
    SUM(CASE WHEN IP.PuntajeObtenido IS NOT NULL AND IP.PuntajeMaximoSnapshot>0
      THEN 1 ELSE 0 END) AS MuestrasConfirmadas,
    AVG(CASE WHEN IP.PuntajeObtenido IS NOT NULL AND IP.PuntajeMaximoSnapshot>0
      THEN IP.PuntajeObtenido*100.0/IP.PuntajeMaximoSnapshot END) AS PorcentajePromedio
  FROM Seleccion S
  JOIN dbo.Intento I ON I.Id=S.IdIntentoValido
    AND I.Estado='entregado' AND I.CorreccionConfirmada=1
  JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
  GROUP BY I.IdPublicacion,IP.GrupoTituloSnapshot,IP.ContenidoHashSnapshot
)
SELECT *,CAST(CASE WHEN MuestrasConfirmadas>=10 AND PorcentajePromedio<30
  THEN 1 ELSE 0 END AS bit) AS HallazgoBajoRendimiento
FROM Muestras
ORDER BY IdPublicacion,GrupoTituloSnapshot,ContenidoHashSnapshot;

/* 6. Tiempos e incidentes; los incidentes normales quedan separados de question_active. */
SELECT P.Id AS IdPublicacion,A.Titulo,
  COUNT(DISTINCT CASE WHEN T.Tipo='question_active' THEN T.Id END) AS IntervalosPregunta,
  COUNT(DISTINCT CASE WHEN C.EsIncidente=1 THEN T.Id END) AS Incidentes,
  COUNT(DISTINCT CASE WHEN C.EsIncidente=1 THEN I.IdAlumno END) AS AlumnosConIncidentes,
  SUM(CASE WHEN T.Tipo='question_active' THEN T.DuracionMilisegundos ELSE 0 END)
    AS TiempoPreguntasMilisegundos,
  SUM(CASE WHEN C.EsIncidente=1 THEN T.DuracionMilisegundos ELSE 0 END)
    AS TiempoIncidentesMilisegundos
FROM dbo.Actividad A
JOIN dbo.Publicacion P ON P.IdActividad=A.Id
JOIN dbo.Intento I ON I.IdPublicacion=P.Id
JOIN dbo.IncidenteIntento T ON T.IdIntento=I.Id
JOIN dbo.TipoEventoTelemetria C ON C.Tipo=T.Tipo
WHERE A.Descripcion=@Marca
GROUP BY P.Id,A.Titulo
ORDER BY P.Id;

/* 7. Controles de integridad: todos deben devolver cero. */
SELECT
  COALESCE(SUM(CASE WHEN I.Estado<>'entregado' THEN 1 ELSE 0 END),0)
    AS IntentosNoEntregados,
  COALESCE(SUM(CASE WHEN I.CorreccionConfirmada<>1 OR I.NotaFinal IS NULL THEN 1 ELSE 0 END),0)
    AS IntentosPendientes,
  COALESCE(SUM(CASE WHEN IP.PuntajeObtenido IS NULL OR IP.PuntajeMaximoSnapshot IS NULL
    THEN 1 ELSE 0 END),0) AS PreguntasSinPuntaje,
  COALESCE(SUM(CASE WHEN IP.ContenidoHashSnapshot IS NULL THEN 1 ELSE 0 END),0)
    AS PreguntasSinHash,
  COALESCE(SUM(CASE WHEN IP.EnunciadoSnapshot IS NULL THEN 1 ELSE 0 END),0)
    AS PreguntasSinEnunciadoSnapshot
FROM dbo.Actividad A
JOIN dbo.Publicacion P ON P.IdActividad=A.Id
JOIN dbo.Intento I ON I.IdPublicacion=P.Id
JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
WHERE A.Descripcion=@Marca;
