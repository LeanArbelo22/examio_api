-- Ejecutar manualmente en la base de Examio, después de la migración del banco.
-- Copia todos los grupos, preguntas y opciones; no modifica la evaluación.
-- La etiqueta de importación impide repetir este lote mientras se conserve.
-- No detecta copias anteriores realizadas sin etiqueta ni procedencia registrada.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @IdDocente INT = 108991, @IdPublicacion INT = 50;
DECLARE @IdActividad INT, @IdEtiqueta INT, @Etiqueta NVARCHAR(50);
DECLARE @IdOrigen INT, @IdNuevo INT;

IF @@TRANCOUNT <> 0
    THROW 51200, N'Ejecutar fuera de otra transacción.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    IF (SELECT COUNT(*) FROM sys.tables
        WHERE schema_id = SCHEMA_ID(N'dbo') AND name IN
        (N'BancoPregunta', N'BancoOpcion', N'BancoGrupo', N'BancoGrupoPregunta',
         N'BancoEtiqueta', N'BancoPreguntaEtiqueta', N'BancoGrupoEtiqueta')) <> 7
        THROW 51201, N'Primero aplicar la migración del banco de preguntas.', 1;

    SELECT @IdActividad = IdActividad
    FROM dbo.Publicacion WHERE Id = @IdPublicacion;
    IF @IdActividad IS NULL
        THROW 51202, N'No existe la publicación 50.', 1;

    -- Mismo orden de bloqueo que la copia desde evaluación del backend.
    IF NOT EXISTS (SELECT 1 FROM dbo.Actividad WITH (UPDLOCK, HOLDLOCK)
                   WHERE Id = @IdActividad)
        THROW 51203, N'No existe la actividad de la publicación.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Docente WITH (UPDLOCK, HOLDLOCK)
                   WHERE Legajo = @IdDocente AND Estado = 1)
        THROW 51204, N'El docente no existe o no está activo.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Publicacion WITH (HOLDLOCK)
                   WHERE Id = @IdPublicacion AND IdActividad = @IdActividad)
        THROW 51205, N'La publicación cambió; volver a consultar.', 1;

    -- La actividad puede tener varias publicaciones: todas deben ser del docente.
    IF EXISTS (
        SELECT 1 FROM dbo.Publicacion AS P WITH (HOLDLOCK)
        LEFT JOIN dbo.MateriaDivision AS MD WITH (HOLDLOCK)
            ON MD.Id = P.IdMateriaDivision
        WHERE P.IdActividad = @IdActividad
          AND (MD.IdDocente IS NULL OR MD.IdDocente <> @IdDocente)
    )
        THROW 51206, N'La actividad tiene publicaciones en comisiones ajenas al docente.', 1;

    SET @Etiqueta = N'Importacion actividad ' + CONVERT(NVARCHAR(11), @IdActividad);
    IF EXISTS (SELECT 1 FROM dbo.BancoEtiqueta WITH (UPDLOCK, HOLDLOCK)
               WHERE IdDocente = @IdDocente
                 AND NombreNormalizado = LOWER(@Etiqueta) COLLATE Latin1_General_100_CI_AS)
        THROW 51207, N'Esta actividad ya tiene una importación registrada. No se insertó nada.', 1;

    DECLARE @Grupos TABLE (
        IdOrigen INT PRIMARY KEY, Titulo NVARCHAR(MAX),
        IdBancoOrigen INT NULL, IdNuevo INT NULL
    );
    DECLARE @Preguntas TABLE (
        IdOrigen INT PRIMARY KEY, IdGrupo INT NOT NULL,
        Enunciado NVARCHAR(MAX), Tipo NVARCHAR(25),
        Posicion INT NOT NULL, IdBancoOrigen INT NULL, IdNuevo INT NULL
    );
    DECLARE @Opciones TABLE (
        IdOrigen INT PRIMARY KEY, IdPregunta INT NOT NULL,
        Texto NVARCHAR(MAX), EsCorrecta BIT, Posicion INT NOT NULL
    );

    INSERT INTO @Grupos (IdOrigen, Titulo, IdBancoOrigen)
    SELECT Id,
           COALESCE(NULLIF(LTRIM(RTRIM(TituloReferencia)), N''),
                    N'Grupo ' + CONVERT(NVARCHAR(11), Id)),
           IdBancoGrupoOrigen
    FROM dbo.GrupoPregunta WITH (HOLDLOCK)
    WHERE IdActividad = @IdActividad;

    IF NOT EXISTS (SELECT 1 FROM @Grupos)
        THROW 51208, N'La actividad no contiene grupos para importar.', 1;

    INSERT INTO @Preguntas (IdOrigen, IdGrupo, Enunciado, Tipo, Posicion, IdBancoOrigen)
    SELECT P.Id, P.IdGrupoPregunta, COALESCE(P.Enunciado, N''), P.Tipo,
           CONVERT(INT, ROW_NUMBER() OVER (PARTITION BY P.IdGrupoPregunta ORDER BY P.Id)),
           P.IdBancoPreguntaOrigen
    FROM dbo.Pregunta AS P WITH (HOLDLOCK)
    INNER JOIN @Grupos AS G ON G.IdOrigen = P.IdGrupoPregunta;

    INSERT INTO @Opciones (IdOrigen, IdPregunta, Texto, EsCorrecta, Posicion)
    SELECT O.Id, O.IdPregunta, O.Texto, O.EsCorrecta,
           CONVERT(INT, ROW_NUMBER() OVER (PARTITION BY O.IdPregunta ORDER BY O.Id))
    FROM dbo.Opcion AS O WITH (HOLDLOCK)
    INNER JOIN @Preguntas AS P ON P.IdOrigen = O.IdPregunta;

    IF EXISTS (SELECT 1 FROM @Grupos WHERE IdBancoOrigen IS NOT NULL)
       OR EXISTS (SELECT 1 FROM @Preguntas WHERE IdBancoOrigen IS NOT NULL)
        THROW 51209, N'Hay contenido vinculado al banco. Revisar esos orígenes antes de copiar para no duplicarlos.', 1;

    -- Límites compatibles con los formularios y validaciones actuales de la API.
    IF EXISTS (SELECT 1 FROM @Grupos WHERE DATALENGTH(Titulo) > 300)
       OR EXISTS (SELECT 1 FROM @Preguntas
                  WHERE Tipo IS NULL OR Tipo NOT IN (N'mc', N'vf', N'abierta', N'code')
                     OR DATALENGTH(Enunciado) > 200000 OR Posicion > 200)
       OR EXISTS (SELECT 1 FROM @Opciones
                  WHERE Texto IS NULL OR DATALENGTH(Texto) > 1000
                     OR EsCorrecta IS NULL OR Posicion > 100)
        THROW 51210, N'El contenido supera los límites del banco o tiene valores inválidos. No se truncaron datos.', 1;

    INSERT INTO dbo.BancoEtiqueta (IdDocente, Nombre)
    VALUES (@IdDocente, @Etiqueta);
    SET @IdEtiqueta = CONVERT(INT, SCOPE_IDENTITY());

    WHILE EXISTS (SELECT 1 FROM @Grupos WHERE IdNuevo IS NULL)
    BEGIN
        SELECT TOP (1) @IdOrigen = IdOrigen
        FROM @Grupos WHERE IdNuevo IS NULL ORDER BY IdOrigen;

        INSERT INTO dbo.BancoGrupo (IdDocente, TituloReferencia, Estado, Revision)
        SELECT @IdDocente, Titulo, N'borrador', 1
        FROM @Grupos WHERE IdOrigen = @IdOrigen;
        SET @IdNuevo = CONVERT(INT, SCOPE_IDENTITY());
        UPDATE @Grupos SET IdNuevo = @IdNuevo WHERE IdOrigen = @IdOrigen;
    END;

    WHILE EXISTS (SELECT 1 FROM @Preguntas WHERE IdNuevo IS NULL)
    BEGIN
        SELECT TOP (1) @IdOrigen = IdOrigen
        FROM @Preguntas WHERE IdNuevo IS NULL ORDER BY IdOrigen;

        INSERT INTO dbo.BancoPregunta (IdDocente, Titulo, Enunciado, Tipo, Estado, Revision)
        SELECT @IdDocente, G.Titulo, P.Enunciado, P.Tipo, N'borrador', 1
        FROM @Preguntas AS P INNER JOIN @Grupos AS G ON G.IdOrigen = P.IdGrupo
        WHERE P.IdOrigen = @IdOrigen;
        SET @IdNuevo = CONVERT(INT, SCOPE_IDENTITY());
        UPDATE @Preguntas SET IdNuevo = @IdNuevo WHERE IdOrigen = @IdOrigen;
    END;

    INSERT INTO dbo.BancoOpcion (IdPregunta, Texto, EsCorrecta, Posicion)
    SELECT P.IdNuevo, O.Texto, O.EsCorrecta, O.Posicion
    FROM @Opciones AS O INNER JOIN @Preguntas AS P ON P.IdOrigen = O.IdPregunta;

    INSERT INTO dbo.BancoGrupoPregunta (IdGrupo, IdPregunta, IdDocente, Posicion)
    SELECT G.IdNuevo, P.IdNuevo, @IdDocente, P.Posicion
    FROM @Preguntas AS P INNER JOIN @Grupos AS G ON G.IdOrigen = P.IdGrupo;

    INSERT INTO dbo.BancoGrupoEtiqueta (IdGrupo, IdEtiqueta, IdDocente)
    SELECT IdNuevo, @IdEtiqueta, @IdDocente FROM @Grupos;
    INSERT INTO dbo.BancoPreguntaEtiqueta (IdPregunta, IdEtiqueta, IdDocente)
    SELECT IdNuevo, @IdEtiqueta, @IdDocente FROM @Preguntas;

    -- Las fechas UTC usan los DEFAULT SYSUTCDATETIME() del esquema real.
    COMMIT TRANSACTION;

    SELECT @IdDocente AS IdDocente, @IdPublicacion AS IdPublicacion,
           @IdActividad AS IdActividad, @Etiqueta AS EtiquetaImportacion,
           (SELECT COUNT(*) FROM @Grupos) AS GruposCreados,
           (SELECT COUNT(*) FROM @Preguntas) AS PreguntasCreadas,
           (SELECT COUNT(*) FROM @Opciones) AS OpcionesCreadas;

    SELECT G.IdOrigen AS IdGrupoEvaluacion, G.IdNuevo AS IdBancoGrupo,
           G.Titulo AS Grupo, P.IdOrigen AS IdPreguntaEvaluacion,
           P.IdNuevo AS IdBancoPregunta, P.Posicion
    FROM @Grupos AS G LEFT JOIN @Preguntas AS P ON P.IdGrupo = G.IdOrigen
    ORDER BY G.IdOrigen, P.Posicion;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
