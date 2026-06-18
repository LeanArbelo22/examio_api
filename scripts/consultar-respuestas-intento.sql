-- ============================================================
-- CONSULTA: Ver todas las respuestas de un intento
-- ============================================================
-- Uso: Reemplazar {IdIntento} por el número real en SSMS
-- ============================================================
USE GestionExamio;

DECLARE @IdIntento INT = {IdIntento}; -- << CAMBIAR AQUÍ

SELECT
    I.Id                    AS IdIntento,
    I.Estado,
    I.NotaFinal,
    I.NotaAutomatica,
    PR.Id                   AS IdPregunta,
    LEFT(PR.Enunciado, 80)  AS Enunciado,
    PR.Tipo                 AS TipoPregunta,
    R.RtaTexto              AS RtaTexto,
    O.Texto                 AS OpcionSeleccionada,
    O.EsCorrecta
FROM Intento I
INNER JOIN Respuesta R       ON R.IdIntento = I.Id
LEFT JOIN Pregunta PR        ON R.IdPregunta = PR.Id
LEFT JOIN RespuestaOpcion RO ON R.Id = RO.IdRespuesta
LEFT JOIN Opcion O           ON RO.IdOpcion = O.Id
WHERE I.Id = @IdIntento
ORDER BY PR.Id;
