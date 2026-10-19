/*
  Etapa 6: políticas configurables de fullscreen e incidentes.
  Ejecutar manualmente después de 20261016_telemetria_temporal.sql y de la etapa previa
  de anulación. No modifica respuestas, notas ni intentos históricos.

  Toda referencia a objetos o columnas creados en este batch usa SQL dinámico para
  evitar la compilación anticipada de SQL Server contra el esquema anterior.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.PoliticaSupervisionPublicacion', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.PoliticaSupervisionPublicacion (
      IdPublicacion INT NOT NULL CONSTRAINT PK_PoliticaSupervisionPublicacion PRIMARY KEY,
      PantallaCompletaObligatoria BIT NOT NULL,
      CodigoConfiguracion VARCHAR(30) NOT NULL,
      Revision INT NOT NULL,
      ModificadoPor INT NULL,
      FechaModificacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_PoliticaSupervision_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_PoliticaSupervision_Publicacion FOREIGN KEY (IdPublicacion)
        REFERENCES dbo.Publicacion(Id),
      CONSTRAINT FK_PoliticaSupervision_Usuario FOREIGN KEY (ModificadoPor)
        REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_PoliticaSupervision_Revision CHECK (Revision>=1),
      CONSTRAINT CHK_PoliticaSupervision_Codigo CHECK (LEN(CodigoConfiguracion)>0)
    );');

  IF OBJECT_ID('dbo.ReglaSupervisionPublicacion', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.ReglaSupervisionPublicacion (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReglaSupervisionPublicacion PRIMARY KEY,
      IdPublicacion INT NOT NULL,
      Codigo VARCHAR(50) NOT NULL,
      TipoEvento VARCHAR(30) NOT NULL,
      Metrica VARCHAR(30) NOT NULL,
      Umbral BIGINT NOT NULL,
      VentanaSegundos INT NULL,
      Prioridad INT NOT NULL,
      Accion VARCHAR(30) NOT NULL,
      Activa BIT NOT NULL,
      CONSTRAINT UQ_ReglaSupervision_Publicacion_Codigo UNIQUE (IdPublicacion,Codigo),
      CONSTRAINT FK_ReglaSupervision_Publicacion FOREIGN KEY (IdPublicacion)
        REFERENCES dbo.PoliticaSupervisionPublicacion(IdPublicacion),
      CONSTRAINT FK_ReglaSupervision_Tipo FOREIGN KEY (TipoEvento)
        REFERENCES dbo.TipoEventoTelemetria(Tipo),
      CONSTRAINT CHK_ReglaSupervision_Metrica CHECK
        (Metrica IN (''cantidad'',''duracion_individual'',''duracion_acumulada'')),
      CONSTRAINT CHK_ReglaSupervision_Accion CHECK
        (Accion IN (''informar'',''advertir'',''bloquear_interfaz'',''anular_intento'')),
      CONSTRAINT CHK_ReglaSupervision_Valores CHECK
        (Umbral>0 AND Prioridad>=0 AND (VentanaSegundos IS NULL OR VentanaSegundos>0))
    );');

  IF OBJECT_ID('dbo.IntentoPoliticaSupervision', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.IntentoPoliticaSupervision (
      IdIntento INT NOT NULL CONSTRAINT PK_IntentoPoliticaSupervision PRIMARY KEY,
      IdPublicacionOrigen INT NOT NULL,
      RevisionOrigen INT NOT NULL,
      CodigoConfiguracion VARCHAR(30) NOT NULL,
      PantallaCompletaObligatoria BIT NOT NULL,
      FechaSnapshot DATETIME2(3) NOT NULL
        CONSTRAINT DF_IntentoPoliticaSupervision_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_IntentoPoliticaSupervision_Intento FOREIGN KEY (IdIntento)
        REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_IntentoPoliticaSupervision_Publicacion FOREIGN KEY (IdPublicacionOrigen)
        REFERENCES dbo.Publicacion(Id),
      CONSTRAINT CHK_IntentoPoliticaSupervision_Revision CHECK (RevisionOrigen>=1)
    );');

  IF OBJECT_ID('dbo.IntentoReglaSupervision', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.IntentoReglaSupervision (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_IntentoReglaSupervision PRIMARY KEY,
      IdIntento INT NOT NULL,
      IdReglaOrigen BIGINT NULL,
      Codigo VARCHAR(50) NOT NULL,
      TipoEvento VARCHAR(30) NOT NULL,
      Metrica VARCHAR(30) NOT NULL,
      Umbral BIGINT NOT NULL,
      VentanaSegundos INT NULL,
      Prioridad INT NOT NULL,
      Accion VARCHAR(30) NOT NULL,
      Activa BIT NOT NULL,
      CONSTRAINT UQ_IntentoReglaSupervision_Intento_Codigo UNIQUE (IdIntento,Codigo),
      CONSTRAINT FK_IntentoReglaSupervision_Intento FOREIGN KEY (IdIntento)
        REFERENCES dbo.IntentoPoliticaSupervision(IdIntento),
      CONSTRAINT FK_IntentoReglaSupervision_Origen FOREIGN KEY (IdReglaOrigen)
        REFERENCES dbo.ReglaSupervisionPublicacion(Id) ON DELETE SET NULL,
      CONSTRAINT FK_IntentoReglaSupervision_Tipo FOREIGN KEY (TipoEvento)
        REFERENCES dbo.TipoEventoTelemetria(Tipo),
      CONSTRAINT CHK_IntentoReglaSupervision_Metrica CHECK
        (Metrica IN (''cantidad'',''duracion_individual'',''duracion_acumulada'')),
      CONSTRAINT CHK_IntentoReglaSupervision_Accion CHECK
        (Accion IN (''informar'',''advertir'',''bloquear_interfaz'',''anular_intento'')),
      CONSTRAINT CHK_IntentoReglaSupervision_Valores CHECK
        (Umbral>0 AND Prioridad>=0 AND (VentanaSegundos IS NULL OR VentanaSegundos>0))
    );');

  IF OBJECT_ID('dbo.EstadoSupervisionIntento', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.EstadoSupervisionIntento (
      IdIntento INT NOT NULL CONSTRAINT PK_EstadoSupervisionIntento PRIMARY KEY,
      Estado VARCHAR(20) NOT NULL,
      UltimaAccion VARCHAR(30) NOT NULL,
      UltimoEventoId UNIQUEIDENTIFIER NULL,
      Revision INT NOT NULL,
      FechaActualizacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_EstadoSupervisionIntento_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_EstadoSupervisionIntento_Intento FOREIGN KEY (IdIntento)
        REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_EstadoSupervisionIntento_Evento FOREIGN KEY (IdIntento,UltimoEventoId)
        REFERENCES dbo.IncidenteIntento(IdIntento,EventoId),
      CONSTRAINT CHK_EstadoSupervisionIntento_Estado CHECK
        (Estado IN (''normal'',''advertido'',''bloqueado'',''anulado'')),
      CONSTRAINT CHK_EstadoSupervisionIntento_Accion CHECK
        (UltimaAccion IN (''informar'',''advertir'',''bloquear_interfaz'',''anular_intento'')),
      CONSTRAINT CHK_EstadoSupervisionIntento_Revision CHECK (Revision>=1)
    );');

  IF OBJECT_ID('dbo.DecisionSupervisionIntento', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.DecisionSupervisionIntento (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DecisionSupervisionIntento PRIMARY KEY,
      IdIntento INT NOT NULL,
      EventoId UNIQUEIDENTIFIER NOT NULL,
      IdReglaSnapshot BIGINT NULL,
      Accion VARCHAR(30) NOT NULL,
      ValorMetrica BIGINT NULL,
      ConsecuenciaAplicada BIT NOT NULL,
      Resultado VARCHAR(40) NOT NULL,
      EstadoRevision VARCHAR(20) NOT NULL,
      FechaDecision DATETIME2(3) NOT NULL
        CONSTRAINT DF_DecisionSupervisionIntento_Fecha DEFAULT SYSUTCDATETIME(),
      FechaActualizacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_DecisionSupervisionIntento_Actualizacion DEFAULT SYSUTCDATETIME(),
      CONSTRAINT UQ_DecisionSupervisionIntento_Evento UNIQUE (IdIntento,EventoId),
      CONSTRAINT FK_DecisionSupervisionIntento_Intento FOREIGN KEY (IdIntento)
        REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_DecisionSupervisionIntento_Evento FOREIGN KEY (IdIntento,EventoId)
        REFERENCES dbo.IncidenteIntento(IdIntento,EventoId),
      CONSTRAINT FK_DecisionSupervisionIntento_Regla FOREIGN KEY (IdReglaSnapshot)
        REFERENCES dbo.IntentoReglaSupervision(Id),
      CONSTRAINT CHK_DecisionSupervisionIntento_Accion CHECK
        (Accion IN (''informar'',''advertir'',''bloquear_interfaz'',''anular_intento'')),
      CONSTRAINT CHK_DecisionSupervisionIntento_Revision CHECK
        (EstadoRevision IN (''pendiente'',''reconocida'',''descartada''))
    );');

  IF OBJECT_ID('dbo.OverrideSupervisionIntento', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.OverrideSupervisionIntento (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OverrideSupervisionIntento PRIMARY KEY,
      IdIntento INT NOT NULL,
      IdDecision BIGINT NULL,
      Accion VARCHAR(20) NOT NULL,
      Motivo NVARCHAR(250) NOT NULL,
      ActorId INT NOT NULL,
      ActorRol VARCHAR(20) NOT NULL,
      RevisionAnterior INT NOT NULL,
      RevisionNueva INT NOT NULL,
      Fecha DATETIME2(3) NOT NULL CONSTRAINT DF_OverrideSupervisionIntento_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_OverrideSupervisionIntento_Intento FOREIGN KEY (IdIntento)
        REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_OverrideSupervisionIntento_Decision FOREIGN KEY (IdDecision)
        REFERENCES dbo.DecisionSupervisionIntento(Id),
      CONSTRAINT FK_OverrideSupervisionIntento_Usuario FOREIGN KEY (ActorId)
        REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_OverrideSupervisionIntento_Accion CHECK
        (Accion IN (''desbloquear'',''reconocer'',''descartar'')),
      CONSTRAINT CHK_OverrideSupervisionIntento_Revision CHECK
        (RevisionAnterior>=1 AND RevisionNueva=RevisionAnterior+1)
    );');

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.ReglaSupervisionPublicacion')
      AND name='IX_ReglaSupervisionPublicacion_Tipo')
    EXEC(N'CREATE INDEX IX_ReglaSupervisionPublicacion_Tipo
      ON dbo.ReglaSupervisionPublicacion(IdPublicacion,TipoEvento,Activa)
      INCLUDE (Metrica,Umbral,VentanaSegundos,Prioridad,Accion);');

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.IntentoReglaSupervision')
      AND name='IX_IntentoReglaSupervision_Tipo')
    EXEC(N'CREATE INDEX IX_IntentoReglaSupervision_Tipo
      ON dbo.IntentoReglaSupervision(IdIntento,TipoEvento,Activa)
      INCLUDE (Metrica,Umbral,VentanaSegundos,Prioridad,Accion);');

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.DecisionSupervisionIntento')
      AND name='IX_DecisionSupervisionIntento_Pendientes')
    EXEC(N'CREATE INDEX IX_DecisionSupervisionIntento_Pendientes
      ON dbo.DecisionSupervisionIntento(IdIntento,EstadoRevision,FechaDecision DESC)
      INCLUDE (EventoId,Accion,ConsecuenciaAplicada,Resultado);');

  /* Actor sistema para reutilizar la anulación autoritativa sin inventar usuarios. */
  IF COL_LENGTH('dbo.AnulacionIntentoIncidente', 'ActorTipo') IS NULL
    EXEC(N'ALTER TABLE dbo.AnulacionIntentoIncidente ADD ActorTipo VARCHAR(20) NOT NULL
      CONSTRAINT DF_AnulacionIntentoIncidente_ActorTipo DEFAULT (''usuario'') WITH VALUES;');
  EXEC(N'ALTER TABLE dbo.AnulacionIntentoIncidente ALTER COLUMN AnuladoPor INT NULL;');
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.AnulacionIntentoIncidente')
      AND name='CHK_AnulacionIntentoIncidente_Tipo')
    EXEC(N'ALTER TABLE dbo.AnulacionIntentoIncidente DROP CONSTRAINT CHK_AnulacionIntentoIncidente_Tipo;');
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.AnulacionIntentoIncidente')
      AND name='CHK_AnulacionIntentoIncidente_Motivo')
    EXEC(N'ALTER TABLE dbo.AnulacionIntentoIncidente DROP CONSTRAINT CHK_AnulacionIntentoIncidente_Motivo;');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.AnulacionIntentoIncidente')
      AND name='CHK_AnulacionIntentoIncidente_Motivo')
    EXEC(N'ALTER TABLE dbo.AnulacionIntentoIncidente WITH CHECK ADD CONSTRAINT
      CHK_AnulacionIntentoIncidente_Motivo CHECK (Motivo IN
      (''POLICY_FIRST_FOCUS_LOSS'',''POLICY_FIRST_FULLSCREEN_EXIT'',''SUPERVISION_POLICY_RULE''));');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.AnulacionIntentoIncidente')
      AND name='CHK_AnulacionIntentoIncidente_Actor')
    EXEC(N'ALTER TABLE dbo.AnulacionIntentoIncidente WITH CHECK ADD CONSTRAINT
      CHK_AnulacionIntentoIncidente_Actor CHECK
      ((ActorTipo=''sistema'' AND AnuladoPor IS NULL) OR
       (ActorTipo=''usuario'' AND AnuladoPor IS NOT NULL));');

  /* temporal-v1: fullscreen obligatorio y primera pérdida de foco/fullscreen anula. */
  EXEC(N'INSERT INTO dbo.PoliticaSupervisionPublicacion
      (IdPublicacion,PantallaCompletaObligatoria,CodigoConfiguracion,Revision,ModificadoPor)
    SELECT P.Id,1,''temporal-v1'',1,NULL FROM dbo.Publicacion P
    WHERE NOT EXISTS (SELECT 1 FROM dbo.PoliticaSupervisionPublicacion X WHERE X.IdPublicacion=P.Id);

    INSERT INTO dbo.ReglaSupervisionPublicacion
      (IdPublicacion,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
    SELECT P.IdPublicacion,V.Codigo,V.Tipo,''cantidad'',1,NULL,100,''anular_intento'',1
    FROM dbo.PoliticaSupervisionPublicacion P
    CROSS JOIN (VALUES (''temporal-focus-1'',''focus_lost''),
                       (''temporal-fullscreen-1'',''fullscreen_exit'')) V(Codigo,Tipo)
    WHERE P.CodigoConfiguracion=''temporal-v1''
      AND NOT EXISTS (SELECT 1 FROM dbo.ReglaSupervisionPublicacion R
      WHERE R.IdPublicacion=P.IdPublicacion AND R.Codigo=V.Codigo);

    INSERT INTO dbo.IntentoPoliticaSupervision
      (IdIntento,IdPublicacionOrigen,RevisionOrigen,CodigoConfiguracion,PantallaCompletaObligatoria)
    SELECT I.Id,I.IdPublicacion,P.Revision,P.CodigoConfiguracion,P.PantallaCompletaObligatoria
    FROM dbo.Intento I JOIN dbo.PoliticaSupervisionPublicacion P ON P.IdPublicacion=I.IdPublicacion
    WHERE NOT EXISTS (SELECT 1 FROM dbo.IntentoPoliticaSupervision S WHERE S.IdIntento=I.Id);

    INSERT INTO dbo.IntentoReglaSupervision
      (IdIntento,IdReglaOrigen,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
    SELECT S.IdIntento,R.Id,R.Codigo,R.TipoEvento,R.Metrica,R.Umbral,R.VentanaSegundos,
      R.Prioridad,R.Accion,R.Activa
    FROM dbo.IntentoPoliticaSupervision S
    JOIN dbo.ReglaSupervisionPublicacion R ON R.IdPublicacion=S.IdPublicacionOrigen
    WHERE NOT EXISTS (SELECT 1 FROM dbo.IntentoReglaSupervision IR
      WHERE IR.IdIntento=S.IdIntento AND IR.Codigo=R.Codigo);

    INSERT INTO dbo.EstadoSupervisionIntento
      (IdIntento,Estado,UltimaAccion,UltimoEventoId,Revision)
    SELECT I.Id,CASE WHEN I.Estado=''anulado'' THEN ''anulado'' ELSE ''normal'' END,
      CASE WHEN I.Estado=''anulado'' THEN ''anular_intento'' ELSE ''informar'' END,
      A.EventoId,1
    FROM dbo.Intento I LEFT JOIN dbo.AnulacionIntentoIncidente A ON A.IdIntento=I.Id
    WHERE NOT EXISTS (SELECT 1 FROM dbo.EstadoSupervisionIntento E WHERE E.IdIntento=I.Id);');

  /* Mantener esta definición sincronizada con el runtime de respuestas múltiples. */
  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_IniciarExamen
    @IdPublicacion INT,
    @IdAlumno INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
      BEGIN TRANSACTION;
      DECLARE @IdIntento INT,@IdActividad INT,@ProximoIntento INT=1,@Escala INT=10;

      SELECT @IdActividad=P.IdActividad,@Escala=A.EscalaCalificacion
      FROM dbo.Publicacion P JOIN dbo.Actividad A ON A.Id=P.IdActividad
      WHERE P.Id=@IdPublicacion;

      IF @IdActividad IS NULL THROW 51350,''Publicación inexistente'',1;

      IF NOT EXISTS (SELECT 1 FROM dbo.PoliticaSupervisionPublicacion WHERE IdPublicacion=@IdPublicacion)
      BEGIN
        INSERT INTO dbo.PoliticaSupervisionPublicacion
          (IdPublicacion,PantallaCompletaObligatoria,CodigoConfiguracion,Revision)
        VALUES(@IdPublicacion,1,''temporal-v1'',1);
        INSERT INTO dbo.ReglaSupervisionPublicacion
          (IdPublicacion,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
        VALUES(@IdPublicacion,''temporal-focus-1'',''focus_lost'',''cantidad'',1,NULL,100,''anular_intento'',1),
              (@IdPublicacion,''temporal-fullscreen-1'',''fullscreen_exit'',''cantidad'',1,NULL,100,''anular_intento'',1);
      END;

      SELECT @IdIntento=Id FROM dbo.Intento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdPublicacion=@IdPublicacion AND IdAlumno=@IdAlumno AND Estado=''en_progreso'';

      IF @IdIntento IS NULL
      BEGIN
        SELECT @ProximoIntento=ISNULL(MAX(NumeroIntento),0)+1
        FROM dbo.Intento WITH (UPDLOCK,HOLDLOCK)
        WHERE IdPublicacion=@IdPublicacion AND IdAlumno=@IdAlumno;

        INSERT INTO dbo.Intento(IdPublicacion,IdAlumno,NumeroIntento,FechaInicio,Estado)
        VALUES(@IdPublicacion,@IdAlumno,@ProximoIntento,SYSUTCDATETIME(),''en_progreso'');
        SET @IdIntento=SCOPE_IDENTITY();

        ;WITH Grupos AS (
          SELECT GP.Id,GP.TituloReferencia,GP.PuntajeMaximo,
            ROW_NUMBER() OVER (ORDER BY GP.Id) AS Posicion,
            COUNT(*) OVER () AS TotalGrupos
          FROM dbo.GrupoPregunta GP WHERE GP.IdActividad=@IdActividad
        )
        INSERT INTO dbo.IntentoPregunta
          (IdIntento,IdPregunta,PuntajeMaximoSnapshot,TipoSnapshot,ModoJustificacionSnapshot,
           EstrategiaCorreccionSnapshot,TratamientoJustificacionSnapshot,ContenidoHashSnapshot,
           EnunciadoSnapshot,GrupoTituloSnapshot,SnapshotReconstruido)
        SELECT @IdIntento,P.Id,
          CAST(COALESCE(G.PuntajeMaximo,
            ((@Escala*100/G.TotalGrupos)+CASE WHEN G.Posicion<=((@Escala*100)%G.TotalGrupos)
              THEN 1 ELSE 0 END)/100.0) AS DECIMAL(5,2)),
          P.Tipo,P.ModoJustificacion,P.EstrategiaCorreccion,P.TratamientoJustificacion,
          P.ContenidoHash,P.Enunciado,G.TituloReferencia,0
        FROM Grupos G
        CROSS APPLY (
          SELECT TOP 1 P.* FROM dbo.Pregunta P
          WHERE P.IdGrupoPregunta=G.Id ORDER BY NEWID()
        ) P;

        INSERT INTO dbo.IntentoPreguntaOpcionSnapshot
          (IdIntentoPregunta,IdOpcionOrigen,TextoSnapshot,EsCorrectaSnapshot,Posicion)
        SELECT IP.Id,O.Id,O.Texto,O.EsCorrecta,
          ROW_NUMBER() OVER (PARTITION BY IP.Id ORDER BY O.Id)
        FROM dbo.IntentoPregunta IP JOIN dbo.Opcion O ON O.IdPregunta=IP.IdPregunta
        WHERE IP.IdIntento=@IdIntento;
      END;

      IF NOT EXISTS (SELECT 1 FROM dbo.IntentoPoliticaSupervision WHERE IdIntento=@IdIntento)
      BEGIN
        INSERT INTO dbo.IntentoPoliticaSupervision
          (IdIntento,IdPublicacionOrigen,RevisionOrigen,CodigoConfiguracion,PantallaCompletaObligatoria)
        SELECT @IdIntento,P.IdPublicacion,P.Revision,P.CodigoConfiguracion,P.PantallaCompletaObligatoria
        FROM dbo.PoliticaSupervisionPublicacion P WHERE P.IdPublicacion=@IdPublicacion;

        INSERT INTO dbo.IntentoReglaSupervision
          (IdIntento,IdReglaOrigen,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
        SELECT @IdIntento,R.Id,R.Codigo,R.TipoEvento,R.Metrica,R.Umbral,R.VentanaSegundos,
          R.Prioridad,R.Accion,R.Activa
        FROM dbo.ReglaSupervisionPublicacion R WHERE R.IdPublicacion=@IdPublicacion;

        INSERT INTO dbo.EstadoSupervisionIntento
          (IdIntento,Estado,UltimaAccion,UltimoEventoId,Revision)
        VALUES(@IdIntento,''normal'',''informar'',NULL,1);
      END;

      COMMIT TRANSACTION;
      SELECT @IdIntento AS IdIntento,''OK'' AS Status;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH;
  END;');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
