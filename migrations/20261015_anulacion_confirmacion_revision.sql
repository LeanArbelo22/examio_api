/*
  Etapa previa a telemetría temporal:
  - anulación autoritativa e idempotente vinculada a IncidenteIntento.EventoId;
  - confirmación persistente y auditada de la corrección;
  - habilitación segura de revisión para intentos entregados y confirmados.

  Ejecutar manualmente después de 20261014_runtime_respuestas_multiples.sql.
  El script es transaccional e idempotente. Todo uso de columnas nuevas se difiere
  con SQL dinámico para evitar compilación contra el esquema anterior.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH('dbo.Intento', 'CorreccionConfirmada') IS NULL
    ALTER TABLE dbo.Intento ADD CorreccionConfirmada BIT NOT NULL
      CONSTRAINT DF_Intento_CorreccionConfirmada DEFAULT (0) WITH VALUES;
  IF COL_LENGTH('dbo.Intento', 'CorreccionConfirmadaPor') IS NULL
    ALTER TABLE dbo.Intento ADD CorreccionConfirmadaPor INT NULL;
  IF COL_LENGTH('dbo.Intento', 'FechaCorreccionConfirmada') IS NULL
    ALTER TABLE dbo.Intento ADD FechaCorreccionConfirmada DATETIME2(3) NULL;
  IF COL_LENGTH('dbo.Intento', 'OrigenConfirmacionCorreccion') IS NULL
    ALTER TABLE dbo.Intento ADD OrigenConfirmacionCorreccion VARCHAR(20) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Intento_CorreccionConfirmadaPor')
    EXEC(N'ALTER TABLE dbo.Intento ADD CONSTRAINT FK_Intento_CorreccionConfirmadaPor
      FOREIGN KEY (CorreccionConfirmadaPor) REFERENCES dbo.Usuario(Id);');

  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Intento_ConfirmacionCorreccion')
    EXEC(N'ALTER TABLE dbo.Intento WITH CHECK ADD CONSTRAINT CHK_Intento_ConfirmacionCorreccion CHECK (
      (CorreccionConfirmada=0 AND CorreccionConfirmadaPor IS NULL
        AND FechaCorreccionConfirmada IS NULL AND OrigenConfirmacionCorreccion IS NULL)
      OR
      (CorreccionConfirmada=1 AND FechaCorreccionConfirmada IS NOT NULL
        AND OrigenConfirmacionCorreccion IN (''automatica'',''manual'',''backfill'')
        AND (OrigenConfirmacionCorreccion<>''manual'' OR CorreccionConfirmadaPor IS NOT NULL))
    );');

  IF OBJECT_ID('dbo.HistorialEstadoCorreccionIntento', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.HistorialEstadoCorreccionIntento (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_HistorialEstadoCorreccionIntento PRIMARY KEY,
      IdIntento INT NOT NULL,
      EstadoAnterior BIT NOT NULL,
      EstadoNuevo BIT NOT NULL,
      Accion VARCHAR(30) NOT NULL,
      ModificadoPor INT NULL,
      FechaModificacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_HistorialEstadoCorreccion_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_HistorialEstadoCorreccion_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_HistorialEstadoCorreccion_Usuario FOREIGN KEY (ModificadoPor) REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_HistorialEstadoCorreccion_Accion CHECK (
        Accion IN ('confirmacion_automatica','confirmacion_manual','reapertura_pregunta','reapertura_nota','backfill')
      )
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID('dbo.HistorialEstadoCorreccionIntento')
      AND name='IX_HistorialEstadoCorreccion_Intento_Fecha'
  )
    EXEC(N'CREATE INDEX IX_HistorialEstadoCorreccion_Intento_Fecha
      ON dbo.HistorialEstadoCorreccionIntento(IdIntento,FechaModificacion DESC);');

  -- Mantener compatibilidad para intentos históricos ya entregados y completamente corregidos.
  EXEC(N'
    INSERT INTO dbo.HistorialEstadoCorreccionIntento
      (IdIntento,EstadoAnterior,EstadoNuevo,Accion,ModificadoPor,FechaModificacion)
    SELECT I.Id,0,1,''backfill'',NULL,COALESCE(I.FechaFin,SYSUTCDATETIME())
    FROM dbo.Intento I
    WHERE I.Estado=''entregado'' AND I.CorreccionConfirmada=0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.IntentoPregunta IP
        WHERE IP.IdIntento=I.Id AND IP.PuntajeObtenido IS NULL
      );

    UPDATE I
    SET CorreccionConfirmada=1,CorreccionConfirmadaPor=NULL,
        FechaCorreccionConfirmada=COALESCE(I.FechaFin,SYSUTCDATETIME()),
        OrigenConfirmacionCorreccion=''backfill''
    FROM dbo.Intento I
    WHERE I.Estado=''entregado'' AND I.CorreccionConfirmada=0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.IntentoPregunta IP
        WHERE IP.IdIntento=I.Id AND IP.PuntajeObtenido IS NULL
      );
  ');

  IF OBJECT_ID('dbo.AnulacionIntentoIncidente', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.AnulacionIntentoIncidente (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AnulacionIntentoIncidente PRIMARY KEY,
      IdIntento INT NOT NULL,
      EventoId UNIQUEIDENTIFIER NOT NULL,
      TipoIncidente VARCHAR(30) NOT NULL,
      Motivo VARCHAR(100) NOT NULL,
      AnuladoPor INT NOT NULL,
      FechaAnulacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_AnulacionIntentoIncidente_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT UQ_AnulacionIntentoIncidente_Intento UNIQUE (IdIntento),
      CONSTRAINT UQ_AnulacionIntentoIncidente_Evento UNIQUE (IdIntento,EventoId),
      CONSTRAINT FK_AnulacionIntentoIncidente_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_AnulacionIntentoIncidente_Evento FOREIGN KEY (IdIntento,EventoId)
        REFERENCES dbo.IncidenteIntento(IdIntento,EventoId),
      CONSTRAINT FK_AnulacionIntentoIncidente_Usuario FOREIGN KEY (AnuladoPor) REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_AnulacionIntentoIncidente_Tipo CHECK (TipoIncidente IN ('focus_lost','fullscreen_exit')),
      CONSTRAINT CHK_AnulacionIntentoIncidente_Motivo CHECK (
        Motivo IN ('POLICY_FIRST_FOCUS_LOSS','POLICY_FIRST_FULLSCREEN_EXIT')
      )
    );
  END;

  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CHK_IncidenteIntento_Tipo')
    EXEC(N'ALTER TABLE dbo.IncidenteIntento DROP CONSTRAINT CHK_IncidenteIntento_Tipo;');
  EXEC(N'ALTER TABLE dbo.IncidenteIntento WITH CHECK ADD CONSTRAINT CHK_IncidenteIntento_Tipo
    CHECK (Tipo IN (''focus_lost'',''fullscreen_exit''));');

  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_FinalizarExamen
    @IdIntento INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
      BEGIN TRANSACTION;
      DECLARE @Estado VARCHAR(20),@CorreccionAutomatica BIT;
      SELECT @Estado=I.Estado,@CorreccionAutomatica=A.CorreccionAutomaticaCerradas
      FROM dbo.Intento I WITH (UPDLOCK,HOLDLOCK)
      JOIN dbo.Publicacion PU ON PU.Id=I.IdPublicacion
      JOIN dbo.Actividad A ON A.Id=PU.IdActividad
      WHERE I.Id=@IdIntento;

      IF @Estado IS NULL THROW 50001,''Intento no encontrado'',1;
      IF @Estado IN (''entregado'',''anulado'',''vencido'')
      BEGIN
        COMMIT TRANSACTION;
        SELECT Id,IdAlumno,IdPublicacion,Estado,NotaFinal,NotaAutomatica,
          NotaFinalCalculada,NotaFinalManual,FechaInicio,FechaFin,
          CorreccionConfirmada,CorreccionConfirmadaPor,FechaCorreccionConfirmada,
          OrigenConfirmacionCorreccion
        FROM dbo.Intento WHERE Id=@IdIntento;
        RETURN;
      END;
      IF @Estado<>''en_progreso'' THROW 51321,''El intento no está en progreso'',1;

      IF EXISTS (
        SELECT 1
        FROM dbo.IntentoPregunta IP
        LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
        WHERE IP.IdIntento=@IdIntento
          AND IP.ModoJustificacionSnapshot=''obligatoria''
          AND ((IP.TipoSnapshot IN (''mc'',''multiple'',''vf'') AND EXISTS (
                 SELECT 1 FROM dbo.RespuestaOpcion RO WHERE RO.IdRespuesta=R.Id
               )) OR
               (IP.TipoSnapshot IN (''abierta'',''code'') AND NULLIF(LTRIM(RTRIM(R.RtaTexto)),N'''') IS NOT NULL))
          AND NULLIF(LTRIM(RTRIM(R.Justificacion)),N'''') IS NULL
      ) THROW 51320,''Falta una justificación obligatoria'',1;

      IF @CorreccionAutomatica=1
      BEGIN
        ;WITH Conteos AS (
          SELECT IP.Id AS IdIntentoPregunta,
            SUM(CASE WHEN S.EsCorrectaSnapshot=1 THEN 1 ELSE 0 END) AS TotalCorrectas,
            SUM(CASE WHEN S.EsCorrectaSnapshot=0 THEN 1 ELSE 0 END) AS TotalIncorrectas,
            SUM(CASE WHEN S.EsCorrectaSnapshot=1 AND RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END) AS CorrectasElegidas,
            SUM(CASE WHEN S.EsCorrectaSnapshot=0 AND RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END) AS IncorrectasElegidas,
            SUM(CASE WHEN RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END) AS TotalElegidas
          FROM dbo.IntentoPregunta IP
          JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
          LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
          LEFT JOIN dbo.RespuestaOpcion RO ON RO.IdRespuesta=R.Id AND RO.IdOpcion=S.IdOpcionOrigen
          WHERE IP.IdIntento=@IdIntento AND IP.TipoSnapshot IN (''mc'',''multiple'',''vf'')
          GROUP BY IP.Id
        ), Calculos AS (
          SELECT IP.Id,
            CAST(ROUND(CASE IP.EstrategiaCorreccionSnapshot
              WHEN ''parcial_sin_penalizacion'' THEN
                IP.PuntajeMaximoSnapshot*CONVERT(DECIMAL(12,6),C.CorrectasElegidas)/NULLIF(C.TotalCorrectas,0)
              WHEN ''parcial_penalizada'' THEN
                CASE WHEN
                  CONVERT(DECIMAL(12,6),C.CorrectasElegidas)/NULLIF(C.TotalCorrectas,0)-
                  CASE WHEN C.TotalIncorrectas=0 THEN 0 ELSE
                    CONVERT(DECIMAL(12,6),C.IncorrectasElegidas)/C.TotalIncorrectas END < 0
                THEN 0 ELSE IP.PuntajeMaximoSnapshot*(
                  CONVERT(DECIMAL(12,6),C.CorrectasElegidas)/NULLIF(C.TotalCorrectas,0)-
                  CASE WHEN C.TotalIncorrectas=0 THEN 0 ELSE
                    CONVERT(DECIMAL(12,6),C.IncorrectasElegidas)/C.TotalIncorrectas END) END
              ELSE CASE WHEN C.CorrectasElegidas=C.TotalCorrectas AND C.IncorrectasElegidas=0
                THEN IP.PuntajeMaximoSnapshot ELSE 0 END
            END,2) AS DECIMAL(5,2)) AS PuntajeAutomatico,C.TotalElegidas
          FROM dbo.IntentoPregunta IP JOIN Conteos C ON C.IdIntentoPregunta=IP.Id
        )
        UPDATE IP SET
          PuntajeAutomaticoOpciones=C.PuntajeAutomatico,
          PuntajeObtenido=CASE WHEN IP.TratamientoJustificacionSnapshot=''revision_manual''
            AND C.TotalElegidas>0 THEN NULL ELSE C.PuntajeAutomatico END,
          OrigenCorreccion=CASE WHEN IP.TratamientoJustificacionSnapshot=''revision_manual''
            AND C.TotalElegidas>0 THEN NULL ELSE ''automatica'' END,
          FechaCorreccion=CASE WHEN IP.TratamientoJustificacionSnapshot=''revision_manual''
            AND C.TotalElegidas>0 THEN NULL ELSE SYSUTCDATETIME() END,
          CorregidoPor=NULL
        FROM dbo.IntentoPregunta IP JOIN Calculos C ON C.Id=IP.Id
        WHERE IP.IdIntento=@IdIntento AND IP.PuntajeObtenido IS NULL;

        UPDATE R SET EsCorrecta=CASE
          WHEN IP.PuntajeObtenido=IP.PuntajeMaximoSnapshot THEN 1
          WHEN IP.PuntajeObtenido=0 THEN 0 ELSE NULL END
        FROM dbo.Respuesta R
        JOIN dbo.IntentoPregunta IP ON IP.IdIntento=R.IdIntento AND IP.IdPregunta=R.IdPregunta
        WHERE R.IdIntento=@IdIntento AND IP.TipoSnapshot IN (''mc'',''multiple'',''vf'');
      END;

      DECLARE @CantidadAutomatica INT,@NotaAutomatica DECIMAL(5,2),@Pendientes INT,
        @NotaCalculada DECIMAL(5,2),@ConfirmacionAutomatica BIT;
      SELECT @CantidadAutomatica=SUM(CASE WHEN OrigenCorreccion=''automatica'' THEN 1 ELSE 0 END),
        @NotaAutomatica=SUM(CASE WHEN OrigenCorreccion=''automatica'' THEN PuntajeObtenido ELSE 0 END),
        @Pendientes=SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END),
        @NotaCalculada=SUM(PuntajeObtenido)
      FROM dbo.IntentoPregunta WHERE IdIntento=@IdIntento;
      IF ISNULL(@CantidadAutomatica,0)=0 SET @NotaAutomatica=NULL;
      IF ISNULL(@Pendientes,0)>0 SET @NotaCalculada=NULL;
      SET @ConfirmacionAutomatica=CASE WHEN ISNULL(@Pendientes,0)=0 THEN 1 ELSE 0 END;

      UPDATE dbo.Intento SET Estado=''entregado'',FechaFin=SYSUTCDATETIME(),
        NotaAutomatica=@NotaAutomatica,NotaFinalCalculada=@NotaCalculada,
        NotaFinal=COALESCE(NotaFinalManual,@NotaCalculada),
        CorreccionConfirmada=@ConfirmacionAutomatica,
        CorreccionConfirmadaPor=NULL,
        FechaCorreccionConfirmada=CASE WHEN @ConfirmacionAutomatica=1 THEN SYSUTCDATETIME() ELSE NULL END,
        OrigenConfirmacionCorreccion=CASE WHEN @ConfirmacionAutomatica=1 THEN ''automatica'' ELSE NULL END
      WHERE Id=@IdIntento;

      IF @ConfirmacionAutomatica=1
        INSERT INTO dbo.HistorialEstadoCorreccionIntento
          (IdIntento,EstadoAnterior,EstadoNuevo,Accion,ModificadoPor)
        VALUES(@IdIntento,0,1,''confirmacion_automatica'',NULL);

      COMMIT TRANSACTION;
      SELECT Id,IdAlumno,IdPublicacion,Estado,NotaFinal,NotaAutomatica,
        NotaFinalCalculada,NotaFinalManual,FechaInicio,FechaFin,
        CorreccionConfirmada,CorreccionConfirmadaPor,FechaCorreccionConfirmada,
        OrigenConfirmacionCorreccion
      FROM dbo.Intento WHERE Id=@IdIntento;
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
