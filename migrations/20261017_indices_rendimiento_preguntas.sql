/*
  Etapa 4: índices para reportes de rendimiento por pregunta y grupo.
  Ejecutar manualmente después de 20261016_telemetria_temporal.sql.

  No crea tablas de agregación ni modifica datos o Stored Procedures. Los tres índices
  cubren accesos que en la base de prueba sólo tenían PK: intentos por publicación,
  preguntas por intento y fallback de navegación por intento/pregunta.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID('dbo.Intento')
      AND name='IX_Intento_Publicacion_Alumno_Estado_Fecha'
  )
    EXEC(N'CREATE INDEX IX_Intento_Publicacion_Alumno_Estado_Fecha
      ON dbo.Intento(IdPublicacion,IdAlumno,Estado,FechaInicio)
      INCLUDE (FechaFin,NumeroIntento,CorreccionConfirmada);');

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID('dbo.IntentoPregunta')
      AND name='IX_IntentoPregunta_Intento_Pregunta_Rendimiento'
  )
    EXEC(N'CREATE INDEX IX_IntentoPregunta_Intento_Pregunta_Rendimiento
      ON dbo.IntentoPregunta(IdIntento,IdPregunta)
      INCLUDE (PuntajeMaximoSnapshot,PuntajeObtenido,ContenidoHashSnapshot,
        OrigenCorreccion,TipoSnapshot,SnapshotReconstruido);');

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID('dbo.MetricasNavegacion')
      AND name='IX_MetricasNavegacion_Intento_Pregunta'
  )
    EXEC(N'CREATE INDEX IX_MetricasNavegacion_Intento_Pregunta
      ON dbo.MetricasNavegacion(IdIntento,IdPregunta)
      INCLUDE (SegundosPermanencia);');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
