SELECT
    a.Nombre + N' ' + a.Apellido AS Alumno,
    m.Nombre AS Materia,
    d.Descripcion AS Division,
    doc.Nombre + N' ' + doc.Apellido AS Profesor
FROM dbo.InscripcionMateria i
JOIN dbo.Alumno a ON a.Matricula = i.IdAlumno
JOIN dbo.MateriaDivision md ON md.Id = i.IdMateriaDivision
JOIN dbo.Materia m ON m.Id = md.IdMateria
JOIN dbo.Carrera c ON c.Id = m.IdCarrera
JOIN dbo.Division d ON d.Id = md.IdDivision
LEFT JOIN dbo.Docente doc ON doc.Legajo = md.IdDocente
WHERE c.Nombre = N'Tecnicatura Superior en Ciberseguridad y Redes'
ORDER BY a.Apellido, a.Nombre, m.Nombre;

DECLARE @LegajoDocente INT = 108991;

SELECT
    m.Nombre AS Materia,
    d.Descripcion AS Division,
    a.Matricula,
    a.Apellido,
    a.Nombre,
    a.Correo
FROM dbo.MateriaDivision md
JOIN dbo.Materia m ON m.Id = md.IdMateria
JOIN dbo.Division d ON d.Id = md.IdDivision
JOIN dbo.InscripcionMateria i ON i.IdMateriaDivision = md.Id
JOIN dbo.Alumno a ON a.Matricula = i.IdAlumno
WHERE md.IdDocente = @LegajoDocente
ORDER BY m.Nombre, d.Descripcion, a.Apellido, a.Nombre;