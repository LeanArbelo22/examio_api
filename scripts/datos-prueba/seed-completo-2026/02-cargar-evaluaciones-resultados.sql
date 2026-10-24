/*
  Seed integral de Examio - etapa 2/2: evaluaciones, intentos y escenarios.
  EXCLUSIVO PARA GestionExamio-Migracion. NO ejecutar antes de 01-preparar-academico.sql.
  Entregado sin ejecutar. Todas las escrituras se realizan en una transacción.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @BaseObjetivo SYSNAME=N'GestionExamio-Migracion';
DECLARE @CONFIRMAR_CARGA BIT=0; -- Cambiar a 1 sólo para la ejecución manual revisada.
DECLARE @LoteId UNIQUEIDENTIFIER='A1202603-2026-4C04-8EED-000000000001';
IF DB_NAME()<>@BaseObjetivo THROW 55100,'Base incorrecta: seleccione GestionExamio-Migracion.',1;
IF @CONFIRMAR_CARGA<>1 THROW 55101,'Preflight correcto. Cambie @CONFIRMAR_CARGA a 1 para ejecutar la etapa 2.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.ExamioTestDataEntidad WHERE LoteId=@LoteId AND Tipo='etapa' AND ClaveLogica=N'01-preparacion')
  THROW 55102,'Primero debe completar la etapa 1 del mismo lote.',1;
IF EXISTS(SELECT 1 FROM dbo.ExamioTestDataEntidad WHERE LoteId=@LoteId AND Tipo='etapa' AND ClaveLogica=N'02-resultados')
BEGIN SELECT 'ETAPA_YA_APLICADA_SIN_CAMBIOS' Estado,@LoteId LoteId; RETURN; END;

DECLARE @J NVARCHAR(MAX)=(SELECT ConfigJson FROM dbo.ExamioTestDataLote WHERE LoteId=@LoteId);
IF @J IS NULL OR ISJSON(@J)<>1 THROW 55103,'Configuración persistida ausente o inválida.',1;
DECLARE @Semilla NVARCHAR(100)=JSON_VALUE(@J,'$.semilla');
DECLARE @FechaInicialLocal DATE=TRY_CONVERT(DATE,JSON_VALUE(@J,'$.fechaInicial'),126);
DECLARE @FechaFinalLocal DATE=TRY_CONVERT(DATE,JSON_VALUE(@J,'$.fechaFinal'),126);
DECLARE @FechaCorteLocal DATETIME2(3)=TRY_CONVERT(DATETIME2(3),JSON_VALUE(@J,'$.fechaCorte'),126);
DECLARE @ZonaHorariaSql SYSNAME=JSON_VALUE(@J,'$.zonaHoraria');
DECLARE @EvaluacionesPorComision INT=TRY_CONVERT(INT,JSON_VALUE(@J,'$.evaluacionesPorComision'));
DECLARE @Preguntas INT=TRY_CONVERT(INT,JSON_VALUE(@J,'$.gruposPorEvaluacion'));
DECLARE @Variantes INT=TRY_CONVERT(INT,JSON_VALUE(@J,'$.variantesPorGrupo'));
DECLARE @TasaReintento DECIMAL(6,5)=TRY_CONVERT(DECIMAL(6,5),JSON_VALUE(@J,'$.tasaReintento'));
DECLARE @TasaOmision DECIMAL(6,5)=TRY_CONVERT(DECIMAL(6,5),JSON_VALUE(@J,'$.tasaOmision'));
DECLARE @TasaPendConf DECIMAL(6,5)=TRY_CONVERT(DECIMAL(6,5),JSON_VALUE(@J,'$.tasaPendienteConfirmacion'));
DECLARE @TasaPendPuntaje DECIMAL(6,5)=TRY_CONVERT(DECIMAL(6,5),JSON_VALUE(@J,'$.tasaPendientePuntaje'));
DECLARE @ProbAlta DECIMAL(6,5)=TRY_CONVERT(DECIMAL(6,5),JSON_VALUE(@J,'$.probAlta'));
DECLARE @ProbMedia DECIMAL(6,5)=TRY_CONVERT(DECIMAL(6,5),JSON_VALUE(@J,'$.probMedia'));
DECLARE @ProbBaja DECIMAL(6,5)=TRY_CONVERT(DECIMAL(6,5),JSON_VALUE(@J,'$.probBaja'));
IF @FechaInicialLocal IS NULL OR @FechaFinalLocal IS NULL OR @FechaCorteLocal IS NULL OR @EvaluacionesPorComision<>2 OR @Preguntas<10 OR @Variantes<3
  THROW 55104,'La configuración persistida no es compatible con esta etapa.',1;

DECLARE @Requeridas TABLE(Nombre SYSNAME PRIMARY KEY);
INSERT @Requeridas VALUES
('Actividad'),('Publicacion'),('GrupoPregunta'),('Pregunta'),('Opcion'),('Intento'),('IntentoPregunta'),
('IntentoPreguntaOpcionSnapshot'),('Respuesta'),('RespuestaOpcion'),('HistorialRespuestaCambio'),
('HistorialCorreccionIntentoPregunta'),('HistorialNotaIntento'),('IntentoValidoOverride'),
('HistorialIntentoValidoOverride'),('HistorialEstadoCorreccionIntento'),('PoliticaRevisionPublicacion'),
('PermisoRevisionIntento'),('AuditoriaRevisionIntento'),('PoliticaSupervisionPublicacion'),
('ReglaSupervisionPublicacion'),('IntentoPoliticaSupervision'),('IntentoReglaSupervision'),
('EstadoSupervisionIntento'),('DecisionSupervisionIntento'),('IncidenteIntento'),
('RevisionIncidenteIntento'),('ActaMateria'),('DetalleActa');
IF EXISTS(SELECT 1 FROM @Requeridas R WHERE OBJECT_ID(N'dbo.'+R.Nombre,N'U') IS NULL)
BEGIN SELECT Nombre TablaFaltante FROM @Requeridas R WHERE OBJECT_ID(N'dbo.'+R.Nombre,N'U') IS NULL;
 THROW 55105,'Faltan migraciones requeridas.',1; END;
IF EXISTS(SELECT 1 FROM dbo.Actividad) OR EXISTS(SELECT 1 FROM dbo.Intento)
  THROW 55106,'Ya existen evaluaciones o intentos no reconocidos; no se sobrescribirán.',1;

CREATE TABLE #Specs(
 SpecId INT IDENTITY PRIMARY KEY,IdCarrera INT,IdMateria INT,IdComision INT,IdDocente INT,IdUsuarioDocente INT,
 MateriaOrden INT,ComisionOrden INT,NumeroEvaluacion INT,Perfil VARCHAR(10),Tendencia VARCHAR(10),Escenario VARCHAR(25),
 Escala TINYINT,NotaAprobacion DECIMAL(5,2),FechaInicio DATETIME2(3),FechaFin DATETIME2(3),
 IdActividad INT NULL,IdPublicacion INT NULL);

;WITH C AS(
 SELECT CA.Id IdCarrera,M.Id IdMateria,MD.Id IdComision,MD.IdDocente,U.Id IdUsuarioDocente,
  DENSE_RANK() OVER(PARTITION BY CA.Id ORDER BY M.Id) MateriaOrden,
  ROW_NUMBER() OVER(PARTITION BY M.Id ORDER BY MD.Id) ComisionOrden
 FROM dbo.Carrera CA JOIN dbo.Materia M ON M.IdCarrera=CA.Id
 JOIN dbo.MateriaDivision MD ON MD.IdMateria=M.Id
 JOIN dbo.Usuario U ON U.IdDocente=MD.IdDocente AND U.Rol='docente' AND U.Activo=1
),N AS(SELECT 1 NumeroEvaluacion UNION ALL SELECT 2),B AS(
 SELECT C.*,N.NumeroEvaluacion,
  ((C.MateriaOrden-1)%4)+(N.NumeroEvaluacion-1)*4 MesOffset,
  2+((C.MateriaOrden-1)/4)*2 DiaMes
 FROM C CROSS JOIN N
)
INSERT #Specs(IdCarrera,IdMateria,IdComision,IdDocente,IdUsuarioDocente,MateriaOrden,ComisionOrden,NumeroEvaluacion,
 Perfil,Tendencia,Escenario,Escala,NotaAprobacion,FechaInicio,FechaFin)
SELECT B.IdCarrera,B.IdMateria,B.IdComision,B.IdDocente,B.IdUsuarioDocente,B.MateriaOrden,B.ComisionOrden,B.NumeroEvaluacion,
 CASE B.IdCarrera%3 WHEN 1 THEN 'alto' WHEN 2 THEN 'medio' ELSE 'bajo' END,
 CASE B.MateriaOrden%3 WHEN 0 THEN 'mejora' WHEN 1 THEN 'empeora' ELSE 'estable' END,
 CASE WHEN ROW_NUMBER() OVER(ORDER BY B.IdComision,B.NumeroEvaluacion)%41=0 THEN 'sin_confirmados'
      WHEN ROW_NUMBER() OVER(ORDER BY B.IdComision,B.NumeroEvaluacion)%17=0 THEN 'muestra_8'
      WHEN ROW_NUMBER() OVER(ORDER BY B.IdComision,B.NumeroEvaluacion)%13=0 THEN 'cobertura_50'
      WHEN ROW_NUMBER() OVER(ORDER BY B.IdComision,B.NumeroEvaluacion)%29=0 THEN 'aprobacion_0'
      ELSE 'normal' END,
 CASE WHEN (B.MateriaOrden+B.ComisionOrden+B.NumeroEvaluacion)%2=0 THEN 10 ELSE 100 END,
 CASE WHEN (B.MateriaOrden+B.ComisionOrden+B.NumeroEvaluacion)%2=0 THEN 6 ELSE 60 END,
 CONVERT(DATETIME2(3),(DATETIME2FROMPARTS(2026,3+B.MesOffset,B.DiaMes,CASE B.ComisionOrden WHEN 1 THEN 9 ELSE 15 END,0,0,0,3)
   AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC'),
 CONVERT(DATETIME2(3),(DATEADD(DAY,2,DATETIME2FROMPARTS(2026,3+B.MesOffset,B.DiaMes,CASE B.ComisionOrden WHEN 1 THEN 13 ELSE 19 END,0,0,0,3))
   AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC')
FROM B;

IF (SELECT COUNT(*) FROM #Specs)<>480 THROW 55107,'La planificación no produjo 480 publicaciones.',1;
IF EXISTS(SELECT 1 FROM #Specs WHERE FechaInicio>CONVERT(DATETIME2(3),(@FechaCorteLocal AT TIME ZONE @ZonaHorariaSql) AT TIME ZONE 'UTC'))
  THROW 55108,'La fecha de corte excluye una publicación planificada.',1;

CREATE TABLE #Mapa(Tipo VARCHAR(30),Clave NVARCHAR(250),Id BIGINT,PRIMARY KEY(Tipo,Clave));
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @S INT=1,@SMax INT=(SELECT MAX(SpecId) FROM #Specs),@IdActividad INT,@IdPublicacion INT,
  @IdComision INT,@IdDocente INT,@IdUsuarioDocente INT,@Eval INT,@Escala TINYINT,@NotaAprob DECIMAL(5,2),
  @Inicio DATETIME2(3),@Fin DATETIME2(3),@G INT,@V INT,@IdGrupo INT,@IdPregunta INT,@Puntaje DECIMAL(5,2),
  @Tipo NVARCHAR(25),@Modo NVARCHAR(25),@Estrategia NVARCHAR(30),@Tratamiento NVARCHAR(25),
  @Enunciado NVARCHAR(MAX),@OpcionesJson NVARCHAR(MAX),@Hash CHAR(64),@Marca NVARCHAR(80)=CONCAT(N'[SYNTH-',CONVERT(NVARCHAR(36),@LoteId),N']');
 DECLARE @Ops TABLE(Posicion INT,Texto NVARCHAR(500),EsCorrecta BIT);

 WHILE @S<=@SMax
 BEGIN
  SELECT @IdComision=IdComision,@IdDocente=IdDocente,@IdUsuarioDocente=IdUsuarioDocente,@Eval=NumeroEvaluacion,
    @Escala=Escala,@NotaAprob=NotaAprobacion,@Inicio=FechaInicio,@Fin=FechaFin FROM #Specs WHERE SpecId=@S;
  INSERT dbo.Actividad(Titulo,Descripcion,Tipo,PermiteMultiplesIntentos,DuracionMinutos,Estado,RecursosPermitidos,
    CantidadIntentosMaximos,Revision,EscalaCalificacion,NotaAprobacion,ModoPuntaje,MostrarPuntajePorPregunta,CorreccionAutomaticaCerradas)
  VALUES(CONCAT(N'Evaluación sintética ',@Eval,N' · comisión ',@IdComision),CONCAT(@Marca,N' Dataset reproducible; no representa desempeño real.'),
    N'evaluacion',1,90,N'publicada',N'Sin recursos externos',2,1,@Escala,@NotaAprob,N'personalizados',1,1);
  SET @IdActividad=CONVERT(INT,SCOPE_IDENTITY());
  INSERT dbo.Publicacion(IdActividad,IdMateriaDivision,FechaInicio,FechaFin,Visible)
    VALUES(@IdActividad,@IdComision,@Inicio,@Fin,1); SET @IdPublicacion=CONVERT(INT,SCOPE_IDENTITY());
  UPDATE #Specs SET IdActividad=@IdActividad,IdPublicacion=@IdPublicacion WHERE SpecId=@S;
  INSERT #Mapa VALUES('actividad',CONCAT('spec:',@S),@IdActividad),('publicacion',CONCAT('spec:',@S),@IdPublicacion);

  INSERT dbo.PoliticaRevisionPublicacion(IdPublicacion,Modo,Acceso,VentanaDesde,VentanaHasta,Revision,ModificadoPor,FechaModificacion)
    VALUES(@IdPublicacion,'al_corregir','libre',NULL,NULL,1,@IdUsuarioDocente,@Fin);
  INSERT dbo.AuditoriaRevisionIntento(IdPublicacion,IdIntento,IdSesion,IdUsuario,ActorRol,Accion,Detalle,Fecha)
    VALUES(@IdPublicacion,NULL,NULL,@IdUsuarioDocente,'docente','politica_actualizada',N'Política inicial del seed: al_corregir + libre.',@Fin);
  INSERT dbo.PoliticaSupervisionPublicacion(IdPublicacion,PantallaCompletaObligatoria,CodigoConfiguracion,Revision,ModificadoPor,FechaModificacion)
    VALUES(@IdPublicacion,1,'seed-analitica-v1',1,@IdUsuarioDocente,@Inicio);
  INSERT dbo.ReglaSupervisionPublicacion(IdPublicacion,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
    VALUES(@IdPublicacion,'seed-focus-warning','focus_lost','cantidad',1,NULL,50,'advertir',1),
          (@IdPublicacion,'seed-fullscreen-info','fullscreen_exit','cantidad',1,NULL,20,'informar',1);

  SET @G=1;
  WHILE @G<=@Preguntas
  BEGIN
   SET @Puntaje=CONVERT(DECIMAL(5,2),@Escala*1.0/@Preguntas);
   INSERT dbo.GrupoPregunta(IdActividad,TituloReferencia,PuntajeMaximo)
     VALUES(@IdActividad,CONCAT(N'Grupo sintético ',RIGHT(CONCAT('00',@G),2)),@Puntaje);
   SET @IdGrupo=CONVERT(INT,SCOPE_IDENTITY()); SET @V=1;
   WHILE @V<=@Variantes
   BEGIN
    SET @Tipo=CASE WHEN @G IN(1,2) THEN N'multiple' WHEN @G=3 THEN N'vf' WHEN @G IN(8,9) THEN N'abierta' WHEN @G=10 THEN N'code' ELSE N'mc' END;
    SET @Modo=CASE WHEN @G=2 THEN N'obligatoria' WHEN @G=1 THEN N'opcional' ELSE N'sin_justificacion' END;
    SET @Estrategia=CASE WHEN @Tipo=N'multiple' THEN N'parcial_sin_penalizacion' ELSE N'exacta' END;
    SET @Tratamiento=N'informativa';
    SET @Enunciado=CONCAT(@Marca,N' P',@S,N'-G',@G,N'-V',@V,CASE WHEN @Tipo IN(N'abierta',N'code') THEN N': desarrolle la respuesta.' ELSE N': seleccione la opción correcta.' END);
    DELETE FROM @Ops;
    IF @Tipo=N'vf' INSERT @Ops VALUES(1,N'Verdadero',1),(2,N'Falso',0);
    ELSE IF @Tipo IN(N'mc',N'multiple') INSERT @Ops VALUES
      (1,CONCAT(N'Opción correcta A V',@V),1),(2,CONCAT(CASE WHEN @Tipo=N'multiple' THEN N'Opción correcta B' ELSE N'Distractor B' END,N' V',@V),CASE WHEN @Tipo=N'multiple' THEN 1 ELSE 0 END),
      (3,CONCAT(N'Distractor C V',@V),0),(4,CONCAT(N'Distractor D V',@V),0);
    SELECT @OpcionesJson=COALESCE((SELECT CONVERT(BIGINT,Posicion) posicion,Texto texto,EsCorrecta esCorrecta FROM @Ops ORDER BY Posicion FOR JSON PATH),N'[]');
    SET @Hash=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CONVERT(NVARCHAR(MAX),CONCAT(N'v1|',@Tipo,N'|',@Enunciado,N'|',@Modo,N'|',@Estrategia,N'|',@Tratamiento,N'|',@OpcionesJson))),2);
    INSERT dbo.Pregunta(IdGrupoPregunta,Enunciado,Tipo,ModoJustificacion,EstrategiaCorreccion,TratamientoJustificacion,ContenidoHash)
      VALUES(@IdGrupo,@Enunciado,@Tipo,@Modo,@Estrategia,@Tratamiento,@Hash); SET @IdPregunta=CONVERT(INT,SCOPE_IDENTITY());
    INSERT dbo.Opcion(IdPregunta,Texto,EsCorrecta) SELECT @IdPregunta,Texto,EsCorrecta FROM @Ops ORDER BY Posicion;
    SET @V+=1;
   END;
   SET @G+=1;
  END;
  SET @S+=1;
 END;

 /* =================== INTENTOS Y SNAPSHOTS, POR PUBLICACIÓN =================== */
 CREATE TABLE #PlanIntento(Clave NVARCHAR(250) PRIMARY KEY,IdAlumno INT,OrdenAlumno INT,NumeroIntento INT,
   Caso VARCHAR(30),FechaInicio DATETIME2(3),FechaFin DATETIME2(3));
 CREATE TABLE #Intentos(Clave NVARCHAR(250) PRIMARY KEY,IdIntento INT,IdAlumno INT,OrdenAlumno INT,NumeroIntento INT,Caso VARCHAR(30));
 CREATE TABLE #PreguntasResultado(IdIntentoPregunta INT PRIMARY KEY,IdIntento INT,IdPregunta INT,OrdenPregunta INT,
   Tipo NVARCHAR(25),Maximo DECIMAL(5,2),Nivel TINYINT,Omitida BIT,Pendiente BIT,Puntaje DECIMAL(5,2));

 SET @S=1;
 WHILE @S<=@SMax
 BEGIN
  SELECT @IdActividad=IdActividad,@IdPublicacion=IdPublicacion,@IdComision=IdComision,@IdUsuarioDocente=IdUsuarioDocente,
    @Inicio=FechaInicio,@Fin=FechaFin,@Escala=Escala,@NotaAprob=NotaAprobacion,@Eval=NumeroEvaluacion FROM #Specs WHERE SpecId=@S;
  DECLARE @Perfil VARCHAR(10),@Tendencia VARCHAR(10),@Escenario VARCHAR(25);
  SELECT @Perfil=Perfil,@Tendencia=Tendencia,@Escenario=Escenario FROM #Specs WHERE SpecId=@S;
  TRUNCATE TABLE #PlanIntento; TRUNCATE TABLE #Intentos; TRUNCATE TABLE #PreguntasResultado;

  ;WITH A AS(
   SELECT DISTINCT IM.IdAlumno,ROW_NUMBER() OVER(ORDER BY IM.IdAlumno) OrdenAlumno
   FROM dbo.InscripcionMateria IM WHERE IM.IdMateriaDivision=@IdComision
  )
  INSERT #PlanIntento
  SELECT CONCAT('spec:',@S,':a:',IdAlumno,':n:1'),IdAlumno,OrdenAlumno,1,
   CASE WHEN @Escenario='sin_confirmados' THEN 'pendiente_confirmacion'
        WHEN @Escenario='muestra_8' AND OrdenAlumno>8 THEN 'pendiente_confirmacion'
        WHEN @Escenario='cobertura_50' AND OrdenAlumno>15 THEN 'pendiente_confirmacion'
        WHEN CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|pendp|',@S,'|',IdAlumno)),1,4))%100000<@TasaPendPuntaje*100000 THEN 'pendiente_puntaje'
        WHEN CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|pendc|',@S,'|',IdAlumno)),1,4))%100000<@TasaPendConf*100000 THEN 'pendiente_confirmacion'
        ELSE 'confirmado' END,
   DATEADD(MINUTE,10+OrdenAlumno*2,@Inicio),DATEADD(MINUTE,65+OrdenAlumno%8,DATEADD(MINUTE,10+OrdenAlumno*2,@Inicio))
  FROM A;
  INSERT #PlanIntento
  SELECT CONCAT('spec:',@S,':a:',IdAlumno,':n:2'),IdAlumno,OrdenAlumno,2,'pendiente_puntaje',
    DATEADD(MINUTE,180,FechaInicio),DATEADD(MINUTE,240,FechaInicio)
  FROM #PlanIntento WHERE NumeroIntento=1 AND OrdenAlumno<=CEILING(30*@TasaReintento);

  MERGE dbo.Intento AS T USING #PlanIntento AS P ON 1=0
  WHEN NOT MATCHED THEN INSERT(IdPublicacion,IdAlumno,NumeroIntento,FechaInicio,FechaFin,Estado)
    VALUES(@IdPublicacion,P.IdAlumno,P.NumeroIntento,P.FechaInicio,P.FechaFin,'entregado')
  OUTPUT P.Clave,inserted.Id,P.IdAlumno,P.OrdenAlumno,P.NumeroIntento,P.Caso
    INTO #Intentos(Clave,IdIntento,IdAlumno,OrdenAlumno,NumeroIntento,Caso);

  ;WITH G AS(
   SELECT GP.Id,GP.TituloReferencia,GP.PuntajeMaximo,ROW_NUMBER() OVER(ORDER BY GP.Id) OrdenPregunta
   FROM dbo.GrupoPregunta GP WHERE GP.IdActividad=@IdActividad
  ),PV AS(
   SELECT P.*,ROW_NUMBER() OVER(PARTITION BY P.IdGrupoPregunta ORDER BY P.Id) Variante FROM dbo.Pregunta P JOIN G ON G.Id=P.IdGrupoPregunta
  )
  INSERT dbo.IntentoPregunta(IdIntento,IdPregunta,PuntajeMaximoSnapshot,TipoSnapshot,ModoJustificacionSnapshot,
    EstrategiaCorreccionSnapshot,TratamientoJustificacionSnapshot,ContenidoHashSnapshot,EnunciadoSnapshot,GrupoTituloSnapshot,SnapshotReconstruido)
  SELECT I.IdIntento,P.Id,G.PuntajeMaximo,P.Tipo,P.ModoJustificacion,P.EstrategiaCorreccion,P.TratamientoJustificacion,
    P.ContenidoHash,P.Enunciado,G.TituloReferencia,0
  FROM #Intentos I CROSS JOIN G JOIN PV P ON P.IdGrupoPregunta=G.Id
  WHERE P.Variante=1+(CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|var|',@S,'|',I.IdAlumno,'|',I.NumeroIntento,'|',G.OrdenPregunta)),1,4))%@Variantes);

  INSERT dbo.IntentoPreguntaOpcionSnapshot(IdIntentoPregunta,IdOpcionOrigen,TextoSnapshot,EsCorrectaSnapshot,Posicion)
  SELECT IP.Id,O.Id,O.Texto,O.EsCorrecta,ROW_NUMBER() OVER(PARTITION BY IP.Id ORDER BY O.Id)
  FROM dbo.IntentoPregunta IP JOIN #Intentos I ON I.IdIntento=IP.IdIntento JOIN dbo.Opcion O ON O.IdPregunta=IP.IdPregunta;

  INSERT dbo.IntentoPoliticaSupervision(IdIntento,IdPublicacionOrigen,RevisionOrigen,CodigoConfiguracion,PantallaCompletaObligatoria,FechaSnapshot)
  SELECT I.IdIntento,P.IdPublicacion,P.Revision,P.CodigoConfiguracion,P.PantallaCompletaObligatoria,PI.FechaInicio
  FROM #Intentos I JOIN #PlanIntento PI ON PI.Clave=I.Clave JOIN dbo.PoliticaSupervisionPublicacion P ON P.IdPublicacion=@IdPublicacion;
  INSERT dbo.IntentoReglaSupervision(IdIntento,IdReglaOrigen,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
  SELECT I.IdIntento,R.Id,R.Codigo,R.TipoEvento,R.Metrica,R.Umbral,R.VentanaSegundos,R.Prioridad,R.Accion,R.Activa
  FROM #Intentos I CROSS JOIN dbo.ReglaSupervisionPublicacion R WHERE R.IdPublicacion=@IdPublicacion;
  INSERT dbo.EstadoSupervisionIntento(IdIntento,Estado,UltimaAccion,UltimoEventoId,Revision,FechaActualizacion)
  SELECT I.IdIntento,'normal','informar',NULL,1,P.FechaInicio FROM #Intentos I JOIN #PlanIntento P ON P.Clave=I.Clave;

  ;WITH Q AS(
   SELECT IP.Id,IP.IdIntento,IP.IdPregunta,IP.TipoSnapshot,IP.PuntajeMaximoSnapshot,
    ROW_NUMBER() OVER(PARTITION BY IP.IdIntento ORDER BY GP.Id) OrdenPregunta,
    1+(SELECT COUNT(*) FROM dbo.Pregunta PX WHERE PX.IdGrupoPregunta=P.IdGrupoPregunta AND PX.Id<P.Id) Variante,
    I.IdAlumno,I.OrdenAlumno,I.NumeroIntento,I.Caso,
    CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|res|',@S,'|',I.IdAlumno,'|',I.NumeroIntento,'|',GP.Id)),1,4))%100000 RollR,
    CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|omit|',@S,'|',I.IdAlumno,'|',I.NumeroIntento,'|',GP.Id)),1,4))%100000 RollO
   FROM dbo.IntentoPregunta IP JOIN #Intentos I ON I.IdIntento=IP.IdIntento
   JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta JOIN dbo.GrupoPregunta GP ON GP.Id=P.IdGrupoPregunta
  ),R AS(
   SELECT Q.*,CASE @Perfil WHEN 'alto' THEN @ProbAlta WHEN 'medio' THEN @ProbMedia ELSE @ProbBaja END
      +CASE @Tendencia WHEN 'mejora' THEN (@Eval-1)*.10
                       WHEN 'empeora' THEN -(@Eval-1)*.10 ELSE 0 END
      +CASE @S%5 WHEN 0 THEN -.08 WHEN 1 THEN .06 ELSE 0 END
      +CASE Variante WHEN 1 THEN .07 WHEN 3 THEN -.07 ELSE 0 END
      +CASE WHEN OrdenPregunta=10 THEN -.25 ELSE 0 END Prob
   FROM Q
  )
  INSERT #PreguntasResultado
  SELECT Id,IdIntento,IdPregunta,OrdenPregunta,TipoSnapshot,PuntajeMaximoSnapshot,
    CASE WHEN @Escenario='aprobacion_0' THEN 0 WHEN RollR<Prob*100000 THEN 2 WHEN RollR<(Prob+.20)*100000 THEN 1 ELSE 0 END,
    CONVERT(BIT,CASE WHEN RollO<@TasaOmision*100000 THEN 1 ELSE 0 END),
    CONVERT(BIT,CASE WHEN Caso='pendiente_puntaje' AND OrdenPregunta=8 THEN 1 ELSE 0 END),NULL FROM R;
  UPDATE #PreguntasResultado SET Nivel=CASE WHEN Tipo IN(N'mc',N'vf') AND Nivel=1 THEN 0 ELSE Nivel END;
  UPDATE #PreguntasResultado SET Puntaje=CASE WHEN Pendiente=1 THEN NULL WHEN Omitida=1 OR Nivel=0 THEN 0
    WHEN Nivel=2 THEN Maximo ELSE ROUND(Maximo/2.0,2) END;

  INSERT dbo.Respuesta(IdIntento,IdPregunta,RtaTexto,EsCorrecta,ComentariosDocente,Justificacion,Revision)
  SELECT R.IdIntento,R.IdPregunta,CASE WHEN R.Tipo IN(N'abierta',N'code') THEN CONCAT(N'Respuesta sintética ',R.OrdenPregunta) END,
    CASE WHEN R.Nivel=2 THEN 1 WHEN R.Nivel=0 THEN 0 END,NULL,
    CASE WHEN P.ModoJustificacion=N'obligatoria' THEN N'Justificación sintética obligatoria.'
         WHEN P.ModoJustificacion=N'opcional' AND R.OrdenPregunta%2=0 THEN N'Justificación sintética opcional.' END,1
  FROM #PreguntasResultado R JOIN dbo.Pregunta P ON P.Id=R.IdPregunta WHERE R.Omitida=0;

  ;WITH O AS(
   SELECT RSP.Id IdRespuesta,PR.Nivel,PR.Tipo,S.IdOpcionOrigen,S.EsCorrectaSnapshot,
    ROW_NUMBER() OVER(PARTITION BY RSP.Id,S.EsCorrectaSnapshot ORDER BY S.Posicion) OrdenTipo
   FROM #PreguntasResultado PR JOIN dbo.Respuesta RSP ON RSP.IdIntento=PR.IdIntento AND RSP.IdPregunta=PR.IdPregunta
   JOIN dbo.IntentoPregunta IP ON IP.Id=PR.IdIntentoPregunta
   JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
   WHERE PR.Omitida=0 AND PR.Tipo IN(N'mc',N'multiple',N'vf')
  )
  INSERT dbo.RespuestaOpcion(IdRespuesta,IdOpcion)
  SELECT IdRespuesta,IdOpcionOrigen FROM O WHERE (Nivel=2 AND EsCorrectaSnapshot=1)
    OR(Nivel=1 AND Tipo=N'multiple' AND EsCorrectaSnapshot=1 AND OrdenTipo=1)
    OR(Nivel=0 AND EsCorrectaSnapshot=0 AND OrdenTipo=1);

  UPDATE IP SET PuntajeObtenido=R.Puntaje,
    PuntajeAutomaticoOpciones=CASE WHEN R.Tipo IN(N'mc',N'multiple',N'vf') THEN R.Puntaje END,
    OrigenCorreccion=CASE WHEN R.Pendiente=1 THEN NULL WHEN R.Tipo IN(N'abierta',N'code') THEN 'manual' ELSE 'automatica' END,
    ComentariosDocente=CASE WHEN R.Pendiente=0 AND R.Tipo IN(N'abierta',N'code') THEN N'Corrección sintética.' END,
    CorregidoPor=CASE WHEN R.Pendiente=0 AND R.Tipo IN(N'abierta',N'code') THEN @IdUsuarioDocente END,
    FechaCorreccion=CASE WHEN R.Pendiente=0 THEN DATEADD(MINUTE,2,P.FechaFin) END
  FROM dbo.IntentoPregunta IP JOIN #PreguntasResultado R ON R.IdIntentoPregunta=IP.Id
  JOIN #Intentos I ON I.IdIntento=R.IdIntento JOIN #PlanIntento P ON P.Clave=I.Clave;

  INSERT dbo.HistorialCorreccionIntentoPregunta(IdIntentoPregunta,PuntajeAnterior,PuntajeNuevo,ComentarioAnterior,
    ComentarioNuevo,OrigenAnterior,OrigenNuevo,ModificadoPor,FechaModificacion)
  SELECT R.IdIntentoPregunta,NULL,R.Puntaje,NULL,N'Corrección sintética.',NULL,'manual',@IdUsuarioDocente,DATEADD(MINUTE,2,P.FechaFin)
  FROM #PreguntasResultado R JOIN #Intentos I ON I.IdIntento=R.IdIntento JOIN #PlanIntento P ON P.Clave=I.Clave
  WHERE R.Pendiente=0 AND R.Tipo IN(N'abierta',N'code');

  ;WITH T AS(
   SELECT I.IdIntento,I.Caso,I.OrdenAlumno,SUM(CASE WHEN R.Tipo IN(N'mc',N'multiple',N'vf') THEN COALESCE(R.Puntaje,0) ELSE 0 END) Auto,
    CASE WHEN SUM(CASE WHEN R.Pendiente=1 THEN 1 ELSE 0 END)>0 THEN NULL ELSE SUM(COALESCE(R.Puntaje,0)) END Calculada
   FROM #Intentos I JOIN #PreguntasResultado R ON R.IdIntento=I.IdIntento GROUP BY I.IdIntento,I.Caso,I.OrdenAlumno
  )
  UPDATE X SET NotaAutomatica=T.Auto,NotaFinalCalculada=T.Calculada,
   NotaFinalManual=CASE WHEN T.Caso='confirmado' AND T.OrdenAlumno=5 AND @S%10=0 THEN CASE WHEN T.Calculada+@Escala*.05>@Escala THEN @Escala ELSE T.Calculada+@Escala*.05 END END,
   NotaFinal=CASE WHEN T.Caso='pendiente_puntaje' THEN NULL
     WHEN T.Caso='confirmado' AND T.OrdenAlumno=5 AND @S%10=0 THEN CASE WHEN T.Calculada+@Escala*.05>@Escala THEN @Escala ELSE T.Calculada+@Escala*.05 END ELSE T.Calculada END,
   CorreccionConfirmada=CASE WHEN T.Caso='confirmado' THEN 1 ELSE 0 END,
   CorreccionConfirmadaPor=CASE WHEN T.Caso='confirmado' THEN @IdUsuarioDocente END,
   FechaCorreccionConfirmada=CASE WHEN T.Caso='confirmado' THEN DATEADD(MINUTE,5,P.FechaFin) END,
   OrigenConfirmacionCorreccion=CASE WHEN T.Caso='confirmado' THEN 'manual' END
  FROM dbo.Intento X JOIN T ON T.IdIntento=X.Id JOIN #Intentos I ON I.IdIntento=X.Id JOIN #PlanIntento P ON P.Clave=I.Clave;

  INSERT dbo.HistorialEstadoCorreccionIntento(IdIntento,EstadoAnterior,EstadoNuevo,Accion,ModificadoPor,FechaModificacion)
  SELECT I.IdIntento,0,1,'confirmacion_manual',@IdUsuarioDocente,DATEADD(MINUTE,5,P.FechaFin)
  FROM #Intentos I JOIN #PlanIntento P ON P.Clave=I.Clave WHERE I.Caso='confirmado';
  INSERT dbo.HistorialNotaIntento(IdIntento,NotaAnterior,NotaNueva,ModificadoPor,FechaModificacion)
  SELECT I.Id,I.NotaFinalCalculada,I.NotaFinalManual,@IdUsuarioDocente,DATEADD(MINUTE,4,I.FechaFin)
  FROM dbo.Intento I JOIN #Intentos X ON X.IdIntento=I.Id
  WHERE I.NotaFinalManual IS NOT NULL;

  /* Reabre una corrección previamente confirmada en un subconjunto auditable. */
  IF @S%31=0
  BEGIN
   DECLARE @Reabierto INT=(SELECT TOP(1) IdIntento FROM #Intentos WHERE NumeroIntento=1 AND Caso='confirmado' ORDER BY OrdenAlumno DESC);
   IF @Reabierto IS NOT NULL
   BEGIN
    UPDATE dbo.Intento SET CorreccionConfirmada=0,CorreccionConfirmadaPor=NULL,FechaCorreccionConfirmada=NULL,OrigenConfirmacionCorreccion=NULL WHERE Id=@Reabierto;
    INSERT dbo.HistorialEstadoCorreccionIntento VALUES(@Reabierto,1,0,'reapertura_pregunta',@IdUsuarioDocente,DATEADD(MINUTE,6,(SELECT FechaFin FROM dbo.Intento WHERE Id=@Reabierto)));
   END
  END;

  /* Override: conserva el intento base confirmado frente al reintento pendiente. */
  IF @S%9=0
  BEGIN
   DECLARE @AlumnoOverride INT=(SELECT TOP(1) IdAlumno FROM #Intentos WHERE NumeroIntento=2 ORDER BY OrdenAlumno);
   DECLARE @IntentoOverride INT=(SELECT IdIntento FROM #Intentos WHERE IdAlumno=@AlumnoOverride AND NumeroIntento=1);
   IF @IntentoOverride IS NOT NULL
   BEGIN
    INSERT dbo.IntentoValidoOverride(IdPublicacion,IdAlumno,IdIntento,SeleccionadoPor,FechaSeleccion)
      VALUES(@IdPublicacion,@AlumnoOverride,@IntentoOverride,@IdUsuarioDocente,DATEADD(MINUTE,1,@Fin));
    INSERT dbo.HistorialIntentoValidoOverride(IdPublicacion,IdAlumno,IdIntento,Accion,ModificadoPor,FechaModificacion)
      VALUES(@IdPublicacion,@AlumnoOverride,@IntentoOverride,'seleccionado',@IdUsuarioDocente,DATEADD(MINUTE,1,@Fin));
   END
  END;

  /* Telemetría determinística: tiempo por pregunta, finalización e incidentes en 20%. */
  ;WITH E AS(
   SELECT IP.Id IdIntentoPregunta,IP.IdIntento,ROW_NUMBER() OVER(PARTITION BY IP.IdIntento ORDER BY IP.Id) Sec,
    I.FechaInicio,I.FechaFin,CONVERT(UNIQUEIDENTIFIER,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|session|',IP.IdIntento)),1,16)) Sesion
   FROM dbo.IntentoPregunta IP JOIN dbo.Intento I ON I.Id=IP.IdIntento JOIN #Intentos X ON X.IdIntento=I.Id
  )
  INSERT dbo.IncidenteIntento(EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,
    FechaRecepcionInicio,FechaRecepcionFin,Estado,IdIntentoPregunta,SesionClienteId,SecuenciaCliente,Codigo,VersionContrato)
  SELECT CONVERT(UNIQUEIDENTIFIER,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|qevent|',IdIntento,'|',Sec)),1,16)),
    IdIntento,'question_active',DATEADD(SECOND,(Sec-1)*150,FechaInicio),
    DATEADD(MILLISECOND,(35+CONVERT(INT,CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|time|',IdIntento,'|',Sec)),1,4))%70))*1000,DATEADD(SECOND,(Sec-1)*150,FechaInicio)),
    CONVERT(BIGINT,(35+CONVERT(INT,CONVERT(BIGINT,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|time|',IdIntento,'|',Sec)),1,4))%70))*1000),
    DATEADD(SECOND,(Sec-1)*150,FechaInicio),DATEADD(SECOND,Sec*150,FechaInicio),'completado',IdIntentoPregunta,Sesion,Sec,'seed-question',1 FROM E;

  INSERT dbo.IncidenteIntento(EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,
    FechaRecepcionInicio,FechaRecepcionFin,Estado,IdIntentoPregunta,SesionClienteId,SecuenciaCliente,Codigo,VersionContrato)
  SELECT CONVERT(UNIQUEIDENTIFIER,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|finished|',I.IdIntento)),1,16)),I.IdIntento,
    'attempt_finished',P.FechaFin,P.FechaFin,0,P.FechaFin,P.FechaFin,'completado',NULL,
    CONVERT(UNIQUEIDENTIFIER,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|session|',I.IdIntento)),1,16)),100,'seed-finished',1
  FROM #Intentos I JOIN #PlanIntento P ON P.Clave=I.Clave;

  INSERT dbo.IncidenteIntento(EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,
    FechaRecepcionInicio,FechaRecepcionFin,Estado,IdIntentoPregunta,SesionClienteId,SecuenciaCliente,Codigo,VersionContrato)
  SELECT CONVERT(UNIQUEIDENTIFIER,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|focus|',I.IdIntento)),1,16)),I.IdIntento,
    CASE WHEN I.OrdenAlumno%10=0 THEN 'fullscreen_exit' ELSE 'focus_lost' END,DATEADD(MINUTE,18,P.FechaInicio),
    DATEADD(SECOND,8+I.OrdenAlumno%20,DATEADD(MINUTE,18,P.FechaInicio)),(8+I.OrdenAlumno%20)*1000,
    DATEADD(MINUTE,18,P.FechaInicio),DATEADD(SECOND,8+I.OrdenAlumno%20,DATEADD(MINUTE,18,P.FechaInicio)),'completado',NULL,
    CONVERT(UNIQUEIDENTIFIER,SUBSTRING(HASHBYTES('SHA2_256',CONCAT(@Semilla,'|session|',I.IdIntento)),1,16)),90,'seed-incident',1
  FROM #Intentos I JOIN #PlanIntento P ON P.Clave=I.Clave WHERE I.NumeroIntento=1 AND I.OrdenAlumno%5=0;

  INSERT dbo.DecisionSupervisionIntento(IdIntento,EventoId,IdReglaSnapshot,Accion,ValorMetrica,ConsecuenciaAplicada,
    Resultado,EstadoRevision,FechaDecision,FechaActualizacion)
  SELECT E.IdIntento,E.EventoId,R.Id,R.Accion,1,1,'aplicada','pendiente',E.FechaRecepcionInicio,E.FechaRecepcionInicio
  FROM dbo.IncidenteIntento E JOIN #Intentos I ON I.IdIntento=E.IdIntento
  JOIN dbo.IntentoReglaSupervision R ON R.IdIntento=E.IdIntento AND R.TipoEvento=E.Tipo AND R.Activa=1
  WHERE E.Codigo='seed-incident';
  UPDATE ES SET Estado=CASE D.Accion WHEN 'advertir' THEN 'advertido' ELSE ES.Estado END,
    UltimaAccion=D.Accion,UltimoEventoId=D.EventoId,Revision=ES.Revision+1,FechaActualizacion=D.FechaDecision
  FROM dbo.EstadoSupervisionIntento ES JOIN dbo.DecisionSupervisionIntento D ON D.IdIntento=ES.IdIntento
  JOIN #Intentos I ON I.IdIntento=ES.IdIntento;
  INSERT dbo.RevisionIncidenteIntento(IdIncidente,Revision,Estado,ActorId,ActorRol,Comentario,FechaRevision)
  SELECT E.Id,1,CASE WHEN I.OrdenAlumno%10=0 THEN 'revisado' ELSE 'descartado' END,@IdUsuarioDocente,'docente',
    N'Revisión operativa sintética; no determina fraude.',DATEADD(MINUTE,10,E.FechaRecepcionFin)
  FROM dbo.IncidenteIntento E JOIN #Intentos I ON I.IdIntento=E.IdIntento
  WHERE E.Codigo='seed-incident' AND I.OrdenAlumno%10=0;

  IF @S%12=0
  BEGIN
   DECLARE @IntentoPermiso INT=(SELECT TOP(1) IdIntento FROM #Intentos WHERE NumeroIntento=1 ORDER BY OrdenAlumno);
   INSERT dbo.PermisoRevisionIntento(IdIntento,Estado,Acceso,FechaDesde,FechaHasta,Motivo,Revision,ModificadoPor,FechaModificacion)
     VALUES(@IntentoPermiso,'activo','libre',@Fin,DATEADD(DAY,30,@Fin),N'Permiso sintético para pruebas.',1,@IdUsuarioDocente,@Fin);
   INSERT dbo.AuditoriaRevisionIntento(IdPublicacion,IdIntento,IdSesion,IdUsuario,ActorRol,Accion,Detalle,Fecha)
     VALUES(@IdPublicacion,@IntentoPermiso,NULL,@IdUsuarioDocente,'docente','permiso_otorgado',N'Permiso sintético.',@Fin);
  END;

  INSERT #Mapa SELECT 'intento',Clave,IdIntento FROM #Intentos;
  SET @S+=1;
 END;

 /* Actas: una por comisión; notas normalizadas a 10 desde resultados confirmados. */
 DECLARE @IdActa INT;
 DECLARE Actas CURSOR LOCAL FAST_FORWARD FOR SELECT Id FROM dbo.MateriaDivision ORDER BY Id;
 OPEN Actas; FETCH NEXT FROM Actas INTO @IdComision;
 WHILE @@FETCH_STATUS=0
 BEGIN
  INSERT dbo.ActaMateria(IdMateriaDivision,FechaCierre,Libro,Folio,Estado)
    VALUES(@IdComision,CONVERT(DATE,@FechaCorteLocal),CONCAT(N'SYN-',@IdComision/100+1),CONVERT(NVARCHAR(20),@IdComision),N'cerrada');
  SET @IdActa=CONVERT(INT,SCOPE_IDENTITY());
  INSERT dbo.DetalleActa(IdActa,IdAlumno,NotaCursada,NotaFinalExamen,CondicionFinal)
  SELECT @IdActa,IM.IdAlumno,
    CONVERT(DECIMAL(4,2),COALESCE(AVG(CASE WHEN A.EscalaCalificacion=100 THEN I.NotaFinal/10.0 ELSE I.NotaFinal END),0)),
    CONVERT(DECIMAL(4,2),COALESCE(AVG(CASE WHEN A.EscalaCalificacion=100 THEN I.NotaFinal/10.0 ELSE I.NotaFinal END),0)),
    CASE WHEN COALESCE(AVG(CASE WHEN A.EscalaCalificacion=100 THEN I.NotaFinal/10.0 ELSE I.NotaFinal END),0)>=8 THEN 'promocionado'
         WHEN COALESCE(AVG(CASE WHEN A.EscalaCalificacion=100 THEN I.NotaFinal/10.0 ELSE I.NotaFinal END),0)>=4 THEN 'regular' ELSE 'libre' END
  FROM dbo.InscripcionMateria IM
  JOIN dbo.Publicacion P ON P.IdMateriaDivision=IM.IdMateriaDivision
  JOIN dbo.Actividad A ON A.Id=P.IdActividad
  JOIN dbo.Intento I ON I.IdPublicacion=P.Id AND I.IdAlumno=IM.IdAlumno AND I.NumeroIntento=1
  WHERE IM.IdMateriaDivision=@IdComision AND I.NotaFinal IS NOT NULL
  GROUP BY IM.IdAlumno;
  FETCH NEXT FROM Actas INTO @IdComision;
 END;
 CLOSE Actas; DEALLOCATE Actas;

 INSERT dbo.ExamioTestDataEntidad(LoteId,Tipo,ClaveLogica,IdEntidad)
   SELECT @LoteId,Tipo,Clave,Id FROM #Mapa;
 INSERT dbo.ExamioTestDataEntidad VALUES(@LoteId,'etapa',N'02-resultados',2);

 IF (SELECT COUNT(*) FROM dbo.Publicacion)<>480 THROW 55109,'No se generaron las 480 publicaciones.',1;
 IF (SELECT COUNT(*) FROM dbo.Intento WHERE NumeroIntento=1 AND Estado='entregado')<>14400
   THROW 55110,'No se generaron los 14.400 intentos base entregados.',1;
 IF EXISTS(SELECT 1 FROM dbo.Actividad A OUTER APPLY(SELECT SUM(G.PuntajeMaximo) Total FROM dbo.GrupoPregunta G WHERE G.IdActividad=A.Id)X
   WHERE X.Total<>A.EscalaCalificacion) THROW 55111,'Una evaluación no suma exactamente su escala.',1;
 COMMIT;
 SELECT 'ETAPA_2_COMPLETA' Estado,@LoteId LoteId,(SELECT COUNT(*) FROM dbo.Publicacion) Publicaciones,
  (SELECT COUNT(*) FROM dbo.Intento WHERE NumeroIntento=1) IntentosBase,
  (SELECT COUNT(*) FROM dbo.Intento WHERE NumeroIntento>1) Reintentos,
  (SELECT COUNT(*) FROM dbo.IncidenteIntento WHERE Codigo='seed-incident') Incidentes;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
