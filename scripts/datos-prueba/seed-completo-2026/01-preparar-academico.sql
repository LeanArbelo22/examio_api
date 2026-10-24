/*
  Seed integral de Examio - etapa 1/2: estructura académica y banco.
  EXCLUSIVO PARA GestionExamio-Migracion. NO es una migración de producto.
  Entregado sin ejecutar. Requiere las migraciones vigentes y una base vacía.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

/* ========================= CONFIGURACIÓN ÚNICA ========================= */
DECLARE @BaseObjetivo SYSNAME=N'GestionExamio-Migracion';
DECLARE @CONFIRMAR_CARGA BIT=0; -- Cambiar a 1 sólo tras revisar y respaldar.
DECLARE @LoteId UNIQUEIDENTIFIER='A1202603-2026-4C04-8EED-000000000001';
DECLARE @Semilla NVARCHAR(100)=N'examio-seed-integral-2026-v1';
DECLARE @VersionGenerador VARCHAR(20)='1.0.0';
DECLARE @FechaInicialLocal DATE=DATEFROMPARTS(2026,3,1);
DECLARE @FechaFinalLocal DATE=DATEFROMPARTS(2026,10,31);
DECLARE @FechaCorteLocal DATETIME2(3)=DATETIME2FROMPARTS(2026,10,23,23,59,59,997,3);
DECLARE @ZonaHorariaSql SYSNAME=N'Argentina Standard Time';
DECLARE @Carreras INT=4,@MateriasPorCarrera INT=30,@ComisionesPorMateria INT=2;
DECLARE @AlumnosPorComision INT=30,@DocentesPorCarrera INT=10;
DECLARE @EvaluacionesPorComision INT=2,@GruposPorEvaluacion INT=10,@VariantesPorGrupo INT=3;
DECLARE @TasaReintento DECIMAL(6,5)=0.10000,@TasaOmision DECIMAL(6,5)=0.08000;
DECLARE @TasaPendienteConfirmacion DECIMAL(6,5)=0.08000,@TasaPendientePuntaje DECIMAL(6,5)=0.03000;
DECLARE @ProbAlta DECIMAL(6,5)=0.82000,@ProbMedia DECIMAL(6,5)=0.58000,@ProbBaja DECIMAL(6,5)=0.28000;
DECLARE @HashPassword VARCHAR(100)='$2b$10$kDvxof7IHvsl7dt3fc39xORm382XUIWjDCwhbZdxuIQ1wNrIFKxhe';

IF DB_NAME()<>@BaseObjetivo THROW 55000,'Base incorrecta: seleccione GestionExamio-Migracion.',1;
IF @CONFIRMAR_CARGA<>1 THROW 55001,'Preflight correcto. Cambie @CONFIRMAR_CARGA a 1 para ejecutar la etapa 1.',1;
IF @FechaInicialLocal>@FechaFinalLocal OR @FechaCorteLocal<CAST(@FechaInicialLocal AS DATETIME2(3))
  THROW 55002,'Rango de fechas inválido.',1;
IF @Carreras<>4 OR @MateriasPorCarrera<>30 OR @ComisionesPorMateria<>2 OR @AlumnosPorComision<>30
  THROW 55003,'Esta versión fue verificada lógicamente para los valores base 4/30/2/30.',1;
IF @EvaluacionesPorComision<>2 OR @GruposPorEvaluacion<10 OR @VariantesPorGrupo<3
  THROW 55004,'La configuración no satisface el volumen académico mínimo.',1;

DECLARE @Requeridas TABLE(Nombre SYSNAME PRIMARY KEY);
INSERT INTO @Requeridas VALUES
('Carrera'),('Materia'),('Division'),('Docente'),('Alumno'),('Usuario'),
('MateriaDivision'),('InscripcionMateria'),('BancoPregunta'),('BancoOpcion'),
('BancoGrupo'),('BancoGrupoPregunta'),('BancoEtiqueta'),('BancoPreguntaEtiqueta'),
('BancoGrupoEtiqueta'),('TipoEventoTelemetria'),('ExamioTestDataLote'),('ExamioTestDataEntidad');
IF EXISTS(SELECT 1 FROM @Requeridas R WHERE OBJECT_ID(N'dbo.'+R.Nombre,N'U') IS NULL)
BEGIN
  SELECT R.Nombre AS TablaFaltante FROM @Requeridas R WHERE OBJECT_ID(N'dbo.'+R.Nombre,N'U') IS NULL;
  THROW 55005,'Faltan tablas requeridas; aplique primero todas las migraciones.',1;
END;

DECLARE @ConfigJson NVARCHAR(MAX)=(SELECT @VersionGenerador versionGenerador,@Semilla semilla,
 @FechaInicialLocal fechaInicial,@FechaFinalLocal fechaFinal,@FechaCorteLocal fechaCorte,
 @ZonaHorariaSql zonaHoraria,@Carreras carreras,@MateriasPorCarrera materiasPorCarrera,
 @ComisionesPorMateria comisionesPorMateria,@AlumnosPorComision alumnosPorComision,
 @DocentesPorCarrera docentesPorCarrera,@EvaluacionesPorComision evaluacionesPorComision,
 @GruposPorEvaluacion gruposPorEvaluacion,@VariantesPorGrupo variantesPorGrupo,
 @TasaReintento tasaReintento,@TasaOmision tasaOmision,
 @TasaPendienteConfirmacion tasaPendienteConfirmacion,@TasaPendientePuntaje tasaPendientePuntaje,
 @ProbAlta probAlta,@ProbMedia probMedia,@ProbBaja probBaja FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
DECLARE @ConfigHash CHAR(64)=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CONVERT(NVARCHAR(MAX),@ConfigJson)),2);
DECLARE @HashExistente CHAR(64)=(SELECT ConfigHash FROM dbo.ExamioTestDataLote WHERE LoteId=@LoteId);
IF @HashExistente IS NOT NULL AND @HashExistente<>@ConfigHash
  THROW 55006,'El LoteId ya existe con otra configuración.',1;
IF @HashExistente=@ConfigHash AND EXISTS(SELECT 1 FROM dbo.ExamioTestDataEntidad
  WHERE LoteId=@LoteId AND Tipo='etapa' AND ClaveLogica=N'01-preparacion')
BEGIN
  SELECT 'ETAPA_YA_APLICADA_SIN_CAMBIOS' Estado,@LoteId LoteId,@ConfigHash ConfigHash;
  RETURN;
END;

/* Un lote nuevo sólo se admite en la base recién vaciada. */
IF @HashExistente IS NULL AND EXISTS(
  SELECT 1 FROM sys.dm_db_partition_stats P JOIN sys.tables T ON T.object_id=P.object_id
  WHERE T.is_ms_shipped=0 AND P.index_id IN(0,1) AND P.row_count>0
    AND T.name NOT IN('sysdiagrams'))
  THROW 55007,'La base no está vacía o contiene otro lote. No se sobrescribirá ningún dato.',1;

CREATE TABLE #Mapa(Tipo VARCHAR(30),Clave NVARCHAR(250),Id BIGINT,PRIMARY KEY(Tipo,Clave));

BEGIN TRY
 BEGIN TRANSACTION;

 /* Catálogo eliminado por el vaciado. Valores exactos de la migración 20261016. */
 INSERT INTO dbo.TipoEventoTelemetria(Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior,Activo) VALUES
 ('question_active',1,0,1,1,1),('focus_lost',1,1,0,1,1),('fullscreen_exit',1,1,0,1,1),
 ('connectivity_lost',1,1,0,1,1),('auth_session_unavailable',1,1,0,1,1),
 ('exam_resumed',0,0,0,0,1),('page_reload',0,0,0,0,1),('sync_error',0,1,0,0,1),
 ('submission_failed',0,1,0,0,1),('attempt_finished',0,0,0,0,1);

 DECLARE @C INT=1,@M INT,@D INT,@A INT,@T INT,@Id INT,@Legajo INT,@Matricula INT,@IdDivision INT;
 WHILE @C<=@Carreras
 BEGIN
  INSERT dbo.Carrera(Nombre,Descripcion,DuracionSemestres,Estado)
  VALUES(CONCAT(N'Carrera Sintética ',@C),N'Datos sintéticos para validación; no representan desempeño real.',6,1);
  SET @Id=CONVERT(INT,SCOPE_IDENTITY()); INSERT #Mapa VALUES('carrera',CONCAT('c:',@C),@Id);
  SET @C+=1;
 END;

 SET @D=1;
 WHILE @D<=@ComisionesPorMateria
 BEGIN
  INSERT dbo.Division(Descripcion) VALUES(CONCAT(N'Cohorte ',CHAR(64+@D),N' 2026'));
  SET @Id=CONVERT(INT,SCOPE_IDENTITY()); INSERT #Mapa VALUES('division',CONCAT('d:',@D),@Id);
  SET @D+=1;
 END;

 /* 40 docentes: diez por carrera, cada uno recibe tres materias y sus dos comisiones. */
 SET @C=1;
 WHILE @C<=@Carreras
 BEGIN
  SET @T=1;
  WHILE @T<=@DocentesPorCarrera
  BEGIN
   SET @Legajo=200000+@C*100+@T;
   INSERT dbo.Docente(Legajo,Nombre,Apellido,Cuil,Correo,Estado)
   VALUES(@Legajo,CONCAT(N'Docente ',@C,N'-',@T),N'Sintético',
     RIGHT(REPLICATE('0',11)+CONVERT(VARCHAR(11),27000000000+@C*100+@T),11),
     CONCAT('docente.c',@C,'.',@T,'@seed.examio.test'),1);
   INSERT #Mapa VALUES('docente',CONCAT('c:',@C,':t:',@T),@Legajo);
   SET @T+=1;
  END;
  SET @C+=1;
 END;

 /* 240 alumnos únicos: dos cohortes de 30 por carrera. */
 SET @C=1;
 WHILE @C<=@Carreras
 BEGIN
  SET @D=1;
  WHILE @D<=@ComisionesPorMateria
  BEGIN
   SET @A=1;
   WHILE @A<=@AlumnosPorComision
   BEGIN
    SET @Matricula=300000+@C*1000+@D*100+@A;
    INSERT dbo.Alumno(Matricula,Nombre,Apellido,Cuil,Correo,Estado)
    VALUES(@Matricula,CONCAT(N'Alumno ',RIGHT(CONCAT('00',@A),2)),CONCAT(N'Sintético C',@C,N'-',CHAR(64+@D)),
      RIGHT(REPLICATE('0',11)+CONVERT(VARCHAR(11),20000000000+@C*1000+@D*100+@A),11),
      CONCAT('alumno.c',@C,'.',LOWER(CHAR(64+@D)),'.',RIGHT(CONCAT('00',@A),2),'@seed.examio.test'),N'activo');
    INSERT #Mapa VALUES('alumno',CONCAT('c:',@C,':d:',@D,':a:',@A),@Matricula);
    SET @A+=1;
   END;
   SET @D+=1;
  END;
  SET @C+=1;
 END;

 /* Hash bcrypt coste 10 generado offline y verificado con bcryptjs. */
 INSERT dbo.Usuario(Email,PasswordHash,Rol,IdDocente,IdAlumno,FechaCreacion,Activo)
 VALUES('admin@seed.examio.test',@HashPassword,'admin',NULL,NULL,SYSUTCDATETIME(),1);
 SET @Id=CONVERT(INT,SCOPE_IDENTITY()); INSERT #Mapa VALUES('usuario',N'admin',@Id);

 INSERT dbo.Usuario(Email,PasswordHash,Rol,IdDocente,IdAlumno,FechaCreacion,Activo)
 OUTPUT 'usuario',CONCAT('docente:',inserted.IdDocente),inserted.Id INTO #Mapa(Tipo,Clave,Id)
 SELECT Correo,@HashPassword,'docente',Legajo,NULL,SYSUTCDATETIME(),1 FROM dbo.Docente;
 INSERT dbo.Usuario(Email,PasswordHash,Rol,IdDocente,IdAlumno,FechaCreacion,Activo)
 OUTPUT 'usuario',CONCAT('alumno:',inserted.IdAlumno),inserted.Id INTO #Mapa(Tipo,Clave,Id)
 SELECT Correo,@HashPassword,'alumno',NULL,Matricula,SYSUTCDATETIME(),1 FROM dbo.Alumno;

 /* 120 materias; cada carrera tiene nombres propios para navegación inequívoca. */
 SET @C=1;
 WHILE @C<=@Carreras
 BEGIN
  SET @M=1;
  WHILE @M<=@MateriasPorCarrera
  BEGIN
   INSERT dbo.Materia(Nombre,Semestre,IdCarrera,Estado)
   VALUES(CONCAT(N'Materia Sintética C',@C,N' ',RIGHT(CONCAT('00',@M),2)),1+((@M-1)%6),
     (SELECT CONVERT(INT,Id) FROM #Mapa WHERE Tipo='carrera' AND Clave=CONCAT('c:',@C)),1);
   SET @Id=CONVERT(INT,SCOPE_IDENTITY()); INSERT #Mapa VALUES('materia',CONCAT('c:',@C,':m:',@M),@Id);
   SET @M+=1;
  END;
  SET @C+=1;
 END;

 /* 240 MateriaDivision y 7.200 inscripciones: la misma cohorte cursa 30 materias. */
 SET @C=1;
 WHILE @C<=@Carreras
 BEGIN
  SET @M=1;
  WHILE @M<=@MateriasPorCarrera
  BEGIN
   SET @D=1;
   WHILE @D<=@ComisionesPorMateria
   BEGIN
    SET @T=1+((@M-1)%@DocentesPorCarrera);
    INSERT dbo.MateriaDivision(IdMateria,IdDivision,IdDocente)
    VALUES((SELECT CONVERT(INT,Id) FROM #Mapa WHERE Tipo='materia' AND Clave=CONCAT('c:',@C,':m:',@M)),
      (SELECT CONVERT(INT,Id) FROM #Mapa WHERE Tipo='division' AND Clave=CONCAT('d:',@D)),200000+@C*100+@T);
    SET @Id=CONVERT(INT,SCOPE_IDENTITY()); INSERT #Mapa VALUES('comision',CONCAT('c:',@C,':m:',@M,':d:',@D),@Id);
    INSERT dbo.InscripcionMateria(IdMateriaDivision,IdAlumno)
    SELECT @Id,CONVERT(INT,Id) FROM #Mapa WHERE Tipo='alumno' AND Clave LIKE CONCAT('c:',@C,':d:',@D,':a:%');
    SET @D+=1;
   END;
   SET @M+=1;
  END;
  SET @C+=1;
 END;

 /* Banco privado significativo: un grupo, tres preguntas y dos etiquetas por docente. */
 DECLARE @IdGrupoBanco INT,@IdPreguntaBanco INT,@IdEtiqueta1 INT,@IdEtiqueta2 INT,@V INT,@Tipo NVARCHAR(25),
   @Enunciado NVARCHAR(MAX),@OpcionesJson NVARCHAR(MAX),@ContenidoHash CHAR(64);
 DECLARE @Opciones TABLE(Posicion INT,Texto NVARCHAR(500),EsCorrecta BIT);
 DECLARE Doc CURSOR LOCAL FAST_FORWARD FOR SELECT Legajo FROM dbo.Docente ORDER BY Legajo;
 OPEN Doc; FETCH NEXT FROM Doc INTO @Legajo;
 WHILE @@FETCH_STATUS=0
 BEGIN
  INSERT dbo.BancoEtiqueta(IdDocente,Nombre,FechaCreacion,FechaActualizacion)
  VALUES(@Legajo,N'Sintético',SYSUTCDATETIME(),SYSUTCDATETIME()); SET @IdEtiqueta1=CONVERT(INT,SCOPE_IDENTITY());
  INSERT dbo.BancoEtiqueta(IdDocente,Nombre,FechaCreacion,FechaActualizacion)
  VALUES(@Legajo,N'2026',SYSUTCDATETIME(),SYSUTCDATETIME()); SET @IdEtiqueta2=CONVERT(INT,SCOPE_IDENTITY());
  INSERT dbo.BancoGrupo(IdDocente,TituloReferencia,Estado,Revision,FechaCreacion,FechaActualizacion)
  VALUES(@Legajo,CONCAT(N'Grupo banco sintético ',@Legajo),N'disponible',1,SYSUTCDATETIME(),SYSUTCDATETIME());
  SET @IdGrupoBanco=CONVERT(INT,SCOPE_IDENTITY());
  INSERT dbo.BancoGrupoEtiqueta VALUES(@IdGrupoBanco,@IdEtiqueta1,@Legajo),(@IdGrupoBanco,@IdEtiqueta2,@Legajo);
  SET @V=1;
  WHILE @V<=3
  BEGIN
   SET @Tipo=CASE @V WHEN 1 THEN N'mc' WHEN 2 THEN N'multiple' ELSE N'vf' END;
   SET @Enunciado=CONCAT(N'Pregunta sintética de banco ',@V,N' del docente ',@Legajo,N'.');
   DELETE FROM @Opciones;
   IF @Tipo=N'vf' INSERT @Opciones VALUES(1,N'Verdadero',1),(2,N'Falso',0);
   ELSE INSERT @Opciones VALUES(1,N'Opción correcta A',1),(2,CASE WHEN @Tipo=N'multiple' THEN N'Opción correcta B' ELSE N'Distractor B' END,CASE WHEN @Tipo=N'multiple' THEN 1 ELSE 0 END),(3,N'Distractor C',0),(4,N'Distractor D',0);
   SELECT @OpcionesJson=(SELECT CONVERT(BIGINT,Posicion) posicion,Texto texto,EsCorrecta esCorrecta FROM @Opciones ORDER BY Posicion FOR JSON PATH);
   SET @ContenidoHash=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CONVERT(NVARCHAR(MAX),CONCAT(N'v1|',@Tipo,N'|',@Enunciado,N'|sin_justificacion|exacta|informativa|',@OpcionesJson))),2);
   INSERT dbo.BancoPregunta(IdDocente,Titulo,Enunciado,Tipo,Estado,Revision,FechaCreacion,FechaActualizacion,
     ModoJustificacion,EstrategiaCorreccion,TratamientoJustificacion,ContenidoHash)
   VALUES(@Legajo,CONCAT(N'Banco sintético ',@V),@Enunciado,@Tipo,N'disponible',1,SYSUTCDATETIME(),SYSUTCDATETIME(),
     N'sin_justificacion',N'exacta',N'informativa',@ContenidoHash);
   SET @IdPreguntaBanco=CONVERT(INT,SCOPE_IDENTITY());
   INSERT dbo.BancoOpcion(IdPregunta,Texto,EsCorrecta,Posicion)
     SELECT @IdPreguntaBanco,Texto,EsCorrecta,Posicion FROM @Opciones;
   INSERT dbo.BancoGrupoPregunta VALUES(@IdGrupoBanco,@IdPreguntaBanco,@Legajo,@V);
   INSERT dbo.BancoPreguntaEtiqueta VALUES(@IdPreguntaBanco,@IdEtiqueta1,@Legajo);
   SET @V+=1;
  END;
  FETCH NEXT FROM Doc INTO @Legajo;
 END;
 CLOSE Doc; DEALLOCATE Doc;

 INSERT dbo.ExamioTestDataLote(LoteId,ConfigHash,ConfigJson,FechaCreacionUtc,Advertencia)
 VALUES(@LoteId,@ConfigHash,@ConfigJson,SYSUTCDATETIME(),N'DATOS SINTÉTICOS: no representan desempeño real.');
 INSERT dbo.ExamioTestDataEntidad(LoteId,Tipo,ClaveLogica,IdEntidad)
 SELECT @LoteId,Tipo,Clave,Id FROM #Mapa;
 INSERT dbo.ExamioTestDataEntidad VALUES(@LoteId,'etapa',N'01-preparacion',1);

 IF (SELECT COUNT(*) FROM dbo.Carrera)<>4 OR (SELECT COUNT(*) FROM dbo.Materia)<>120
   OR (SELECT COUNT(*) FROM dbo.MateriaDivision)<>240 OR (SELECT COUNT(*) FROM dbo.InscripcionMateria)<>7200
   THROW 55008,'Falló una invariante de volumen de la etapa 1.',1;
 COMMIT;
 SELECT 'ETAPA_1_COMPLETA' Estado,@LoteId LoteId,(SELECT COUNT(*) FROM dbo.Alumno) Alumnos,
   (SELECT COUNT(*) FROM dbo.Docente) Docentes,(SELECT COUNT(*) FROM dbo.Usuario) Usuarios,
   (SELECT COUNT(*) FROM dbo.InscripcionMateria) Inscripciones;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
