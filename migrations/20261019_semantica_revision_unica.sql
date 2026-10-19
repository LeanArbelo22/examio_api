/*
  Corrección aditiva de la semántica de revisión de la etapa 5.
  Ejecutar manualmente después de 20261018_revision_examen.sql.

  - El consumo único pasa a ser una propiedad persistente del intento.
  - Las sesiones nuevas congelan los límites efectivos usados al emitirlas.
  - Se amplía el catálogo de auditoría sin modificar notas, respuestas ni intentos.

  Toda referencia posterior a objetos/columnas nuevos usa SQL dinámico para evitar
  compilación anticipada de SQL Server contra el esquema anterior.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH('dbo.SesionRevisionIntento', 'DisponibleDesdeSnapshot') IS NULL
    EXEC(N'ALTER TABLE dbo.SesionRevisionIntento
      ADD DisponibleDesdeSnapshot DATETIME2(3) NULL;');

  IF COL_LENGTH('dbo.SesionRevisionIntento', 'DisponibleHastaSnapshot') IS NULL
    EXEC(N'ALTER TABLE dbo.SesionRevisionIntento
      ADD DisponibleHastaSnapshot DATETIME2(3) NULL;');

  IF COL_LENGTH('dbo.SesionRevisionIntento', 'ExpiracionLimitadaPor') IS NULL
    EXEC(N'ALTER TABLE dbo.SesionRevisionIntento
      ADD ExpiracionLimitadaPor VARCHAR(20) NULL;');

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID('dbo.SesionRevisionIntento')
      AND name='CHK_SesionRevision_LimiteExpiracion'
  )
    EXEC(N'ALTER TABLE dbo.SesionRevisionIntento WITH CHECK
      ADD CONSTRAINT CHK_SesionRevision_LimiteExpiracion
      CHECK (ExpiracionLimitadaPor IS NULL OR
        ExpiracionLimitadaPor IN (''duracion'',''ventana'',''permiso''));');

  IF OBJECT_ID('dbo.ConsumoRevisionUnicaIntento', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.ConsumoRevisionUnicaIntento (
      IdIntento INT NOT NULL CONSTRAINT PK_ConsumoRevisionUnicaIntento PRIMARY KEY,
      IdSesion UNIQUEIDENTIFIER NOT NULL,
      IdUsuario INT NOT NULL,
      FechaConsumo DATETIME2(3) NOT NULL,
      Origen VARCHAR(10) NOT NULL,
      CONSTRAINT UQ_ConsumoRevisionUnica_Sesion UNIQUE (IdSesion),
      CONSTRAINT FK_ConsumoRevisionUnica_Intento FOREIGN KEY (IdIntento)
        REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_ConsumoRevisionUnica_Sesion FOREIGN KEY (IdSesion)
        REFERENCES dbo.SesionRevisionIntento(Id),
      CONSTRAINT FK_ConsumoRevisionUnica_Usuario FOREIGN KEY (IdUsuario)
        REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_ConsumoRevisionUnica_Origen CHECK (Origen IN (''runtime'',''backfill''))
    );');

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID('dbo.ConsumoRevisionUnicaIntento')
      AND name='IX_ConsumoRevisionUnica_Fecha'
  )
    EXEC(N'CREATE INDEX IX_ConsumoRevisionUnica_Fecha
      ON dbo.ConsumoRevisionUnicaIntento(FechaConsumo DESC)
      INCLUDE (IdSesion,IdUsuario,Origen);');

  /* Conserva como consumo autoritativo el primer consumo único histórico. */
  EXEC(N';WITH Candidatos AS (
      SELECT S.IdIntento,S.Id AS IdSesion,S.IdUsuario,
        COALESCE(S.FechaPrimerConsumo,S.FechaUltimoConsumo,S.FechaEmision) AS FechaConsumo,
        ROW_NUMBER() OVER (
          PARTITION BY S.IdIntento
          ORDER BY COALESCE(S.FechaPrimerConsumo,S.FechaUltimoConsumo,S.FechaEmision),S.Id
        ) AS Orden
      FROM dbo.SesionRevisionIntento S
      WHERE S.AccesoSnapshot=''unico''
        AND (S.Estado=''consumida'' OR S.CantidadConsumos>0)
    )
    INSERT INTO dbo.ConsumoRevisionUnicaIntento
      (IdIntento,IdSesion,IdUsuario,FechaConsumo,Origen)
    SELECT C.IdIntento,C.IdSesion,C.IdUsuario,C.FechaConsumo,''backfill''
    FROM Candidatos C
    WHERE C.Orden=1
      AND NOT EXISTS (
        SELECT 1 FROM dbo.ConsumoRevisionUnicaIntento U WHERE U.IdIntento=C.IdIntento
      );');

  /* La constraint original debe ampliarse porque la migración de etapa 5 ya fue aplicada. */
  IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID('dbo.AuditoriaRevisionIntento')
      AND name='CHK_AuditoriaRevision_Accion'
  )
    EXEC(N'ALTER TABLE dbo.AuditoriaRevisionIntento
      DROP CONSTRAINT CHK_AuditoriaRevision_Accion;');

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID('dbo.AuditoriaRevisionIntento')
      AND name='CHK_AuditoriaRevision_Accion'
  )
    EXEC(N'ALTER TABLE dbo.AuditoriaRevisionIntento WITH CHECK
      ADD CONSTRAINT CHK_AuditoriaRevision_Accion CHECK (Accion IN (
        ''politica_backfill'',''politica_actualizada'',
        ''permiso_otorgado'',''permiso_reactivado'',''permiso_revocado'',
        ''permiso_denegado_nunca'',
        ''sesion_emitida'',''sesion_reutilizada'',''sesion_abierta'',
        ''sesion_consumida'',''sesion_expirada'',''sesion_revocada'',''contenido_consultado'',
        ''emision_denegada_unico'',''emision_denegada_nunca''
      ));');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
