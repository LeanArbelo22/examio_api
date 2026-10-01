SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Ejecutar sobre la base de datos de Examio.
-- Carga independiente: no ejecutar dentro de otra transacción.
IF @@TRANCOUNT <> 0
    THROW 51000, N'Ejecutar este script fuera de una transacción existente.', 1;

DECLARE @NombreCarrera NVARCHAR(100) =
    N'Tecnicatura Superior en Ciberseguridad y Redes';

DECLARE @PasswordHash NVARCHAR(255) =
    N'$2b$10$LdavSpqchmdImmy0ery4V.x7Ye0YCJHeA8ITtZgRgU/TClPI/7yr6';

DECLARE @FechaCreacion DATETIME = CONVERT(DATETIME, SYSUTCDATETIME());
DECLARE @IdCarrera INT;
DECLARE @BaseLegajo BIGINT;
DECLARE @BaseMatricula BIGINT;
DECLARE @Bloqueo BIGINT;

DECLARE @Materias TABLE
(
    Numero INT PRIMARY KEY,
    Nombre NVARCHAR(100) NOT NULL UNIQUE,
    Semestre INT NOT NULL,
    IdMateria INT NULL
);

INSERT INTO @Materias (Numero, Nombre, Semestre)
VALUES
    (1,  N'Fundamentos de Redes de Datos',             1),
    (2,  N'Administración de Redes Seguras',           2),
    (3,  N'Administración de Sistemas Linux',          1),
    (4,  N'Seguridad de Sistemas Operativos',          2),
    (5,  N'Fundamentos de Criptografía',               3),
    (6,  N'Infraestructura de Clave Pública',          4),
    (7,  N'Programación Segura',                      3),
    (8,  N'Seguridad de Aplicaciones Web',            4),
    (9,  N'Auditoría de Seguridad Informática',        5),
    (10, N'Respuesta a Incidentes y Análisis Forense', 6);

DECLARE @Divisiones TABLE
(
    Grupo INT PRIMARY KEY,
    Descripcion NVARCHAR(50) NOT NULL UNIQUE,
    IdDivision INT NULL
);

INSERT INTO @Divisiones (Grupo, Descripcion)
VALUES (1, N'1NMS'), (2, N'2NMS');

DECLARE @Personas TABLE
(
    Orden INT PRIMARY KEY,
    Rol NVARCHAR(20) NOT NULL,
    Numero INT NOT NULL,
    Nombre NVARCHAR(50) NOT NULL,
    Apellido NVARCHAR(50) NOT NULL,
    Email NVARCHAR(50) NOT NULL UNIQUE,
    Grupo INT NULL,
    Cuil NVARCHAR(20) NULL,
    IdInstitucional INT NULL,
    UNIQUE (Rol, Numero)
);

-- Docentes 1-10.
INSERT INTO @Personas
    (Orden, Rol, Numero, Nombre, Apellido, Email, Grupo)
VALUES
    (1,  N'docente', 1,  N'Gabriel',  N'Salvatierra',
     N'gabriel.salvatierra@cervantes.edu.ar', NULL),
    (2,  N'docente', 2,  N'Paula',    N'Venturini',
     N'paula.venturini@cervantes.edu.ar', NULL),
    (3,  N'docente', 3,  N'Esteban',  N'Figueroa',
     N'esteban.figueroa@cervantes.edu.ar', NULL),
    (4,  N'docente', 4,  N'Luciana',  N'Bertone',
     N'luciana.bertone@cervantes.edu.ar', NULL),
    (5,  N'docente', 5,  N'Ramiro',   N'Ferreyra',
     N'ramiro.ferreyra@cervantes.edu.ar', NULL),
    (6,  N'docente', 6,  N'Natalia',  N'Olmedo',
     N'natalia.olmedo@cervantes.edu.ar', NULL),
    (7,  N'docente', 7,  N'Matías',   N'Villalba',
     N'matias.villalba@cervantes.edu.ar', NULL),
    (8,  N'docente', 8,  N'Cecilia',  N'Arrieta',
     N'cecilia.arrieta@cervantes.edu.ar', NULL),
    (9,  N'docente', 9,  N'Ignacio',  N'Funes',
     N'ignacio.funes@cervantes.edu.ar', NULL),
    (10, N'docente', 10, N'Florencia', N'Balmaceda',
     N'florencia.balmaceda@cervantes.edu.ar', NULL);

-- Alumnos 1-10: grupo 1. Alumnos 11-20: grupo 2.
INSERT INTO @Personas
    (Orden, Rol, Numero, Nombre, Apellido, Email, Grupo)
VALUES
    (11, N'alumno', 1,  N'Abril',    N'Bustamante',
     N'abril.bustamante@cervantes.edu.ar', 1),
    (12, N'alumno', 2,  N'Tomás',    N'Ledesma',
     N'tomas.ledesma@cervantes.edu.ar', 1),
    (13, N'alumno', 3,  N'Malena',   N'Quiroga',
     N'malena.quiroga@cervantes.edu.ar', 1),
    (14, N'alumno', 4,  N'Joaquín',  N'Vera',
     N'joaquin.vera@cervantes.edu.ar', 1),
    (15, N'alumno', 5,  N'Pilar',    N'Soria',
     N'pilar.soria@cervantes.edu.ar', 1),
    (16, N'alumno', 6,  N'Bautista', N'Correa',
     N'bautista.correa@cervantes.edu.ar', 1),
    (17, N'alumno', 7,  N'Mora',     N'Escudero',
     N'mora.escudero@cervantes.edu.ar', 1),
    (18, N'alumno', 8,  N'Benjamín', N'Pereyra',
     N'benjamin.pereyra@cervantes.edu.ar', 1),
    (19, N'alumno', 9,  N'Catalina', N'Godoy',
     N'catalina.godoy@cervantes.edu.ar', 1),
    (20, N'alumno', 10, N'Simón',    N'Carrizo',
     N'simon.carrizo@cervantes.edu.ar', 1),
    (21, N'alumno', 11, N'Clara',    N'Zambrano',
     N'clara.zambrano@cervantes.edu.ar', 2),
    (22, N'alumno', 12, N'Felipe',   N'Aguirre',
     N'felipe.aguirre@cervantes.edu.ar', 2),
    (23, N'alumno', 13, N'Elena',    N'Rosales',
     N'elena.rosales@cervantes.edu.ar', 2),
    (24, N'alumno', 14, N'Bruno',    N'Mansilla',
     N'bruno.mansilla@cervantes.edu.ar', 2),
    (25, N'alumno', 15, N'Olivia',   N'Farías',
     N'olivia.farias@cervantes.edu.ar', 2),
    (26, N'alumno', 16, N'Lautaro',  N'Paz',
     N'lautaro.paz@cervantes.edu.ar', 2),
    (27, N'alumno', 17, N'Emma',     N'Cardozo',
     N'emma.cardozo@cervantes.edu.ar', 2),
    (28, N'alumno', 18, N'Valentín', N'Acun?a',
     N'valentin.acuna@cervantes.edu.ar', 2),
    (29, N'alumno', 19, N'Juana',    N'Medina',
     N'juana.medina@cervantes.edu.ar', 2),
    (30, N'alumno', 20, N'Pedro',    N'Palacios',
     N'pedro.palacios@cervantes.edu.ar', 2);

DECLARE @Comisiones TABLE
(
    IdMateriaDivision INT PRIMARY KEY,
    IdMateria INT NOT NULL,
    IdDivision INT NOT NULL,
    IdDocente INT NOT NULL
);

-- CUIL sintéticos de prueba, sin guiones, como los seeds.
-- Se calcula el dígito verificador; no representan identidades verificadas.
DECLARE @Orden INT = 1;
DECLARE @Dni INT = 60000000;
DECLARE @BaseCuil VARCHAR(10);
DECLARE @Suma INT;
DECLARE @Digito INT;

WHILE @Orden <= 30
BEGIN
    SET @Dni += 1;
    SET @BaseCuil = '20' + RIGHT('00000000' + CONVERT(VARCHAR(8), @Dni), 8);

    SELECT @Suma =
        SUM(CONVERT(INT, SUBSTRING(@BaseCuil, v.Posicion, 1)) * v.Peso)
    FROM (VALUES
        (1,5), (2,4), (3,3), (4,2), (5,7),
        (6,6), (7,5), (8,4), (9,3), (10,2)
    ) v(Posicion, Peso);

    SET @Digito = 11 - (@Suma % 11);

    IF @Digito = 11 SET @Digito = 0;

    -- Se omiten candidatos que requerirían cambiar el prefijo.
    IF @Digito = 10 CONTINUE;

    UPDATE @Personas
    SET Cuil = @BaseCuil + CONVERT(VARCHAR(1), @Digito)
    WHERE Orden = @Orden;

    SET @Orden += 1;
END;

BEGIN TRY
    BEGIN TRANSACTION;

    -- Bloqueos mantenidos hasta COMMIT/ROLLBACK.
    -- Permiten reservar legajos/matrículas y comprobar colisiones
    -- sin carreras entre dos ejecuciones concurrentes.
    SELECT @Bloqueo = COUNT_BIG(*)
    FROM dbo.Carrera WITH (TABLOCKX, HOLDLOCK);

    SELECT @Bloqueo = COUNT_BIG(*)
    FROM dbo.Division WITH (TABLOCKX, HOLDLOCK);

    SELECT @BaseLegajo = COALESCE(MAX(CONVERT(BIGINT, Legajo)), 0)
    FROM dbo.Docente WITH (TABLOCKX, HOLDLOCK);

    SELECT @BaseMatricula = COALESCE(MAX(CONVERT(BIGINT, Matricula)), 0)
    FROM dbo.Alumno WITH (TABLOCKX, HOLDLOCK);

    SELECT @Bloqueo = COUNT_BIG(*)
    FROM dbo.Usuario WITH (TABLOCKX, HOLDLOCK);

    IF EXISTS (
        SELECT 1
        FROM dbo.Carrera
        WHERE Nombre = @NombreCarrera
    )
        THROW 51001,
            N'La carrera ya existe. Se cancela para evitar duplicar o mezclar esta carga.',
            1;

    -- No se reutilizan personas/cuentas preexistentes.
    IF EXISTS (
        SELECT 1
        FROM @Personas p
        JOIN dbo.Usuario u ON u.Email = p.Email
    )
    OR EXISTS (
        SELECT 1
        FROM @Personas p
        JOIN dbo.Docente d ON d.Correo = p.Email OR d.Cuil = p.Cuil
    )
    OR EXISTS (
        SELECT 1
        FROM @Personas p
        JOIN dbo.Alumno a ON a.Correo = p.Email OR a.Cuil = p.Cuil
    )
        THROW 51002,
            N'Existe una cuenta, correo o CUIL de esta carga. No se insertó ningún dato.',
            1;

    IF @BaseLegajo < 0 SET @BaseLegajo = 0;
    IF @BaseMatricula < 0 SET @BaseMatricula = 0;

    IF @BaseLegajo > 2147483637 OR @BaseMatricula > 2147483627
        THROW 51003, N'No hay espacio INT para reservar los identificadores.', 1;

    UPDATE @Personas
    SET IdInstitucional = CONVERT(INT,
        CASE
            WHEN Rol = N'docente' THEN @BaseLegajo + Numero
            ELSE @BaseMatricula + Numero
        END
    );

    -- 1. Carrera nueva.
    INSERT INTO dbo.Carrera
        (Nombre, Descripcion, DuracionSemestres, Estado)
    VALUES
        (@NombreCarrera,
         N'Formación técnica en redes, protección de sistemas, criptografía, '
         + N'desarrollo seguro y respuesta a incidentes. Datos de prueba Examio.',
         6, 1);

    SET @IdCarrera = CONVERT(INT, SCOPE_IDENTITY());

    -- 2. Materias.
    INSERT INTO dbo.Materia (Nombre, Semestre, IdCarrera, Estado)
    SELECT Nombre, Semestre, @IdCarrera, 1
    FROM @Materias;

    UPDATE s
    SET IdMateria = m.Id
    FROM @Materias s
    JOIN dbo.Materia m
      ON m.IdCarrera = @IdCarrera
     AND m.Nombre = s.Nombre;

    -- 3. Dos divisiones del catálogo, reutilizadas por clave natural.
    INSERT INTO dbo.Division (Descripcion)
    SELECT s.Descripcion
    FROM @Divisiones s
    WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.Division d
        WHERE d.Descripcion = s.Descripcion
    );

    UPDATE s
    SET IdDivision = d.Id
    FROM @Divisiones s
    JOIN dbo.Division d ON d.Descripcion = s.Descripcion;

    -- 4. Diez docentes y veinte alumnos nuevos.
    INSERT INTO dbo.Docente
        (Legajo, Nombre, Apellido, Cuil, Correo, Estado)
    SELECT IdInstitucional, Nombre, Apellido, Cuil, Email, 1
    FROM @Personas
    WHERE Rol = N'docente';

    INSERT INTO dbo.Alumno
        (Matricula, Nombre, Apellido, Cuil, Correo, Estado)
    SELECT IdInstitucional, Nombre, Apellido, Cuil, Email, N'activo'
    FROM @Personas
    WHERE Rol = N'alumno';

    -- 5. Una cuenta activa por persona, con vinculación exclusiva.
    INSERT INTO dbo.Usuario
        (Email, PasswordHash, Rol, IdDocente, IdAlumno, FechaCreacion, Activo)
    SELECT
        Email,
        @PasswordHash,
        Rol,
        CASE WHEN Rol = N'docente' THEN IdInstitucional END,
        CASE WHEN Rol = N'alumno' THEN IdInstitucional END,
        @FechaCreacion,
        1
    FROM @Personas;

    -- 6. Veinte comisiones con un docente cada una.
    --
    -- Las materias se agrupan por afinidad:
    -- 1-2 redes; 3-4 sistemas; 5-6 criptografía;
    -- 7-8 desarrollo seguro; 9-10 auditoría/respuesta.
    --
    -- Grupo 1: docente con el mismo número de materia.
    -- Grupo 2: docente de la otra materia del par.
    -- Cada docente queda con dos materias diferentes.
    INSERT INTO dbo.MateriaDivision (IdMateria, IdDivision, IdDocente)
    OUTPUT
        inserted.Id,
        inserted.IdMateria,
        inserted.IdDivision,
        inserted.IdDocente
    INTO @Comisiones
        (IdMateriaDivision, IdMateria, IdDivision, IdDocente)
    SELECT
        m.IdMateria,
        d.IdDivision,
        p.IdInstitucional
    FROM @Materias m
    CROSS JOIN @Divisiones d
    JOIN @Personas p
      ON p.Rol = N'docente'
     AND p.Numero =
        CASE
            WHEN d.Grupo = 1 THEN m.Numero
            WHEN m.Numero % 2 = 1 THEN m.Numero + 1
            ELSE m.Numero - 1
        END;

    -- 7. Diez materias por alumno, exclusivamente en su división.
    INSERT INTO dbo.InscripcionMateria (IdMateriaDivision, IdAlumno)
    SELECT c.IdMateriaDivision, p.IdInstitucional
    FROM @Personas p
    JOIN @Divisiones d ON d.Grupo = p.Grupo
    JOIN @Comisiones c ON c.IdDivision = d.IdDivision
    WHERE p.Rol = N'alumno';

    -- Comprobaciones previas al COMMIT.
    IF (SELECT COUNT(*) FROM dbo.Materia WHERE IdCarrera = @IdCarrera) <> 10
       OR (SELECT COUNT(*) FROM @Comisiones) <> 20
       OR (
           SELECT COUNT(*)
           FROM dbo.Docente d
           JOIN @Personas p
             ON p.Rol = N'docente' AND p.IdInstitucional = d.Legajo
       ) <> 10
       OR (
           SELECT COUNT(*)
           FROM dbo.Alumno a
           JOIN @Personas p
             ON p.Rol = N'alumno' AND p.IdInstitucional = a.Matricula
       ) <> 20
       OR (
           SELECT COUNT(*)
           FROM dbo.Usuario u
           JOIN @Personas p ON p.Email = u.Email
           WHERE u.Activo = 1
             AND u.Rol = p.Rol
             AND (
                 (p.Rol = N'docente'
                  AND u.IdDocente = p.IdInstitucional AND u.IdAlumno IS NULL)
                 OR
                 (p.Rol = N'alumno'
                  AND u.IdAlumno = p.IdInstitucional AND u.IdDocente IS NULL)
             )
       ) <> 30
        THROW 51004, N'Falló la comprobación de entidades o cuentas.', 1;

    IF EXISTS (
        SELECT p.IdInstitucional
        FROM @Personas p
        LEFT JOIN dbo.MateriaDivision md
          ON md.IdDocente = p.IdInstitucional
        WHERE p.Rol = N'docente'
        GROUP BY p.IdInstitucional
        HAVING COUNT(md.Id) <> 2
            OR COUNT(DISTINCT md.IdMateria) <> 2
    )
        THROW 51005, N'Un docente no tiene exactamente dos materias diferentes.', 1;

    IF EXISTS (
        SELECT p.IdInstitucional
        FROM @Personas p
        LEFT JOIN dbo.InscripcionMateria i
          ON i.IdAlumno = p.IdInstitucional
        LEFT JOIN dbo.MateriaDivision md ON md.Id = i.IdMateriaDivision
        WHERE p.Rol = N'alumno'
        GROUP BY p.IdInstitucional
        HAVING COUNT(i.IdMateriaDivision) <> 10
            OR COUNT(DISTINCT md.IdMateria) <> 10
    )
        THROW 51006, N'Un alumno no tiene exactamente diez materias diferentes.', 1;

    IF EXISTS (
        SELECT 1
        FROM @Personas p
        JOIN dbo.InscripcionMateria i ON i.IdAlumno = p.IdInstitucional
        JOIN dbo.MateriaDivision md ON md.Id = i.IdMateriaDivision
        JOIN dbo.Materia m ON m.Id = md.IdMateria
        JOIN @Divisiones d ON d.Grupo = p.Grupo
        WHERE p.Rol = N'alumno'
          AND (md.IdDivision <> d.IdDivision OR m.IdCarrera <> @IdCarrera)
    )
        THROW 51007, N'Una inscripción pertenece a otra división o carrera.', 1;

    IF (
        SELECT COUNT(*)
        FROM dbo.InscripcionMateria i
        JOIN @Comisiones c ON c.IdMateriaDivision = i.IdMateriaDivision
    ) <> 200
        THROW 51008, N'El total de inscripciones no es 200.', 1;

    IF EXISTS (
        SELECT c.IdMateriaDivision
        FROM @Comisiones c
        LEFT JOIN dbo.InscripcionMateria i
          ON i.IdMateriaDivision = c.IdMateriaDivision
        GROUP BY c.IdMateriaDivision
        HAVING COUNT(i.IdAlumno) <> 10
    )
        THROW 51009, N'Una comisión no tiene exactamente diez alumnos.', 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;

-- ============================================================
-- VALIDACIÓN
-- Estos SELECT no modifican datos.
-- Mantenerlos en el mismo bloque para conservar las variables.
-- ============================================================

-- 1, 2, 3, 4, 6 y 10: totales persistidos.
-- Actual debe coincidir con Esperado en todas las filas.
SELECT N'1. Carrera nueva' AS Comprobacion, 1 AS Esperado,
       COUNT(*) AS Actual
FROM dbo.Carrera
WHERE Nombre = @NombreCarrera

UNION ALL
SELECT N'2. Materias de la carrera', 10, COUNT(*)
FROM dbo.Materia
WHERE IdCarrera = @IdCarrera

UNION ALL
SELECT N'3. Comisiones de la carrera', 20, COUNT(*)
FROM dbo.MateriaDivision md
JOIN dbo.Materia m ON m.Id = md.IdMateria
WHERE m.IdCarrera = @IdCarrera

UNION ALL
SELECT N'4. Docentes nuevos', 10, COUNT(*)
FROM dbo.Docente d
JOIN @Personas p
  ON p.Rol = N'docente' AND p.IdInstitucional = d.Legajo

UNION ALL
SELECT N'6. Alumnos nuevos', 20, COUNT(*)
FROM dbo.Alumno a
JOIN @Personas p
  ON p.Rol = N'alumno' AND p.IdInstitucional = a.Matricula

UNION ALL
SELECT N'10. Inscripciones de la carrera', 200, COUNT(*)
FROM dbo.InscripcionMateria i
JOIN dbo.MateriaDivision md ON md.Id = i.IdMateriaDivision
JOIN dbo.Materia m ON m.Id = md.IdMateria
WHERE m.IdCarrera = @IdCarrera;

-- 5: diez filas; cada una con 2 comisiones y 2 materias distintas.
-- Se cuentan TODAS las comisiones del docente.
SELECT
    p.Numero AS NumeroDocente,
    d.Legajo,
    d.Nombre,
    d.Apellido,
    COUNT(md.Id) AS Comisiones,
    COUNT(DISTINCT md.IdMateria) AS MateriasDistintas,
    CASE WHEN COUNT(md.Id) = 2 AND COUNT(DISTINCT md.IdMateria) = 2
         THEN N'OK' ELSE N'ERROR' END AS Resultado
FROM @Personas p
JOIN dbo.Docente d ON d.Legajo = p.IdInstitucional
LEFT JOIN dbo.MateriaDivision md ON md.IdDocente = d.Legajo
WHERE p.Rol = N'docente'
GROUP BY p.Numero, d.Legajo, d.Nombre, d.Apellido
ORDER BY p.Numero;

-- 7, 8 y 9: veinte filas ordenadas por número de alumno.
-- Esperado: 10 inscripciones, 10 materias distintas,
-- 10 inscripciones correctas y 0 fuera del grupo/carrera.
-- Se cuentan TODAS las inscripciones de cada alumno.
SELECT
    p.Numero AS NumeroAlumno,
    a.Matricula,
    u.Email,
    p.Grupo AS GrupoEsperado,
    d.Descripcion AS DivisionEsperada,
    COUNT(i.IdMateriaDivision) AS Inscripciones,
    COUNT(DISTINCT md.IdMateria) AS MateriasDistintas,
    SUM(CASE
        WHEN md.IdDivision = d.IdDivision AND m.IdCarrera = @IdCarrera
        THEN 1 ELSE 0
    END) AS InscripcionesCorrectas,
    SUM(CASE
        WHEN i.IdMateriaDivision IS NOT NULL
         AND (md.IdDivision <> d.IdDivision OR m.IdCarrera <> @IdCarrera)
        THEN 1 ELSE 0
    END) AS FueraDelGrupoOCarrera
FROM @Personas p
JOIN dbo.Alumno a ON a.Matricula = p.IdInstitucional
JOIN dbo.Usuario u ON u.IdAlumno = a.Matricula AND u.Email = p.Email
JOIN @Divisiones d ON d.Grupo = p.Grupo
LEFT JOIN dbo.InscripcionMateria i ON i.IdAlumno = a.Matricula
LEFT JOIN dbo.MateriaDivision md ON md.Id = i.IdMateriaDivision
LEFT JOIN dbo.Materia m ON m.Id = md.IdMateria
WHERE p.Rol = N'alumno'
GROUP BY
    p.Numero, a.Matricula, u.Email, p.Grupo,
    d.Descripcion, d.IdDivision
ORDER BY p.Numero;

-- 11: veinte filas, todas con 10 alumnos.
SELECT
    md.Id AS IdComision,
    m.Nombre AS Materia,
    d.Descripcion AS Division,
    md.IdDocente,
    COUNT(i.IdAlumno) AS Alumnos,
    CASE WHEN COUNT(i.IdAlumno) = 10
         THEN N'OK' ELSE N'ERROR' END AS Resultado
FROM dbo.MateriaDivision md
JOIN dbo.Materia m ON m.Id = md.IdMateria
JOIN dbo.Division d ON d.Id = md.IdDivision
LEFT JOIN dbo.InscripcionMateria i ON i.IdMateriaDivision = md.Id
WHERE m.IdCarrera = @IdCarrera
GROUP BY md.Id, m.Nombre, d.Descripcion, md.IdDocente
ORDER BY m.Nombre, d.Descripcion;

-- Control adicional: debe devolver CERO filas.
-- Ningún alumno de la carga aparece dos veces en una misma materia.
SELECT
    i.IdAlumno,
    md.IdMateria,
    COUNT(*) AS InscripcionesEnLaMismaMateria
FROM dbo.InscripcionMateria i
JOIN dbo.MateriaDivision md ON md.Id = i.IdMateriaDivision
JOIN @Personas p
  ON p.Rol = N'alumno' AND p.IdInstitucional = i.IdAlumno
GROUP BY i.IdAlumno, md.IdMateria
HAVING COUNT(*) > 1;

-- Listado de las 30 cuentas, sin exponer hashes.
-- Contraseña común: Cervantes2026.
SELECT
    p.Rol,
    p.Numero,
    p.Nombre,
    p.Apellido,
    p.Grupo,
    p.IdInstitucional,
    u.Email,
    u.Activo,
    u.FechaCreacion
FROM @Personas p
JOIN dbo.Usuario u ON u.Email = p.Email
ORDER BY p.Orden;