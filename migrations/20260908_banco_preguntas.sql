-- Banco privado de preguntas. Ejecutar manualmente en la base destino.
-- No modifica SPs ni migra contenido anterior. Sin GO; transacción única.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
IF @@TRANCOUNT <> 0 THROW 51100, N'Ejecutar fuera de otra transacción.', 1;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'dbo.Docente',N'U') IS NULL OR OBJECT_ID(N'dbo.Pregunta',N'U') IS NULL
    OR OBJECT_ID(N'dbo.GrupoPregunta',N'U') IS NULL
    THROW 51101, N'Falta el esquema académico de Examio.', 1;

 DECLARE @Existentes INT = (SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo')
   AND name IN ('BancoPregunta','BancoOpcion','BancoGrupo','BancoGrupoPregunta','BancoEtiqueta','BancoPreguntaEtiqueta','BancoGrupoEtiqueta'));
 IF @Existentes NOT IN (0,7) THROW 51102, N'El banco tiene una migración parcial; revisar antes de continuar.', 1;

 IF @Existentes=0
 BEGIN
 CREATE TABLE dbo.BancoPregunta (
 Id INT IDENTITY PRIMARY KEY, IdDocente INT NOT NULL REFERENCES dbo.Docente(Legajo),
 Titulo NVARCHAR(150) NOT NULL, Enunciado NVARCHAR(MAX) NOT NULL DEFAULT N'',
 Tipo NVARCHAR(25) NOT NULL CHECK (Tipo IN ('mc','vf','abierta','code')),
 Estado NVARCHAR(10) NOT NULL DEFAULT N'borrador' CHECK (Estado IN ('borrador','disponible','archivado')),
 Revision INT NOT NULL DEFAULT 1 CHECK (Revision>0),
 FechaCreacion DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 FechaActualizacion DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT UQ_BancoPregunta_Propietario UNIQUE (Id,IdDocente));
 CREATE INDEX IX_BancoPregunta_Busqueda ON dbo.BancoPregunta(IdDocente,Estado,FechaActualizacion DESC,Id);
 CREATE TABLE dbo.BancoGrupo (
 Id INT IDENTITY PRIMARY KEY, IdDocente INT NOT NULL REFERENCES dbo.Docente(Legajo),
 TituloReferencia NVARCHAR(150) NOT NULL, 
 Estado NVARCHAR(10) NOT NULL DEFAULT N'borrador' CHECK (Estado IN ('borrador','disponible','archivado')),
 Revision INT NOT NULL DEFAULT 1 CHECK (Revision>0),
 FechaCreacion DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 FechaActualizacion DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT UQ_BancoGrupo_Propietario UNIQUE (Id,IdDocente));
 CREATE INDEX IX_BancoGrupo_Busqueda ON dbo.BancoGrupo(IdDocente,Estado,FechaActualizacion DESC,Id);
 CREATE INDEX IX_BancoPregunta_Tipo ON dbo.BancoPregunta(IdDocente,Tipo);
 CREATE TABLE dbo.BancoOpcion (
 Id INT IDENTITY PRIMARY KEY, IdPregunta INT NOT NULL REFERENCES dbo.BancoPregunta(Id),
 Texto NVARCHAR(500) NOT NULL, EsCorrecta BIT NOT NULL,
 Posicion INT NOT NULL CHECK(Posicion>0), UNIQUE(IdPregunta,Posicion));
 CREATE TABLE dbo.BancoGrupoPregunta (
 IdGrupo INT NOT NULL, IdPregunta INT NOT NULL, IdDocente INT NOT NULL,
 Posicion INT NOT NULL CHECK(Posicion>0),
 PRIMARY KEY(IdGrupo,IdPregunta), UNIQUE(IdGrupo,Posicion),
 FOREIGN KEY(IdGrupo,IdDocente) REFERENCES dbo.BancoGrupo(Id,IdDocente),
 FOREIGN KEY(IdPregunta,IdDocente) REFERENCES dbo.BancoPregunta(Id,IdDocente));
 CREATE INDEX IX_BancoGrupoPregunta_Pregunta ON dbo.BancoGrupoPregunta(IdPregunta,IdGrupo);
 CREATE TABLE dbo.BancoEtiqueta (
 Id INT IDENTITY PRIMARY KEY, IdDocente INT NOT NULL REFERENCES dbo.Docente(Legajo),
 Nombre NVARCHAR(50) NOT NULL CHECK(LEN(LTRIM(RTRIM(Nombre)))>0),
 NombreNormalizado AS (LOWER(LTRIM(RTRIM(Nombre))) COLLATE Latin1_General_100_CI_AS) PERSISTED,
 FechaCreacion DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 FechaActualizacion DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 UNIQUE(Id,IdDocente), UNIQUE(IdDocente,NombreNormalizado));
 CREATE TABLE dbo.BancoPreguntaEtiqueta (
 IdPregunta INT NOT NULL, IdEtiqueta INT NOT NULL, IdDocente INT NOT NULL,
 PRIMARY KEY(IdPregunta,IdEtiqueta),
 FOREIGN KEY(IdPregunta,IdDocente) REFERENCES dbo.BancoPregunta(Id,IdDocente),
 FOREIGN KEY(IdEtiqueta,IdDocente) REFERENCES dbo.BancoEtiqueta(Id,IdDocente));
 CREATE INDEX IX_BancoPreguntaEtiqueta_Etiqueta ON dbo.BancoPreguntaEtiqueta(IdEtiqueta,IdPregunta);
 CREATE TABLE dbo.BancoGrupoEtiqueta (
 IdGrupo INT NOT NULL, IdEtiqueta INT NOT NULL, IdDocente INT NOT NULL,
 PRIMARY KEY(IdGrupo,IdEtiqueta),
 FOREIGN KEY(IdGrupo,IdDocente) REFERENCES dbo.BancoGrupo(Id,IdDocente),
 FOREIGN KEY(IdEtiqueta,IdDocente) REFERENCES dbo.BancoEtiqueta(Id,IdDocente));
 CREATE INDEX IX_BancoGrupoEtiqueta_Etiqueta ON dbo.BancoGrupoEtiqueta(IdEtiqueta,IdGrupo);
 END;
 -- Validar las columnas/tipos mínimos también al repetir la migración.
 DECLARE @Columnas TABLE(Tabla SYSNAME, Columna SYSNAME, Tipo SYSNAME, Longitud SMALLINT, Nulo BIT);
 INSERT INTO @Columnas VALUES
('BancoPregunta','Id','int',4,0),
('BancoPregunta','IdDocente','int',4,0),
('BancoPregunta','Titulo','nvarchar',300,0),
('BancoPregunta','Estado','nvarchar',20,0),
('BancoPregunta','Revision','int',4,0),
('BancoPregunta','FechaCreacion','datetime2',7,0),
('BancoPregunta','FechaActualizacion','datetime2',7,0),
('BancoGrupo','Id','int',4,0),
('BancoGrupo','IdDocente','int',4,0),
('BancoGrupo','TituloReferencia','nvarchar',300,0),
('BancoGrupo','Estado','nvarchar',20,0),
('BancoGrupo','Revision','int',4,0),
('BancoGrupo','FechaCreacion','datetime2',7,0),
('BancoGrupo','FechaActualizacion','datetime2',7,0),
('BancoPregunta','Enunciado','nvarchar',-1,0),
('BancoPregunta','Tipo','nvarchar',50,0),
('BancoOpcion','Id','int',4,0),
('BancoOpcion','IdPregunta','int',4,0),
('BancoOpcion','Texto','nvarchar',1000,0),
('BancoOpcion','EsCorrecta','bit',1,0),
('BancoOpcion','Posicion','int',4,0),
('BancoGrupoPregunta','IdGrupo','int',4,0),
('BancoGrupoPregunta','IdPregunta','int',4,0),
('BancoGrupoPregunta','IdDocente','int',4,0),
('BancoGrupoPregunta','Posicion','int',4,0),
('BancoEtiqueta','Id','int',4,0),
('BancoEtiqueta','IdDocente','int',4,0),
('BancoEtiqueta','Nombre','nvarchar',100,0),
('BancoEtiqueta','FechaCreacion','datetime2',7,0),
('BancoEtiqueta','FechaActualizacion','datetime2',7,0),
('BancoPreguntaEtiqueta','IdPregunta','int',4,0),
('BancoPreguntaEtiqueta','IdEtiqueta','int',4,0),
('BancoPreguntaEtiqueta','IdDocente','int',4,0),
('BancoGrupoEtiqueta','IdGrupo','int',4,0),
('BancoGrupoEtiqueta','IdEtiqueta','int',4,0),
('BancoGrupoEtiqueta','IdDocente','int',4,0);
 IF EXISTS (SELECT 1 FROM @Columnas e LEFT JOIN sys.columns c ON c.object_id=OBJECT_ID(N'dbo.'+e.Tabla) AND c.name=e.Columna
 WHERE c.column_id IS NULL OR TYPE_NAME(c.user_type_id)<>e.Tipo
 OR (e.Tipo<>'datetime2' AND c.max_length<>e.Longitud)
 OR (e.Tipo='datetime2' AND c.scale<>3) OR c.is_nullable<>e.Nulo)
 THROW 51103, N'Columnas del banco incompatibles.',1;
 IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id IN
 (SELECT OBJECT_ID(N'dbo.'+Tabla) FROM @Columnas) AND (is_disabled=1 OR is_not_trusted=1))
 THROW 51104, N'Hay claves foráneas deshabilitadas o no confiables.',1;
 IF (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id IN (SELECT OBJECT_ID(N'dbo.'+Tabla) FROM @Columnas))<>10
 OR (SELECT COUNT(*) FROM sys.key_constraints WHERE type='PK' AND parent_object_id IN (SELECT OBJECT_ID(N'dbo.'+Tabla) FROM @Columnas))<>7
 OR (SELECT COUNT(*) FROM sys.key_constraints WHERE type='UQ' AND parent_object_id IN (SELECT OBJECT_ID(N'dbo.'+Tabla) FROM @Columnas))<>6
 OR (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id IN (SELECT OBJECT_ID(N'dbo.'+Tabla) FROM @Columnas))<>8
 OR EXISTS(SELECT 1 FROM sys.check_constraints WHERE (is_disabled=1 OR is_not_trusted=1)
 AND parent_object_id IN (SELECT OBJECT_ID(N'dbo.'+Tabla) FROM @Columnas))
 THROW 51106, N'Restricciones del banco incompatibles; inspeccionar el DDL.',1;
 IF EXISTS(SELECT 1 FROM sys.columns c JOIN @Columnas e ON c.object_id=OBJECT_ID(N'dbo.'+e.Tabla) AND c.name=e.Columna
 WHERE e.Columna='Id' AND c.is_identity<>1)
 OR NOT EXISTS(SELECT 1 FROM sys.computed_columns WHERE object_id=OBJECT_ID(N'dbo.BancoEtiqueta') AND name='NombreNormalizado' AND is_persisted=1)
 THROW 51107, N'Identidades o normalización incompatibles.',1;
 -- Verificar destinos y columnas de todas las relaciones del banco.
 DECLARE @FK TABLE(Tabla SYSNAME,Columna SYSNAME,Destino SYSNAME,Referencia SYSNAME);
 INSERT INTO @FK VALUES
(N'BancoPregunta',N'IdDocente',N'Docente',N'Legajo'),
(N'BancoGrupo',N'IdDocente',N'Docente',N'Legajo'),
(N'BancoEtiqueta',N'IdDocente',N'Docente',N'Legajo'),
(N'BancoOpcion',N'IdPregunta',N'BancoPregunta',N'Id'),
(N'BancoGrupoPregunta',N'IdGrupo',N'BancoGrupo',N'Id'),
(N'BancoGrupoPregunta',N'IdDocente',N'BancoGrupo',N'IdDocente'),
(N'BancoGrupoPregunta',N'IdPregunta',N'BancoPregunta',N'Id'),
(N'BancoGrupoPregunta',N'IdDocente',N'BancoPregunta',N'IdDocente'),
(N'BancoGrupoEtiqueta',N'IdGrupo',N'BancoGrupo',N'Id'),
(N'BancoGrupoEtiqueta',N'IdDocente',N'BancoGrupo',N'IdDocente'),
(N'BancoGrupoEtiqueta',N'IdEtiqueta',N'BancoEtiqueta',N'Id'),
(N'BancoGrupoEtiqueta',N'IdDocente',N'BancoEtiqueta',N'IdDocente'),
(N'BancoPreguntaEtiqueta',N'IdPregunta',N'BancoPregunta',N'Id'),
(N'BancoPreguntaEtiqueta',N'IdDocente',N'BancoPregunta',N'IdDocente'),
(N'BancoPreguntaEtiqueta',N'IdEtiqueta',N'BancoEtiqueta',N'Id'),
(N'BancoPreguntaEtiqueta',N'IdDocente',N'BancoEtiqueta',N'IdDocente');
 IF EXISTS(SELECT Tabla,Columna,Destino,Referencia FROM @FK EXCEPT
 SELECT OBJECT_NAME(f.parent_object_id),COL_NAME(f.parent_object_id,f.parent_column_id),
 OBJECT_NAME(f.referenced_object_id),COL_NAME(f.referenced_object_id,f.referenced_column_id)
 FROM sys.foreign_key_columns f WHERE f.parent_object_id IN(SELECT OBJECT_ID(N'dbo.'+Tabla) FROM @Columnas))
 THROW 51108,N'Relaciones del banco incompatibles.',1;
 IF COL_LENGTH(N'dbo.GrupoPregunta',N'IdBancoGrupoOrigen') IS NULL
 BEGIN
  ALTER TABLE dbo.GrupoPregunta ADD IdBancoGrupoOrigen INT NULL, RevisionBancoOrigen INT NULL, FechaIncorporacionBanco DATETIME2(3) NULL;
  EXEC(N'ALTER TABLE dbo.GrupoPregunta ADD CONSTRAINT FK_GrupoPregunta_BancoOrigen FOREIGN KEY(IdBancoGrupoOrigen) REFERENCES dbo.BancoGrupo(Id)');
  EXEC(N'ALTER TABLE dbo.GrupoPregunta ADD CONSTRAINT CK_GrupoPregunta_BancoOrigen CHECK (
    (IdBancoGrupoOrigen IS NULL AND RevisionBancoOrigen IS NULL AND FechaIncorporacionBanco IS NULL) OR
    (IdBancoGrupoOrigen IS NOT NULL AND RevisionBancoOrigen IS NOT NULL AND RevisionBancoOrigen>0 AND FechaIncorporacionBanco IS NOT NULL))');
 END;
 IF COL_LENGTH(N'dbo.GrupoPregunta',N'IdBancoGrupoOrigen')<>4
 OR COL_LENGTH(N'dbo.GrupoPregunta',N'RevisionBancoOrigen') IS NULL
 OR COL_LENGTH(N'dbo.GrupoPregunta',N'FechaIncorporacionBanco') IS NULL
 THROW 51105, N'Columnas de procedencia incompatibles.',1;
 IF COL_LENGTH(N'dbo.Pregunta',N'IdBancoPreguntaOrigen') IS NULL
 BEGIN
  ALTER TABLE dbo.Pregunta ADD IdBancoPreguntaOrigen INT NULL, RevisionBancoOrigen INT NULL, FechaIncorporacionBanco DATETIME2(3) NULL;
  EXEC(N'ALTER TABLE dbo.Pregunta ADD CONSTRAINT FK_Pregunta_BancoOrigen FOREIGN KEY(IdBancoPreguntaOrigen) REFERENCES dbo.BancoPregunta(Id)');
  EXEC(N'ALTER TABLE dbo.Pregunta ADD CONSTRAINT CK_Pregunta_BancoOrigen CHECK (
    (IdBancoPreguntaOrigen IS NULL AND RevisionBancoOrigen IS NULL AND FechaIncorporacionBanco IS NULL) OR
    (IdBancoPreguntaOrigen IS NOT NULL AND RevisionBancoOrigen IS NOT NULL AND RevisionBancoOrigen>0 AND FechaIncorporacionBanco IS NOT NULL))');
 END;
 IF COL_LENGTH(N'dbo.Pregunta',N'IdBancoPreguntaOrigen')<>4
 OR COL_LENGTH(N'dbo.Pregunta',N'RevisionBancoOrigen') IS NULL
 OR COL_LENGTH(N'dbo.Pregunta',N'FechaIncorporacionBanco') IS NULL
 THROW 51105, N'Columnas de procedencia incompatibles.',1;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
