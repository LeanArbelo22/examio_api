-- ============================================================
-- MIGRACIÓN 004 — SP_Intento_FinalizarExamen con soporte
--                 de preguntas abiertas + NotaAutomatica
-- ============================================================
-- 1. Agrega columna NotaAutomatica a Intento
-- 2. Reemplaza SP_Intento_FinalizarExamen con:
--    - Idempotencia (devuelve sin THROW si ya finalizado)
--    - Detección de preguntas abiertas
--    - Si 100% mc/vf → NotaFinal = cálculo, NotaAutomatica = cálculo
--    - Si hay abiertas → NotaFinal = NULL, NotaAutomatica = parcial
-- ============================================================
USE GestionExamio;
GO

-- ============================================================
-- PASO 1: Agregar columna de referencia para el docente
-- ============================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('Intento') AND name = 'NotaAutomatica'
)
BEGIN
    ALTER TABLE Intento ADD NotaAutomatica DECIMAL(4,2) NULL;
    PRINT '✓ Columna NotaAutomatica agregada a Intento.';
END
ELSE
    PRINT '→ Columna NotaAutomatica ya existe.';
GO

-- ============================================================
-- PASO 2: Reescribir el SP
-- ============================================================
ALTER PROCEDURE SP_Intento_FinalizarExamen
    @IdIntento INT
AS
BEGIN
    SET NOCOUNT ON;

    -- ==========================================================
    -- [IDEMPOTENTE] Si ya está entregado/anulado/vencido,
    -- devuelve el registro actual sin lanzar error.
    -- ==========================================================
    DECLARE @EstadoActual NVARCHAR(20);
    SELECT @EstadoActual = Estado FROM Intento WHERE Id = @IdIntento;

    IF @EstadoActual IN ('entregado', 'anulado', 'vencido')
    BEGIN
        SELECT Id, IdAlumno, IdPublicacion, Estado, NotaFinal,
               NotaAutomatica, FechaInicio, FechaFin
        FROM Intento WHERE Id = @IdIntento;
        RETURN;
    END;

    -- ==========================================================
    -- Variables
    -- ==========================================================
    DECLARE @TotalChoice       INT;
    DECLARE @CorrectasChoice   INT;
    DECLARE @TotalAbierta      INT;
    DECLARE @NotaParcial       DECIMAL(4,2);
    DECLARE @IdPublicacion     INT;

    SELECT @IdPublicacion = IdPublicacion FROM Intento WHERE Id = @IdIntento;

    -- ==========================================================
    -- 1. Contar preguntas objetivas (mc / vf)
    -- ==========================================================
    SELECT @TotalChoice = COUNT(*)
    FROM IntentoPregunta IP
    INNER JOIN Pregunta P ON IP.IdPregunta = P.Id
    WHERE IP.IdIntento = @IdIntento
      AND P.Tipo IN ('mc', 'vf');

    -- ==========================================================
    -- 2. Contar preguntas abiertas
    -- ==========================================================
    SELECT @TotalAbierta = COUNT(*)
    FROM IntentoPregunta IP
    INNER JOIN Pregunta P ON IP.IdPregunta = P.Id
    WHERE IP.IdIntento = @IdIntento
      AND P.Tipo = 'abierta';

    -- ==========================================================
    -- 3. Contar respuestas correctas (solo mc/vf)
    -- ==========================================================
    SELECT @CorrectasChoice = COUNT(*)
    FROM Respuesta R
    INNER JOIN RespuestaOpcion RO ON R.Id = RO.IdRespuesta
    INNER JOIN Opcion O ON RO.IdOpcion = O.Id
    WHERE R.IdIntento = @IdIntento
      AND O.EsCorrecta = 1;

    -- ==========================================================
    -- 4. Calcular nota parcial objetiva
    -- ==========================================================
    IF @TotalChoice > 0
        SET @NotaParcial = CAST(
            ROUND((CAST(@CorrectasChoice AS DECIMAL(10,2)) / @TotalChoice) * 10.00, 2)
        AS DECIMAL(4,2));
    ELSE
        SET @NotaParcial = NULL;

    -- ==========================================================
    -- 5. Actualizar según composición del examen
    -- ==========================================================
    IF @TotalAbierta = 0
    BEGIN
        -- 100% objetivo: nota final definitiva
        UPDATE Intento
        SET Estado         = 'entregado',
            FechaFin       = SYSUTCDATETIME(),
            NotaFinal      = ISNULL(@NotaParcial, 0.00),
            NotaAutomatica = @NotaParcial
        WHERE Id = @IdIntento;
    END
    ELSE
    BEGIN
        -- Hay abiertas: estado entregado, NotaFinal queda NULL
        -- (pendiente de corrección manual por el docente)
        UPDATE Intento
        SET Estado         = 'entregado',
            FechaFin       = SYSUTCDATETIME(),
            NotaFinal      = NULL,
            NotaAutomatica = @NotaParcial
        WHERE Id = @IdIntento;
    END;

    -- ==========================================================
    -- 6. Retornar el registro actualizado
    -- ==========================================================
    SELECT Id, IdAlumno, IdPublicacion, Estado, NotaFinal,
           NotaAutomatica, FechaInicio, FechaFin
    FROM Intento WHERE Id = @IdIntento;
END;
GO

PRINT '✓ SP_Intento_FinalizarExamen actualizado con soporte de abiertas + NotaAutomatica.';
GO
