/*
  Etapa 3: telemetría temporal confiable.
  Ejecutar manualmente después de 20261015_anulacion_confirmacion_revision.sql.
  Extiende IncidenteIntento; no crea ni modifica Stored Procedures.

  El script es transaccional e idempotente. Toda referencia posterior a columnas o
  tablas creadas en este batch usa SQL dinámico para evitar errores de compilación 207/208.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.TipoEventoTelemetria', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TipoEventoTelemetria (
      Tipo VARCHAR(30) NOT NULL CONSTRAINT PK_TipoEventoTelemetria PRIMARY KEY,
      EsIntervalo BIT NOT NULL,
      EsIncidente BIT NOT NULL,
      RequierePregunta BIT NOT NULL,
      AdmiteCierrePosterior BIT NOT NULL,
      Activo BIT NOT NULL CONSTRAINT DF_TipoEventoTelemetria_Activo DEFAULT (1),
      FechaActualizacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_TipoEventoTelemetria_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT CHK_TipoEventoTelemetria_Cierre CHECK (
        AdmiteCierrePosterior=0 OR EsIntervalo=1
      )
    );
  END;

  EXEC(N'
    UPDATE T SET
      EsIntervalo=V.EsIntervalo,
      EsIncidente=V.EsIncidente,
      RequierePregunta=V.RequierePregunta,
      AdmiteCierrePosterior=V.AdmiteCierrePosterior,
      Activo=1,
      FechaActualizacion=SYSUTCDATETIME()
    FROM dbo.TipoEventoTelemetria T
    JOIN (VALUES
      (''question_active'',1,0,1,1),
      (''focus_lost'',1,1,0,1),
      (''fullscreen_exit'',1,1,0,1),
      (''connectivity_lost'',1,1,0,1),
      (''auth_session_unavailable'',1,1,0,1),
      (''exam_resumed'',0,0,0,0),
      (''page_reload'',0,0,0,0),
      (''sync_error'',0,1,0,0),
      (''submission_failed'',0,1,0,0),
      (''attempt_finished'',0,0,0,0)
    ) V(Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior)
      ON V.Tipo=T.Tipo;

    INSERT INTO dbo.TipoEventoTelemetria
      (Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior,Activo)
    SELECT V.Tipo,V.EsIntervalo,V.EsIncidente,V.RequierePregunta,V.AdmiteCierrePosterior,1
    FROM (VALUES
      (''question_active'',1,0,1,1),
      (''focus_lost'',1,1,0,1),
      (''fullscreen_exit'',1,1,0,1),
      (''connectivity_lost'',1,1,0,1),
      (''auth_session_unavailable'',1,1,0,1),
      (''exam_resumed'',0,0,0,0),
      (''page_reload'',0,0,0,0),
      (''sync_error'',0,1,0,0),
      (''submission_failed'',0,1,0,0),
      (''attempt_finished'',0,0,0,0)
    ) V(Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior)
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.TipoEventoTelemetria T WHERE T.Tipo=V.Tipo
    );
  ');

  IF COL_LENGTH('dbo.IncidenteIntento', 'IdIntentoPregunta') IS NULL
    ALTER TABLE dbo.IncidenteIntento ADD IdIntentoPregunta INT NULL;
  IF COL_LENGTH('dbo.IncidenteIntento', 'SesionClienteId') IS NULL
    ALTER TABLE dbo.IncidenteIntento ADD SesionClienteId UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH('dbo.IncidenteIntento', 'SecuenciaCliente') IS NULL
    ALTER TABLE dbo.IncidenteIntento ADD SecuenciaCliente BIGINT NULL;
  IF COL_LENGTH('dbo.IncidenteIntento', 'Codigo') IS NULL
    ALTER TABLE dbo.IncidenteIntento ADD Codigo VARCHAR(50) NULL;
  IF COL_LENGTH('dbo.IncidenteIntento', 'VersionContrato') IS NULL
    ALTER TABLE dbo.IncidenteIntento ADD VersionContrato SMALLINT NOT NULL
      CONSTRAINT DF_IncidenteIntento_VersionContrato DEFAULT (1) WITH VALUES;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_IncidenteIntento_IntentoPregunta')
    EXEC(N'ALTER TABLE dbo.IncidenteIntento ADD CONSTRAINT FK_IncidenteIntento_IntentoPregunta
      FOREIGN KEY (IdIntentoPregunta) REFERENCES dbo.IntentoPregunta(Id);');

  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CHK_IncidenteIntento_SesionSecuencia')
    EXEC(N'ALTER TABLE dbo.IncidenteIntento WITH CHECK ADD CONSTRAINT CHK_IncidenteIntento_SesionSecuencia CHECK (
      (SesionClienteId IS NULL AND SecuenciaCliente IS NULL)
      OR (SesionClienteId IS NOT NULL AND SecuenciaCliente IS NOT NULL AND SecuenciaCliente>=0)
    );');

  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CHK_IncidenteIntento_VersionContrato')
    EXEC(N'ALTER TABLE dbo.IncidenteIntento WITH CHECK ADD CONSTRAINT CHK_IncidenteIntento_VersionContrato
      CHECK (VersionContrato>=1);');

  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CHK_IncidenteIntento_Tipo')
    EXEC(N'ALTER TABLE dbo.IncidenteIntento DROP CONSTRAINT CHK_IncidenteIntento_Tipo;');

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_IncidenteIntento_TipoEvento')
    EXEC(N'ALTER TABLE dbo.IncidenteIntento WITH CHECK ADD CONSTRAINT FK_IncidenteIntento_TipoEvento
      FOREIGN KEY (Tipo) REFERENCES dbo.TipoEventoTelemetria(Tipo);');

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID('dbo.IncidenteIntento')
      AND name='UX_IncidenteIntento_Intento_Sesion_Secuencia'
  )
    EXEC(N'CREATE UNIQUE INDEX UX_IncidenteIntento_Intento_Sesion_Secuencia
      ON dbo.IncidenteIntento(IdIntento,SesionClienteId,SecuenciaCliente)
      WHERE SesionClienteId IS NOT NULL AND SecuenciaCliente IS NOT NULL;');

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID('dbo.IncidenteIntento')
      AND name='IX_IncidenteIntento_Intento_Tipo_Pregunta_Fecha'
  )
    EXEC(N'CREATE INDEX IX_IncidenteIntento_Intento_Tipo_Pregunta_Fecha
      ON dbo.IncidenteIntento(IdIntento,Tipo,IdIntentoPregunta,Estado,FechaInicioCliente)
      INCLUDE (FechaFinCliente,DuracionMilisegundos,SesionClienteId,SecuenciaCliente);');

  -- question_active necesita el identificador estable de la instancia sorteada.
  -- Se redefine aquí para poder reaplicar únicamente la migración de esta etapa.
  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_ObtenerExamenDinamico
    @IdIntento INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT IP.Id AS IdIntentoPregunta,IP.IdPregunta,
      COALESCE(IP.EnunciadoSnapshot,P.Enunciado) AS Enunciado,
      COALESCE(IP.TipoSnapshot,P.Tipo) AS Tipo,
      COALESCE(IP.GrupoTituloSnapshot,GP.TituloReferencia) AS GrupoConceptualmente,
      IP.ModoJustificacionSnapshot AS ModoJustificacion,
      IP.EstrategiaCorreccionSnapshot AS EstrategiaCorreccion,
      IP.TratamientoJustificacionSnapshot AS TratamientoJustificacion,
      IP.PuntajeMaximoSnapshot AS PuntajeMaximo,A.MostrarPuntajePorPregunta,
      R.Id AS IdRespuesta,R.RtaTexto,R.Justificacion,R.Revision,
      COALESCE((SELECT RO.IdOpcion AS idOpcion
        FROM dbo.RespuestaOpcion RO WHERE RO.IdRespuesta=R.Id
        ORDER BY RO.IdOpcion FOR JSON PATH),N''[]'') AS OpcionesSeleccionadasJson
    FROM dbo.IntentoPregunta IP
    LEFT JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
    LEFT JOIN dbo.GrupoPregunta GP ON GP.Id=P.IdGrupoPregunta
    JOIN dbo.Intento I ON I.Id=IP.IdIntento
    JOIN dbo.Publicacion PU ON PU.Id=I.IdPublicacion
    JOIN dbo.Actividad A ON A.Id=PU.IdActividad
    LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
    WHERE IP.IdIntento=@IdIntento
    ORDER BY IP.Id;
  END;');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
