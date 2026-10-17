/*
  Configuración de calificación, snapshots por pregunta, selección de intento
  válido e incidentes de foco. Ejecutar manualmente después de:
    1. 20260908_banco_preguntas.sql
    2. 20260926_evaluacion_revision_idempotencia.sql

  El script es transaccional e idempotente. No recalifica intentos históricos.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH('dbo.Actividad', 'EscalaCalificacion') IS NULL
    ALTER TABLE dbo.Actividad ADD EscalaCalificacion TINYINT NOT NULL
      CONSTRAINT DF_Actividad_EscalaCalificacion DEFAULT (10) WITH VALUES;
  IF COL_LENGTH('dbo.Actividad', 'NotaAprobacion') IS NULL
    ALTER TABLE dbo.Actividad ADD NotaAprobacion DECIMAL(5,2) NOT NULL
      CONSTRAINT DF_Actividad_NotaAprobacion DEFAULT (4) WITH VALUES;
  IF COL_LENGTH('dbo.Actividad', 'ModoPuntaje') IS NULL
    ALTER TABLE dbo.Actividad ADD ModoPuntaje VARCHAR(20) NOT NULL
      CONSTRAINT DF_Actividad_ModoPuntaje DEFAULT ('iguales') WITH VALUES;
  IF COL_LENGTH('dbo.Actividad', 'MostrarPuntajePorPregunta') IS NULL
    ALTER TABLE dbo.Actividad ADD MostrarPuntajePorPregunta BIT NOT NULL
      CONSTRAINT DF_Actividad_MostrarPuntaje DEFAULT (0) WITH VALUES;
  IF COL_LENGTH('dbo.Actividad', 'CorreccionAutomaticaCerradas') IS NULL
    ALTER TABLE dbo.Actividad ADD CorreccionAutomaticaCerradas BIT NOT NULL
      CONSTRAINT DF_Actividad_CorreccionAutomatica DEFAULT (1) WITH VALUES;

  -- SQL Server compila el batch antes de ejecutar los ALTER ADD anteriores.
  -- Diferir el DDL que referencia columnas/tablas nuevas evita errores 207/208.
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Actividad_EscalaCalificacion')
    EXEC(N'ALTER TABLE dbo.Actividad WITH CHECK ADD CONSTRAINT CHK_Actividad_EscalaCalificacion
      CHECK (EscalaCalificacion IN (10, 100));');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Actividad_NotaAprobacion')
    EXEC(N'ALTER TABLE dbo.Actividad WITH CHECK ADD CONSTRAINT CHK_Actividad_NotaAprobacion
      CHECK (NotaAprobacion >= 0 AND NotaAprobacion <= EscalaCalificacion);');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Actividad_ModoPuntaje')
    EXEC(N'ALTER TABLE dbo.Actividad WITH CHECK ADD CONSTRAINT CHK_Actividad_ModoPuntaje
      CHECK (ModoPuntaje IN (''iguales'', ''personalizados''));');

  IF COL_LENGTH('dbo.GrupoPregunta', 'PuntajeMaximo') IS NULL
    ALTER TABLE dbo.GrupoPregunta ADD PuntajeMaximo DECIMAL(5,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_GrupoPregunta_PuntajeMaximo')
    EXEC(N'ALTER TABLE dbo.GrupoPregunta WITH CHECK ADD CONSTRAINT CHK_GrupoPregunta_PuntajeMaximo
      CHECK (PuntajeMaximo IS NULL OR PuntajeMaximo >= 0);');

  IF COL_LENGTH('dbo.Intento', 'NotaFinal') IS NOT NULL
    ALTER TABLE dbo.Intento ALTER COLUMN NotaFinal DECIMAL(5,2) NULL;
  IF COL_LENGTH('dbo.Intento', 'NotaAutomatica') IS NOT NULL
    ALTER TABLE dbo.Intento ALTER COLUMN NotaAutomatica DECIMAL(5,2) NULL;
  IF COL_LENGTH('dbo.Intento', 'NotaFinalCalculada') IS NULL
    ALTER TABLE dbo.Intento ADD NotaFinalCalculada DECIMAL(5,2) NULL;
  IF COL_LENGTH('dbo.Intento', 'NotaFinalManual') IS NULL
    ALTER TABLE dbo.Intento ADD NotaFinalManual DECIMAL(5,2) NULL;

  IF COL_LENGTH('dbo.IntentoPregunta', 'PuntajeMaximoSnapshot') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD PuntajeMaximoSnapshot DECIMAL(5,2) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'PuntajeObtenido') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD PuntajeObtenido DECIMAL(5,2) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'OrigenCorreccion') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD OrigenCorreccion VARCHAR(20) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'ComentariosDocente') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD ComentariosDocente NVARCHAR(MAX) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'CorregidoPor') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD CorregidoPor INT NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'FechaCorreccion') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD FechaCorreccion DATETIME2(3) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_IntentoPregunta_Puntajes')
    EXEC(N'ALTER TABLE dbo.IntentoPregunta WITH CHECK ADD CONSTRAINT CHK_IntentoPregunta_Puntajes
      CHECK (
        (PuntajeMaximoSnapshot IS NULL OR PuntajeMaximoSnapshot >= 0) AND
        (PuntajeObtenido IS NULL OR
          (PuntajeMaximoSnapshot IS NOT NULL AND PuntajeObtenido >= 0 AND PuntajeObtenido <= PuntajeMaximoSnapshot))
      );');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_IntentoPregunta_OrigenCorreccion')
    EXEC(N'ALTER TABLE dbo.IntentoPregunta WITH CHECK ADD CONSTRAINT CHK_IntentoPregunta_OrigenCorreccion
      CHECK (OrigenCorreccion IS NULL OR OrigenCorreccion IN (''automatica'', ''manual''));');
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_IntentoPregunta_CorregidoPor')
    EXEC(N'ALTER TABLE dbo.IntentoPregunta ADD CONSTRAINT FK_IntentoPregunta_CorregidoPor
      FOREIGN KEY (CorregidoPor) REFERENCES dbo.Usuario(Id);');

  IF OBJECT_ID('dbo.HistorialCorreccionIntentoPregunta', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.HistorialCorreccionIntentoPregunta (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_HistorialCorreccionIntentoPregunta PRIMARY KEY,
      IdIntentoPregunta INT NOT NULL,
      PuntajeAnterior DECIMAL(5,2) NULL,
      PuntajeNuevo DECIMAL(5,2) NULL,
      ComentarioAnterior NVARCHAR(MAX) NULL,
      ComentarioNuevo NVARCHAR(MAX) NULL,
      OrigenAnterior VARCHAR(20) NULL,
      OrigenNuevo VARCHAR(20) NULL,
      ModificadoPor INT NOT NULL,
      FechaModificacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_HistorialCorreccion_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_HistorialCorreccion_IntentoPregunta FOREIGN KEY (IdIntentoPregunta)
        REFERENCES dbo.IntentoPregunta(Id),
      CONSTRAINT FK_HistorialCorreccion_Usuario FOREIGN KEY (ModificadoPor) REFERENCES dbo.Usuario(Id)
    );
  END;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.HistorialCorreccionIntentoPregunta') AND name = 'IX_HistorialCorreccion_IntentoPregunta_Fecha')
    EXEC(N'CREATE INDEX IX_HistorialCorreccion_IntentoPregunta_Fecha
      ON dbo.HistorialCorreccionIntentoPregunta(IdIntentoPregunta, FechaModificacion DESC);');

  IF OBJECT_ID('dbo.HistorialNotaIntento', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.HistorialNotaIntento (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_HistorialNotaIntento PRIMARY KEY,
      IdIntento INT NOT NULL,
      NotaAnterior DECIMAL(5,2) NULL,
      NotaNueva DECIMAL(5,2) NOT NULL,
      ModificadoPor INT NOT NULL,
      FechaModificacion DATETIME2(3) NOT NULL CONSTRAINT DF_HistorialNota_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_HistorialNota_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_HistorialNota_Usuario FOREIGN KEY (ModificadoPor) REFERENCES dbo.Usuario(Id)
    );
  END;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.HistorialNotaIntento') AND name = 'IX_HistorialNota_Intento_Fecha')
    EXEC(N'CREATE INDEX IX_HistorialNota_Intento_Fecha ON dbo.HistorialNotaIntento(IdIntento, FechaModificacion DESC);');

  IF OBJECT_ID('dbo.IntentoValidoOverride', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.IntentoValidoOverride (
      IdPublicacion INT NOT NULL,
      IdAlumno INT NOT NULL,
      IdIntento INT NOT NULL,
      SeleccionadoPor INT NOT NULL,
      FechaSeleccion DATETIME2(3) NOT NULL CONSTRAINT DF_IntentoValidoOverride_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_IntentoValidoOverride PRIMARY KEY (IdPublicacion, IdAlumno),
      CONSTRAINT UQ_IntentoValidoOverride_Intento UNIQUE (IdIntento),
      CONSTRAINT FK_IntentoValidoOverride_Publicacion FOREIGN KEY (IdPublicacion) REFERENCES dbo.Publicacion(Id),
      CONSTRAINT FK_IntentoValidoOverride_Alumno FOREIGN KEY (IdAlumno) REFERENCES dbo.Alumno(Matricula),
      CONSTRAINT FK_IntentoValidoOverride_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_IntentoValidoOverride_Usuario FOREIGN KEY (SeleccionadoPor) REFERENCES dbo.Usuario(Id)
    );
  END;

  IF OBJECT_ID('dbo.HistorialIntentoValidoOverride', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.HistorialIntentoValidoOverride (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_HistorialIntentoValidoOverride PRIMARY KEY,
      IdPublicacion INT NOT NULL,
      IdAlumno INT NOT NULL,
      IdIntento INT NULL,
      Accion VARCHAR(20) NOT NULL,
      ModificadoPor INT NOT NULL,
      FechaModificacion DATETIME2(3) NOT NULL CONSTRAINT DF_HistorialIntentoValido_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT CHK_HistorialIntentoValido_Accion CHECK (Accion IN ('seleccionado', 'eliminado')),
      CONSTRAINT FK_HistorialIntentoValido_Publicacion FOREIGN KEY (IdPublicacion) REFERENCES dbo.Publicacion(Id),
      CONSTRAINT FK_HistorialIntentoValido_Alumno FOREIGN KEY (IdAlumno) REFERENCES dbo.Alumno(Matricula),
      CONSTRAINT FK_HistorialIntentoValido_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_HistorialIntentoValido_Usuario FOREIGN KEY (ModificadoPor) REFERENCES dbo.Usuario(Id)
    );
  END;

  IF OBJECT_ID('dbo.IncidenteIntento', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.IncidenteIntento (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_IncidenteIntento PRIMARY KEY,
      EventoId UNIQUEIDENTIFIER NOT NULL,
      IdIntento INT NOT NULL,
      Tipo VARCHAR(30) NOT NULL,
      FechaInicioCliente DATETIME2(3) NOT NULL,
      FechaFinCliente DATETIME2(3) NULL,
      DuracionMilisegundos BIGINT NULL,
      FechaRecepcionInicio DATETIME2(3) NOT NULL CONSTRAINT DF_IncidenteIntento_RecepcionInicio DEFAULT SYSUTCDATETIME(),
      FechaRecepcionFin DATETIME2(3) NULL,
      Estado VARCHAR(20) NOT NULL CONSTRAINT DF_IncidenteIntento_Estado DEFAULT ('iniciado'),
      CONSTRAINT UQ_IncidenteIntento_Intento_Evento UNIQUE (IdIntento, EventoId),
      CONSTRAINT FK_IncidenteIntento_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT CHK_IncidenteIntento_Tipo CHECK (Tipo IN ('focus_lost')),
      CONSTRAINT CHK_IncidenteIntento_Estado CHECK (Estado IN ('iniciado', 'completado')),
      CONSTRAINT CHK_IncidenteIntento_Fechas CHECK (
        (Estado = 'iniciado' AND FechaFinCliente IS NULL AND DuracionMilisegundos IS NULL AND FechaRecepcionFin IS NULL) OR
        (Estado = 'completado' AND FechaFinCliente IS NOT NULL AND DuracionMilisegundos IS NOT NULL
          AND DuracionMilisegundos >= 0 AND FechaRecepcionFin IS NOT NULL AND FechaFinCliente >= FechaInicioCliente)
      )
    );
  END;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.IncidenteIntento') AND name = 'IX_IncidenteIntento_Intento_Tipo_Estado')
    EXEC(N'CREATE INDEX IX_IncidenteIntento_Intento_Tipo_Estado
      ON dbo.IncidenteIntento(IdIntento, Tipo, Estado) INCLUDE (DuracionMilisegundos, FechaInicioCliente);');

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
      DECLARE @IdIntento INT, @IdActividad INT, @ProximoIntento INT = 1, @Escala INT = 10;

      SELECT @IdActividad = P.IdActividad, @Escala = A.EscalaCalificacion
      FROM dbo.Publicacion P JOIN dbo.Actividad A ON A.Id = P.IdActividad
      WHERE P.Id = @IdPublicacion;

      SELECT @IdIntento = Id FROM dbo.Intento WITH (UPDLOCK, HOLDLOCK)
      WHERE IdPublicacion = @IdPublicacion AND IdAlumno = @IdAlumno AND Estado = ''en_progreso'';

      IF @IdIntento IS NULL
      BEGIN
        SELECT @ProximoIntento = ISNULL(MAX(NumeroIntento), 0) + 1
        FROM dbo.Intento WITH (UPDLOCK, HOLDLOCK)
        WHERE IdPublicacion = @IdPublicacion AND IdAlumno = @IdAlumno;

        INSERT INTO dbo.Intento (IdPublicacion, IdAlumno, NumeroIntento, FechaInicio, Estado)
        VALUES (@IdPublicacion, @IdAlumno, @ProximoIntento, SYSUTCDATETIME(), ''en_progreso'');
        SET @IdIntento = SCOPE_IDENTITY();

        ;WITH Grupos AS (
          SELECT GP.Id, GP.PuntajeMaximo,
            ROW_NUMBER() OVER (ORDER BY GP.Id) AS Posicion,
            COUNT(*) OVER () AS TotalGrupos
          FROM dbo.GrupoPregunta GP
          WHERE GP.IdActividad = @IdActividad
        )
        INSERT INTO dbo.IntentoPregunta (IdIntento, IdPregunta, PuntajeMaximoSnapshot)
        SELECT @IdIntento, Pregunta.Id,
          CAST(COALESCE(G.PuntajeMaximo,
            ((@Escala * 100 / G.TotalGrupos) +
              CASE WHEN G.Posicion <= ((@Escala * 100) % G.TotalGrupos) THEN 1 ELSE 0 END) / 100.0
          ) AS DECIMAL(5,2))
        FROM Grupos G
        CROSS APPLY (
          SELECT TOP 1 P.Id FROM dbo.Pregunta P WHERE P.IdGrupoPregunta = G.Id ORDER BY NEWID()
        ) Pregunta;
      END;

      COMMIT TRANSACTION;
      SELECT @IdIntento AS IdIntento, ''OK'' AS Status;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH;
  END');

  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_ObtenerExamenDinamico
    @IdIntento INT
  AS
  BEGIN
    SET NOCOUNT ON;
    ;WITH Grupos AS (
      SELECT GP.Id, GP.PuntajeMaximo, A.EscalaCalificacion,
        ROW_NUMBER() OVER (PARTITION BY GP.IdActividad ORDER BY GP.Id) AS Posicion,
        COUNT(*) OVER (PARTITION BY GP.IdActividad) AS TotalGrupos
      FROM dbo.GrupoPregunta GP
      JOIN dbo.Actividad A ON A.Id = GP.IdActividad
    )
    SELECT IP.Id AS IdIntentoPregunta,P.Id AS IdPregunta,P.Enunciado,P.Tipo,
      GP.TituloReferencia AS GrupoConceptualmente,
      CAST(COALESCE(IP.PuntajeMaximoSnapshot, GP.PuntajeMaximo,
        ((A.EscalaCalificacion * 100 / G.TotalGrupos) +
          CASE WHEN G.Posicion <= ((A.EscalaCalificacion * 100) % G.TotalGrupos) THEN 1 ELSE 0 END) / 100.0
      ) AS DECIMAL(5,2)) AS PuntajeMaximo,
      A.MostrarPuntajePorPregunta
    FROM dbo.IntentoPregunta IP
    JOIN dbo.Pregunta P ON P.Id = IP.IdPregunta
    JOIN dbo.GrupoPregunta GP ON GP.Id = P.IdGrupoPregunta
    JOIN Grupos G ON G.Id = GP.Id
    JOIN dbo.Actividad A ON A.Id = GP.IdActividad
    WHERE IP.IdIntento = @IdIntento
    ORDER BY GP.Id, P.Id;
  END');

  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_FinalizarExamen
    @IdIntento INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
      BEGIN TRANSACTION;
      DECLARE @Estado VARCHAR(20), @CorreccionAutomatica BIT, @Escala INT;
      SELECT @Estado = I.Estado, @CorreccionAutomatica = A.CorreccionAutomaticaCerradas,
        @Escala = A.EscalaCalificacion
      FROM dbo.Intento I WITH (UPDLOCK, HOLDLOCK)
      JOIN dbo.Publicacion PU ON PU.Id = I.IdPublicacion
      JOIN dbo.Actividad A ON A.Id = PU.IdActividad
      WHERE I.Id = @IdIntento;

      IF @Estado IS NULL
      BEGIN
        ;THROW 50001, ''Intento no encontrado'', 1;
      END;
      IF @Estado IN (''entregado'', ''anulado'', ''vencido'')
      BEGIN
        COMMIT TRANSACTION;
        SELECT Id, IdAlumno, IdPublicacion, Estado, NotaFinal, NotaAutomatica,
          NotaFinalCalculada, NotaFinalManual, FechaInicio, FechaFin
        FROM dbo.Intento WHERE Id = @IdIntento;
        RETURN;
      END;

      ;WITH Puntajes AS (
        SELECT GP.Id, GP.PuntajeMaximo,
          ROW_NUMBER() OVER (PARTITION BY GP.IdActividad ORDER BY GP.Id) AS Posicion,
          COUNT(*) OVER (PARTITION BY GP.IdActividad) AS TotalGrupos
        FROM dbo.GrupoPregunta GP
      )
      UPDATE IP SET PuntajeMaximoSnapshot = CAST(COALESCE(P.PuntajeMaximo,
        ((@Escala * 100 / P.TotalGrupos) +
          CASE WHEN P.Posicion <= ((@Escala * 100) % P.TotalGrupos) THEN 1 ELSE 0 END) / 100.0
        ) AS DECIMAL(5,2))
      FROM dbo.IntentoPregunta IP
      JOIN dbo.Pregunta PR ON PR.Id = IP.IdPregunta
      JOIN Puntajes P ON P.Id = PR.IdGrupoPregunta
      WHERE IP.IdIntento = @IdIntento AND IP.PuntajeMaximoSnapshot IS NULL;

      IF @CorreccionAutomatica = 1
      BEGIN
        UPDATE IP SET
          PuntajeObtenido = CASE WHEN EXISTS (
            SELECT 1 FROM dbo.Respuesta R
            JOIN dbo.RespuestaOpcion RO ON RO.IdRespuesta = R.Id
            JOIN dbo.Opcion O ON O.Id = RO.IdOpcion
            WHERE R.IdIntento = IP.IdIntento AND R.IdPregunta = IP.IdPregunta AND O.EsCorrecta = 1
          ) THEN IP.PuntajeMaximoSnapshot ELSE 0 END,
          OrigenCorreccion = ''automatica'', FechaCorreccion = SYSUTCDATETIME(), CorregidoPor = NULL
        FROM dbo.IntentoPregunta IP
        JOIN dbo.Pregunta P ON P.Id = IP.IdPregunta
        WHERE IP.IdIntento = @IdIntento AND P.Tipo IN (''mc'', ''vf'') AND IP.PuntajeObtenido IS NULL;
      END;

      DECLARE @CantidadAutomatica INT, @NotaAutomatica DECIMAL(5,2), @Pendientes INT,
        @NotaCalculada DECIMAL(5,2);
      SELECT @CantidadAutomatica = SUM(CASE WHEN OrigenCorreccion = ''automatica'' THEN 1 ELSE 0 END),
        @NotaAutomatica = SUM(CASE WHEN OrigenCorreccion = ''automatica'' THEN PuntajeObtenido ELSE 0 END),
        @Pendientes = SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END),
        @NotaCalculada = SUM(PuntajeObtenido)
      FROM dbo.IntentoPregunta WHERE IdIntento = @IdIntento;

      IF ISNULL(@CantidadAutomatica, 0) = 0 SET @NotaAutomatica = NULL;
      IF ISNULL(@Pendientes, 0) > 0 SET @NotaCalculada = NULL;

      UPDATE dbo.Intento SET Estado = ''entregado'', FechaFin = SYSUTCDATETIME(),
        NotaAutomatica = @NotaAutomatica, NotaFinalCalculada = @NotaCalculada,
        NotaFinal = COALESCE(NotaFinalManual, @NotaCalculada)
      WHERE Id = @IdIntento;

      COMMIT TRANSACTION;
      SELECT Id, IdAlumno, IdPublicacion, Estado, NotaFinal, NotaAutomatica,
        NotaFinalCalculada, NotaFinalManual, FechaInicio, FechaFin
      FROM dbo.Intento WHERE Id = @IdIntento;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH;
  END');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

