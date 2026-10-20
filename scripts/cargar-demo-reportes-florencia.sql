/*
  Dataset DEMO para reportes docentes - Florencia Balmaceda (Legajo 109000)
  Base autorizada: GestionExamio-Migracion

  Crea:
  - 10 alumnos demo adicionales para cada MateriaDivision 32 y 42;
  - 2 evaluaciones publicadas por comisión;
  - 5 grupos por evaluación, con 2 variantes cerradas por grupo;
  - un intento para todos los alumnos y un segundo intento para los primeros 4;
  - respuestas, puntajes, notas finales y corrección confirmada;
  - tiempos question_active, finalización e incidentes para el 20% del padrón.

  Contraseña de los usuarios demo: cervantes

  El script es transaccional e idempotente por la marca [DEMO-REPORTES-109000].
  No ejecutar en producción.
*/
USE [GestionExamio-Migracion];
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;

IF DB_NAME() <> N'GestionExamio-Migracion'
  THROW 52000, 'Este script sólo puede ejecutarse en GestionExamio-Migracion.', 1;

IF NOT EXISTS (
  SELECT 1 FROM dbo.Docente
  WHERE Legajo=109000 AND Correo=N'florencia.balmaceda@cervantes.edu.ar'
)
  THROW 52001, 'No existe la docente Florencia Balmaceda (109000) en esta base.', 1;

IF EXISTS (
  SELECT V.IdMateriaDivision
  FROM (VALUES (32),(42)) V(IdMateriaDivision)
  LEFT JOIN dbo.MateriaDivision MD ON MD.Id=V.IdMateriaDivision AND MD.IdDocente=109000
  WHERE MD.Id IS NULL
)
  THROW 52002, 'Las comisiones 32 y 42 no pertenecen ambas a la docente 109000.', 1;

IF OBJECT_ID(N'dbo.IntentoPreguntaOpcionSnapshot',N'U') IS NULL
   OR OBJECT_ID(N'dbo.TipoEventoTelemetria',N'U') IS NULL
   OR OBJECT_ID(N'dbo.IntentoPoliticaSupervision',N'U') IS NULL
   OR COL_LENGTH(N'dbo.Intento',N'CorreccionConfirmada') IS NULL
   OR COL_LENGTH(N'dbo.IntentoPregunta',N'ContenidoHashSnapshot') IS NULL
  THROW 52003, 'Faltan migraciones requeridas de intentos, snapshots, corrección o telemetría.', 1;

IF OBJECT_ID(N'dbo.SP_Intento_IniciarExamen',N'P') IS NULL
  THROW 52004, 'No existe SP_Intento_IniciarExamen.', 1;

IF NOT EXISTS (
  SELECT 1 FROM dbo.TipoEventoTelemetria
  WHERE Tipo='question_active' AND Activo=1 AND RequierePregunta=1
) OR NOT EXISTS (
  SELECT 1 FROM dbo.TipoEventoTelemetria
  WHERE Tipo='focus_lost' AND Activo=1 AND EsIncidente=1
) OR NOT EXISTS (
  SELECT 1 FROM dbo.TipoEventoTelemetria
  WHERE Tipo='fullscreen_exit' AND Activo=1 AND EsIncidente=1
) OR NOT EXISTS (
  SELECT 1 FROM dbo.TipoEventoTelemetria
  WHERE Tipo='attempt_finished' AND Activo=1
)
  THROW 52005, 'El catálogo de telemetría no contiene los tipos requeridos.', 1;

DECLARE @Marca NVARCHAR(100)=N'[DEMO-REPORTES-109000]';
DECLARE @PasswordHash NVARCHAR(255)=N'$2b$10$IXJLafVO0W4zJRaSe9hNd.eo34KhQ6DB.WwICErC0sn2xxmxbPlyu';
DECLARE @UsuarioDocente INT=(
  SELECT TOP (1) Id FROM dbo.Usuario
  WHERE Rol='docente' AND IdDocente=109000 AND Activo=1
  ORDER BY Id
);

IF @UsuarioDocente IS NULL
  THROW 52006, 'La docente no posee un Usuario activo para auditar revisiones.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  /* ---------- 10 alumnos nuevos por comisión ---------- */
  DECLARE @Numeros TABLE (Numero INT PRIMARY KEY);
  INSERT INTO @Numeros(Numero)
  VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10);

  DECLARE @AlumnosDemo TABLE (
    IdMateriaDivision INT NOT NULL,
    Numero INT NOT NULL,
    Matricula INT NOT NULL PRIMARY KEY,
    Cuil NVARCHAR(20) NOT NULL UNIQUE,
    Email NVARCHAR(50) NOT NULL UNIQUE
  );

  INSERT INTO @AlumnosDemo(IdMateriaDivision,Numero,Matricula,Cuil,Email)
  SELECT MD.Id,N.Numero,M.Matricula,
    CASE
      WHEN DV.DigitoVerificador=10
        THEN CONCAT(N'23',D.Documento,N'4')
      ELSE CONCAT(N'27',D.Documento,DV.DigitoVerificador)
    END,
    CONCAT(N'demo.reportes.',MD.Id,N'.',RIGHT(CONCAT(N'0',N.Numero),2),N'@cervantes.edu.ar')
  FROM (VALUES (32),(42)) MD(Id)
  CROSS JOIN @Numeros N
  CROSS APPLY (SELECT 9000000 + MD.Id*1000 + N.Numero AS Matricula) M
  CROSS APPLY (SELECT RIGHT(CONCAT(N'00000000',M.Matricula),8) AS Documento) D
  CROSS APPLY (
    SELECT
      11-(
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),1,1))*5+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),2,1))*4+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),3,1))*3+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),4,1))*2+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),5,1))*7+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),6,1))*6+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),7,1))*5+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),8,1))*4+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),9,1))*3+
        CONVERT(INT,SUBSTRING(CONCAT(N'27',D.Documento),10,1))*2
      )%11 AS DigitoBase
  ) C
  CROSS APPLY (
    SELECT CASE WHEN C.DigitoBase=11 THEN 0 ELSE C.DigitoBase END AS DigitoVerificador
  ) DV;

  IF EXISTS (
    SELECT 1
    FROM @AlumnosDemo D
    JOIN dbo.Alumno A ON A.Matricula=D.Matricula
    WHERE A.Correo<>D.Email
  )
    THROW 52007, 'Una matrícula reservada para DEMO pertenece a otro alumno.', 1;

  IF EXISTS (
    SELECT 1
    FROM @AlumnosDemo D
    JOIN dbo.Alumno A ON A.Correo=D.Email
    WHERE A.Matricula<>D.Matricula
  )
    THROW 52008, 'Un correo reservado para DEMO pertenece a otra matrícula.', 1;

  IF EXISTS (
    SELECT 1
    FROM @AlumnosDemo D
    JOIN dbo.Alumno A ON A.Cuil=D.Cuil
    WHERE A.Matricula<>D.Matricula
  )
    THROW 52009, 'Un CUIL reservado para DEMO pertenece a otro alumno.', 1;

  INSERT INTO dbo.Alumno(Matricula,Nombre,Apellido,Cuil,Correo,Estado)
  SELECT D.Matricula,CONCAT(N'Demo ',RIGHT(CONCAT(N'0',D.Numero),2)),
    CONCAT(N'Reportes MD',D.IdMateriaDivision),D.Cuil,D.Email,N'activo'
  FROM @AlumnosDemo D
  WHERE NOT EXISTS (SELECT 1 FROM dbo.Alumno A WHERE A.Matricula=D.Matricula);

  INSERT INTO dbo.Usuario(Email,PasswordHash,Rol,IdDocente,IdAlumno,Activo)
  SELECT D.Email,@PasswordHash,N'alumno',NULL,D.Matricula,1
  FROM @AlumnosDemo D
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.Usuario U WHERE U.IdAlumno=D.Matricula OR U.Email=D.Email
  );

  INSERT INTO dbo.InscripcionMateria(IdMateriaDivision,IdAlumno)
  SELECT D.IdMateriaDivision,D.Matricula
  FROM @AlumnosDemo D
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.InscripcionMateria IM
    WHERE IM.IdMateriaDivision=D.IdMateriaDivision AND IM.IdAlumno=D.Matricula
  );

  IF EXISTS (
    SELECT MD.Id
    FROM (VALUES (32),(42)) MD(Id)
    OUTER APPLY (
      SELECT COUNT(DISTINCT IM.IdAlumno) AS Cantidad
      FROM dbo.InscripcionMateria IM WHERE IM.IdMateriaDivision=MD.Id
    ) C
    WHERE C.Cantidad<20
  )
    THROW 52009, 'Alguna comisión continúa con menos de 20 alumnos después del alta DEMO.', 1;

  DECLARE @ActividadesExistentes INT=(
    SELECT COUNT(*) FROM dbo.Actividad WHERE Descripcion=@Marca
  );

  IF @ActividadesExistentes>0
  BEGIN
    IF @ActividadesExistentes<>4
      THROW 52010, 'Existe una carga DEMO parcial. Revisar antes de reintentar.', 1;

    COMMIT TRANSACTION;
    SELECT N'DATOS_YA_EXISTENTES' AS Estado,
      (SELECT COUNT(*) FROM dbo.Alumno A JOIN @AlumnosDemo D ON D.Matricula=A.Matricula)
        AS AlumnosDemo,
      @ActividadesExistentes AS ActividadesDemo;
    RETURN;
  END;

  /* ---------- Evaluaciones, grupos, variantes y publicaciones ---------- */
  DECLARE @Evaluaciones TABLE (
    IdMateriaDivision INT NOT NULL,
    NumeroEvaluacion INT NOT NULL,
    IdActividad INT NOT NULL PRIMARY KEY,
    IdPublicacion INT NOT NULL UNIQUE,
    FechaInicio DATETIME NOT NULL,
    FechaFin DATETIME NOT NULL
  );

  DECLARE @Especificaciones TABLE (
    IdMateriaDivision INT NOT NULL,
    NumeroEvaluacion INT NOT NULL,
    FechaInicio DATETIME NOT NULL,
    FechaFin DATETIME NOT NULL,
    PRIMARY KEY(IdMateriaDivision,NumeroEvaluacion)
  );

  INSERT INTO @Especificaciones
    (IdMateriaDivision,NumeroEvaluacion,FechaInicio,FechaFin)
  VALUES
    (32,1,'2026-09-08T09:00:00','2026-09-10T23:00:00'),
    (32,2,'2026-10-06T09:00:00','2026-10-08T23:00:00'),
    (42,1,'2026-09-15T09:00:00','2026-09-17T23:00:00'),
    (42,2,'2026-10-13T09:00:00','2026-10-15T23:00:00');

  DECLARE @IdMD INT,@NumeroEvaluacion INT,@FechaPublicacionInicio DATETIME,
    @FechaPublicacionFin DATETIME,@IdActividad INT,@IdPublicacion INT;

  DECLARE EvaluacionesCursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT IdMateriaDivision,NumeroEvaluacion,FechaInicio,FechaFin
    FROM @Especificaciones ORDER BY IdMateriaDivision,NumeroEvaluacion;

  OPEN EvaluacionesCursor;
  FETCH NEXT FROM EvaluacionesCursor INTO
    @IdMD,@NumeroEvaluacion,@FechaPublicacionInicio,@FechaPublicacionFin;

  WHILE @@FETCH_STATUS=0
  BEGIN
    INSERT INTO dbo.Actividad
      (Titulo,Descripcion,Tipo,PermiteMultiplesIntentos,DuracionMinutos,Estado,
       RecursosPermitidos,CantidadIntentosMaximos,Revision,EscalaCalificacion,
       NotaAprobacion,ModoPuntaje,MostrarPuntajePorPregunta,CorreccionAutomaticaCerradas)
    VALUES(
      CONCAT(@Marca,N' MD',@IdMD,N' Evaluación ',@NumeroEvaluacion),
      @Marca,N'evaluacion',1,60,N'publicada',N'Sin recursos externos',2,1,10,6,
      N'personalizados',1,1
    );
    SET @IdActividad=CONVERT(INT,SCOPE_IDENTITY());

    INSERT INTO dbo.Publicacion
      (IdActividad,IdMateriaDivision,FechaInicio,FechaFin,Visible)
    VALUES(@IdActividad,@IdMD,@FechaPublicacionInicio,@FechaPublicacionFin,1);
    SET @IdPublicacion=CONVERT(INT,SCOPE_IDENTITY());

    INSERT INTO @Evaluaciones
      (IdMateriaDivision,NumeroEvaluacion,IdActividad,IdPublicacion,FechaInicio,FechaFin)
    VALUES(@IdMD,@NumeroEvaluacion,@IdActividad,@IdPublicacion,
      @FechaPublicacionInicio,@FechaPublicacionFin);

    DECLARE @GrupoNumero INT=1,@Variante INT,@IdGrupo INT,@IdPregunta INT,
      @TipoPregunta NVARCHAR(25),@Enunciado NVARCHAR(MAX),@Hash CHAR(64);

    WHILE @GrupoNumero<=5
    BEGIN
      INSERT INTO dbo.GrupoPregunta(IdActividad,TituloReferencia,PuntajeMaximo)
      VALUES(@IdActividad,CONCAT(N'Grupo ',@GrupoNumero,N' - ',@Marca),2.00);
      SET @IdGrupo=CONVERT(INT,SCOPE_IDENTITY());
      SET @Variante=1;

      WHILE @Variante<=2
      BEGIN
        SET @TipoPregunta=CASE WHEN @GrupoNumero IN (2,4) THEN N'multiple' ELSE N'mc' END;
        SET @Enunciado=CONCAT(
          @Marca,N' MD',@IdMD,N' E',@NumeroEvaluacion,N' G',@GrupoNumero,
          N' Variante ',@Variante,N': seleccione la respuesta correcta.'
        );
        SET @Hash=CONVERT(CHAR(64),HASHBYTES('SHA2_256',
          CONVERT(VARBINARY(MAX),CONCAT(@Enunciado,N'|',@TipoPregunta))),2);

        INSERT INTO dbo.Pregunta
          (IdGrupoPregunta,Enunciado,Tipo,ModoJustificacion,EstrategiaCorreccion,
           TratamientoJustificacion,ContenidoHash)
        VALUES(
          @IdGrupo,@Enunciado,@TipoPregunta,
          CASE WHEN @TipoPregunta=N'multiple' THEN N'opcional' ELSE N'sin_justificacion' END,
          CASE WHEN @TipoPregunta=N'multiple' THEN N'parcial_sin_penalizacion' ELSE N'exacta' END,
          N'informativa',@Hash
        );
        SET @IdPregunta=CONVERT(INT,SCOPE_IDENTITY());

        INSERT INTO dbo.Opcion(IdPregunta,Texto,EsCorrecta)
        VALUES
          (@IdPregunta,CONCAT(N'Opción A - correcta - V',@Variante),1),
          (@IdPregunta,CONCAT(N'Opción B - ',
            CASE WHEN @TipoPregunta=N'multiple' THEN N'correcta' ELSE N'distractor' END,
            N' - V',@Variante),CASE WHEN @TipoPregunta=N'multiple' THEN 1 ELSE 0 END),
          (@IdPregunta,CONCAT(N'Opción C - distractor - V',@Variante),0),
          (@IdPregunta,CONCAT(N'Opción D - distractor - V',@Variante),0);

        SET @Variante+=1;
      END;
      SET @GrupoNumero+=1;
    END;

    FETCH NEXT FROM EvaluacionesCursor INTO
      @IdMD,@NumeroEvaluacion,@FechaPublicacionInicio,@FechaPublicacionFin;
  END;

  CLOSE EvaluacionesCursor;
  DEALLOCATE EvaluacionesCursor;

  /* ---------- Padrón efectivo ---------- */
  SELECT IM.IdMateriaDivision,IM.IdAlumno,
    ROW_NUMBER() OVER (PARTITION BY IM.IdMateriaDivision ORDER BY IM.IdAlumno) AS OrdenAlumno
  INTO #Padron
  FROM dbo.InscripcionMateria IM
  WHERE IM.IdMateriaDivision IN (32,42);

  CREATE TABLE #IntentosCarga (
    IdIntento INT NOT NULL PRIMARY KEY,
    IdPublicacion INT NOT NULL,
    IdMateriaDivision INT NOT NULL,
    NumeroEvaluacion INT NOT NULL,
    IdAlumno INT NOT NULL,
    OrdenAlumno INT NOT NULL,
    NumeroCarga INT NOT NULL
  );

  CREATE TABLE #InicioIntento (IdIntento INT NOT NULL,Status VARCHAR(30) NULL);

  DECLARE @Fase INT=1;
  WHILE @Fase<=2
  BEGIN
    DECLARE @Alumno INT,@OrdenAlumno INT,@IntentoCreado INT;
    DECLARE IntentosCursor CURSOR LOCAL FAST_FORWARD FOR
      SELECT E.IdPublicacion,E.IdMateriaDivision,E.NumeroEvaluacion,P.IdAlumno,P.OrdenAlumno
      FROM @Evaluaciones E
      JOIN #Padron P ON P.IdMateriaDivision=E.IdMateriaDivision
      WHERE @Fase=1 OR P.OrdenAlumno<=4
      ORDER BY E.IdPublicacion,P.OrdenAlumno;

    OPEN IntentosCursor;
    FETCH NEXT FROM IntentosCursor INTO
      @IdPublicacion,@IdMD,@NumeroEvaluacion,@Alumno,@OrdenAlumno;

    WHILE @@FETCH_STATUS=0
    BEGIN
      DELETE FROM #InicioIntento;
      INSERT INTO #InicioIntento(IdIntento,Status)
      EXEC dbo.SP_Intento_IniciarExamen @IdPublicacion=@IdPublicacion,@IdAlumno=@Alumno;

      SELECT @IntentoCreado=IdIntento FROM #InicioIntento;
      IF @IntentoCreado IS NULL
        THROW 52011, 'SP_Intento_IniciarExamen no devolvió un intento.', 1;

      INSERT INTO #IntentosCarga
        (IdIntento,IdPublicacion,IdMateriaDivision,NumeroEvaluacion,
         IdAlumno,OrdenAlumno,NumeroCarga)
      VALUES(@IntentoCreado,@IdPublicacion,@IdMD,@NumeroEvaluacion,
        @Alumno,@OrdenAlumno,@Fase);

      FETCH NEXT FROM IntentosCursor INTO
        @IdPublicacion,@IdMD,@NumeroEvaluacion,@Alumno,@OrdenAlumno;
    END;

    CLOSE IntentosCursor;
    DEALLOCATE IntentosCursor;

    UPDATE I
    SET FechaInicio=DATEADD(MINUTE,C.OrdenAlumno*2 + CASE WHEN @Fase=2 THEN 180 ELSE 0 END,E.FechaInicio),
        FechaFin=DATEADD(MINUTE,C.OrdenAlumno*2 + CASE WHEN @Fase=2 THEN 230 ELSE 50 END,E.FechaInicio)
    FROM dbo.Intento I
    JOIN #IntentosCarga C ON C.IdIntento=I.Id AND C.NumeroCarga=@Fase
    JOIN @Evaluaciones E ON E.IdPublicacion=C.IdPublicacion;

    ;WITH PreguntasOrdenadas AS (
      SELECT C.IdIntento,C.IdPublicacion,C.IdMateriaDivision,C.NumeroEvaluacion,
        C.IdAlumno,C.OrdenAlumno,C.NumeroCarga,
        IP.Id AS IdIntentoPregunta,IP.IdPregunta,IP.TipoSnapshot,IP.PuntajeMaximoSnapshot,
        ROW_NUMBER() OVER (PARTITION BY C.IdIntento ORDER BY IP.Id) AS OrdenPregunta
      FROM #IntentosCarga C
      JOIN dbo.IntentoPregunta IP ON IP.IdIntento=C.IdIntento
      WHERE C.NumeroCarga=@Fase
    )
    SELECT P.*,
      CAST(CASE
        WHEN @Fase=2 THEN CASE P.OrdenPregunta
          WHEN 1 THEN P.PuntajeMaximoSnapshot
          WHEN 2 THEN P.PuntajeMaximoSnapshot
          WHEN 3 THEN P.PuntajeMaximoSnapshot
          WHEN 4 THEN CASE WHEN P.OrdenAlumno<=2 THEN P.PuntajeMaximoSnapshot
            ELSE P.PuntajeMaximoSnapshot/2 END
          WHEN 5 THEN CASE WHEN P.OrdenAlumno=1 THEN P.PuntajeMaximoSnapshot ELSE 0 END
        END
        ELSE CASE P.OrdenPregunta
          WHEN 1 THEN P.PuntajeMaximoSnapshot
          WHEN 2 THEN CASE WHEN P.OrdenAlumno<=14 THEN P.PuntajeMaximoSnapshot ELSE 0 END
          WHEN 3 THEN CASE WHEN P.OrdenAlumno<=10 THEN P.PuntajeMaximoSnapshot
            ELSE P.PuntajeMaximoSnapshot/2 END
          WHEN 4 THEN CASE WHEN P.OrdenAlumno<=12 THEN P.PuntajeMaximoSnapshot
            WHEN P.OrdenAlumno<=16 THEN P.PuntajeMaximoSnapshot/2 ELSE 0 END
          WHEN 5 THEN CASE WHEN P.OrdenAlumno<=4 THEN P.PuntajeMaximoSnapshot ELSE 0 END
        END
      END AS DECIMAL(5,2)) AS PuntajeObjetivo,
      CAST(CASE WHEN @Fase=1 AND P.OrdenPregunta=5 AND P.OrdenAlumno>=15
        THEN 1 ELSE 0 END AS bit) AS Omitida
    INTO #CalificacionFase
    FROM PreguntasOrdenadas P;

    UPDATE IP
    SET PuntajeObtenido=C.PuntajeObjetivo,
        PuntajeAutomaticoOpciones=C.PuntajeObjetivo,
        OrigenCorreccion='automatica',
        ComentariosDocente=NULL,
        CorregidoPor=NULL,
        FechaCorreccion=DATEADD(MINUTE,1,I.FechaFin)
    FROM dbo.IntentoPregunta IP
    JOIN #CalificacionFase C ON C.IdIntentoPregunta=IP.Id
    JOIN dbo.Intento I ON I.Id=C.IdIntento;

    INSERT INTO dbo.Respuesta
      (IdIntento,IdPregunta,RtaTexto,EsCorrecta,ComentariosDocente,Justificacion,Revision)
    SELECT C.IdIntento,C.IdPregunta,NULL,
      CAST(CASE WHEN C.PuntajeObjetivo=C.PuntajeMaximoSnapshot THEN 1 ELSE 0 END AS bit),
      NULL,
      CASE WHEN C.TipoSnapshot=N'multiple' AND C.Omitida=0 AND C.OrdenAlumno%3=0
        THEN CONCAT(N'Justificación demo coherente para la pregunta ',C.OrdenPregunta)
        ELSE NULL END,
      1
    FROM #CalificacionFase C;

    ;WITH OpcionesClasificadas AS (
      SELECT C.IdIntentoPregunta,C.IdIntento,C.IdPregunta,C.TipoSnapshot,
        C.PuntajeObjetivo,C.PuntajeMaximoSnapshot,C.Omitida,
        S.IdOpcionOrigen,S.EsCorrectaSnapshot,S.Posicion,
        ROW_NUMBER() OVER (
          PARTITION BY C.IdIntentoPregunta,S.EsCorrectaSnapshot ORDER BY S.Posicion
        ) AS OrdenTipo
      FROM #CalificacionFase C
      JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=C.IdIntentoPregunta
    )
    INSERT INTO dbo.RespuestaOpcion(IdRespuesta,IdOpcion)
    SELECT R.Id,O.IdOpcionOrigen
    FROM OpcionesClasificadas O
    JOIN dbo.Respuesta R ON R.IdIntento=O.IdIntento AND R.IdPregunta=O.IdPregunta
    WHERE O.Omitida=0 AND O.IdOpcionOrigen IS NOT NULL AND (
      (O.PuntajeObjetivo=O.PuntajeMaximoSnapshot AND O.EsCorrectaSnapshot=1
        AND (O.TipoSnapshot=N'multiple' OR O.OrdenTipo=1))
      OR
      (O.PuntajeObjetivo>0 AND O.PuntajeObjetivo<O.PuntajeMaximoSnapshot
        AND O.EsCorrectaSnapshot=1 AND O.OrdenTipo=1)
      OR
      (O.PuntajeObjetivo=0 AND O.EsCorrectaSnapshot=0 AND O.OrdenTipo=1)
    );

    ;WITH Totales AS (
      SELECT C.IdIntento,SUM(C.PuntajeObjetivo) AS Nota
      FROM #CalificacionFase C GROUP BY C.IdIntento
    )
    UPDATE I
    SET Estado=N'entregado',
        NotaAutomatica=T.Nota,
        NotaFinalCalculada=T.Nota,
        NotaFinalManual=NULL,
        NotaFinal=T.Nota,
        CorreccionConfirmada=1,
        CorreccionConfirmadaPor=NULL,
        FechaCorreccionConfirmada=DATEADD(MINUTE,2,I.FechaFin),
        OrigenConfirmacionCorreccion='automatica'
    FROM dbo.Intento I
    JOIN Totales T ON T.IdIntento=I.Id;

    CREATE TABLE #SesionesFase (IdIntento INT PRIMARY KEY,SesionClienteId UNIQUEIDENTIFIER NOT NULL);
    INSERT INTO #SesionesFase(IdIntento,SesionClienteId)
    SELECT IdIntento,NEWID() FROM #IntentosCarga WHERE NumeroCarga=@Fase;

    INSERT INTO dbo.IncidenteIntento
      (EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,
       FechaRecepcionInicio,FechaRecepcionFin,Estado,IdIntentoPregunta,
       SesionClienteId,SecuenciaCliente,Codigo,VersionContrato)
    SELECT NEWID(),C.IdIntento,'question_active',T.Inicio,
      DATEADD(MILLISECOND,T.DuracionMs,T.Inicio),T.DuracionMs,
      SYSUTCDATETIME(),SYSUTCDATETIME(),'completado',C.IdIntentoPregunta,
      S.SesionClienteId,C.OrdenPregunta,'demo-reportes',1
    FROM #CalificacionFase C
    JOIN dbo.Intento I ON I.Id=C.IdIntento
    JOIN #SesionesFase S ON S.IdIntento=C.IdIntento
    CROSS APPLY (
      SELECT DATEADD(SECOND,(C.OrdenPregunta-1)*600,I.FechaInicio) AS Inicio,
        CONVERT(BIGINT,(25 + C.OrdenPregunta*12 + C.OrdenAlumno%5*7)*1000) AS DuracionMs
    ) T;

    INSERT INTO dbo.IncidenteIntento
      (EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,
       FechaRecepcionInicio,FechaRecepcionFin,Estado,IdIntentoPregunta,
       SesionClienteId,SecuenciaCliente,Codigo,VersionContrato)
    SELECT NEWID(),C.IdIntento,'attempt_finished',I.FechaFin,I.FechaFin,0,
      SYSUTCDATETIME(),SYSUTCDATETIME(),'completado',NULL,
      S.SesionClienteId,200,'demo-reportes',1
    FROM #IntentosCarga C
    JOIN dbo.Intento I ON I.Id=C.IdIntento
    JOIN #SesionesFase S ON S.IdIntento=C.IdIntento
    WHERE C.NumeroCarga=@Fase;

    IF @Fase=1
    BEGIN
      INSERT INTO dbo.IncidenteIntento
        (EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,
         FechaRecepcionInicio,FechaRecepcionFin,Estado,IdIntentoPregunta,
         SesionClienteId,SecuenciaCliente,Codigo,VersionContrato)
      SELECT NEWID(),C.IdIntento,'focus_lost',T.Inicio,
        DATEADD(MILLISECOND,T.DuracionMs,T.Inicio),T.DuracionMs,
        SYSUTCDATETIME(),SYSUTCDATETIME(),'completado',NULL,
        S.SesionClienteId,100,'demo-reportes-focus',1
      FROM #IntentosCarga C
      JOIN dbo.Intento I ON I.Id=C.IdIntento
      JOIN #SesionesFase S ON S.IdIntento=C.IdIntento
      CROSS APPLY (
        SELECT DATEADD(MINUTE,18,I.FechaInicio) AS Inicio,
          CONVERT(BIGINT,(5+C.OrdenAlumno)*1000) AS DuracionMs
      ) T
      WHERE C.NumeroCarga=1 AND C.OrdenAlumno%5=0;

      INSERT INTO dbo.IncidenteIntento
        (EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,
         FechaRecepcionInicio,FechaRecepcionFin,Estado,IdIntentoPregunta,
         SesionClienteId,SecuenciaCliente,Codigo,VersionContrato)
      SELECT NEWID(),C.IdIntento,'fullscreen_exit',T.Inicio,
        DATEADD(MILLISECOND,T.DuracionMs,T.Inicio),T.DuracionMs,
        SYSUTCDATETIME(),SYSUTCDATETIME(),'completado',NULL,
        S.SesionClienteId,101,'demo-reportes-fullscreen',1
      FROM #IntentosCarga C
      JOIN dbo.Intento I ON I.Id=C.IdIntento
      JOIN #SesionesFase S ON S.IdIntento=C.IdIntento
      CROSS APPLY (
        SELECT DATEADD(MINUTE,32,I.FechaInicio) AS Inicio,
          CONVERT(BIGINT,12000) AS DuracionMs
      ) T
      WHERE C.NumeroCarga=1 AND C.OrdenAlumno%10=0;

      INSERT INTO dbo.RevisionIncidenteIntento
        (IdIncidente,Revision,Estado,ActorId,ActorRol,Comentario,FechaRevision)
      SELECT E.Id,1,'revisado',@UsuarioDocente,'docente',
        N'Incidente DEMO revisado para validar reportes.',SYSUTCDATETIME()
      FROM dbo.IncidenteIntento E
      JOIN #IntentosCarga C ON C.IdIntento=E.IdIntento AND C.NumeroCarga=1
      WHERE E.Codigo IN ('demo-reportes-focus','demo-reportes-fullscreen')
        AND C.OrdenAlumno%10=0
        AND NOT EXISTS (
          SELECT 1 FROM dbo.RevisionIncidenteIntento R WHERE R.IdIncidente=E.Id
        );
    END;

    DROP TABLE #SesionesFase;
    DROP TABLE #CalificacionFase;
    SET @Fase+=1;
  END;

  IF EXISTS (
    SELECT 1
    FROM dbo.Intento I
    JOIN @Evaluaciones E ON E.IdPublicacion=I.IdPublicacion
    WHERE I.Estado<>N'entregado' OR I.CorreccionConfirmada<>1 OR I.NotaFinal IS NULL
  )
    THROW 52012, 'La carga dejó intentos pendientes o sin nota.', 1;

  IF EXISTS (
    SELECT 1
    FROM dbo.IntentoPregunta IP
    JOIN dbo.Intento I ON I.Id=IP.IdIntento
    JOIN @Evaluaciones E ON E.IdPublicacion=I.IdPublicacion
    WHERE IP.PuntajeObtenido IS NULL OR IP.PuntajeMaximoSnapshot IS NULL
  )
    THROW 52013, 'La carga dejó preguntas sin puntaje definitivo.', 1;

  COMMIT TRANSACTION;

  SELECT N'CARGA_COMPLETADA' AS Estado,
    (SELECT COUNT(*) FROM @AlumnosDemo) AS AlumnosDemo,
    (SELECT COUNT(*) FROM @Evaluaciones) AS Evaluaciones,
    (SELECT COUNT(*) FROM #IntentosCarga) AS Intentos,
    (SELECT COUNT(*) FROM dbo.IncidenteIntento E
      JOIN #IntentosCarga C ON C.IdIntento=E.IdIntento
      JOIN dbo.TipoEventoTelemetria T ON T.Tipo=E.Tipo AND T.EsIncidente=1) AS Incidentes;
END TRY
BEGIN CATCH
  IF CURSOR_STATUS('local','EvaluacionesCursor')>=-1
  BEGIN
    IF CURSOR_STATUS('local','EvaluacionesCursor')> -1 CLOSE EvaluacionesCursor;
    DEALLOCATE EvaluacionesCursor;
  END;
  IF CURSOR_STATUS('local','IntentosCursor')>=-1
  BEGIN
    IF CURSOR_STATUS('local','IntentosCursor')> -1 CLOSE IntentosCursor;
    DEALLOCATE IntentosCursor;
  END;
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
