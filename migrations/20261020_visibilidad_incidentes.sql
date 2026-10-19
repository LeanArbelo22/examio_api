/*
  Etapa 7: visibilidad operativa y revisión de incidentes.
  Ejecutar manualmente después de 20261019_politicas_supervision.sql.

  La tabla es append-only: la fila de mayor Revision representa el estado actual.
  La ausencia de filas equivale a pendiente con revisión 0. No se modifican eventos,
  decisiones de supervisión, intentos, respuestas ni calificaciones.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.RevisionIncidenteIntento', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.RevisionIncidenteIntento (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RevisionIncidenteIntento PRIMARY KEY,
      IdIncidente BIGINT NOT NULL,
      Revision INT NOT NULL,
      Estado VARCHAR(20) NOT NULL,
      ActorId INT NOT NULL,
      ActorRol VARCHAR(20) NOT NULL,
      Comentario NVARCHAR(500) NULL,
      FechaRevision DATETIME2(3) NOT NULL
        CONSTRAINT DF_RevisionIncidenteIntento_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT UQ_RevisionIncidenteIntento_Incidente_Revision
        UNIQUE (IdIncidente,Revision),
      CONSTRAINT FK_RevisionIncidenteIntento_Incidente FOREIGN KEY (IdIncidente)
        REFERENCES dbo.IncidenteIntento(Id),
      CONSTRAINT FK_RevisionIncidenteIntento_Actor FOREIGN KEY (ActorId)
        REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_RevisionIncidenteIntento_Revision CHECK (Revision>=1),
      CONSTRAINT CHK_RevisionIncidenteIntento_Estado CHECK
        (Estado IN (''pendiente'',''revisado'',''descartado'')),
      CONSTRAINT CHK_RevisionIncidenteIntento_ActorRol CHECK
        (ActorRol IN (''admin'',''docente''))
    );');

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID('dbo.RevisionIncidenteIntento')
      AND name='IX_RevisionIncidenteIntento_Estado'
  )
    EXEC(N'CREATE INDEX IX_RevisionIncidenteIntento_Estado
      ON dbo.RevisionIncidenteIntento(IdIncidente,Revision DESC)
      INCLUDE (Estado,ActorId,ActorRol,Comentario,FechaRevision);');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
