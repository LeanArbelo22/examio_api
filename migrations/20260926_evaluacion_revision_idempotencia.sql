SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.Actividad', N'U') IS NULL
        THROW 51000, 'No existe dbo.Actividad; no se puede instalar la revisión optimista.', 1;

    IF COL_LENGTH(N'dbo.Actividad', N'Revision') IS NULL
    BEGIN
        ALTER TABLE dbo.Actividad ADD Revision INT NULL;
        EXEC sys.sp_executesql
            N'UPDATE dbo.Actividad SET Revision = 1 WHERE Revision IS NULL';
        ALTER TABLE dbo.Actividad ALTER COLUMN Revision INT NOT NULL;
        ALTER TABLE dbo.Actividad ADD CONSTRAINT DF_Actividad_Revision DEFAULT (1) FOR Revision;
        EXEC sys.sp_executesql
            N'ALTER TABLE dbo.Actividad
              ADD CONSTRAINT CK_Actividad_Revision_Positiva CHECK (Revision > 0)';
    END
    ELSE
    BEGIN
        IF EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID(N'dbo.Actividad') AND name = N'Revision'
              AND (system_type_id <> TYPE_ID(N'int') OR is_nullable = 1)
        )
            THROW 51001, 'dbo.Actividad.Revision existe con una definición incompatible.', 1;

        IF NOT EXISTS (
            SELECT 1 FROM sys.default_constraints dc
            JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
            WHERE dc.parent_object_id = OBJECT_ID(N'dbo.Actividad') AND c.name = N'Revision'
        )
            ALTER TABLE dbo.Actividad ADD CONSTRAINT DF_Actividad_Revision DEFAULT (1) FOR Revision;

        IF NOT EXISTS (
            SELECT 1 FROM sys.check_constraints
            WHERE parent_object_id = OBJECT_ID(N'dbo.Actividad') AND name = N'CK_Actividad_Revision_Positiva'
        )
            EXEC sys.sp_executesql
                N'ALTER TABLE dbo.Actividad WITH CHECK
                  ADD CONSTRAINT CK_Actividad_Revision_Positiva CHECK (Revision > 0)';
    END;

    IF OBJECT_ID(N'dbo.OperacionIdempotente', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.OperacionIdempotente (
            Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OperacionIdempotente PRIMARY KEY,
            Actor NVARCHAR(100) NOT NULL,
            Operacion NVARCHAR(150) NOT NULL,
            Clave UNIQUEIDENTIFIER NOT NULL,
            RequestHash CHAR(64) NOT NULL,
            Estado NVARCHAR(20) NOT NULL,
            ResultadoJson NVARCHAR(MAX) NULL,
            StatusHttp INT NULL,
            FechaCreacion DATETIME2(3) NOT NULL CONSTRAINT DF_OperacionIdempotente_FechaCreacion DEFAULT SYSUTCDATETIME(),
            FechaActualizacion DATETIME2(3) NOT NULL CONSTRAINT DF_OperacionIdempotente_FechaActualizacion DEFAULT SYSUTCDATETIME(),
            FechaExpiracion DATETIME2(3) NULL,
            CONSTRAINT UQ_OperacionIdempotente_Actor_Operacion_Clave UNIQUE (Actor, Operacion, Clave),
            CONSTRAINT CK_OperacionIdempotente_Estado CHECK (Estado IN (N'en_progreso', N'completada')),
            CONSTRAINT CK_OperacionIdempotente_Hash CHECK (LEN(RequestHash) = 64),
            CONSTRAINT CK_OperacionIdempotente_Resultado CHECK (
                (Estado = N'en_progreso' AND ResultadoJson IS NULL AND StatusHttp IS NULL) OR
                (Estado = N'completada' AND ResultadoJson IS NOT NULL AND StatusHttp BETWEEN 200 AND 299)
            )
        );
        CREATE INDEX IX_OperacionIdempotente_Expiracion
            ON dbo.OperacionIdempotente (FechaExpiracion, Estado) INCLUDE (FechaActualizacion);
    END
    ELSE
    BEGIN
        IF COL_LENGTH(N'dbo.OperacionIdempotente', N'Actor') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'Operacion') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'Clave') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'RequestHash') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'Estado') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'ResultadoJson') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'StatusHttp') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'FechaCreacion') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'FechaActualizacion') IS NULL
           OR COL_LENGTH(N'dbo.OperacionIdempotente', N'FechaExpiracion') IS NULL
            THROW 51002, 'dbo.OperacionIdempotente existe pero está incompleta.', 1;

        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE object_id = OBJECT_ID(N'dbo.OperacionIdempotente')
              AND name = N'UQ_OperacionIdempotente_Actor_Operacion_Clave' AND is_unique = 1
        )
            THROW 51003, 'dbo.OperacionIdempotente no posee la unicidad requerida.', 1;

        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE object_id = OBJECT_ID(N'dbo.OperacionIdempotente')
              AND name = N'IX_OperacionIdempotente_Expiracion'
        )
            CREATE INDEX IX_OperacionIdempotente_Expiracion
                ON dbo.OperacionIdempotente (FechaExpiracion, Estado) INCLUDE (FechaActualizacion);
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
