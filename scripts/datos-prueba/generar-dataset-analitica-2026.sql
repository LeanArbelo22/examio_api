/*
  Dataset sintético reproducible para analítica docente e institucional de Examio.

  EXCLUSIVO PARA BASES DE PRUEBA. NO es una migración del producto.
  Este archivo no debe ejecutarse en producción. No crea usuarios, alumnos ni
  inscripciones y no invoca Stored Procedures de negocio (sólo usa
  sys.sp_executesql para DDL dinámico de las tablas auxiliares de prueba).

  Fechas: las variables de calendario se expresan en America/Buenos_Aires
  (Windows SQL Server: "Argentina Standard Time"). Publicacion.FechaInicio/FechaFin
  y las fechas de intento/corrección se escriben como instantes UTC sin offset,
  conforme a la convención efectiva de la API para DATETIME/DATETIME2.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

/* ======================== CONFIGURACIÓN DEL LOTE ======================== */
DECLARE @BaseObjetivo SYSNAME = N'GestionExamio';
DECLARE @LoteId UNIQUEIDENTIFIER = '7D7DFF9A-7E02-4FB0-9C8F-202603102026';
DECLARE @Semilla NVARCHAR(100) = N'examio-analitica-2026-v1';
-- Usar constructores tipados evita depender de DATEFORMAT/LANGUAGE de SQL Server.
DECLARE @FechaInicialLocal DATE = DATEFROMPARTS(2026,3,1);
DECLARE @FechaFinalLocal DATE = DATEFROMPARTS(2026,10,31);
DECLARE @FechaCorteLocal DATETIME2(3) = DATETIME2FROMPARTS(2026,10,23,23,59,59,997,3);
DECLARE @ZonaHorariaSql SYSNAME = N'Argentina Standard Time';
DECLARE @VersionGenerador VARCHAR(20) = '1.0.2';
DECLARE @FechaLimiteLocal DATETIME2(3)=CASE
  WHEN @FechaCorteLocal<DATEADD(MILLISECOND,-3,DATEADD(DAY,1,CONVERT(DATETIME2(3),@FechaFinalLocal)))
    THEN @FechaCorteLocal
  ELSE DATEADD(MILLISECOND,-3,DATEADD(DAY,1,CONVERT(DATETIME2(3),@FechaFinalLocal))) END;

DECLARE @EvaluacionesPorComisionMes INT = 2;
DECLARE @PreguntasPorEvaluacion INT = 10;       -- equivale a grupos presentados
DECLARE @VariantesPorGrupo INT = 2;
DECLARE @GruposConVariantes INT = 4;
DECLARE @MaxParticipantesPorPublicacion INT = 20;

-- Listas CSV de IDs; NULL incluye todo el alcance elegible.
DECLARE @FiltroIdsCarrera NVARCHAR(MAX) = NULL;
DECLARE @FiltroIdsMateria NVARCHAR(MAX) = NULL;
DECLARE @FiltroIdsComision NVARCHAR(MAX) = NULL;
DECLARE @FiltroIdsDocente NVARCHAR(MAX) = NULL;

DECLARE @ExcluirSinDocente BIT = 1;
DECLARE @ExcluirSinAlumnos BIT = 1;
DECLARE @SoloEstimar BIT = 0; -- 1: muestra alcance/volumen y termina sin escribir

DECLARE @TasaParticipacion DECIMAL(6,5) = 1.00000;
DECLARE @TasaCoberturaBaja DECIMAL(6,5) = 0.50000;
DECLARE @TasaReintento DECIMAL(6,5) = 0.18000;
DECLARE @TasaOmission DECIMAL(6,5) = 0.08000;
DECLARE @TasaPendienteConfirmacion DECIMAL(6,5) = 0.06000;
DECLARE @TasaPendientePuntaje DECIMAL(6,5) = 0.03500;
DECLARE @MuestraInsuficienteMax INT = 8;
DECLARE @MinComisionesParaExtremosInstitucionales INT = 4;

-- Probabilidades base (0..1). Se ajustan por perfil, tendencia, alumno,
-- evaluación, pregunta y variante, siempre de forma determinística.
DECLARE @ProbAciertoAlta DECIMAL(6,5) = 0.82000;
DECLARE @ProbAciertoMedia DECIMAL(6,5) = 0.58000;
DECLARE @ProbAciertoBaja DECIMAL(6,5) = 0.30000;
DECLARE @ProbCreditoParcial DECIMAL(6,5) = 0.18000;

/* =========================== GUARDAS BÁSICAS =========================== */
IF DB_NAME() <> @BaseObjetivo
  THROW 53000, 'Base incorrecta. Seleccione la base configurada en @BaseObjetivo antes de ejecutar.', 1;

IF @FechaInicialLocal>@FechaFinalLocal OR @FechaCorteLocal<CAST(@FechaInicialLocal AS DATETIME2(3))
  THROW 53001, 'Rango de fechas o fecha de corte inválidos.', 1;
IF @EvaluacionesPorComisionMes<2 OR @PreguntasPorEvaluacion<10 OR
   @VariantesPorGrupo<1 OR @GruposConVariantes<0 OR
   @GruposConVariantes>@PreguntasPorEvaluacion OR @MaxParticipantesPorPublicacion<1
  THROW 53002, 'Configuración de volumen inválida.', 1;
IF @TasaParticipacion NOT BETWEEN 0 AND 1 OR @TasaCoberturaBaja NOT BETWEEN 0 AND 1 OR
   @TasaReintento NOT BETWEEN 0 AND 1 OR @TasaOmission NOT BETWEEN 0 AND 1 OR
   @TasaPendienteConfirmacion NOT BETWEEN 0 AND 1 OR @TasaPendientePuntaje NOT BETWEEN 0 AND 1 OR
   @TasaPendienteConfirmacion+@TasaPendientePuntaje>1
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
   COL_LENGTH(N'dbo.Intento',N'CorreccionConfirmada') IS NULL
  THROW 53007, 'Faltan columnas de hash, snapshots o confirmación.', 1;

IF OBJECT_ID(N'dbo.PoliticaRevisionPublicacion',N'U') IS NULL OR
   OBJECT_ID(N'dbo.AuditoriaRevisionIntento',N'U') IS NULL OR
   OBJECT_ID(N'dbo.PoliticaSupervisionPublicacion',N'U') IS NULL OR
   OBJECT_ID(N'dbo.ReglaSupervisionPublicacion',N'U') IS NULL OR
   OBJECT_ID(N'dbo.IntentoPoliticaSupervision',N'U') IS NULL OR
   OBJECT_ID(N'dbo.IntentoReglaSupervision',N'U') IS NULL OR
   OBJECT_ID(N'dbo.EstadoSupervisionIntento',N'U') IS NULL
  THROW 53008, 'Faltan migraciones de revisión o supervisión.', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.TipoEventoTelemetria WHERE Tipo='focus_lost' AND Activo=1)
   OR NOT EXISTS (SELECT 1 FROM dbo.TipoEventoTelemetria WHERE Tipo='fullscreen_exit' AND Activo=1)
  THROW 53009, 'Falta el catálogo requerido por la política de supervisión.', 1;

/* ================ ALCANCE Y ESTIMACIÓN (SÓLO LECTURA) ================ */
CREATE TABLE #Alcance (
  IdCarrera INT NOT NULL, Carrera NVARCHAR(300) NOT NULL,
  IdMateria INT NOT NULL, Materia NVARCHAR(300) NOT NULL,
  IdComision INT NOT NULL PRIMARY KEY, Division NVARCHAR(300) NULL,
  IdDocente INT NULL, IdUsuarioDocente INT NULL,
  AlumnosActivos INT NOT NULL, MotivoExclusion NVARCHAR(200) NULL
);

INSERT INTO #Alcance
SELECT C.Id,C.Nombre,M.Id,M.Nombre,MD.Id,DV.Descripcion,MD.IdDocente,
  U.Id,IA.AlumnosActivos,
  CASE WHEN C.Estado<>1 OR M.Estado<>1 THEN N'carrera o materia inactiva'
       WHEN MD.IdDocente IS NULL OR D.Legajo IS NULL OR D.Estado<>1 THEN N'sin docente activo'
       WHEN U.Id IS NULL THEN N'sin usuario docente activo para auditoría'
       WHEN IA.AlumnosActivos=0 THEN N'sin alumnos activos inscriptos'
       ELSE NULL END
FROM dbo.MateriaDivision MD
JOIN dbo.Materia M ON M.Id=MD.IdMateria
JOIN dbo.Carrera C ON C.Id=M.IdCarrera
LEFT JOIN dbo.Division DV ON DV.Id=MD.IdDivision
LEFT JOIN dbo.Docente D ON D.Legajo=MD.IdDocente
OUTER APPLY (SELECT TOP (1) UX.Id FROM dbo.Usuario UX
  WHERE UX.Rol='docente' AND UX.IdDocente=MD.IdDocente AND UX.Activo=1 ORDER BY UX.Id) U
OUTER APPLY (
  SELECT COUNT(*) AS AlumnosActivos
  FROM (
    SELECT DISTINCT IM.IdAlumno
    FROM dbo.InscripcionMateria IM
    JOIN dbo.Alumno AL ON AL.Matricula=IM.IdAlumno AND AL.Estado=N'activo'
    WHERE IM.IdMateriaDivision=MD.Id
  ) InscripcionesActivas
) IA
WHERE (@FiltroIdsCarrera IS NULL OR EXISTS (SELECT 1 FROM STRING_SPLIT(@FiltroIdsCarrera,N',') X WHERE TRY_CONVERT(INT,X.value)=C.Id))
  AND (@FiltroIdsMateria IS NULL OR EXISTS (SELECT 1 FROM STRING_SPLIT(@FiltroIdsMateria,N',') X WHERE TRY_CONVERT(INT,X.value)=M.Id))
  AND (@FiltroIdsComision IS NULL OR EXISTS (SELECT 1 FROM STRING_SPLIT(@FiltroIdsComision,N',') X WHERE TRY_CONVERT(INT,X.value)=MD.Id))
  AND (@FiltroIdsDocente IS NULL OR EXISTS (SELECT 1 FROM STRING_SPLIT(@FiltroIdsDocente,N',') X WHERE TRY_CONVERT(INT,X.value)=MD.IdDocente));

CREATE TABLE #Comisiones (
  Orden INT IDENTITY(1,1) PRIMARY KEY, IdCarrera INT,IdMateria INT,IdComision INT UNIQUE,
  IdDocente INT,IdUsuarioDocente INT,AlumnosActivos INT
);

IF @ExcluirSinDocente=0 AND EXISTS (
  SELECT 1 FROM #Alcance WHERE MotivoExclusion IN (N'sin docente activo',N'sin usuario docente activo para auditoría')
)
  THROW 53012, 'El alcance contiene comisiones sin docente/usuario activo y la política configurada no permite excluirlas.', 1;
IF @ExcluirSinAlumnos=0 AND EXISTS (
  SELECT 1 FROM #Alcance WHERE MotivoExclusion=N'sin alumnos activos inscriptos'
)
  THROW 53013, 'El alcance contiene comisiones sin alumnos activos y la política configurada no permite excluirlas.', 1;

INSERT INTO #Comisiones(IdCarrera,IdMateria,IdComision,IdDocente,IdUsuarioDocente,AlumnosActivos)
SELECT IdCarrera,IdMateria,IdComision,IdDocente,IdUsuarioDocente,AlumnosActivos
FROM #Alcance
WHERE MotivoExclusion IS NULL;

CREATE TABLE #Meses(OrdenMes INT IDENTITY(0,1) PRIMARY KEY,InicioMes DATE UNIQUE);
;WITH Meses AS (
  SELECT DATEFROMPARTS(YEAR(@FechaInicialLocal),MONTH(@FechaInicialLocal),1) AS InicioMes
  UNION ALL SELECT DATEADD(MONTH,1,InicioMes) FROM Meses
  WHERE InicioMes<DATEFROMPARTS(YEAR(@FechaFinalLocal),MONTH(@FechaFinalLocal),1)
)
INSERT INTO #Meses(InicioMes) SELECT InicioMes FROM Meses OPTION (MAXRECURSION 60);

CREATE TABLE #Specs (
  SpecId INT IDENTITY(1,1) PRIMARY KEY,IdComision INT,IdDocente INT,IdUsuarioDocente INT,
  OrdenMes INT,InicioMes DATE,NumeroMes INT,Perfil VARCHAR(10),Tendencia VARCHAR(10),
  Escenario VARCHAR(25),Escala TINYINT,NotaAprobacion DECIMAL(5,2),
  FechaInicioUtc DATETIME2(3),FechaFinUtc DATETIME2(3),IdActividad INT NULL,IdPublicacion INT NULL
);
DECLARE @ComisionesElegibles INT=(SELECT COUNT(*) FROM #Comisiones);

;WITH N AS (
  SELECT TOP (@EvaluacionesPorComisionMes) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS NumeroMes
  FROM sys.all_objects
), Base AS (
  SELECT C.*,M.OrdenMes,M.InicioMes,N.NumeroMes,
    ROW_NUMBER() OVER (ORDER BY C.IdComision,M.InicioMes,N.NumeroMes) AS Secuencia,
    DATEADD(DAY,4+((N.NumeroMes-1)*20/@EvaluacionesPorComisionMes),CAST(M.InicioMes AS DATETIME2(3))) AS InicioLocal
  FROM #Comisiones C CROSS JOIN #Meses M CROSS JOIN N
)
INSERT INTO #Specs(IdComision,IdDocente,IdUsuarioDocente,OrdenMes,InicioMes,NumeroMes,
  Perfil,Tendencia,Escenario,Escala,NotaAprobacion,FechaInicioUtc,FechaFinUtc)
SELECT B.IdComision,B.IdDocente,B.IdUsuarioDocente,B.OrdenMes,B.InicioMes,B.NumeroMes,
  CASE B.IdComision%3 WHEN 0 THEN 'alto' WHEN 1 THEN 'medio' ELSE 'bajo' END,
  CASE (B.IdComision/3)%3 WHEN 0 THEN 'mejora' WHEN 1 THEN 'empeora' ELSE 'estable' END,
  CASE WHEN @ComisionesElegibles>=@MinComisionesParaExtremosInstitucionales AND B.Orden=1 THEN 'sin_entregas'
       WHEN @ComisionesElegibles>=@MinComisionesParaExtremosInstitucionales AND B.Orden=2 THEN 'cobertura_baja'
       WHEN B.Secuencia%13=0 THEN 'sin_entregas'
       WHEN B.Secuencia%11=0 THEN 'muestra_insuficiente'
       WHEN B.Secuencia%7=0 THEN 'cobertura_baja' ELSE 'normal' END,
  CASE WHEN (B.OrdenMes+B.NumeroMes+B.IdComision)%2=0 THEN 10 ELSE 100 END,
  CASE WHEN (B.OrdenMes+B.NumeroMes+B.IdComision)%2=0 THEN 6 ELSE 60 END,
  CONVERT(DATETIME2(3),(DATEADD(HOUR,9,B.InicioLocal) AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC'),
  CONVERT(DATETIME2(3),(((CASE WHEN DATEADD(HOUR,20,DATEADD(DAY,2,B.InicioLocal))>@FechaLimiteLocal
    THEN @FechaLimiteLocal ELSE DATEADD(HOUR,20,DATEADD(DAY,2,B.InicioLocal)) END)
    AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC'))
FROM Base B
WHERE DATEADD(HOUR,15,B.InicioLocal)<=@FechaLimiteLocal;

DECLARE @MesesIncluidos INT=(SELECT COUNT(*) FROM #Meses),
  @PublicacionesPrevistas INT=(SELECT COUNT(*) FROM #Specs),
  @IntentosBaseEstimados BIGINT;
SELECT @IntentosBaseEstimados=SUM(CASE S.Escenario
  WHEN 'sin_entregas' THEN CASE WHEN C.AlumnosActivos>=2 THEN 2 ELSE C.AlumnosActivos END
  WHEN 'muestra_insuficiente' THEN CASE WHEN C.AlumnosActivos>@MuestraInsuficienteMax THEN @MuestraInsuficienteMax ELSE C.AlumnosActivos END
  WHEN 'cobertura_baja' THEN CASE WHEN C.AlumnosActivos>@MaxParticipantesPorPublicacion THEN @MaxParticipantesPorPublicacion ELSE C.AlumnosActivos END
  ELSE CASE WHEN C.AlumnosActivos>@MaxParticipantesPorPublicacion THEN @MaxParticipantesPorPublicacion ELSE C.AlumnosActivos END END)
FROM #Specs S JOIN #Comisiones C ON C.IdComision=S.IdComision;

SELECT N'ALCANCE' AS Seccion,* FROM #Alcance ORDER BY IdCarrera,IdMateria,IdComision;
SELECT N'ESTIMACION_PREVIA' AS Seccion,@ComisionesElegibles AS ComisionesElegibles,
  @MesesIncluidos AS Meses,@PublicacionesPrevistas AS Publicaciones,
  CONVERT(BIGINT,@PublicacionesPrevistas)*@PreguntasPorEvaluacion AS Grupos,
  CONVERT(BIGINT,@PublicacionesPrevistas)*(@PreguntasPorEvaluacion+
    @GruposConVariantes*(@VariantesPorGrupo-1)) AS PreguntasContenido,
  @IntentosBaseEstimados AS IntentosBaseSinReintentos,
  CEILING(@IntentosBaseEstimados*(1+@TasaReintento)) AS IntentosEstimadosConReintentos,
  CEILING(@IntentosBaseEstimados*(1+@TasaReintento))*@PreguntasPorEvaluacion AS PreguntasIntentoEstimadas,
  (SELECT COUNT_BIG(*) FROM dbo.Publicacion P JOIN #Comisiones C ON C.IdComision=P.IdMateriaDivision)
    AS PublicacionesExistentesEnAlcance,
  (SELECT COUNT_BIG(*) FROM dbo.Intento I JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
    JOIN #Comisiones C ON C.IdComision=P.IdMateriaDivision) AS IntentosExistentesEnAlcance,
  (SELECT COUNT_BIG(*) FROM dbo.IntentoPregunta IP JOIN dbo.Intento I ON I.Id=IP.IdIntento
    JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion JOIN #Comisiones C ON C.IdComision=P.IdMateriaDivision)
    AS PreguntasIntentoExistentesEnAlcance;

IF @ComisionesElegibles=0 THROW 53010, 'No hay comisiones elegibles con docente, usuario docente y alumnos activos.', 1;
IF @SoloEstimar=1 RETURN;

/* ======================== IDENTIDAD E IDEMPOTENCIA ======================== */
DECLARE @ConfigJson NVARCHAR(MAX)=(SELECT @VersionGenerador AS versionGenerador,
  @Semilla AS semilla,@FechaInicialLocal AS fechaInicial,
  @FechaFinalLocal AS fechaFinal,@FechaCorteLocal AS fechaCorte,@ZonaHorariaSql AS zonaHoraria,
  @EvaluacionesPorComisionMes AS evaluacionesPorMes,@PreguntasPorEvaluacion AS preguntas,
  @VariantesPorGrupo AS variantes,@GruposConVariantes AS gruposConVariantes,
  @MaxParticipantesPorPublicacion AS maxParticipantes,@FiltroIdsCarrera AS carreras,
  @FiltroIdsMateria AS materias,@FiltroIdsComision AS comisiones,@FiltroIdsDocente AS docentes,
  @ExcluirSinDocente AS excluirSinDocente,@ExcluirSinAlumnos AS excluirSinAlumnos,
  @MuestraInsuficienteMax AS muestraInsuficienteMax,
  @MinComisionesParaExtremosInstitucionales AS minComisionesExtremos,
  @TasaParticipacion AS tasaParticipacion,@TasaCoberturaBaja AS tasaCoberturaBaja,
  @TasaReintento AS tasaReintento,@TasaOmission AS tasaOmision,
  @TasaPendienteConfirmacion AS tasaPendienteConfirmacion,@TasaPendientePuntaje AS tasaPendientePuntaje,
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

  /* ================= EVALUACIONES, CONTENIDO Y POLÍTICAS ================= */
  DECLARE @SpecId INT=1,@SpecMax INT=(SELECT MAX(SpecId) FROM #Specs),
    @IdComision INT,@IdDocente INT,@IdUsuarioDocente INT,@OrdenMes INT,@NumeroMes INT,
    @Perfil VARCHAR(10),@Tendencia VARCHAR(10),@Escenario VARCHAR(25),
    @Escala TINYINT,@NotaAprobacion DECIMAL(5,2),@FechaPubInicio DATETIME2(3),@FechaPubFin DATETIME2(3),
    @IdActividad INT,@IdPublicacion INT,@Marca NVARCHAR(80)=CONCAT(N'[SYNTH-',CONVERT(NVARCHAR(36),@LoteId),N']');

  WHILE @SpecId<=@SpecMax
  BEGIN
    SELECT @IdComision=IdComision,@IdDocente=IdDocente,@IdUsuarioDocente=IdUsuarioDocente,
      @OrdenMes=OrdenMes,@NumeroMes=NumeroMes,@Perfil=Perfil,@Tendencia=Tendencia,@Escenario=Escenario,
      @Escala=Escala,@NotaAprobacion=NotaAprobacion,@FechaPubInicio=FechaInicioUtc,@FechaPubFin=FechaFinUtc
    FROM #Specs WHERE SpecId=@SpecId;

    INSERT INTO dbo.Actividad(Titulo,Descripcion,Tipo,PermiteMultiplesIntentos,DuracionMinutos,Estado,
      RecursosPermitidos,CantidadIntentosMaximos,Revision,EscalaCalificacion,NotaAprobacion,ModoPuntaje,
      MostrarPuntajePorPregunta,CorreccionAutomaticaCerradas)
    VALUES(CONCAT(N'Sintética ',FORMAT(@FechaPubInicio,'yyyy-MM'),N' #',@NumeroMes,N' · comisión ',@IdComision),
      CONCAT(@Marca,N' Datos sintéticos; no representan desempeño real.'),N'evaluacion',1,90,N'publicada',
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
    VALUES(@IdPublicacion,'al_corregir','libre',NULL,NULL,1,@IdUsuarioDocente,@FechaPubFin);
    INSERT INTO dbo.AuditoriaRevisionIntento
      (IdPublicacion,IdIntento,IdSesion,IdUsuario,ActorRol,Accion,Detalle,Fecha)
    VALUES(@IdPublicacion,NULL,NULL,@IdUsuarioDocente,'docente','politica_actualizada',
      N'Política inicial del dataset sintético: al_corregir + libre.',@FechaPubFin);

    INSERT INTO dbo.PoliticaSupervisionPublicacion
      (IdPublicacion,PantallaCompletaObligatoria,CodigoConfiguracion,Revision,ModificadoPor,FechaModificacion)
    VALUES(@IdPublicacion,1,'temporal-v1',1,@IdUsuarioDocente,@FechaPubInicio);
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
    SELECT @IdComision=IdComision,@IdDocente=IdDocente,@IdUsuarioDocente=IdUsuarioDocente,
      @OrdenMes=OrdenMes,@Perfil=Perfil,@Tendencia=Tendencia,@Escenario=Escenario,
      @Escala=Escala,@NotaAprobacion=NotaAprobacion,@FechaPubInicio=FechaInicioUtc,
      @FechaPubFin=FechaFinUtc,@IdActividad=IdActividad,@IdPublicacion=IdPublicacion
    FROM #Specs WHERE SpecId=@SpecId;
    TRUNCATE TABLE #Participantes;

    DECLARE @AlumnosComision INT=(SELECT COUNT(DISTINCT IM.IdAlumno) FROM dbo.InscripcionMateria IM
      JOIN dbo.Alumno AL ON AL.Matricula=IM.IdAlumno AND AL.Estado=N'activo'
      WHERE IM.IdMateriaDivision=@IdComision),@ObjetivoParticipantes INT;
    SET @ObjetivoParticipantes=CASE @Escenario
      WHEN 'sin_entregas' THEN CASE WHEN @AlumnosComision<2 THEN @AlumnosComision ELSE 2 END
      WHEN 'muestra_insuficiente' THEN CASE WHEN @AlumnosComision<@MuestraInsuficienteMax THEN @AlumnosComision ELSE @MuestraInsuficienteMax END
      WHEN 'cobertura_baja' THEN CASE WHEN @AlumnosComision<@MaxParticipantesPorPublicacion THEN @AlumnosComision ELSE @MaxParticipantesPorPublicacion END
      ELSE CASE WHEN @AlumnosComision<@MaxParticipantesPorPublicacion THEN @AlumnosComision ELSE @MaxParticipantesPorPublicacion END END;

    INSERT INTO #Participantes(IdAlumno)
    SELECT TOP (@ObjetivoParticipantes) Candidato.IdAlumno
    FROM (SELECT DISTINCT IM.IdAlumno FROM dbo.InscripcionMateria IM
      JOIN dbo.Alumno AL ON AL.Matricula=IM.IdAlumno AND AL.Estado=N'activo'
      WHERE IM.IdMateriaDivision=@IdComision) Candidato
    CROSS APPLY (SELECT CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',
      CONCAT(@Semilla,N'|participante|',@SpecId,N'|',Candidato.IdAlumno)),1,4)) AS OrdenHash) H
    WHERE @Escenario<>'normal' OR H.OrdenHash%100000<CONVERT(BIGINT,@TasaParticipacion*100000)
    ORDER BY H.OrdenHash,Candidato.IdAlumno;

    DECLARE @OrdenAlumno INT=1,@ParticipantesMax INT=(SELECT MAX(OrdenAlumno) FROM #Participantes),
      @IdAlumno INT,@CantidadIntentos INT,@NumeroIntento INT,@IdIntento INT,@PrimerIntento INT,@SegundoIntento INT,
      @EstadoCaso VARCHAR(30),@FechaIntentoInicio DATETIME2(3),@FechaIntentoFin DATETIME2(3),
      @Roll BIGINT,@RollEstado BIGINT,@EsOverride BIT;
    WHILE @OrdenAlumno<=ISNULL(@ParticipantesMax,0)
    BEGIN
      SELECT @IdAlumno=IdAlumno FROM #Participantes WHERE OrdenAlumno=@OrdenAlumno;
      SET @Roll=CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,N'|retry|',@SpecId,N'|',@IdAlumno)),1,4))%100000;
      SET @CantidadIntentos=CASE WHEN @Escenario='normal' AND (@OrdenAlumno<=2 OR @Roll<@TasaReintento*100000) THEN 2 ELSE 1 END;
      SET @PrimerIntento=NULL; SET @SegundoIntento=NULL; SET @EsOverride=0; SET @NumeroIntento=1;

      WHILE @NumeroIntento<=@CantidadIntentos
      BEGIN
        SET @RollEstado=CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',
          CONCAT(@Semilla,N'|estado|',@SpecId,N'|',@IdAlumno,N'|',@NumeroIntento)),1,4))%100000;
        SET @EstadoCaso=CASE
          WHEN @Escenario='sin_entregas' THEN 'en_progreso'
          WHEN @Escenario='cobertura_baja' AND @OrdenAlumno>CEILING(@ObjetivoParticipantes*@TasaCoberturaBaja)
            THEN 'pendiente_confirmacion'
          WHEN @NumeroIntento=2 AND @OrdenAlumno=1 AND @SpecId%4=0 THEN 'pendiente_puntaje'
          WHEN @OrdenAlumno=1 AND @SpecId%4=0 THEN 'confirmado'
          WHEN @OrdenAlumno=2 AND @SpecId%5=0 THEN 'confirmado'
          WHEN @NumeroIntento=1 AND @OrdenAlumno=3 AND @SpecId%5=0 THEN 'pendiente_confirmacion'
          WHEN @OrdenAlumno=4 AND @SpecId%6=0 THEN 'confirmado'
          WHEN @OrdenAlumno=5 AND @SpecId%6=0 THEN 'confirmado'
          WHEN @RollEstado<@TasaPendientePuntaje*100000 THEN 'pendiente_puntaje'
          WHEN @RollEstado<(@TasaPendientePuntaje+@TasaPendienteConfirmacion)*100000 THEN 'pendiente_confirmacion'
          ELSE 'confirmado' END;
        SET @FechaIntentoInicio=DATEADD(MINUTE,10+@OrdenAlumno*3+(@NumeroIntento-1)*150,@FechaPubInicio);
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
              CASE WHEN B.OrdenPregunta=@PreguntasPorEvaluacion THEN 0.16
                ELSE B.ProbBase + CASE @Tendencia WHEN 'mejora' THEN @OrdenMes*0.025
                  WHEN 'empeora' THEN -@OrdenMes*0.020 ELSE 0 END
                  +((CONVERT(INT,B.RollResultado%21)-10)/100.0)
                  +CASE B.VarianteOrden WHEN 1 THEN 0.06 WHEN 2 THEN -0.08 ELSE 0 END END AS ProbAjustada
            FROM B
          )
          INSERT INTO #ResultadoPregunta
          SELECT Id,IdPregunta,OrdenPregunta,TipoSnapshot,PuntajeMaximoSnapshot,
            CASE WHEN @OrdenAlumno=4 AND @SpecId%6=0 THEN 0
              WHEN RollResultado<CASE WHEN ProbAjustada<0 THEN 0 WHEN ProbAjustada>0.95 THEN 95000 ELSE ProbAjustada*100000 END THEN 2
              WHEN RollResultado<CASE WHEN ProbAjustada+@ProbCreditoParcial>0.98 THEN 98000 ELSE (ProbAjustada+@ProbCreditoParcial)*100000 END THEN 1 ELSE 0 END,
            CAST(CASE WHEN NOT (@OrdenAlumno=4 AND @SpecId%6=0) AND RollOmision<@TasaOmission*100000 THEN 1 ELSE 0 END AS BIT),
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
          SET @NotaManual=CASE WHEN @EstadoCaso='confirmado' AND @OrdenAlumno=5 AND @SpecId%6=0
            THEN CONVERT(DECIMAL(5,2),CASE WHEN @NotaCalculada+@Escala*0.05>@Escala THEN @Escala ELSE @NotaCalculada+@Escala*0.05 END) ELSE NULL END;
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
      IF @PrimerIntento IS NOT NULL AND @SegundoIntento IS NOT NULL AND @OrdenAlumno=2 AND @SpecId%5=0
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
    (SELECT COUNT(*) FROM #Comisiones) AS Comisiones,
    (SELECT COUNT(*) FROM #Specs) AS Publicaciones,
    (SELECT COUNT(*) FROM #Mapa WHERE Tipo='intento') AS Intentos,
    (SELECT COUNT(*) FROM #Mapa WHERE Tipo='publicacion')*@PreguntasPorEvaluacion AS PreguntasPresentadasMinimas;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
