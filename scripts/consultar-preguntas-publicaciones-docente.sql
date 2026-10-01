-- Solo lectura. Reemplazar NULL por el legajo del docente.
-- Incluye actividades en borrador, publicadas y archivadas.
-- La asignación corresponde al docente actual de la comisión, no a autoría histórica.
DECLARE @IdDocente INT = NULL;

SELECT
    D.Legajo AS IdDocente,
    D.Nombre + N' ' + D.Apellido AS Docente,
    M.Nombre AS Materia,
    DV.Descripcion AS Division,
    P.Id AS IdPublicacion,
    A.Id AS IdActividad,
    A.Titulo AS Evaluacion,
    A.Estado AS EstadoEvaluacion,
    GP.Id AS IdGrupoPregunta,
    GP.TituloReferencia AS GrupoPregunta,
    PR.Id AS IdPregunta,
    PR.Tipo AS TipoPregunta,
    PR.Enunciado
FROM dbo.Docente AS D
INNER JOIN dbo.MateriaDivision AS MD ON MD.IdDocente = D.Legajo
INNER JOIN dbo.Materia AS M ON M.Id = MD.IdMateria
INNER JOIN dbo.Division AS DV ON DV.Id = MD.IdDivision
INNER JOIN dbo.Publicacion AS P ON P.IdMateriaDivision = MD.Id
INNER JOIN dbo.Actividad AS A ON A.Id = P.IdActividad
LEFT JOIN dbo.GrupoPregunta AS GP ON GP.IdActividad = A.Id
LEFT JOIN dbo.Pregunta AS PR ON PR.IdGrupoPregunta = GP.Id
WHERE D.Legajo = @IdDocente
ORDER BY M.Nombre, DV.Descripcion, P.Id, GP.Id, PR.Id;

-- Si una actividad tiene varias publicaciones, sus preguntas aparecen
-- una vez por publicación. Esto no significa que estén duplicadas.
