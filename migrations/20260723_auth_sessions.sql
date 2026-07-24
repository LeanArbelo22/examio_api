SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.AuthSession', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuthSession
    (
        Id UNIQUEIDENTIFIER NOT NULL,
        IdUsuario INT NOT NULL,
        FechaCreacion DATETIME2(3) NOT NULL,
        FechaExpiracion DATETIME2(3) NOT NULL,
        UltimaActividad DATETIME2(3) NOT NULL,
        FechaRevocacion DATETIME2(3) NULL,
        MotivoRevocacion NVARCHAR(50) NULL,
        CONSTRAINT PK_AuthSession PRIMARY KEY (Id),
        CONSTRAINT FK_AuthSession_Usuario FOREIGN KEY (IdUsuario) REFERENCES dbo.Usuario(Id),
        CONSTRAINT CHK_AuthSession_Expiracion CHECK (FechaExpiracion > FechaCreacion),
        CONSTRAINT CHK_AuthSession_Revocacion CHECK (FechaRevocacion IS NULL OR FechaRevocacion >= FechaCreacion)
    );
END;

IF OBJECT_ID(N'dbo.AuthRefreshToken', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuthRefreshToken
    (
        Id UNIQUEIDENTIFIER NOT NULL,
        IdSesion UNIQUEIDENTIFIER NOT NULL,
        TokenHash BINARY(32) NOT NULL,
        FechaEmision DATETIME2(3) NOT NULL,
        FechaExpiracion DATETIME2(3) NOT NULL,
        AccessTokenExpiraEn DATETIME2(3) NOT NULL,
        FechaConsumo DATETIME2(3) NULL,
        ReemplazadoPor UNIQUEIDENTIFIER NULL,
        IdempotencyKey UNIQUEIDENTIFIER NULL,
        ClaimsJson NVARCHAR(1000) NOT NULL,
        CONSTRAINT PK_AuthRefreshToken PRIMARY KEY (Id),
        CONSTRAINT FK_AuthRefreshToken_AuthSession FOREIGN KEY (IdSesion) REFERENCES dbo.AuthSession(Id),
        CONSTRAINT FK_AuthRefreshToken_Reemplazo FOREIGN KEY (ReemplazadoPor) REFERENCES dbo.AuthRefreshToken(Id),
        CONSTRAINT UQ_AuthRefreshToken_TokenHash UNIQUE (TokenHash),
        CONSTRAINT CHK_AuthRefreshToken_Expiracion CHECK (FechaExpiracion > FechaEmision),
        CONSTRAINT CHK_AuthRefreshToken_AccessExpiracion CHECK
            (AccessTokenExpiraEn > FechaEmision AND AccessTokenExpiraEn <= FechaExpiracion),
        CONSTRAINT CHK_AuthRefreshToken_Rotacion CHECK
            (
                (FechaConsumo IS NULL AND ReemplazadoPor IS NULL AND IdempotencyKey IS NULL)
                OR
                (FechaConsumo IS NOT NULL AND ReemplazadoPor IS NOT NULL AND IdempotencyKey IS NOT NULL)
            )
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AuthSession_Usuario_Estado' AND object_id = OBJECT_ID(N'dbo.AuthSession')
)
BEGIN
    CREATE INDEX IX_AuthSession_Usuario_Estado
        ON dbo.AuthSession (IdUsuario, FechaRevocacion, FechaExpiracion);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AuthRefreshToken_Sesion' AND object_id = OBJECT_ID(N'dbo.AuthRefreshToken')
)
BEGIN
    CREATE INDEX IX_AuthRefreshToken_Sesion
        ON dbo.AuthRefreshToken (IdSesion, FechaExpiracion)
        INCLUDE (FechaConsumo, ReemplazadoPor);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_AuthRefreshToken_Sesion_IdempotencyKey' AND object_id = OBJECT_ID(N'dbo.AuthRefreshToken')
)
BEGIN
    CREATE UNIQUE INDEX UX_AuthRefreshToken_Sesion_IdempotencyKey
        ON dbo.AuthRefreshToken (IdSesion, IdempotencyKey)
        WHERE IdempotencyKey IS NOT NULL;
END;

COMMIT TRANSACTION;
