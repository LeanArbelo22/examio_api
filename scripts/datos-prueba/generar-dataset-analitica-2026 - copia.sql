/*
  Dataset sintético reproducible para analítica docente e institucional de Examio.

  EXCLUSIVO PARA BASES DE PRUEBA. NO es una migración del producto.
  Este archivo no debe ejecutarse en producción. No crea usuarios, alumnos ni
  docentes. Reemplaza exclusivamente las inscripciones sintéticas reconocidas
  del lote de preparación para modelar cohortes plausibles; no invoca Stored
  Procedures de negocio (sólo usa sys.sp_executesql para DDL dinámico de las
  tablas auxiliares de prueba).

  Planificación sintética (no es una entidad del producto): cada carrera conserva
  30 materias en seis semestres reales de cinco materias. Los 60 alumnos existentes
  por carrera representan cohortes de ingreso 2024 y 2025, de 30 integrantes cada
  una. Cada cohorte cursa cinco materias en marzo-junio y cinco en agosto-noviembre,
  y avanza un año curricular por ciclo lectivo. InscripcionMateria no conserva
  historia: se materializa únicamente la matrícula vigente en 2026; la pertenencia
  histórica se reconstruye dentro de este generador mediante lote, carrera y cohorte.

  Con la configuración completa se esperan 240 alumnos reutilizados, 2.400
  inscripciones vigentes, 200 comisiones-cohorte con actividad histórica, 400
  publicaciones regulares programadas (380 rendidas hasta el corte), 20 recuperatorios
  rendidos y 20 publicaciones de noviembre de 2026 sin intentos. Los intentos
  exactos dependen de participación y reintentos determinísticos y se informan en
  el preflight.

  Fechas: las variables de calendario se expresan en America/Buenos_Aires
  (Windows SQL Server: "Argentina Standard Time"). Publicacion.FechaInicio/FechaFin
  y las fechas de intento/corrección se escriben como instantes UTC sin offset,
  conforme a la convención efectiva de la API para DATETIME/DATETIME2.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

/* Permite reintentar el archivo completo en la misma sesión de SSMS después de
   un error o de una ejecución en modo estimación. Sólo elimina tablas temporales
   locales de esta conexión; no modifica objetos ni datos permanentes. */
DROP TABLE IF EXISTS #IntentosValidos;
DROP TABLE IF EXISTS #ResultadoPregunta;
DROP TABLE IF EXISTS #Participantes;
DROP TABLE IF EXISTS #Mapa;
DROP TABLE IF EXISTS #Specs;
DROP TABLE IF EXISTS #Comisiones;
DROP TABLE IF EXISTS #Alcance;
DROP TABLE IF EXISTS #PlanInscripcion;
DROP TABLE IF EXISTS #CohorteAlumno;
DROP TABLE IF EXISTS #ComisionPlan;
DROP TABLE IF EXISTS #MateriaPlan;
DROP TABLE IF EXISTS #CarreraPlan;

/* ======================== CONFIGURACIÓN DEL LOTE ======================== */
DECLARE @BaseObjetivo SYSNAME = N'GestionExamio-Migracion';
DECLARE @CONFIRMAR_CARGA BIT = 0; -- cambiar a 1 sólo después de revisar y respaldar
DECLARE @LotePreparacion UNIQUEIDENTIFIER = 'A1202603-2026-4C04-8EED-000000000001';
DECLARE @LoteId UNIQUEIDENTIFIER = '7D7DFF9A-7E02-4FB0-9C8F-202401012026';
DECLARE @Semilla NVARCHAR(100) = N'examio-analitica-seis-semestres-2024-2026-v3';
-- Usar constructores tipados evita depender de DATEFORMAT/LANGUAGE de SQL Server.
DECLARE @FechaInicialLocal DATE = DATEFROMPARTS(2024,1,1);
DECLARE @FechaFinalLocal DATE = DATEFROMPARTS(2026,10,24);
DECLARE @FechaFinProgramacionLocal DATE = DATEFROMPARTS(2026,11,30);
DECLARE @FechaCorteLocal DATETIME2(3) = DATETIME2FROMPARTS(2026,10,24,23,59,59,997,3);
DECLARE @ZonaHorariaSql SYSNAME = N'Argentina Standard Time';
DECLARE @VersionGenerador VARCHAR(20) = '3.0.0';
DECLARE @FechaLimiteLocal DATETIME2(3)=CASE
  WHEN @FechaCorteLocal<DATEADD(MILLISECOND,-3,DATEADD(DAY,1,CONVERT(DATETIME2(3),@FechaFinalLocal)))
    THEN @FechaCorteLocal
  ELSE DATEADD(MILLISECOND,-3,DATEADD(DAY,1,CONVERT(DATETIME2(3),@FechaFinalLocal))) END;
DECLARE @FechaCorteUtc DATETIME2(3)=CONVERT(DATETIME2(3),
  (@FechaLimiteLocal AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC');

DECLARE @EvaluacionesPorComisionSemestre INT = 2;
DECLARE @CrearRecuperatoriosJulio BIT = 1;
DECLARE @CadaNComisionesConRecuperatorio INT = 5;
DECLARE @ParticipantesPorRecuperatorio INT = 12;
DECLARE @PreguntasPorEvaluacion INT = 10;       -- equivale a grupos presentados
DECLARE @VariantesPorGrupo INT = 2;
DECLARE @GruposConVariantes INT = 4;
DECLARE @MaxParticipantesPorPublicacion INT = 30;

-- Listas CSV de IDs; NULL incluye todo el alcance elegible.
DECLARE @FiltroIdsCarrera NVARCHAR(MAX) = NULL;
DECLARE @FiltroIdsMateria NVARCHAR(MAX) = NULL;
DECLARE @FiltroIdsComision NVARCHAR(MAX) = NULL;
DECLARE @FiltroIdsDocente NVARCHAR(MAX) = NULL;

DECLARE @ExcluirSinDocente BIT = 1;
DECLARE @ExcluirSinAlumnos BIT = 1;
DECLARE @SoloEstimar BIT = 0; -- 1: muestra alcance/volumen y termina sin escribir

DECLARE @TasaParticipacion DECIMAL(6,5) = 0.92000;
DECLARE @TasaReintento DECIMAL(6,5) = 0.08000;
DECLARE @TasaOmission DECIMAL(6,5) = 0.08000;
DECLARE @TasaPendienteConfirmacionAntigua DECIMAL(6,5) = 0.00000;
DECLARE @TasaPendienteConfirmacionReciente DECIMAL(6,5) = 0.14000;
DECLARE @TasaPendientePuntajeAntigua DECIMAL(6,5) = 0.00000;
DECLARE @TasaPendientePuntajeReciente DECIMAL(6,5) = 0.05000;

-- Probabilidades base (0..1). Se ajustan por perfil, tendencia, alumno,
-- evaluación, pregunta y variante, siempre de forma determinística.
DECLARE @ProbAciertoAlta DECIMAL(6,5) = 0.78000;
DECLARE @ProbAciertoMedia DECIMAL(6,5) = 0.68000;
DECLARE @ProbAciertoBaja DECIMAL(6,5) = 0.58000;
DECLARE @ProbCreditoParcial DECIMAL(6,5) = 0.16000;

/* =========================== GUARDAS BÁSICAS =========================== */
IF DB_NAME() <> @BaseObjetivo
  THROW 53000, 'Base incorrecta. Seleccione la base configurada en @BaseObjetivo antes de ejecutar.', 1;
IF @CONFIRMAR_CARGA<>1 AND @SoloEstimar=0
  THROW 53014, 'Preflight correcto. Cambie @CONFIRMAR_CARGA a 1 sólo para la ejecución manual autorizada.', 1;

IF @FechaInicialLocal>@FechaFinalLocal OR @FechaCorteLocal<CAST(@FechaInicialLocal AS DATETIME2(3))
  THROW 53001, 'Rango de fechas o fecha de corte inválidos.', 1;
IF @EvaluacionesPorComisionSemestre<>2 OR @CadaNComisionesConRecuperatorio<1 OR
   @PreguntasPorEvaluacion<10 OR
   @VariantesPorGrupo<1 OR @GruposConVariantes<0 OR
   @GruposConVariantes>@PreguntasPorEvaluacion OR @MaxParticipantesPorPublicacion<1
  THROW 53002, 'Configuración de volumen inválida.', 1;
IF @TasaParticipacion NOT BETWEEN 0 AND 1 OR
   @TasaReintento NOT BETWEEN 0 AND 1 OR @TasaOmission NOT BETWEEN 0 AND 1 OR
   @TasaPendienteConfirmacionAntigua NOT BETWEEN 0 AND 1 OR
   @TasaPendienteConfirmacionReciente NOT BETWEEN 0 AND 1 OR
   @TasaPendientePuntajeAntigua NOT BETWEEN 0 AND 1 OR
   @TasaPendientePuntajeReciente NOT BETWEEN 0 AND 1 OR
   @TasaPendienteConfirmacionReciente+@TasaPendientePuntajeReciente>1
  THROW 53003, 'Todas las tasas deben estar entre 0 y 1.', 1;
IF DATEDIFF(MONTH,DATEFROMPARTS(YEAR(@FechaInicialLocal),MONTH(@FechaInicialLocal),1),
  DATEFROMPARTS(YEAR(@FechaFinalLocal),MONTH(@FechaFinalLocal),1))+1>60
  THROW 53004, 'El rango supera 60 meses calendario.', 1;

IF EXISTS (
  SELECT 1 FROM (VALUES (@FiltroIdsCarrera),(@FiltroIdsMateria),(@FiltroIdsComision),(@FiltroIdsDocente)) F(Lista)
  CROSS APPLY STRING_SPLIT(COALESCE(F.Lista,N''),N',') S
  WHERE NULLIF(LTRIM(RTRIM(S.value)),N'') IS NOT NULL
    AND TRY_CONVERT(INT,LTRIM(RTRIM(S.value))) IS NULL
)
  THROW 53005, 'Un filtro CSV contiene un identificador no numérico.', 1;

IF OBJECT_ID(N'dbo.Actividad',N'U') IS NULL OR OBJECT_ID(N'dbo.Publicacion',N'U') IS NULL OR
   OBJECT_ID(N'dbo.GrupoPregunta',N'U') IS NULL OR OBJECT_ID(N'dbo.Pregunta',N'U') IS NULL OR
   OBJECT_ID(N'dbo.Opcion',N'U') IS NULL OR OBJECT_ID(N'dbo.Intento',N'U') IS NULL OR
   OBJECT_ID(N'dbo.IntentoPregunta',N'U') IS NULL OR OBJECT_ID(N'dbo.IntentoPreguntaOpcionSnapshot',N'U') IS NULL OR
   OBJECT_ID(N'dbo.Respuesta',N'U') IS NULL OR OBJECT_ID(N'dbo.RespuestaOpcion',N'U') IS NULL OR
   OBJECT_ID(N'dbo.HistorialCorreccionIntentoPregunta',N'U') IS NULL OR
   OBJECT_ID(N'dbo.HistorialEstadoCorreccionIntento',N'U') IS NULL OR
   OBJECT_ID(N'dbo.IntentoValidoOverride',N'U') IS NULL OR
   OBJECT_ID(N'dbo.HistorialIntentoValidoOverride',N'U') IS NULL
  THROW 53006, 'Faltan tablas o migraciones requeridas para intentos, snapshots y auditoría.', 1;

IF COL_LENGTH(N'dbo.Pregunta',N'ContenidoHash') IS NULL OR
   COL_LENGTH(N'dbo.IntentoPregunta',N'ContenidoHashSnapshot') IS NULL OR
   COL_LENGTH(N'dbo.Intento',N'CorreccionConfirmada') IS NULL OR
   COL_LENGTH(N'dbo.IncidenteIntento',N'IdIntentoPregunta') IS NULL OR
   COL_LENGTH(N'dbo.IncidenteIntento',N'SesionClienteId') IS NULL OR
   COL_LENGTH(N'dbo.IncidenteIntento',N'SecuenciaCliente') IS NULL OR
   COL_LENGTH(N'dbo.IncidenteIntento',N'VersionContrato') IS NULL
  THROW 53007, 'Faltan columnas de hash, snapshots, confirmación o telemetría temporal.', 1;

IF OBJECT_ID(N'dbo.PoliticaRevisionPublicacion',N'U') IS NULL OR
   OBJECT_ID(N'dbo.AuditoriaRevisionIntento',N'U') IS NULL OR
   OBJECT_ID(N'dbo.PoliticaSupervisionPublicacion',N'U') IS NULL OR
   OBJECT_ID(N'dbo.ReglaSupervisionPublicacion',N'U') IS NULL OR
   OBJECT_ID(N'dbo.IntentoPoliticaSupervision',N'U') IS NULL OR
   OBJECT_ID(N'dbo.IntentoReglaSupervision',N'U') IS NULL OR
   OBJECT_ID(N'dbo.EstadoSupervisionIntento',N'U') IS NULL
  THROW 53008, 'Faltan migraciones de revisión o supervisión.', 1;

/* ================ PLAN DE COHORTES Y ESTIMACIÓN (SÓLO LECTURA) ================ */
IF OBJECT_ID(N'dbo.ExamioTestDataLote',N'U') IS NULL OR
   OBJECT_ID(N'dbo.ExamioTestDataEntidad',N'U') IS NULL OR
   NOT EXISTS (SELECT 1 FROM dbo.ExamioTestDataEntidad
     WHERE LoteId=@LotePreparacion AND Tipo='etapa' AND ClaveLogica=N'01-preparacion')
  THROW 53015, 'Debe aplicarse primero el lote de preparación académica reconocido.', 1;

CREATE TABLE #CarreraPlan(
  IdCarrera INT PRIMARY KEY,Carrera NVARCHAR(300),CarreraOrden INT UNIQUE
);
INSERT #CarreraPlan
SELECT C.Id,C.Nombre,TRY_CONVERT(INT,STUFF(E.ClaveLogica,1,2,N''))
FROM dbo.ExamioTestDataEntidad E
JOIN dbo.Carrera C ON C.Id=E.IdEntidad
WHERE E.LoteId=@LotePreparacion AND E.Tipo='carrera'
  AND (@FiltroIdsCarrera IS NULL OR EXISTS (SELECT 1 FROM STRING_SPLIT(@FiltroIdsCarrera,N',') X
    WHERE TRY_CONVERT(INT,X.value)=C.Id));

CREATE TABLE #MateriaPlan(
  IdCarrera INT,CarreraOrden INT,IdMateria INT PRIMARY KEY,Materia NVARCHAR(300),
  SemestreCurricular INT,OrdenEnSemestre INT
);
INSERT #MateriaPlan
SELECT C.IdCarrera,C.CarreraOrden,M.Id,M.Nombre,M.Semestre,
  ROW_NUMBER() OVER(PARTITION BY M.IdCarrera,M.Semestre ORDER BY M.Id)
FROM #CarreraPlan C JOIN dbo.Materia M ON M.IdCarrera=C.IdCarrera AND M.Estado=1
WHERE (@FiltroIdsMateria IS NULL OR EXISTS (SELECT 1 FROM STRING_SPLIT(@FiltroIdsMateria,N',') X
  WHERE TRY_CONVERT(INT,X.value)=M.Id));

IF EXISTS (SELECT 1 FROM #MateriaPlan WHERE SemestreCurricular IS NULL OR SemestreCurricular NOT BETWEEN 1 AND 6)
  THROW 53016, 'Materia.Semestre debe estar entre 1 y 6 para el plan sintético.', 1;
IF @FiltroIdsMateria IS NULL AND EXISTS (
  SELECT IdCarrera,SemestreCurricular FROM #MateriaPlan
  GROUP BY IdCarrera,SemestreCurricular HAVING COUNT(*)<>5
)
  THROW 53017, 'Cada carrera debe tener exactamente cinco materias por semestre curricular.', 1;

CREATE TABLE #ComisionPlan(
  IdCarrera INT,CarreraOrden INT,IdMateria INT,SemestreCurricular INT,OrdenEnSemestre INT,
  IdComision INT PRIMARY KEY,CohorteOrden INT,AnioIngreso INT,AnioCurricular INT,
  AnioLectivo INT,IdDivision INT,Division NVARCHAR(300),IdDocente INT,
  IdUsuarioDocente INT,ActivaEnPeriodo BIT,ActivaAlCorte BIT
);
;WITH MDOrdenada AS (
  SELECT MP.*,MD.Id AS IdComision,MD.IdDivision,DV.Descripcion,MD.IdDocente,
    ROW_NUMBER() OVER(PARTITION BY MP.IdMateria ORDER BY MD.Id) AS CohorteOrden
  FROM #MateriaPlan MP JOIN dbo.MateriaDivision MD ON MD.IdMateria=MP.IdMateria
  LEFT JOIN dbo.Division DV ON DV.Id=MD.IdDivision
)
INSERT #ComisionPlan
SELECT X.IdCarrera,X.CarreraOrden,X.IdMateria,X.SemestreCurricular,X.OrdenEnSemestre,
  X.IdComision,X.CohorteOrden,2023+X.CohorteOrden,1+((X.SemestreCurricular-1)/2),
  2023+X.CohorteOrden+((X.SemestreCurricular-1)/2),X.IdDivision,
  X.Descripcion,X.IdDocente,U.Id,
  CONVERT(BIT,CASE WHEN 2023+X.CohorteOrden+((X.SemestreCurricular-1)/2)
    BETWEEN YEAR(@FechaInicialLocal) AND YEAR(@FechaFinProgramacionLocal) THEN 1 ELSE 0 END),
  CONVERT(BIT,CASE WHEN 2023+X.CohorteOrden+((X.SemestreCurricular-1)/2)=YEAR(@FechaCorteLocal)
    THEN 1 ELSE 0 END)
FROM MDOrdenada X
OUTER APPLY (SELECT TOP (1) UX.Id FROM dbo.Usuario UX
  WHERE UX.Rol='docente' AND UX.IdDocente=X.IdDocente AND UX.Activo=1 ORDER BY UX.Id) U
WHERE X.CohorteOrden<=2
  AND (@FiltroIdsComision IS NULL OR EXISTS (SELECT 1 FROM STRING_SPLIT(@FiltroIdsComision,N',') F
    WHERE TRY_CONVERT(INT,F.value)=X.IdComision))
  AND (@FiltroIdsDocente IS NULL OR EXISTS (SELECT 1 FROM STRING_SPLIT(@FiltroIdsDocente,N',') F
    WHERE TRY_CONVERT(INT,F.value)=X.IdDocente));

CREATE TABLE #CohorteAlumno(
  IdCarrera INT,CarreraOrden INT,CohorteOrden INT,AnioIngreso INT,IdAlumno INT PRIMARY KEY
);
INSERT #CohorteAlumno
SELECT CP.IdCarrera,CP.CarreraOrden,D.CohorteOrden,
  2023+D.CohorteOrden,CONVERT(INT,E.IdEntidad)
FROM #CarreraPlan CP CROSS JOIN (VALUES(1),(2)) D(CohorteOrden)
JOIN dbo.ExamioTestDataEntidad E ON E.LoteId=@LotePreparacion AND E.Tipo='alumno'
  AND E.ClaveLogica LIKE CONCAT(N'c:',CP.CarreraOrden,N':d:',D.CohorteOrden,N':a:%')
JOIN dbo.Alumno A ON A.Matricula=E.IdEntidad AND A.Estado=N'activo';

IF EXISTS (SELECT 1 FROM #CohorteAlumno GROUP BY IdCarrera,CohorteOrden HAVING COUNT(*)<>30)
  THROW 53018, 'Cada cohorte lógica reconocida debe contener 30 alumnos activos.', 1;

CREATE TABLE #PlanInscripcion(IdComision INT,IdAlumno INT,SemestreCurricular INT,
  PRIMARY KEY(IdComision,IdAlumno));
INSERT #PlanInscripcion
SELECT CP.IdComision,CA.IdAlumno,CP.SemestreCurricular
FROM #CohorteAlumno CA JOIN #ComisionPlan CP
  ON CP.IdCarrera=CA.IdCarrera AND CP.CohorteOrden=CA.CohorteOrden
  AND CP.ActivaAlCorte=1;

IF @FiltroIdsCarrera IS NULL AND @FiltroIdsMateria IS NULL AND
   @FiltroIdsComision IS NULL AND @FiltroIdsDocente IS NULL AND EXISTS (
 SELECT 1 FROM #CohorteAlumno C WHERE
   (SELECT COUNT(*) FROM #PlanInscripcion P WHERE P.IdAlumno=C.IdAlumno)<>10 OR
   (SELECT COUNT(*) FROM #PlanInscripcion P WHERE P.IdAlumno=C.IdAlumno AND P.SemestreCurricular%2=1)<>5 OR
   (SELECT COUNT(*) FROM #PlanInscripcion P WHERE P.IdAlumno=C.IdAlumno AND P.SemestreCurricular%2=0)<>5
)
  THROW 53019, 'El plan debe asignar a cada alumno cinco materias por semestre y diez anuales.', 1;

CREATE TABLE #Alcance(
  IdCarrera INT,Carrera NVARCHAR(300),IdMateria INT,Materia NVARCHAR(300),
  SemestreCurricular INT,IdComision INT PRIMARY KEY,Division NVARCHAR(300),
  CohorteOrden INT,AnioIngreso INT,AnioCurricular INT,AnioLectivo INT,
  IdDocente INT,IdUsuarioDocente INT,
  AlumnosPlanificados INT,MotivoExclusion NVARCHAR(200)
);
INSERT #Alcance
SELECT CP.IdCarrera,C.Nombre,CP.IdMateria,M.Nombre,CP.SemestreCurricular,CP.IdComision,
  CP.Division,CP.CohorteOrden,CP.AnioIngreso,CP.AnioCurricular,CP.AnioLectivo,
  CP.IdDocente,CP.IdUsuarioDocente,
  (SELECT COUNT(*) FROM #CohorteAlumno CA
    WHERE CA.IdCarrera=CP.IdCarrera AND CA.CohorteOrden=CP.CohorteOrden),
  CASE WHEN CP.ActivaEnPeriodo=0 THEN N'cohorte alcanza esta etapa después del período histórico'
       WHEN CP.IdDocente IS NULL OR D.Legajo IS NULL OR D.Estado<>1 THEN N'sin docente activo'
       WHEN CP.IdUsuarioDocente IS NULL THEN N'sin usuario docente activo para auditoría'
       WHEN NOT EXISTS(SELECT 1 FROM #CohorteAlumno CA
         WHERE CA.IdCarrera=CP.IdCarrera AND CA.CohorteOrden=CP.CohorteOrden)
         THEN N'sin alumnos planificados' ELSE NULL END
FROM #ComisionPlan CP JOIN dbo.Carrera C ON C.Id=CP.IdCarrera
JOIN dbo.Materia M ON M.Id=CP.IdMateria LEFT JOIN dbo.Docente D ON D.Legajo=CP.IdDocente;

CREATE TABLE #Comisiones(
  Orden INT IDENTITY(1,1) PRIMARY KEY,IdCarrera INT,IdMateria INT,SemestreCurricular INT,
  OrdenEnSemestre INT,IdComision INT UNIQUE,CohorteOrden INT,AnioIngreso INT,
  AnioCurricular INT,AnioLectivo INT,
  IdDocente INT,IdUsuarioDocente INT,AlumnosActivos INT
);
INSERT #Comisiones(IdCarrera,IdMateria,SemestreCurricular,OrdenEnSemestre,IdComision,
  CohorteOrden,AnioIngreso,AnioCurricular,AnioLectivo,IdDocente,IdUsuarioDocente,AlumnosActivos)
SELECT CP.IdCarrera,CP.IdMateria,CP.SemestreCurricular,CP.OrdenEnSemestre,CP.IdComision,
  CP.CohorteOrden,CP.AnioIngreso,CP.AnioCurricular,CP.AnioLectivo,
  CP.IdDocente,CP.IdUsuarioDocente,A.AlumnosPlanificados
FROM #ComisionPlan CP JOIN #Alcance A ON A.IdComision=CP.IdComision
WHERE A.MotivoExclusion IS NULL;

IF @ExcluirSinDocente=0 AND EXISTS(SELECT 1 FROM #Alcance
  WHERE MotivoExclusion IN(N'sin docente activo',N'sin usuario docente activo para auditoría'))
  THROW 53012, 'El alcance contiene comisiones sin docente/usuario activo.', 1;
IF @ExcluirSinAlumnos=0 AND EXISTS(SELECT 1 FROM #Alcance WHERE MotivoExclusion=N'sin alumnos planificados')
  THROW 53013, 'El alcance contiene comisiones activas sin alumnos planificados.', 1;

CREATE TABLE #Specs(
  SpecId INT IDENTITY(1,1) PRIMARY KEY,IdCarrera INT,IdMateria INT,SemestreCurricular INT,
  AnioIngreso INT,AnioCurricular INT,AnioLectivo INT,CohorteOrden INT,
  IdComision INT,IdDocente INT,IdUsuarioDocente INT,NumeroEvaluacion INT,
  TipoEvaluacion VARCHAR(20),Perfil VARCHAR(10),Tendencia VARCHAR(10),Escenario VARCHAR(25),
  Escala TINYINT,NotaAprobacion DECIMAL(5,2),FechaInicioUtc DATETIME2(3),
  FechaFinUtc DATETIME2(3),Rendida BIT,IdActividad INT NULL,IdPublicacion INT NULL
);

;WITH Base AS (
  SELECT C.*,N.NumeroEvaluacion,
    ROW_NUMBER() OVER(PARTITION BY C.AnioLectivo,C.SemestreCurricular%2,N.NumeroEvaluacion,
      CASE WHEN C.SemestreCurricular%2=0 AND N.NumeroEvaluacion=2
        THEN (C.IdMateria+C.IdComision)%2 ELSE 0 END
      ORDER BY C.IdCarrera,C.CohorteOrden,C.OrdenEnSemestre,C.IdComision) AS Secuencia
  FROM #Comisiones C CROSS JOIN (VALUES(1),(2)) N(NumeroEvaluacion)
), Fechas AS (
  SELECT B.*,
    CASE WHEN B.SemestreCurricular%2=1 AND B.NumeroEvaluacion=1 THEN DATEFROMPARTS(B.AnioLectivo,4,8)
         WHEN B.SemestreCurricular%2=1 AND B.NumeroEvaluacion=2 THEN DATEFROMPARTS(B.AnioLectivo,6,3)
         WHEN B.SemestreCurricular%2=0 AND B.NumeroEvaluacion=1 THEN DATEFROMPARTS(B.AnioLectivo,9,8)
         WHEN (B.IdMateria+B.IdComision)%2=0 THEN DATEFROMPARTS(B.AnioLectivo,10,14)
         ELSE DATEFROMPARTS(B.AnioLectivo,11,3) END AS FechaBase
  FROM Base B
), Horarios AS (
  SELECT F.*,DATEADD(HOUR,CASE WHEN (F.Secuencia-1)%2=0 THEN 9 ELSE 14 END,
    DATEADD(DAY,(F.Secuencia-1)/2,CONVERT(DATETIME2(3),F.FechaBase))) AS InicioLocal
  FROM Fechas F
)
INSERT #Specs(IdCarrera,IdMateria,SemestreCurricular,AnioIngreso,AnioCurricular,AnioLectivo,
  CohorteOrden,IdComision,IdDocente,IdUsuarioDocente,
  NumeroEvaluacion,TipoEvaluacion,Perfil,Tendencia,Escenario,Escala,NotaAprobacion,
  FechaInicioUtc,FechaFinUtc,Rendida)
SELECT H.IdCarrera,H.IdMateria,H.SemestreCurricular,H.AnioIngreso,H.AnioCurricular,H.AnioLectivo,
  H.CohorteOrden,H.IdComision,H.IdDocente,H.IdUsuarioDocente,
  H.NumeroEvaluacion,'regular',CASE (H.IdMateria+H.IdComision)%3 WHEN 0 THEN 'alto'
    WHEN 1 THEN 'medio' ELSE 'bajo' END,
  CASE (H.IdMateria+H.IdCarrera)%3 WHEN 0 THEN 'mejora' WHEN 1 THEN 'empeora' ELSE 'estable' END,
  'normal',CASE WHEN (H.IdMateria+H.NumeroEvaluacion)%2=0 THEN 10 ELSE 100 END,
  CASE WHEN (H.IdMateria+H.NumeroEvaluacion)%2=0 THEN 6 ELSE 60 END,
  CONVERT(DATETIME2(3),(H.InicioLocal AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC'),
  CONVERT(DATETIME2(3),(DATEADD(HOUR,4,H.InicioLocal) AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC'),
  CONVERT(BIT,CASE WHEN H.InicioLocal<=@FechaLimiteLocal THEN 1 ELSE 0 END)
FROM Horarios H
WHERE CONVERT(DATE,H.InicioLocal) BETWEEN @FechaInicialLocal AND @FechaFinProgramacionLocal;

IF @CrearRecuperatoriosJulio=1
BEGIN
  ;WITH R AS (
    SELECT C.*,ROW_NUMBER() OVER(PARTITION BY C.AnioLectivo
      ORDER BY C.IdCarrera,C.IdMateria,C.IdComision) AS Secuencia
    FROM #Comisiones C WHERE C.SemestreCurricular%2=1
  ), Elegidas AS (
    SELECT R.*,ROW_NUMBER() OVER(PARTITION BY R.AnioLectivo ORDER BY R.Secuencia) AS OrdenRecuperatorio
    FROM R WHERE R.Secuencia%@CadaNComisionesConRecuperatorio=0
  ), H AS (
    SELECT E.*,DATEADD(HOUR,CASE WHEN (OrdenRecuperatorio-1)%2=0 THEN 9 ELSE 14 END,
      DATEADD(DAY,(OrdenRecuperatorio-1)/2,CONVERT(DATETIME2(3),DATEFROMPARTS(E.AnioLectivo,7,6)))) InicioLocal
    FROM Elegidas E
  )
  INSERT #Specs(IdCarrera,IdMateria,SemestreCurricular,AnioIngreso,AnioCurricular,AnioLectivo,
    CohorteOrden,IdComision,IdDocente,IdUsuarioDocente,
    NumeroEvaluacion,TipoEvaluacion,Perfil,Tendencia,Escenario,Escala,NotaAprobacion,
    FechaInicioUtc,FechaFinUtc,Rendida)
  SELECT H.IdCarrera,H.IdMateria,H.SemestreCurricular,H.AnioIngreso,H.AnioCurricular,H.AnioLectivo,
    H.CohorteOrden,H.IdComision,H.IdDocente,H.IdUsuarioDocente,
    3,'recuperatorio',CASE (H.IdMateria+H.IdComision)%3 WHEN 0 THEN 'alto' WHEN 1 THEN 'medio' ELSE 'bajo' END,
    'mejora','recuperatorio',CASE WHEN (H.IdMateria+3)%2=0 THEN 10 ELSE 100 END,
    CASE WHEN (H.IdMateria+3)%2=0 THEN 6 ELSE 60 END,
    CONVERT(DATETIME2(3),(H.InicioLocal AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC'),
    CONVERT(DATETIME2(3),(DATEADD(HOUR,4,H.InicioLocal) AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC'),
    CONVERT(BIT,CASE WHEN H.InicioLocal<=@FechaLimiteLocal THEN 1 ELSE 0 END)
  FROM H
  WHERE CONVERT(DATE,H.InicioLocal) BETWEEN @FechaInicialLocal AND @FechaFinProgramacionLocal;
END;

IF @FiltroIdsCarrera IS NULL AND @FiltroIdsMateria IS NULL AND
   @FiltroIdsComision IS NULL AND @FiltroIdsDocente IS NULL AND (
     (SELECT COUNT(*) FROM #CarreraPlan)<>4 OR
     (SELECT COUNT(*) FROM #MateriaPlan)<>120 OR
     (SELECT COUNT(*) FROM #ComisionPlan)<>240 OR
     (SELECT COUNT(*) FROM #CohorteAlumno)<>240 OR
     (SELECT COUNT(*) FROM #PlanInscripcion)<>2400 OR
     (SELECT COUNT(*) FROM #Comisiones)<>200 OR
     (@CrearRecuperatoriosJulio=1 AND @CadaNComisionesConRecuperatorio=5
       AND (SELECT COUNT(*) FROM #Specs)<>420)
   )
  THROW 53042, 'El alcance completo no coincide con 4 carreras, 120 materias, 240 comisiones, 240 alumnos, 2.400 inscripciones vigentes, 200 comisiones históricas y 420 publicaciones programadas.', 1;

IF EXISTS (
  SELECT 1 FROM #Specs
  WHERE (TipoEvaluacion='recuperatorio' AND MONTH(FechaInicioUtc)<>7)
     OR (TipoEvaluacion='regular' AND SemestreCurricular%2=1
       AND MONTH(FechaInicioUtc) NOT BETWEEN 4 AND 6)
     OR (TipoEvaluacion='regular' AND SemestreCurricular%2=0
       AND MONTH(FechaInicioUtc) NOT BETWEEN 9 AND 11)
)
  THROW 53043, 'Una publicación quedó fuera del calendario semestral sintético permitido.', 1;

DECLARE @ComisionesElegibles INT=(SELECT COUNT(*) FROM #Comisiones),
  @PublicacionesPrevistas INT=(SELECT COUNT(*) FROM #Specs),
  @PublicacionesRendidas INT=(SELECT COUNT(*) FROM #Specs WHERE Rendida=1),
  @PublicacionesProgramadasFuturas INT=(SELECT COUNT(*) FROM #Specs WHERE Rendida=0),
  @IntentosBaseEstimados BIGINT;
SELECT @IntentosBaseEstimados=SUM(CASE WHEN S.Rendida=0 THEN 0
  WHEN S.Escenario='recuperatorio' THEN
    CASE WHEN C.AlumnosActivos<@ParticipantesPorRecuperatorio THEN C.AlumnosActivos ELSE @ParticipantesPorRecuperatorio END
  ELSE CEILING((CASE WHEN C.AlumnosActivos<@MaxParticipantesPorPublicacion
    THEN C.AlumnosActivos ELSE @MaxParticipantesPorPublicacion END)*@TasaParticipacion) END)
FROM #Specs S JOIN #Comisiones C ON C.IdComision=S.IdComision;

SELECT N'ALCANCE' AS Seccion,* FROM #Alcance ORDER BY IdCarrera,SemestreCurricular,IdMateria,IdComision;
SELECT N'ESTIMACION_PREVIA' AS Seccion,@ComisionesElegibles AS ComisionesActivas,
  (SELECT COUNT(*) FROM #CohorteAlumno) AS AlumnosUnicos,
  (SELECT COUNT(*) FROM #PlanInscripcion) AS InscripcionesPlanificadas,
  @PublicacionesPrevistas AS PublicacionesProgramadas,@PublicacionesRendidas AS PublicacionesRendidas,
  @PublicacionesProgramadasFuturas AS PublicacionesFuturasSinRendicion,
  CONVERT(BIGINT,@PublicacionesPrevistas)*@PreguntasPorEvaluacion AS Grupos,
  @IntentosBaseEstimados AS IntentosBaseSinReintentos,
  CEILING(@IntentosBaseEstimados*(1+@TasaReintento)) AS IntentosEstimadosConReintentos,
  CEILING(@IntentosBaseEstimados*(1+@TasaReintento))*@PreguntasPorEvaluacion AS PreguntasIntentoEstimadas;

SELECT N'ESTIMACION_POR_ANIO_SEMESTRE' AS Seccion,S.AnioLectivo,
  CASE WHEN S.TipoEvaluacion='recuperatorio' THEN N'recuperatorio_julio'
    WHEN S.SemestreCurricular%2=1 THEN N'primer_semestre' ELSE N'segundo_semestre' END AS Periodo,
  COUNT(*) AS PublicacionesProgramadas,SUM(CONVERT(INT,S.Rendida)) AS PublicacionesRendidas,
  SUM(CASE WHEN S.Rendida=0 THEN 0 WHEN S.Escenario='recuperatorio' THEN
      CASE WHEN C.AlumnosActivos<@ParticipantesPorRecuperatorio
        THEN C.AlumnosActivos ELSE @ParticipantesPorRecuperatorio END
    ELSE CEILING((CASE WHEN C.AlumnosActivos<@MaxParticipantesPorPublicacion
      THEN C.AlumnosActivos ELSE @MaxParticipantesPorPublicacion END)*@TasaParticipacion) END)
    AS IntentosBaseEstimados
FROM #Specs S JOIN #Comisiones C ON C.IdComision=S.IdComision
GROUP BY S.AnioLectivo,CASE WHEN S.TipoEvaluacion='recuperatorio' THEN N'recuperatorio_julio'
  WHEN S.SemestreCurricular%2=1 THEN N'primer_semestre' ELSE N'segundo_semestre' END
ORDER BY S.AnioLectivo,Periodo;

IF @ComisionesElegibles=0 THROW 53010, 'No hay comisiones activas con cohorte, docente y alumnos.', 1;
IF @SoloEstimar=1 RETURN;

/* ======================== IDENTIDAD E IDEMPOTENCIA ======================== */
DECLARE @ConfigJson NVARCHAR(MAX)=(SELECT @VersionGenerador AS versionGenerador,
  @Semilla AS semilla,@LotePreparacion AS lotePreparacion,@FechaInicialLocal AS fechaInicial,
  @FechaFinalLocal AS fechaFinal,@FechaFinProgramacionLocal AS fechaFinProgramacion,
  @FechaCorteLocal AS fechaCorte,@ZonaHorariaSql AS zonaHoraria,
  @EvaluacionesPorComisionSemestre AS evaluacionesPorSemestre,
  @CrearRecuperatoriosJulio AS crearRecuperatorios,
  @CadaNComisionesConRecuperatorio AS frecuenciaRecuperatorios,
  @ParticipantesPorRecuperatorio AS participantesRecuperatorio,@PreguntasPorEvaluacion AS preguntas,
  @VariantesPorGrupo AS variantes,@GruposConVariantes AS gruposConVariantes,
  @MaxParticipantesPorPublicacion AS maxParticipantes,@FiltroIdsCarrera AS carreras,
  @FiltroIdsMateria AS materias,@FiltroIdsComision AS comisiones,@FiltroIdsDocente AS docentes,
  @ExcluirSinDocente AS excluirSinDocente,@ExcluirSinAlumnos AS excluirSinAlumnos,
  @TasaParticipacion AS tasaParticipacion,
  @TasaReintento AS tasaReintento,@TasaOmission AS tasaOmision,
  @TasaPendienteConfirmacionAntigua AS pendienteConfirmacionAntigua,
  @TasaPendienteConfirmacionReciente AS pendienteConfirmacionReciente,
  @TasaPendientePuntajeAntigua AS pendientePuntajeAntigua,
  @TasaPendientePuntajeReciente AS pendientePuntajeReciente,
  @ProbAciertoAlta AS probAlta,@ProbAciertoMedia AS probMedia,@ProbAciertoBaja AS probBaja,
  @ProbCreditoParcial AS probParcial FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
DECLARE @ConfigHash CHAR(64)=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CONVERT(NVARCHAR(MAX),@ConfigJson)),2);
DECLARE @HashExistente CHAR(64);

CREATE TABLE #Mapa(Tipo VARCHAR(30),ClaveLogica NVARCHAR(250),IdEntidad BIGINT,
  PRIMARY KEY(Tipo,ClaveLogica));

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.ExamioTestDataLote',N'U') IS NULL
    EXEC(N'CREATE TABLE dbo.ExamioTestDataLote(
      LoteId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ExamioTestDataLote PRIMARY KEY,
      ConfigHash CHAR(64) NOT NULL,ConfigJson NVARCHAR(MAX) NOT NULL,
      FechaCreacionUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ExamioTestDataLote_Fecha DEFAULT SYSUTCDATETIME(),
      Advertencia NVARCHAR(250) NOT NULL,
      CONSTRAINT CHK_ExamioTestDataLote_Config CHECK(ISJSON(ConfigJson)=1));');
  IF OBJECT_ID(N'dbo.ExamioTestDataEntidad',N'U') IS NULL
    EXEC(N'CREATE TABLE dbo.ExamioTestDataEntidad(
      LoteId UNIQUEIDENTIFIER NOT NULL,Tipo VARCHAR(30) NOT NULL,
      ClaveLogica NVARCHAR(250) NOT NULL,IdEntidad BIGINT NOT NULL,
      CONSTRAINT PK_ExamioTestDataEntidad PRIMARY KEY(LoteId,Tipo,ClaveLogica),
      CONSTRAINT FK_ExamioTestDataEntidad_Lote FOREIGN KEY(LoteId)
        REFERENCES dbo.ExamioTestDataLote(LoteId));');

  EXEC sys.sp_executesql N'SELECT @Hash=ConfigHash FROM dbo.ExamioTestDataLote WHERE LoteId=@Lote;',
    N'@Lote UNIQUEIDENTIFIER,@Hash CHAR(64) OUTPUT',@Lote=@LoteId,@Hash=@HashExistente OUTPUT;
  IF @HashExistente IS NOT NULL AND @HashExistente<>@ConfigHash
    THROW 53011, 'El LoteId ya existe con una configuración diferente.', 1;
  IF @HashExistente=@ConfigHash
  BEGIN
    ROLLBACK TRANSACTION;
    SELECT N'LOTE_YA_APLICADO_SIN_CAMBIOS' AS Estado,@LoteId AS LoteId,@ConfigHash AS ConfigHash;
    RETURN;
  END;

  /* El vaciado total elimina también este catálogo técnico. Se reponen únicamente
     los códigos exactos de 20261016_telemetria_temporal; no se inventan enums ni
     se corrigen silenciosamente definiciones incompatibles ya existentes. */
  IF EXISTS (
    SELECT 1
    FROM dbo.TipoEventoTelemetria T
    JOIN (VALUES
      ('question_active',1,0,1,1),('focus_lost',1,1,0,1),
      ('fullscreen_exit',1,1,0,1),('connectivity_lost',1,1,0,1),
      ('auth_session_unavailable',1,1,0,1),('exam_resumed',0,0,0,0),
      ('page_reload',0,0,0,0),('sync_error',0,1,0,0),
      ('submission_failed',0,1,0,0),('attempt_finished',0,0,0,0)
    ) V(Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior)
      ON V.Tipo=T.Tipo
    WHERE T.EsIntervalo<>V.EsIntervalo OR T.EsIncidente<>V.EsIncidente
      OR T.RequierePregunta<>V.RequierePregunta
      OR T.AdmiteCierrePosterior<>V.AdmiteCierrePosterior
  )
    THROW 53009, 'El catálogo de telemetría contiene definiciones incompatibles con la migración 20261016.', 1;

  INSERT INTO dbo.TipoEventoTelemetria
    (Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior,Activo)
  SELECT V.Tipo,V.EsIntervalo,V.EsIncidente,V.RequierePregunta,V.AdmiteCierrePosterior,1
  FROM (VALUES
    ('question_active',1,0,1,1),('focus_lost',1,1,0,1),
    ('fullscreen_exit',1,1,0,1),('connectivity_lost',1,1,0,1),
    ('auth_session_unavailable',1,1,0,1),('exam_resumed',0,0,0,0),
    ('page_reload',0,0,0,0),('sync_error',0,1,0,0),
    ('submission_failed',0,1,0,0),('attempt_finished',0,0,0,0)
  ) V(Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior)
  WHERE NOT EXISTS (SELECT 1 FROM dbo.TipoEventoTelemetria T WHERE T.Tipo=V.Tipo);

  UPDATE T SET Activo=1
  FROM dbo.TipoEventoTelemetria T
  WHERE T.Tipo IN ('question_active','focus_lost','fullscreen_exit','connectivity_lost',
    'auth_session_unavailable','exam_resumed','page_reload','sync_error',
    'submission_failed','attempt_finished') AND T.Activo=0;

  /* El lote de preparación dejó una matrícula técnica completa. Se reemplaza sólo
     para alumnos/comisiones reconocidos por el lote y se conserva como snapshot
     de la cursada vigente al corte 2026: cinco materias por semestre. El producto
     no modela una inscripción histórica; las cohortes 2024-2025 permanecen en las
     tablas temporales del generador para construir sus intentos históricos. */
  IF EXISTS (
    SELECT 1 FROM dbo.InscripcionMateria IM
    JOIN #ComisionPlan CP ON CP.IdComision=IM.IdMateriaDivision
    LEFT JOIN #CohorteAlumno CA ON CA.IdAlumno=IM.IdAlumno
    WHERE CA.IdAlumno IS NULL
  )
    THROW 53020, 'Hay inscripciones no reconocidas en el alcance; no se reemplazará matrícula ajena.', 1;

  DELETE IM
  FROM dbo.InscripcionMateria IM
  JOIN #ComisionPlan CP ON CP.IdComision=IM.IdMateriaDivision
  JOIN #CohorteAlumno CA ON CA.IdAlumno=IM.IdAlumno;

  INSERT dbo.InscripcionMateria(IdMateriaDivision,IdAlumno)
  SELECT IdComision,IdAlumno FROM #PlanInscripcion;

  /* ================= EVALUACIONES, CONTENIDO Y POLÍTICAS ================= */
  DECLARE @SpecId INT=1,@SpecMax INT=(SELECT MAX(SpecId) FROM #Specs),
    @IdCarrera INT,@IdMateria INT,@SemestreCurricular INT,@IdComision INT,
    @AnioIngreso INT,@AnioCurricular INT,@AnioLectivo INT,@CohorteOrden INT,
    @IdDocente INT,@IdUsuarioDocente INT,@NumeroEvaluacion INT,@TipoEvaluacion VARCHAR(20),
    @Perfil VARCHAR(10),@Tendencia VARCHAR(10),@Escenario VARCHAR(25),@Rendida BIT,
    @Escala TINYINT,@NotaAprobacion DECIMAL(5,2),@FechaPubInicio DATETIME2(3),@FechaPubFin DATETIME2(3),
    @IdActividad INT,@IdPublicacion INT,@FechaConfiguracion DATETIME2(3),
    @Marca NVARCHAR(80)=CONCAT(N'[SYNTH-',CONVERT(NVARCHAR(36),@LoteId),N']');

  WHILE @SpecId<=@SpecMax
  BEGIN
    SELECT @IdCarrera=IdCarrera,@IdMateria=IdMateria,@SemestreCurricular=SemestreCurricular,
      @AnioIngreso=AnioIngreso,@AnioCurricular=AnioCurricular,@AnioLectivo=AnioLectivo,
      @CohorteOrden=CohorteOrden,
      @IdComision=IdComision,@IdDocente=IdDocente,@IdUsuarioDocente=IdUsuarioDocente,
      @NumeroEvaluacion=NumeroEvaluacion,@TipoEvaluacion=TipoEvaluacion,@Perfil=Perfil,
      @Tendencia=Tendencia,@Escenario=Escenario,@Rendida=Rendida,
      @Escala=Escala,@NotaAprobacion=NotaAprobacion,@FechaPubInicio=FechaInicioUtc,@FechaPubFin=FechaFinUtc
    FROM #Specs WHERE SpecId=@SpecId;
    SET @FechaConfiguracion=CASE WHEN DATEADD(DAY,-7,@FechaPubInicio)>@FechaCorteUtc
      THEN @FechaCorteUtc ELSE DATEADD(DAY,-7,@FechaPubInicio) END;

    INSERT INTO dbo.Actividad(Titulo,Descripcion,Tipo,PermiteMultiplesIntentos,DuracionMinutos,Estado,
      RecursosPermitidos,CantidadIntentosMaximos,Revision,EscalaCalificacion,NotaAprobacion,ModoPuntaje,
      MostrarPuntajePorPregunta,CorreccionAutomaticaCerradas)
    VALUES(CONCAT(N'Sintética ',@TipoEvaluacion,N' ',FORMAT(@FechaPubInicio,'yyyy-MM'),N' #',
        @NumeroEvaluacion,N' · comisión ',@IdComision),
      CONCAT(@Marca,N' Cohorte curricular sintética; no representa desempeño real.'),N'evaluacion',1,90,N'publicada',
      N'Sin recursos externos',2,1,@Escala,@NotaAprobacion,N'personalizados',1,1);
    SET @IdActividad=CONVERT(INT,SCOPE_IDENTITY());

    INSERT INTO dbo.Publicacion(IdActividad,IdMateriaDivision,FechaInicio,FechaFin,Visible)
    VALUES(@IdActividad,@IdComision,@FechaPubInicio,@FechaPubFin,1);
    SET @IdPublicacion=CONVERT(INT,SCOPE_IDENTITY());
    UPDATE #Specs SET IdActividad=@IdActividad,IdPublicacion=@IdPublicacion WHERE SpecId=@SpecId;
    INSERT INTO #Mapa VALUES('actividad',CONCAT('spec:',@SpecId),@IdActividad),
      ('publicacion',CONCAT('spec:',@SpecId),@IdPublicacion);

    INSERT INTO dbo.PoliticaRevisionPublicacion
      (IdPublicacion,Modo,Acceso,VentanaDesde,VentanaHasta,Revision,ModificadoPor,FechaModificacion)
    VALUES(@IdPublicacion,'al_corregir','libre',NULL,NULL,1,@IdUsuarioDocente,@FechaConfiguracion);
    INSERT INTO dbo.AuditoriaRevisionIntento
      (IdPublicacion,IdIntento,IdSesion,IdUsuario,ActorRol,Accion,Detalle,Fecha)
    VALUES(@IdPublicacion,NULL,NULL,@IdUsuarioDocente,'docente','politica_actualizada',
      N'Política inicial del dataset sintético: al_corregir + libre.',@FechaConfiguracion);

    INSERT INTO dbo.PoliticaSupervisionPublicacion
      (IdPublicacion,PantallaCompletaObligatoria,CodigoConfiguracion,Revision,ModificadoPor,FechaModificacion)
    VALUES(@IdPublicacion,1,'temporal-v1',1,@IdUsuarioDocente,@FechaConfiguracion);
    INSERT INTO dbo.ReglaSupervisionPublicacion
      (IdPublicacion,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
    VALUES(@IdPublicacion,'temporal-focus-1','focus_lost','cantidad',1,NULL,100,'anular_intento',1),
      (@IdPublicacion,'temporal-fullscreen-1','fullscreen_exit','cantidad',1,NULL,100,'anular_intento',1);

    DECLARE @GrupoNumero INT=1,@IdGrupo INT,@PuntajeGrupo DECIMAL(5,2),@Variante INT,
      @VariantesEsteGrupo INT,@IdPregunta INT,@Tipo NVARCHAR(25),@ModoJust NVARCHAR(25),
      @Estrategia NVARCHAR(30),@Tratamiento NVARCHAR(25),@Enunciado NVARCHAR(MAX),
      @OpcionesJson NVARCHAR(MAX),@ContenidoHash CHAR(64),@CentavosBase INT,@RestoCentavos INT,
      @OpPos INT;
    SET @CentavosBase=(@Escala*100)/@PreguntasPorEvaluacion;
    SET @RestoCentavos=(@Escala*100)%@PreguntasPorEvaluacion;

    WHILE @GrupoNumero<=@PreguntasPorEvaluacion
    BEGIN
      SET @PuntajeGrupo=CONVERT(DECIMAL(5,2),(@CentavosBase+CASE WHEN @GrupoNumero<=@RestoCentavos THEN 1 ELSE 0 END)/100.0);
      INSERT INTO dbo.GrupoPregunta(IdActividad,TituloReferencia,PuntajeMaximo)
      VALUES(@IdActividad,CONCAT(N'Concepto sintético ',RIGHT(CONCAT('00',@GrupoNumero),2)),@PuntajeGrupo);
      SET @IdGrupo=CONVERT(INT,SCOPE_IDENTITY());
      SET @VariantesEsteGrupo=CASE WHEN @GrupoNumero<=@GruposConVariantes THEN @VariantesPorGrupo ELSE 1 END;
      SET @Variante=1;

      WHILE @Variante<=@VariantesEsteGrupo
      BEGIN
        SET @Tipo=CASE WHEN @GrupoNumero IN (1,2) THEN N'multiple'
          WHEN @GrupoNumero=3 THEN N'vf' WHEN @GrupoNumero=9 THEN N'abierta'
          WHEN @GrupoNumero=10 THEN N'code' ELSE N'mc' END;
        SET @ModoJust=CASE WHEN @GrupoNumero=2 THEN N'obligatoria'
          WHEN @GrupoNumero=1 THEN N'opcional' ELSE N'sin_justificacion' END;
        SET @Estrategia=CASE WHEN @Tipo=N'multiple' THEN N'parcial_sin_penalizacion' ELSE N'exacta' END;
        SET @Tratamiento=N'informativa';
        SET @Enunciado=CASE WHEN @GrupoNumero<=2
          THEN CONCAT(N'Contenido común sintético G',@GrupoNumero,N' V',@Variante,N': seleccione la respuesta adecuada.')
          ELSE CONCAT(@Marca,N' C',@IdComision,N' E',@SpecId,N' G',@GrupoNumero,N' V',@Variante,
            CASE WHEN @Tipo IN (N'abierta',N'code') THEN N': desarrolle una respuesta breve.' ELSE N': seleccione la respuesta adecuada.' END) END;

        DECLARE @Opciones TABLE(Posicion INT,Texto NVARCHAR(500),EsCorrecta BIT);
        IF @Tipo=N'vf'
          INSERT INTO @Opciones VALUES(1,N'Verdadero',1),(2,N'Falso',0);
        ELSE IF @Tipo IN (N'mc',N'multiple')
          INSERT INTO @Opciones VALUES(1,CONCAT(N'Opción correcta A · V',@Variante),1),
            (2,CONCAT(CASE WHEN @Tipo=N'multiple' THEN N'Opción correcta B' ELSE N'Distractor B' END,N' · V',@Variante),CASE WHEN @Tipo=N'multiple' THEN 1 ELSE 0 END),
            (3,CONCAT(N'Distractor C · V',@Variante),0),(4,CONCAT(N'Distractor D · V',@Variante),0);

        SELECT @OpcionesJson=COALESCE((SELECT CONVERT(BIGINT,Posicion) AS posicion,Texto AS texto,
          EsCorrecta AS esCorrecta FROM @Opciones ORDER BY Posicion FOR JSON PATH),N'[]');
        SET @ContenidoHash=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CONVERT(NVARCHAR(MAX),
          CONCAT(N'v1|',@Tipo,N'|',@Enunciado,N'|',@ModoJust,N'|',@Estrategia,N'|',@Tratamiento,N'|',@OpcionesJson))),2);

        INSERT INTO dbo.Pregunta(IdGrupoPregunta,Enunciado,Tipo,ModoJustificacion,EstrategiaCorreccion,
          TratamientoJustificacion,ContenidoHash)
        VALUES(@IdGrupo,@Enunciado,@Tipo,@ModoJust,@Estrategia,@Tratamiento,@ContenidoHash);
        SET @IdPregunta=CONVERT(INT,SCOPE_IDENTITY());
        SET @OpPos=1;
        WHILE @OpPos<=ISNULL((SELECT MAX(Posicion) FROM @Opciones),0)
        BEGIN
          INSERT INTO dbo.Opcion(IdPregunta,Texto,EsCorrecta)
            SELECT @IdPregunta,Texto,EsCorrecta FROM @Opciones WHERE Posicion=@OpPos;
          SET @OpPos+=1;
        END;
        DELETE FROM @Opciones;
        SET @Variante+=1;
      END;
      SET @GrupoNumero+=1;
    END;

    SET @SpecId+=1;
  END;

  /* ==================== PARTICIPANTES, INTENTOS Y NOTAS ==================== */
  CREATE TABLE #Participantes(OrdenAlumno INT IDENTITY(1,1) PRIMARY KEY,IdAlumno INT UNIQUE);
  CREATE TABLE #ResultadoPregunta(
    IdIntentoPregunta INT PRIMARY KEY,IdPregunta INT,OrdenPregunta INT,Tipo NVARCHAR(25),
    PuntajeMaximo DECIMAL(5,2),Nivel TINYINT,Omitida BIT,Pendiente BIT,Puntaje DECIMAL(5,2)
  );

  SET @SpecId=1;
  WHILE @SpecId<=@SpecMax
  BEGIN
    SELECT @IdCarrera=IdCarrera,@IdMateria=IdMateria,@SemestreCurricular=SemestreCurricular,
      @AnioIngreso=AnioIngreso,@AnioCurricular=AnioCurricular,@AnioLectivo=AnioLectivo,
      @CohorteOrden=CohorteOrden,
      @IdComision=IdComision,@IdDocente=IdDocente,@IdUsuarioDocente=IdUsuarioDocente,
      @NumeroEvaluacion=NumeroEvaluacion,@TipoEvaluacion=TipoEvaluacion,@Perfil=Perfil,
      @Tendencia=Tendencia,@Escenario=Escenario,@Rendida=Rendida,
      @Escala=Escala,@NotaAprobacion=NotaAprobacion,@FechaPubInicio=FechaInicioUtc,
      @FechaPubFin=FechaFinUtc,@IdActividad=IdActividad,@IdPublicacion=IdPublicacion
    FROM #Specs WHERE SpecId=@SpecId;
    TRUNCATE TABLE #Participantes;

    DECLARE @AlumnosComision INT=(SELECT COUNT(*) FROM #CohorteAlumno CA
      JOIN dbo.Alumno AL ON AL.Matricula=CA.IdAlumno AND AL.Estado=N'activo'
      WHERE CA.IdCarrera=@IdCarrera AND CA.CohorteOrden=@CohorteOrden),@ObjetivoParticipantes INT;
    SET @ObjetivoParticipantes=CASE WHEN @Rendida=0 THEN 0
      WHEN @Escenario='recuperatorio' THEN
        CASE WHEN @AlumnosComision<@ParticipantesPorRecuperatorio THEN @AlumnosComision ELSE @ParticipantesPorRecuperatorio END
      ELSE CASE WHEN @AlumnosComision<@MaxParticipantesPorPublicacion
        THEN @AlumnosComision ELSE @MaxParticipantesPorPublicacion END END;

    INSERT INTO #Participantes(IdAlumno)
    SELECT TOP (@ObjetivoParticipantes) Candidato.IdAlumno
    FROM (SELECT CA.IdAlumno FROM #CohorteAlumno CA
      JOIN dbo.Alumno AL ON AL.Matricula=CA.IdAlumno AND AL.Estado=N'activo'
      WHERE CA.IdCarrera=@IdCarrera AND CA.CohorteOrden=@CohorteOrden) Candidato
    CROSS APPLY (SELECT CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',
      CONCAT(@Semilla,N'|participante|',@SpecId,N'|',Candidato.IdAlumno)),1,4)) AS OrdenHash) H
    WHERE @Rendida=1 AND (@Escenario='recuperatorio' OR
      H.OrdenHash%100000<CONVERT(BIGINT,@TasaParticipacion*100000))
    ORDER BY H.OrdenHash,Candidato.IdAlumno;

    DECLARE @OrdenAlumno INT=1,@ParticipantesMax INT=(SELECT MAX(OrdenAlumno) FROM #Participantes),
      @IdAlumno INT,@CantidadIntentos INT,@NumeroIntento INT,@IdIntento INT,@PrimerIntento INT,@SegundoIntento INT,
      @EstadoCaso VARCHAR(30),@FechaIntentoInicio DATETIME2(3),@FechaIntentoFin DATETIME2(3),
      @Roll BIGINT,@RollEstado BIGINT,@EsOverride BIT,@EsUltimoMes BIT,@EsSpecControlUltimoMes BIT,
      @TasaPendienteConfirmacionEfectiva DECIMAL(6,5),@TasaPendientePuntajeEfectiva DECIMAL(6,5);
    SET @EsUltimoMes=CONVERT(BIT,CASE WHEN @AnioLectivo=YEAR(@FechaCorteLocal)
      AND MONTH(CONVERT(DATETIME2(3),(@FechaPubInicio AT TIME ZONE 'UTC') AT TIME ZONE @ZonaHorariaSql))
          =MONTH(@FechaCorteLocal) THEN 1 ELSE 0 END);
    SET @EsSpecControlUltimoMes=CONVERT(BIT,CASE WHEN @EsUltimoMes=1 AND @SpecId=(
      SELECT MIN(SC.SpecId) FROM #Specs SC WHERE SC.Rendida=1
        AND SC.AnioLectivo=YEAR(@FechaCorteLocal)
        AND MONTH(SC.FechaInicioUtc)=MONTH(@FechaCorteLocal)
    ) THEN 1 ELSE 0 END);
    SET @TasaPendienteConfirmacionEfectiva=CASE WHEN @EsUltimoMes=1
      THEN @TasaPendienteConfirmacionReciente ELSE 0 END;
    SET @TasaPendientePuntajeEfectiva=CASE WHEN @EsUltimoMes=1
      THEN @TasaPendientePuntajeReciente ELSE 0 END;
    WHILE @OrdenAlumno<=ISNULL(@ParticipantesMax,0)
    BEGIN
      SELECT @IdAlumno=IdAlumno FROM #Participantes WHERE OrdenAlumno=@OrdenAlumno;
      SET @Roll=CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,N'|retry|',@SpecId,N'|',@IdAlumno)),1,4))%100000;
      SET @CantidadIntentos=CASE WHEN @Escenario='normal' AND
        (@Roll<@TasaReintento*100000 OR (@OrdenAlumno=1 AND @SpecId%11=0)
          OR (@OrdenAlumno=2 AND @SpecId%7=0)
          OR (@EsSpecControlUltimoMes=1 AND @OrdenAlumno=1)) THEN 2 ELSE 1 END;
      SET @PrimerIntento=NULL; SET @SegundoIntento=NULL; SET @EsOverride=0; SET @NumeroIntento=1;

      WHILE @NumeroIntento<=@CantidadIntentos
      BEGIN
        SET @RollEstado=CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',
          CONCAT(@Semilla,N'|estado|',@SpecId,N'|',@IdAlumno,N'|',@NumeroIntento)),1,4))%100000;
        SET @EstadoCaso=CASE
          WHEN @EsSpecControlUltimoMes=1 AND @OrdenAlumno=1 AND @NumeroIntento=1 THEN 'confirmado'
          WHEN @EsSpecControlUltimoMes=1 AND @OrdenAlumno=1 AND @NumeroIntento=2 THEN 'pendiente_confirmacion'
          WHEN @EsSpecControlUltimoMes=1 AND @OrdenAlumno=2 THEN 'pendiente_puntaje'
          WHEN @EsSpecControlUltimoMes=1 AND @OrdenAlumno BETWEEN 3 AND 9 THEN 'pendiente_confirmacion'
          WHEN @EsUltimoMes=1 AND @RollEstado>=98000 THEN 'en_progreso'
          WHEN @RollEstado<@TasaPendientePuntajeEfectiva*100000 THEN 'pendiente_puntaje'
          WHEN @RollEstado<(@TasaPendientePuntajeEfectiva+@TasaPendienteConfirmacionEfectiva)*100000
            THEN 'pendiente_confirmacion'
          ELSE 'confirmado' END;
        SET @FechaIntentoInicio=DATEADD(MINUTE,5+@OrdenAlumno*2+(@NumeroIntento-1)*100,@FechaPubInicio);
        SET @FechaIntentoFin=CASE WHEN @EstadoCaso='en_progreso' THEN NULL
          ELSE DATEADD(MINUTE,55+(@OrdenAlumno%6)*4,@FechaIntentoInicio) END;

        INSERT INTO dbo.Intento(IdPublicacion,IdAlumno,NumeroIntento,FechaInicio,FechaFin,Estado)
        VALUES(@IdPublicacion,@IdAlumno,@NumeroIntento,@FechaIntentoInicio,@FechaIntentoFin,
          CASE WHEN @EstadoCaso='en_progreso' THEN 'en_progreso' ELSE 'entregado' END);
        SET @IdIntento=CONVERT(INT,SCOPE_IDENTITY());
        IF @NumeroIntento=1 SET @PrimerIntento=@IdIntento ELSE SET @SegundoIntento=@IdIntento;
        INSERT INTO #Mapa VALUES('intento',CONCAT('spec:',@SpecId,':alumno:',@IdAlumno,':n:',@NumeroIntento),@IdIntento);

        ;WITH G AS (
          SELECT GP.Id,GP.TituloReferencia,GP.PuntajeMaximo,
            ROW_NUMBER() OVER (ORDER BY GP.Id) AS OrdenPregunta
          FROM dbo.GrupoPregunta GP WHERE GP.IdActividad=@IdActividad
        )
        INSERT INTO dbo.IntentoPregunta(IdIntento,IdPregunta,PuntajeMaximoSnapshot,TipoSnapshot,
          ModoJustificacionSnapshot,EstrategiaCorreccionSnapshot,TratamientoJustificacionSnapshot,
          ContenidoHashSnapshot,EnunciadoSnapshot,GrupoTituloSnapshot,SnapshotReconstruido)
        SELECT @IdIntento,P.Id,G.PuntajeMaximo,P.Tipo,P.ModoJustificacion,P.EstrategiaCorreccion,
          P.TratamientoJustificacion,P.ContenidoHash,P.Enunciado,G.TituloReferencia,0
        FROM G CROSS APPLY (SELECT TOP (1) P.* FROM (
            SELECT PX.*,ROW_NUMBER() OVER(ORDER BY PX.Id) AS VarianteOrden
            FROM dbo.Pregunta PX WHERE PX.IdGrupoPregunta=G.Id
          ) P
          CROSS APPLY (SELECT CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',
            CONCAT(@Semilla,N'|variante|',@SpecId,N'|',@IdAlumno,N'|',@NumeroIntento,N'|',G.OrdenPregunta,N'|',P.VarianteOrden)),1,4)) AS H) X
          ORDER BY X.H,P.VarianteOrden) P;

        INSERT INTO dbo.IntentoPreguntaOpcionSnapshot
          (IdIntentoPregunta,IdOpcionOrigen,TextoSnapshot,EsCorrectaSnapshot,Posicion)
        SELECT IP.Id,O.Id,O.Texto,O.EsCorrecta,ROW_NUMBER() OVER(PARTITION BY IP.Id ORDER BY O.Id)
        FROM dbo.IntentoPregunta IP JOIN dbo.Opcion O ON O.IdPregunta=IP.IdPregunta
        WHERE IP.IdIntento=@IdIntento;

        INSERT INTO dbo.IntentoPoliticaSupervision
          (IdIntento,IdPublicacionOrigen,RevisionOrigen,CodigoConfiguracion,PantallaCompletaObligatoria,FechaSnapshot)
        SELECT @IdIntento,IdPublicacion,Revision,CodigoConfiguracion,PantallaCompletaObligatoria,@FechaIntentoInicio
        FROM dbo.PoliticaSupervisionPublicacion WHERE IdPublicacion=@IdPublicacion;
        INSERT INTO dbo.IntentoReglaSupervision
          (IdIntento,IdReglaOrigen,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
        SELECT @IdIntento,Id,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa
        FROM dbo.ReglaSupervisionPublicacion WHERE IdPublicacion=@IdPublicacion;
        INSERT INTO dbo.EstadoSupervisionIntento(IdIntento,Estado,UltimaAccion,UltimoEventoId,Revision,FechaActualizacion)
        VALUES(@IdIntento,'normal','informar',NULL,1,@FechaIntentoInicio);

        /* Permanencia por pregunta. Los intervalos son consecutivos, cerrados y
           determinísticos; no representan incidentes ni disparan consecuencias. */
        IF @FechaIntentoFin IS NOT NULL
        BEGIN
          DECLARE @SesionTelemetria UNIQUEIDENTIFIER=CONVERT(UNIQUEIDENTIFIER,
            SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,N'|sesion|',@IdIntento)),1,16));
          ;WITH Q AS (
            SELECT IP.Id AS IdIntentoPregunta,
              ROW_NUMBER() OVER(ORDER BY GP.Id,IP.Id) AS Secuencia,
              COUNT(*) OVER() AS Cantidad
            FROM dbo.IntentoPregunta IP
            JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
            JOIN dbo.GrupoPregunta GP ON GP.Id=P.IdGrupoPregunta
            WHERE IP.IdIntento=@IdIntento
          ), T AS (
            SELECT Q.*,
              DATEDIFF_BIG(MILLISECOND,@FechaIntentoInicio,@FechaIntentoFin)/Q.Cantidad AS SlotMs,
              CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',
                CONCAT(@Semilla,N'|tiempo-pregunta|',@IdIntento,N'|',Q.IdIntentoPregunta)),1,4))%10001 AS VariacionMs
            FROM Q
          ), F AS (
            SELECT T.*,
              DATEADD(MILLISECOND,(T.Secuencia-1)*T.SlotMs,@FechaIntentoInicio) AS InicioEvento,
              CASE WHEN T.SlotMs>25000 THEN T.SlotMs-15000+T.VariacionMs ELSE T.SlotMs END AS DuracionMs
            FROM T
          )
          INSERT INTO dbo.IncidenteIntento
            (EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,
             FechaRecepcionInicio,FechaRecepcionFin,Estado,IdIntentoPregunta,SesionClienteId,
             SecuenciaCliente,Codigo,VersionContrato)
          SELECT CONVERT(UNIQUEIDENTIFIER,SUBSTRING(HASHBYTES('SHA2_256',
              CONCAT(@Semilla,N'|evento-pregunta|',@IdIntento,N'|',F.IdIntentoPregunta)),1,16)),
            @IdIntento,'question_active',F.InicioEvento,
            DATEADD(MILLISECOND,F.DuracionMs,F.InicioEvento),F.DuracionMs,
            DATEADD(SECOND,1,F.InicioEvento),
            DATEADD(SECOND,2,DATEADD(MILLISECOND,F.DuracionMs,F.InicioEvento)),
            'completado',F.IdIntentoPregunta,@SesionTelemetria,F.Secuencia,
            'synthetic_question_time',1
          FROM F;
        END;

        IF @EstadoCaso<>'en_progreso'
        BEGIN
          DELETE FROM #ResultadoPregunta;
          ;WITH B0 AS (
            SELECT IP.Id,IP.IdPregunta,IP.TipoSnapshot,IP.PuntajeMaximoSnapshot,
              (SELECT COUNT(*) FROM dbo.GrupoPregunta GX
                WHERE GX.IdActividad=@IdActividad AND GX.Id<=GP.Id) AS OrdenPregunta,
              CASE @Perfil WHEN 'alto' THEN @ProbAciertoAlta WHEN 'medio' THEN @ProbAciertoMedia ELSE @ProbAciertoBaja END AS ProbBase,
              (SELECT COUNT(*) FROM dbo.Pregunta PV
                WHERE PV.IdGrupoPregunta=P.IdGrupoPregunta AND PV.Id<=P.Id) AS VarianteOrden
            FROM dbo.IntentoPregunta IP JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
            JOIN dbo.GrupoPregunta GP ON GP.Id=P.IdGrupoPregunta
            WHERE IP.IdIntento=@IdIntento
          ), B AS (
            SELECT B0.*,
              CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,N'|resultado|',@SpecId,N'|',@IdAlumno,N'|',@NumeroIntento,N'|',B0.OrdenPregunta,N'|',B0.VarianteOrden)),1,4))%100000 AS RollResultado,
              CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,N'|omision|',@SpecId,N'|',@IdAlumno,N'|',@NumeroIntento,N'|',B0.OrdenPregunta,N'|',B0.VarianteOrden)),1,4))%100000 AS RollOmision
            FROM B0
          ), P AS (
            SELECT B.*,
              CASE WHEN B.OrdenPregunta=@PreguntasPorEvaluacion AND @SpecId%6=0 THEN 0.20
                ELSE B.ProbBase
                  +CASE @Tendencia
                    WHEN 'mejora' THEN (((@AnioLectivo-2024)*2)+(@SemestreCurricular%2)+(@NumeroEvaluacion-1))*0.012
                    WHEN 'empeora' THEN -(((@AnioLectivo-2024)*2)+(@SemestreCurricular%2)+(@NumeroEvaluacion-1))*0.010
                    ELSE 0 END
                  +CASE WHEN @Escenario='recuperatorio' THEN 0.040 ELSE 0 END
                  +((CONVERT(INT,CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',
                    CONCAT(@Semilla,N'|aptitud|',@IdAlumno)),1,4))%17)-8)/100.0)
                  +((CONVERT(INT,B.RollResultado%9)-4)/100.0)
                  +CASE B.VarianteOrden WHEN 1 THEN 0.03 WHEN 2 THEN -0.04 ELSE 0 END END AS ProbAjustada
            FROM B
          )
          INSERT INTO #ResultadoPregunta
          SELECT Id,IdPregunta,OrdenPregunta,TipoSnapshot,PuntajeMaximoSnapshot,
            CASE WHEN RollResultado<CASE WHEN ProbAjustada<0 THEN 0 WHEN ProbAjustada>0.95 THEN 95000 ELSE ProbAjustada*100000 END THEN 2
              WHEN RollResultado<CASE WHEN ProbAjustada+@ProbCreditoParcial>0.98 THEN 98000 ELSE (ProbAjustada+@ProbCreditoParcial)*100000 END THEN 1 ELSE 0 END,
            CAST(CASE WHEN RollOmision<@TasaOmission*100000 THEN 1 ELSE 0 END AS BIT),
            CAST(CASE WHEN @EstadoCaso='pendiente_puntaje' AND OrdenPregunta=9 THEN 1 ELSE 0 END AS BIT),NULL
          FROM P;

          UPDATE R SET Nivel=CASE WHEN Tipo IN (N'mc',N'vf') AND Nivel=1 THEN 0 ELSE Nivel END,
            Puntaje=CASE WHEN Pendiente=1 THEN NULL WHEN Omitida=1 OR Nivel=0 THEN 0
              WHEN Nivel=2 THEN PuntajeMaximo ELSE ROUND(PuntajeMaximo/2.0,2) END
          FROM #ResultadoPregunta R;

          INSERT INTO dbo.Respuesta(IdIntento,IdPregunta,RtaTexto,EsCorrecta,ComentariosDocente,Justificacion,Revision)
          SELECT @IdIntento,R.IdPregunta,
            CASE WHEN R.Tipo IN (N'abierta',N'code') THEN CONCAT(N'Respuesta sintética ',R.OrdenPregunta,N' del alumno ',@IdAlumno) ELSE NULL END,
            CASE WHEN R.Nivel=2 THEN 1 WHEN R.Nivel=0 THEN 0 ELSE NULL END,NULL,
            CASE WHEN P.ModoJustificacion=N'obligatoria' THEN N'Justificación sintética obligatoria.'
              WHEN P.ModoJustificacion=N'opcional' AND R.OrdenPregunta%2=0 THEN N'Justificación sintética opcional.' ELSE NULL END,1
          FROM #ResultadoPregunta R JOIN dbo.Pregunta P ON P.Id=R.IdPregunta
          WHERE R.Omitida=0;

          ;WITH OS AS (
            SELECT R.Id AS IdRespuesta,RP.Nivel,S.IdOpcionOrigen,S.EsCorrectaSnapshot,
              ROW_NUMBER() OVER(PARTITION BY R.Id,S.EsCorrectaSnapshot ORDER BY S.Posicion) AS OrdenTipo,
              RP.Tipo
            FROM #ResultadoPregunta RP JOIN dbo.Respuesta R ON R.IdIntento=@IdIntento AND R.IdPregunta=RP.IdPregunta
            JOIN dbo.IntentoPregunta IP ON IP.IdIntento=@IdIntento AND IP.IdPregunta=RP.IdPregunta
            JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
            WHERE RP.Omitida=0 AND RP.Tipo IN (N'mc',N'multiple',N'vf') AND S.IdOpcionOrigen IS NOT NULL
          )
          INSERT INTO dbo.RespuestaOpcion(IdRespuesta,IdOpcion)
          SELECT IdRespuesta,IdOpcionOrigen FROM OS WHERE
            (Nivel=2 AND EsCorrectaSnapshot=1) OR
            (Nivel=1 AND Tipo=N'multiple' AND EsCorrectaSnapshot=1 AND OrdenTipo=1) OR
            (Nivel=0 AND EsCorrectaSnapshot=0 AND OrdenTipo=1);

          UPDATE IP SET PuntajeObtenido=R.Puntaje,
            PuntajeAutomaticoOpciones=CASE WHEN R.Tipo IN (N'mc',N'multiple',N'vf') THEN R.Puntaje ELSE NULL END,
            OrigenCorreccion=CASE WHEN R.Pendiente=1 THEN NULL WHEN R.Tipo IN (N'abierta',N'code') THEN 'manual' ELSE 'automatica' END,
            ComentariosDocente=CASE WHEN R.Pendiente=0 AND R.Tipo IN (N'abierta',N'code') THEN N'Corrección sintética para pruebas.' ELSE NULL END,
            CorregidoPor=CASE WHEN R.Pendiente=0 AND R.Tipo IN (N'abierta',N'code') THEN @IdUsuarioDocente ELSE NULL END,
            FechaCorreccion=CASE WHEN R.Pendiente=1 THEN NULL ELSE DATEADD(MINUTE,2,@FechaIntentoFin) END
          FROM dbo.IntentoPregunta IP JOIN #ResultadoPregunta R ON R.IdIntentoPregunta=IP.Id;

          INSERT INTO dbo.HistorialCorreccionIntentoPregunta
            (IdIntentoPregunta,PuntajeAnterior,PuntajeNuevo,ComentarioAnterior,ComentarioNuevo,
             OrigenAnterior,OrigenNuevo,ModificadoPor,FechaModificacion)
          SELECT R.IdIntentoPregunta,NULL,R.Puntaje,NULL,N'Corrección sintética para pruebas.',
            NULL,'manual',@IdUsuarioDocente,DATEADD(MINUTE,2,@FechaIntentoFin)
          FROM #ResultadoPregunta R WHERE R.Pendiente=0 AND R.Tipo IN (N'abierta',N'code');

          DECLARE @NotaAutomatica DECIMAL(5,2),@NotaCalculada DECIMAL(5,2),@NotaManual DECIMAL(5,2),@NotaFinal DECIMAL(5,2);
          SELECT @NotaAutomatica=SUM(CASE WHEN Tipo IN (N'mc',N'multiple',N'vf') THEN COALESCE(Puntaje,0) ELSE 0 END),
            @NotaCalculada=CASE WHEN SUM(CASE WHEN Pendiente=1 THEN 1 ELSE 0 END)>0 THEN NULL
              ELSE SUM(COALESCE(Puntaje,0)) END
          FROM #ResultadoPregunta;
          -- La nota se deriva de puntajes; este dataset principal no fuerza aprobaciones con override manual.
          SET @NotaManual=NULL;
          SET @NotaFinal=COALESCE(@NotaManual,@NotaCalculada);

          UPDATE dbo.Intento SET NotaAutomatica=@NotaAutomatica,NotaFinalCalculada=@NotaCalculada,
            NotaFinalManual=@NotaManual,NotaFinal=@NotaFinal,
            CorreccionConfirmada=CASE WHEN @EstadoCaso='confirmado' THEN 1 ELSE 0 END,
            CorreccionConfirmadaPor=CASE WHEN @EstadoCaso='confirmado' THEN @IdUsuarioDocente ELSE NULL END,
            FechaCorreccionConfirmada=CASE WHEN @EstadoCaso='confirmado' THEN DATEADD(MINUTE,5,@FechaIntentoFin) ELSE NULL END,
            OrigenConfirmacionCorreccion=CASE WHEN @EstadoCaso='confirmado' THEN 'manual' ELSE NULL END
          WHERE Id=@IdIntento;

          IF @NotaManual IS NOT NULL
            INSERT INTO dbo.HistorialNotaIntento(IdIntento,NotaAnterior,NotaNueva,ModificadoPor,FechaModificacion)
            VALUES(@IdIntento,@NotaCalculada,@NotaManual,@IdUsuarioDocente,DATEADD(MINUTE,4,@FechaIntentoFin));
          IF @EstadoCaso='confirmado'
            INSERT INTO dbo.HistorialEstadoCorreccionIntento
              (IdIntento,EstadoAnterior,EstadoNuevo,Accion,ModificadoPor,FechaModificacion)
            VALUES(@IdIntento,0,1,'confirmacion_manual',@IdUsuarioDocente,DATEADD(MINUTE,5,@FechaIntentoFin));
        END;

        SET @NumeroIntento+=1;
      END;

      -- Override explícito: conserva el primer intento entregado como válido.
      IF @PrimerIntento IS NOT NULL AND @SegundoIntento IS NOT NULL AND @OrdenAlumno=2 AND @SpecId%7=0
      BEGIN
        INSERT INTO dbo.IntentoValidoOverride(IdPublicacion,IdAlumno,IdIntento,SeleccionadoPor,FechaSeleccion)
        VALUES(@IdPublicacion,@IdAlumno,@PrimerIntento,@IdUsuarioDocente,DATEADD(MINUTE,1,@FechaPubFin));
        INSERT INTO dbo.HistorialIntentoValidoOverride
          (IdPublicacion,IdAlumno,IdIntento,Accion,ModificadoPor,FechaModificacion)
        VALUES(@IdPublicacion,@IdAlumno,@PrimerIntento,'seleccionado',@IdUsuarioDocente,DATEADD(MINUTE,1,@FechaPubFin));
      END;
      SET @OrdenAlumno+=1;
    END;
    SET @SpecId+=1;
  END;

  /* ================= VALIDACIONES OBLIGATORIAS PREVIAS AL COMMIT ================= */
  IF EXISTS (SELECT 1 FROM #Comisiones WHERE AlumnosActivos<>30)
    THROW 53021, 'Una comisión histórica no conserva una cohorte lógica de 30 alumnos.', 1;

  IF EXISTS (
    SELECT P.IdComision FROM #PlanInscripcion P
    FULL JOIN dbo.InscripcionMateria IM
      ON IM.IdMateriaDivision=P.IdComision AND IM.IdAlumno=P.IdAlumno
    JOIN #ComisionPlan CP ON CP.IdComision=COALESCE(P.IdComision,IM.IdMateriaDivision)
    JOIN #CohorteAlumno CA ON CA.IdAlumno=COALESCE(P.IdAlumno,IM.IdAlumno)
    WHERE P.IdAlumno IS NULL OR IM.IdAlumno IS NULL
  )
    THROW 53036, 'La matrícula vigente no coincide con el plan anual al corte.', 1;

  IF @FiltroIdsCarrera IS NULL AND @FiltroIdsMateria IS NULL AND
     @FiltroIdsComision IS NULL AND @FiltroIdsDocente IS NULL AND EXISTS (
    SELECT 1 FROM #CohorteAlumno CA WHERE
      (SELECT COUNT(*) FROM #PlanInscripcion P WHERE P.IdAlumno=CA.IdAlumno)<>10 OR
      (SELECT COUNT(*) FROM #PlanInscripcion P WHERE P.IdAlumno=CA.IdAlumno AND P.SemestreCurricular%2=1)<>5 OR
      (SELECT COUNT(*) FROM #PlanInscripcion P WHERE P.IdAlumno=CA.IdAlumno AND P.SemestreCurricular%2=0)<>5
  )
    THROW 53022, 'Un alumno no quedó asignado a cinco materias por semestre y diez anuales.', 1;

  IF EXISTS (
    SELECT 1 FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
    JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
    WHERE I.FechaInicio<P.FechaInicio OR I.FechaInicio>P.FechaFin
      OR I.FechaInicio>@FechaCorteUtc OR I.FechaFin>@FechaCorteUtc
      OR (I.FechaFin IS NOT NULL AND (I.FechaFin<I.FechaInicio OR I.FechaFin>P.FechaFin))
  )
    THROW 53023, 'Hay intentos fuera de la ventana de publicación, con cronología inválida o posteriores al corte.', 1;

  IF EXISTS (
    SELECT 1 FROM #Specs S
    JOIN dbo.Intento I ON I.IdPublicacion=S.IdPublicacion
    WHERE S.Rendida=0
  )
    THROW 53024, 'Una publicación futura contiene intentos.', 1;

  IF EXISTS (
    SELECT 1 FROM #Mapa M1 JOIN dbo.Intento I1 ON I1.Id=M1.IdEntidad AND M1.Tipo='intento'
    JOIN #Mapa M2 ON M2.Tipo='intento' AND M2.IdEntidad>M1.IdEntidad
    JOIN dbo.Intento I2 ON I2.Id=M2.IdEntidad AND I2.IdAlumno=I1.IdAlumno
    WHERE I1.FechaInicio<COALESCE(I2.FechaFin,DATEADD(MINUTE,90,I2.FechaInicio))
      AND I2.FechaInicio<COALESCE(I1.FechaFin,DATEADD(MINUTE,90,I1.FechaInicio))
  )
    THROW 53025, 'Un alumno tiene evaluaciones temporalmente superpuestas.', 1;

  IF EXISTS (
    SELECT 1 FROM #Specs S1 JOIN #Specs S2 ON S2.SpecId>S1.SpecId AND S2.IdDocente=S1.IdDocente
    WHERE S1.FechaInicioUtc<S2.FechaFinUtc AND S2.FechaInicioUtc<S1.FechaFinUtc
  )
    THROW 53026, 'Un docente tiene publicaciones temporalmente superpuestas.', 1;

  IF EXISTS (
    SELECT I.Id FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
    OUTER APPLY (
      SELECT COUNT(*) AS Preguntas,
        SUM(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS SinPuntaje,
        SUM(COALESCE(IP.PuntajeObtenido,0)) AS SumaPuntaje
      FROM dbo.IntentoPregunta IP WHERE IP.IdIntento=I.Id
    ) X
    WHERE I.Estado='entregado' AND (
      X.Preguntas<>@PreguntasPorEvaluacion
      OR (X.SinPuntaje=0 AND (I.NotaFinalCalculada IS NULL OR
          ABS(I.NotaFinalCalculada-X.SumaPuntaje)>0.005 OR
          ABS(I.NotaFinal-X.SumaPuntaje)>0.005))
      OR (X.SinPuntaje>0 AND (I.NotaFinalCalculada IS NOT NULL OR I.NotaFinal IS NOT NULL))
      OR I.NotaFinalManual IS NOT NULL
    )
  )
    THROW 53027, 'Una nota no deriva exactamente de los puntajes definitivos de sus preguntas.', 1;

  IF EXISTS (
    SELECT 1 FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
    JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
    WHERE IP.PuntajeObtenido<0 OR IP.PuntajeObtenido>IP.PuntajeMaximoSnapshot
      OR IP.FechaCorreccion<I.FechaFin OR IP.FechaCorreccion>@FechaCorteUtc
      OR I.FechaCorreccionConfirmada<I.FechaFin OR I.FechaCorreccionConfirmada>@FechaCorteUtc
  )
    THROW 53028, 'Hay puntajes fuera de rango o correcciones/confirmaciones con cronología inválida.', 1;

  IF EXISTS (
    SELECT 1 FROM #Mapa MI JOIN dbo.IncidenteIntento E ON E.IdIntento=MI.IdEntidad AND MI.Tipo='intento'
    JOIN dbo.Intento I ON I.Id=E.IdIntento
    WHERE E.Tipo<>'question_active' OR E.IdIntentoPregunta IS NULL OR E.Estado<>'completado'
      OR E.FechaInicioCliente<I.FechaInicio OR E.FechaFinCliente>I.FechaFin
      OR E.FechaFinCliente>@FechaCorteUtc OR E.DuracionMilisegundos<0
      OR DATEDIFF_BIG(MILLISECOND,E.FechaInicioCliente,E.FechaFinCliente)<>E.DuracionMilisegundos
  )
    THROW 53029, 'La telemetría temporal sintética es incompleta, sensible o cronológicamente inválida.', 1;

  IF EXISTS (
    SELECT I.Id FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
    JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
    LEFT JOIN dbo.Respuesta R ON R.IdIntento=I.Id AND R.IdPregunta=IP.IdPregunta
    LEFT JOIN dbo.IncidenteIntento E ON E.IdIntento=I.Id
      AND E.IdIntentoPregunta=IP.Id AND E.Tipo='question_active'
    WHERE I.Estado='entregado'
    GROUP BY I.Id
    HAVING COUNT(DISTINCT IP.Id)<>@PreguntasPorEvaluacion
      OR COUNT(DISTINCT E.IdIntentoPregunta)<>@PreguntasPorEvaluacion
  )
    THROW 53033, 'Un intento entregado no tiene diez snapshots o diez intervalos temporales por pregunta.', 1;

  IF NOT EXISTS (
      SELECT 1 FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
      JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
      LEFT JOIN dbo.Respuesta R ON R.IdIntento=I.Id AND R.IdPregunta=IP.IdPregunta
      WHERE I.Estado='entregado' AND R.Id IS NULL AND IP.PuntajeObtenido=0
    ) OR NOT EXISTS (
      SELECT 1 FROM #Mapa MI JOIN dbo.IntentoPregunta IP ON IP.IdIntento=MI.IdEntidad AND MI.Tipo='intento'
      WHERE IP.PuntajeObtenido>0 AND IP.PuntajeObtenido<IP.PuntajeMaximoSnapshot
    )
    THROW 53034, 'No se generaron omisiones calificadas con cero y crédito parcial.', 1;

  IF NOT EXISTS (
      SELECT 1 FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
      WHERE I.Estado='entregado' AND I.CorreccionConfirmada=0 AND I.NotaFinal IS NULL
    ) OR NOT EXISTS (
      SELECT 1 FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
      WHERE I.Estado='entregado' AND I.CorreccionConfirmada=0 AND I.NotaFinal IS NOT NULL
    ) OR NOT EXISTS (
      SELECT I.IdPublicacion,I.IdAlumno FROM #Mapa MI
      JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
      GROUP BY I.IdPublicacion,I.IdAlumno HAVING COUNT(*)>1
    ) OR NOT EXISTS (
      SELECT 1 FROM dbo.IntentoValidoOverride V JOIN #Specs S ON S.IdPublicacion=V.IdPublicacion
    )
    THROW 53035, 'Faltan pendientes de puntaje/confirmación, reintentos u overrides válidos.', 1;

  CREATE TABLE #IntentosValidos(IdPublicacion INT,IdAlumno INT,IdIntento INT PRIMARY KEY);
  ;WITH Entregados AS (
    SELECT I.Id,I.IdPublicacion,I.IdAlumno,
      ROW_NUMBER() OVER(PARTITION BY I.IdPublicacion,I.IdAlumno
        ORDER BY I.NumeroIntento DESC,I.FechaFin DESC,I.Id DESC) AS Orden
    FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
    WHERE I.Estado='entregado'
  ), Elegidos AS (
    SELECT E.IdPublicacion,E.IdAlumno,COALESCE(O.IdIntento,E.Id) AS IdIntento
    FROM Entregados E
    OUTER APPLY (SELECT TOP (1) V.IdIntento FROM dbo.IntentoValidoOverride V
      WHERE V.IdPublicacion=E.IdPublicacion AND V.IdAlumno=E.IdAlumno
      ORDER BY V.FechaSeleccion DESC,V.IdIntento DESC) O
    WHERE E.Orden=1
  )
  INSERT #IntentosValidos SELECT IdPublicacion,IdAlumno,IdIntento FROM Elegidos;

  /* El generador produce historia efectiva en los tres ciclos, no sólo
     publicaciones programadas. */
  IF EXISTS (
    SELECT Y.Anio
    FROM (VALUES(2024),(2025),(2026)) Y(Anio)
    WHERE NOT EXISTS (
      SELECT 1 FROM #IntentosValidos V
      JOIN dbo.Intento I ON I.Id=V.IdIntento
      JOIN #Specs S ON S.IdPublicacion=V.IdPublicacion
      WHERE S.AnioLectivo=Y.Anio AND I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL
    )
  )
    THROW 53037, 'Faltan resultados oficiales efectivos en 2024, 2025 o 2026.', 1;

  IF EXISTS (
    SELECT 1 FROM #Specs S
    WHERE MONTH(S.FechaInicioUtc) IN (12,1,2)
  ) OR EXISTS (
    SELECT 1 FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
    WHERE MONTH(I.FechaInicio) IN (12,1,2)
  )
    THROW 53038, 'Hay evaluaciones o rendiciones en diciembre, enero o febrero.', 1;

  /* Antes de octubre de 2026 todos los intentos, incluso los no válidos de un
     reintento, deben estar entregados, puntuados y confirmados. */
  IF EXISTS (
    SELECT 1 FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
    JOIN #Specs S ON S.IdPublicacion=I.IdPublicacion
    WHERE (S.AnioLectivo<YEAR(@FechaCorteLocal)
       OR (S.AnioLectivo=YEAR(@FechaCorteLocal) AND MONTH(S.FechaInicioUtc)<MONTH(@FechaCorteLocal)))
      AND (I.Estado<>'entregado' OR I.NotaFinal IS NULL OR I.NotaFinalCalculada IS NULL
        OR I.CorreccionConfirmada<>1 OR EXISTS (
          SELECT 1 FROM dbo.IntentoPregunta IP
          WHERE IP.IdIntento=I.Id AND IP.PuntajeObtenido IS NULL
        ))
  )
    THROW 53039, 'Existen intentos o puntajes pendientes anteriores al último mes habilitado.', 1;

  IF EXISTS (
    SELECT 1 FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
    JOIN #Specs S ON S.IdPublicacion=I.IdPublicacion
    WHERE (I.Estado<>'entregado' OR I.NotaFinal IS NULL OR I.CorreccionConfirmada<>1
      OR EXISTS (SELECT 1 FROM dbo.IntentoPregunta IP
        WHERE IP.IdIntento=I.Id AND IP.PuntajeObtenido IS NULL))
      AND NOT (S.AnioLectivo=YEAR(@FechaCorteLocal)
        AND MONTH(S.FechaInicioUtc)=MONTH(@FechaCorteLocal))
  )
    THROW 53040, 'Un pendiente operativo quedó fuera del único mes reciente permitido.', 1;

  /* Esta comprobación es más estricta que el ranking: cada publicación histórica
     rendida debe aportar por sí sola al menos diez válidos y 70% de cobertura
     oficial. Por agregación, materia/comisión/mes también satisfacen el umbral. */
  IF EXISTS (
    SELECT S.IdPublicacion
    FROM #Specs S
    LEFT JOIN #IntentosValidos V ON V.IdPublicacion=S.IdPublicacion
    LEFT JOIN dbo.Intento I ON I.Id=V.IdIntento
    WHERE S.Rendida=1
      AND (S.AnioLectivo<YEAR(@FechaCorteLocal)
        OR (S.AnioLectivo=YEAR(@FechaCorteLocal) AND MONTH(S.FechaInicioUtc)<MONTH(@FechaCorteLocal)))
    GROUP BY S.IdPublicacion
    HAVING COUNT(V.IdIntento)<10
      OR SUM(CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END)<10
      OR 100.0*SUM(CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END)
          <70.0*COUNT(V.IdIntento)
  )
    THROW 53041, 'Una publicación histórica activa no alcanza muestra 10 o cobertura oficial 70%.', 1;

  IF EXISTS (
    SELECT S.IdCarrera
    FROM #Specs S LEFT JOIN #IntentosValidos V ON V.IdPublicacion=S.IdPublicacion
    LEFT JOIN dbo.Intento I ON I.Id=V.IdIntento AND I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL
    GROUP BY S.IdCarrera
    HAVING COUNT(I.Id)=0
      OR SUM(CASE WHEN I.NotaFinal>=S.NotaAprobacion THEN 1 ELSE 0 END)=0
      OR 1.0*SUM(CASE WHEN I.NotaFinal>=S.NotaAprobacion THEN 1 ELSE 0 END)/NULLIF(COUNT(I.Id),0)<0.55
      OR 1.0*SUM(CASE WHEN I.NotaFinal>=S.NotaAprobacion THEN 1 ELSE 0 END)/NULLIF(COUNT(I.Id),0)>0.85
  )
    THROW 53030, 'La aprobación oficial de una carrera quedó fuera del rango sintético 55%-85% o sin evidencia.', 1;

  IF EXISTS (
    SELECT I.IdAlumno,YEAR(S.FechaInicioUtc),MONTH(S.FechaInicioUtc)
    FROM #IntentosValidos V JOIN dbo.Intento I ON I.Id=V.IdIntento
    JOIN #Specs S ON S.IdPublicacion=V.IdPublicacion
    GROUP BY I.IdAlumno,YEAR(S.FechaInicioUtc),MONTH(S.FechaInicioUtc)
    HAVING COUNT(DISTINCT S.IdPublicacion)>6
  )
    THROW 53031, 'Un alumno supera seis evaluaciones distintas en un mismo mes.', 1;

  DECLARE @ConfirmacionAntigua DECIMAL(9,6),@ConfirmacionReciente DECIMAL(9,6);
  SELECT @ConfirmacionAntigua=1.0*SUM(CASE WHEN I.CorreccionConfirmada=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0)
  FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
  JOIN #Specs S ON S.IdPublicacion=I.IdPublicacion
  WHERE I.Estado='entregado' AND DATEDIFF(DAY,S.FechaFinUtc,@FechaCorteUtc)>=60;
  SELECT @ConfirmacionReciente=1.0*SUM(CASE WHEN I.CorreccionConfirmada=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0)
  FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
  JOIN #Specs S ON S.IdPublicacion=I.IdPublicacion
  WHERE I.Estado='entregado' AND DATEDIFF(DAY,S.FechaFinUtc,@FechaCorteUtc)<30;
  IF @ConfirmacionAntigua IS NOT NULL AND @ConfirmacionReciente IS NOT NULL
     AND @ConfirmacionAntigua<@ConfirmacionReciente
    THROW 53032, 'Las evaluaciones antiguas no tienen mayor confirmación que las recientes.', 1;

  /* ============================ CIERRE DEL LOTE ============================ */
  EXEC sys.sp_executesql N'INSERT INTO dbo.ExamioTestDataLote
      (LoteId,ConfigHash,ConfigJson,FechaCreacionUtc,Advertencia)
    VALUES(@Lote,@Hash,@Json,SYSUTCDATETIME(),N''DATOS SINTÉTICOS: no representan desempeño real.'');
    INSERT INTO dbo.ExamioTestDataEntidad(LoteId,Tipo,ClaveLogica,IdEntidad)
      SELECT @Lote,Tipo,ClaveLogica,IdEntidad FROM #Mapa;',
    N'@Lote UNIQUEIDENTIFIER,@Hash CHAR(64),@Json NVARCHAR(MAX)',
    @Lote=@LoteId,@Hash=@ConfigHash,@Json=@ConfigJson;

  COMMIT TRANSACTION;

  SELECT N'LOTE_GENERADO' AS Estado,@LoteId AS LoteId,@ConfigHash AS ConfigHash,
    (SELECT COUNT(*) FROM #CohorteAlumno) AS AlumnosUnicos,
    (SELECT COUNT(*) FROM #PlanInscripcion) AS Inscripciones,
    (SELECT COUNT(*) FROM #Comisiones) AS ComisionesActivas,
    (SELECT COUNT(*) FROM #Specs) AS PublicacionesProgramadas,
    (SELECT COUNT(*) FROM #Specs WHERE Rendida=1) AS PublicacionesRendidas,
    (SELECT COUNT(*) FROM #Specs WHERE Rendida=0) AS PublicacionesFuturas,
    (SELECT COUNT(*) FROM #Mapa WHERE Tipo='intento') AS IntentosTotales,
    (SELECT COUNT(*) FROM #Mapa WHERE Tipo='intento')-
      (SELECT COUNT(*) FROM #IntentosValidos) AS ReintentosAdicionales;

  /* Result sets de verificación de sólo lectura posteriores a la carga. */
  SELECT N'MATRICULA_VIGENTE_POR_ALUMNO' AS Seccion,CA.IdCarrera,CA.AnioIngreso,CA.IdAlumno,
    COUNT(DISTINCT P.IdComision) AS MateriasAnuales,
    SUM(CASE WHEN P.SemestreCurricular%2=1 THEN 1 ELSE 0 END) AS MateriasMarzoJunio,
    SUM(CASE WHEN P.SemestreCurricular%2=0 THEN 1 ELSE 0 END) AS MateriasAgostoDiciembre
  FROM #CohorteAlumno CA LEFT JOIN #PlanInscripcion P ON P.IdAlumno=CA.IdAlumno
  GROUP BY CA.IdCarrera,CA.AnioIngreso,CA.IdAlumno
  ORDER BY CA.IdCarrera,CA.AnioIngreso,CA.IdAlumno;

  SELECT N'ALUMNOS_COHORTE_POR_COMISION_HISTORICA' AS Seccion,S.AnioLectivo,S.IdCarrera,
    S.SemestreCurricular,S.IdComision,COUNT(DISTINCT CA.IdAlumno) AS Alumnos
  FROM #Specs S JOIN #CohorteAlumno CA
    ON CA.IdCarrera=S.IdCarrera AND CA.CohorteOrden=S.CohorteOrden
  GROUP BY S.AnioLectivo,S.IdCarrera,S.SemestreCurricular,S.IdComision
  ORDER BY S.AnioLectivo,S.IdCarrera,S.SemestreCurricular,S.IdComision;

  SELECT N'EVALUACIONES_POR_ALUMNO_MES' AS Seccion,I.IdAlumno,
    DATEFROMPARTS(YEAR(S.FechaInicioUtc),MONTH(S.FechaInicioUtc),1) AS Mes,
    COUNT(DISTINCT S.IdPublicacion) AS Evaluaciones
  FROM #IntentosValidos V JOIN dbo.Intento I ON I.Id=V.IdIntento
  JOIN #Specs S ON S.IdPublicacion=V.IdPublicacion
  GROUP BY I.IdAlumno,DATEFROMPARTS(YEAR(S.FechaInicioUtc),MONTH(S.FechaInicioUtc),1)
  ORDER BY I.IdAlumno,Mes;

  SELECT N'CONFIRMACION_POR_ANTIGUEDAD' AS Seccion,
    CASE WHEN DATEDIFF(DAY,S.FechaFinUtc,@FechaCorteUtc)>=60 THEN N'60_dias_o_mas'
      WHEN DATEDIFF(DAY,S.FechaFinUtc,@FechaCorteUtc)>=30 THEN N'30_a_59_dias' ELSE N'menos_de_30_dias' END AS Banda,
    COUNT(*) AS Entregados,SUM(CASE WHEN I.CorreccionConfirmada=1 THEN 1 ELSE 0 END) AS Confirmados
  FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
  JOIN #Specs S ON S.IdPublicacion=I.IdPublicacion WHERE I.Estado='entregado'
  GROUP BY CASE WHEN DATEDIFF(DAY,S.FechaFinUtc,@FechaCorteUtc)>=60 THEN N'60_dias_o_mas'
    WHEN DATEDIFF(DAY,S.FechaFinUtc,@FechaCorteUtc)>=30 THEN N'30_a_59_dias' ELSE N'menos_de_30_dias' END;

  SELECT N'APROBACION_OFICIAL_POR_CARRERA' AS Seccion,S.IdCarrera,COUNT(I.Id) AS ResultadosConsiderados,
    SUM(CASE WHEN I.NotaFinal>=S.NotaAprobacion THEN 1 ELSE 0 END) AS Aprobados,
    CAST(100.0*SUM(CASE WHEN I.NotaFinal>=S.NotaAprobacion THEN 1 ELSE 0 END)/NULLIF(COUNT(I.Id),0) AS DECIMAL(6,2)) AS PorcentajeAprobacion
  FROM #Specs S LEFT JOIN #IntentosValidos V ON V.IdPublicacion=S.IdPublicacion
  LEFT JOIN dbo.Intento I ON I.Id=V.IdIntento AND I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL
  GROUP BY S.IdCarrera ORDER BY S.IdCarrera;

  SELECT N'PUBLICACIONES_POR_MES' AS Seccion,S.IdCarrera,S.IdMateria,S.IdComision,
    DATEFROMPARTS(YEAR(S.FechaInicioUtc),MONTH(S.FechaInicioUtc),1) AS Mes,
    COUNT(*) AS Programadas,SUM(CONVERT(INT,S.Rendida)) AS Rendidas
  FROM #Specs S GROUP BY S.IdCarrera,S.IdMateria,S.IdComision,
    DATEFROMPARTS(YEAR(S.FechaInicioUtc),MONTH(S.FechaInicioUtc),1)
  ORDER BY Mes,S.IdCarrera,S.IdMateria,S.IdComision;

  SELECT N'RESUMEN_POR_ANIO_SEMESTRE' AS Seccion,S.AnioLectivo,
    CASE WHEN S.TipoEvaluacion='recuperatorio' THEN N'recuperatorio_julio'
      WHEN S.SemestreCurricular%2=1 THEN N'primer_semestre'
      ELSE N'segundo_semestre' END AS Periodo,
    COUNT(DISTINCT S.IdPublicacion) AS PublicacionesProgramadas,
    COUNT(DISTINCT CASE WHEN S.Rendida=1 THEN S.IdPublicacion END) AS PublicacionesRendidas,
    COUNT(DISTINCT I.Id) AS IntentosTotales,
    COUNT(DISTINCT CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL
      THEN I.Id END) AS IntentosConfirmadosConNota,
    COUNT(DISTINCT V.IdIntento) AS ResultadosValidosEntregados,
    COUNT(DISTINCT CASE WHEN IV.CorreccionConfirmada=1 AND IV.NotaFinal IS NOT NULL
      THEN V.IdIntento END) AS ResultadosOficialesConsiderados
  FROM #Specs S
  LEFT JOIN dbo.Intento I ON I.IdPublicacion=S.IdPublicacion
  LEFT JOIN #IntentosValidos V ON V.IdPublicacion=S.IdPublicacion
  LEFT JOIN dbo.Intento IV ON IV.Id=V.IdIntento
  GROUP BY S.AnioLectivo,CASE WHEN S.TipoEvaluacion='recuperatorio' THEN N'recuperatorio_julio'
    WHEN S.SemestreCurricular%2=1 THEN N'primer_semestre' ELSE N'segundo_semestre' END
  ORDER BY S.AnioLectivo,Periodo;

  SELECT N'COBERTURA_HISTORICA_POR_PUBLICACION' AS Seccion,S.AnioLectivo,S.IdCarrera,
    S.IdMateria,S.IdComision,S.IdPublicacion,COUNT(V.IdIntento) AS IntentosValidosEntregados,
    SUM(CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END)
      AS ResultadosConsiderados,
    CAST(100.0*SUM(CASE WHEN I.CorreccionConfirmada=1 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END)
      /NULLIF(COUNT(V.IdIntento),0) AS DECIMAL(6,2)) AS PorcentajeCoberturaConfirmada
  FROM #Specs S LEFT JOIN #IntentosValidos V ON V.IdPublicacion=S.IdPublicacion
  LEFT JOIN dbo.Intento I ON I.Id=V.IdIntento
  WHERE S.Rendida=1
  GROUP BY S.AnioLectivo,S.IdCarrera,S.IdMateria,S.IdComision,S.IdPublicacion
  ORDER BY S.AnioLectivo,S.IdCarrera,S.IdMateria,S.IdComision,S.IdPublicacion;

  SELECT N'VALIDACIONES_CRITICAS' AS Seccion,
    (SELECT COUNT(*) FROM #Mapa M1 JOIN dbo.Intento I1 ON I1.Id=M1.IdEntidad AND M1.Tipo='intento'
      JOIN #Mapa M2 ON M2.Tipo='intento' AND M2.IdEntidad>M1.IdEntidad
      JOIN dbo.Intento I2 ON I2.Id=M2.IdEntidad AND I2.IdAlumno=I1.IdAlumno
      WHERE I1.FechaInicio<COALESCE(I2.FechaFin,DATEADD(MINUTE,90,I2.FechaInicio))
        AND I2.FechaInicio<COALESCE(I1.FechaFin,DATEADD(MINUTE,90,I1.FechaInicio))) AS SuperposicionesAlumno,
    (SELECT COUNT(*) FROM #Specs S1 JOIN #Specs S2
      ON S2.SpecId>S1.SpecId AND S2.IdDocente=S1.IdDocente
      WHERE S1.FechaInicioUtc<S2.FechaFinUtc AND S2.FechaInicioUtc<S1.FechaFinUtc) AS SuperposicionesDocente,
    (SELECT COUNT(*) FROM #Specs S JOIN dbo.Intento I ON I.IdPublicacion=S.IdPublicacion
      WHERE S.Rendida=0) AS IntentosEnPublicacionesFuturas,
    (SELECT COUNT(*) FROM #Specs WHERE MONTH(FechaInicioUtc) IN (12,1,2)) AS PublicacionesEnReceso,
    (SELECT COUNT(*) FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
      WHERE MONTH(I.FechaInicio) IN (12,1,2)) AS IntentosEnReceso,
    (SELECT COUNT(*) FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
      JOIN #Specs S ON S.IdPublicacion=I.IdPublicacion
      WHERE (S.AnioLectivo<YEAR(@FechaCorteLocal)
        OR (S.AnioLectivo=YEAR(@FechaCorteLocal) AND MONTH(S.FechaInicioUtc)<MONTH(@FechaCorteLocal)))
        AND (I.Estado<>'entregado' OR I.NotaFinal IS NULL OR I.CorreccionConfirmada<>1
          OR EXISTS (SELECT 1 FROM dbo.IntentoPregunta IP
            WHERE IP.IdIntento=I.Id AND IP.PuntajeObtenido IS NULL))) AS PendientesHistoricos,
    (SELECT COUNT(*) FROM #Mapa MI JOIN dbo.Intento I ON I.Id=MI.IdEntidad AND MI.Tipo='intento'
      OUTER APPLY (SELECT SUM(COALESCE(IP.PuntajeObtenido,0)) Suma,
        SUM(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) SinPuntaje
        FROM dbo.IntentoPregunta IP WHERE IP.IdIntento=I.Id) X
      WHERE I.Estado='entregado' AND ((X.SinPuntaje=0 AND ABS(I.NotaFinal-X.Suma)>0.005)
        OR (X.SinPuntaje>0 AND I.NotaFinal IS NOT NULL))) AS NotasIncoherentes,
    (SELECT COUNT(*) FROM #Mapa MI JOIN dbo.IncidenteIntento E
      ON E.IdIntento=MI.IdEntidad AND MI.Tipo='intento'
      WHERE E.FechaFinCliente>@FechaCorteUtc) AS EventosPosterioresAlCorte;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
