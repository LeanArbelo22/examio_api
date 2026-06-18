-- ============================================================
-- MIGRACIÓN 002 — Eliminar anulación automática por fullscreen_exit
-- ============================================================
-- Ejecutar en SSMS contra la base de datos GestionExamio
-- ============================================================
USE GestionExamio;
GO

ALTER PROCEDURE SP_Antifraude_RegistrarAlerta
    @IdIntento INT,
    @TipoIncidente NVARCHAR(50),
    @Detalle NVARCHAR(250)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO AlertaFraude (IdIntento, TipoIncidentes, Detalle)
    VALUES (@IdIntento, @TipoIncidente, @Detalle);
END;
GO

PRINT '✓ SP_Antifraude_RegistrarAlerta actualizado. Ya no anula intentos automáticamente.';
GO
