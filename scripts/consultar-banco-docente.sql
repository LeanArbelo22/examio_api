-- Solo lectura. Incluye preguntas sin grupo y todos los estados del banco.
-- Una pregunta que integra varios grupos aparece una vez por cada grupo.
DECLARE @IdDocente INT = 108991;

SELECT
    P.Id AS IdBancoPregunta,
    P.Titulo AS TituloPregunta,
    P.Tipo,
    P.Estado AS EstadoPregunta,
    P.Revision AS RevisionPregunta,
    G.Id AS IdBancoGrupo,
    G.TituloReferencia AS Grupo,
    G.Estado AS EstadoGrupo,
    GP.Posicion AS PosicionEnGrupo,
    P.Enunciado,
    (SELECT COUNT(*) FROM dbo.BancoOpcion AS O
     WHERE O.IdPregunta = P.Id) AS CantidadOpciones
FROM dbo.BancoPregunta AS P
LEFT JOIN dbo.BancoGrupoPregunta AS GP
    ON GP.IdPregunta = P.Id AND GP.IdDocente = P.IdDocente
LEFT JOIN dbo.BancoGrupo AS G
    ON G.Id = GP.IdGrupo AND G.IdDocente = P.IdDocente
WHERE P.IdDocente = @IdDocente
ORDER BY G.TituloReferencia, G.Id, GP.Posicion, P.Id;
