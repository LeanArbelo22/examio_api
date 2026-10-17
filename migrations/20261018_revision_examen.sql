/*
  Etapa 5: políticas, permisos y sesiones auditadas de revisión.
  Ejecutar manualmente después de 20261017_indices_rendimiento_preguntas.sql.

  Backfill compatible: al_corregir + libre. No modifica notas, respuestas ni intentos.
  Las referencias posteriores a objetos creados se ejecutan con SQL dinámico para evitar
  compilación anticipada contra un esquema anterior.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.PoliticaRevisionPublicacion', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.PoliticaRevisionPublicacion (
      IdPublicacion INT NOT NULL CONSTRAINT PK_PoliticaRevisionPublicacion PRIMARY KEY,
      Modo VARCHAR(20) NOT NULL CONSTRAINT DF_PoliticaRevision_Modo DEFAULT ''al_corregir'',
      Acceso VARCHAR(10) NOT NULL CONSTRAINT DF_PoliticaRevision_Acceso DEFAULT ''libre'',
      VentanaDesde DATETIME2(3) NULL,
      VentanaHasta DATETIME2(3) NULL,
      Revision INT NOT NULL CONSTRAINT DF_PoliticaRevision_Revision DEFAULT 1,
      ModificadoPor INT NULL,
      FechaModificacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_PoliticaRevision_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_PoliticaRevision_Publicacion FOREIGN KEY (IdPublicacion) REFERENCES dbo.Publicacion(Id),
      CONSTRAINT FK_PoliticaRevision_Usuario FOREIGN KEY (ModificadoPor) REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_PoliticaRevision_Modo CHECK (Modo IN (''nunca'',''al_corregir'',''ventana'',''manual'')),
      CONSTRAINT CHK_PoliticaRevision_Acceso CHECK (Acceso IN (''unico'',''libre'')),
      CONSTRAINT CHK_PoliticaRevision_Ventana CHECK (
        (Modo=''ventana'' AND VentanaDesde IS NOT NULL AND VentanaHasta IS NOT NULL
          AND VentanaDesde<VentanaHasta)
        OR (Modo<>''ventana'' AND VentanaDesde IS NULL AND VentanaHasta IS NULL)
      ),
      CONSTRAINT CHK_PoliticaRevision_Revision CHECK (Revision>=1)
    );');

  IF OBJECT_ID('dbo.PermisoRevisionIntento', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.PermisoRevisionIntento (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PermisoRevisionIntento PRIMARY KEY,
      IdIntento INT NOT NULL,
      Estado VARCHAR(10) NOT NULL,
      Acceso VARCHAR(10) NOT NULL,
      FechaDesde DATETIME2(3) NULL,
      FechaHasta DATETIME2(3) NULL,
      Motivo NVARCHAR(250) NULL,
      Revision INT NOT NULL CONSTRAINT DF_PermisoRevision_Revision DEFAULT 1,
      ModificadoPor INT NOT NULL,
      FechaModificacion DATETIME2(3) NOT NULL
        CONSTRAINT DF_PermisoRevision_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT UQ_PermisoRevision_Intento UNIQUE (IdIntento),
      CONSTRAINT FK_PermisoRevision_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_PermisoRevision_Usuario FOREIGN KEY (ModificadoPor) REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_PermisoRevision_Estado CHECK (Estado IN (''activo'',''revocado'')),
      CONSTRAINT CHK_PermisoRevision_Acceso CHECK (Acceso IN (''unico'',''libre'')),
      CONSTRAINT CHK_PermisoRevision_Fechas CHECK (
        FechaDesde IS NULL OR FechaHasta IS NULL OR FechaDesde<FechaHasta
      ),
      CONSTRAINT CHK_PermisoRevision_Revision CHECK (Revision>=1)
    );');

  IF OBJECT_ID('dbo.SesionRevisionIntento', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.SesionRevisionIntento (
      Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_SesionRevisionIntento PRIMARY KEY,
      IdIntento INT NOT NULL,
      IdUsuario INT NOT NULL,
      ModoPoliticaSnapshot VARCHAR(20) NOT NULL,
      AccesoSnapshot VARCHAR(10) NOT NULL,
      RevisionPoliticaSnapshot INT NOT NULL,
      IdPermisoSnapshot BIGINT NULL,
      Estado VARCHAR(12) NOT NULL,
      EsActivaUnica BIT NOT NULL CONSTRAINT DF_SesionRevision_ActivaUnica DEFAULT 0,
      FechaEmision DATETIME2(3) NOT NULL CONSTRAINT DF_SesionRevision_Emision DEFAULT SYSUTCDATETIME(),
      FechaExpiracion DATETIME2(3) NOT NULL,
      FechaPrimerConsumo DATETIME2(3) NULL,
      FechaUltimoConsumo DATETIME2(3) NULL,
      CantidadConsumos INT NOT NULL CONSTRAINT DF_SesionRevision_Consumos DEFAULT 0,
      CONSTRAINT FK_SesionRevision_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_SesionRevision_Usuario FOREIGN KEY (IdUsuario) REFERENCES dbo.Usuario(Id),
      CONSTRAINT FK_SesionRevision_Permiso FOREIGN KEY (IdPermisoSnapshot) REFERENCES dbo.PermisoRevisionIntento(Id),
      CONSTRAINT CHK_SesionRevision_Modo CHECK (ModoPoliticaSnapshot IN (''nunca'',''al_corregir'',''ventana'',''manual'')),
      CONSTRAINT CHK_SesionRevision_Acceso CHECK (AccesoSnapshot IN (''unico'',''libre'')),
      CONSTRAINT CHK_SesionRevision_Estado CHECK (Estado IN (''emitida'',''consumida'',''expirada'',''revocada'')),
      CONSTRAINT CHK_SesionRevision_Fechas CHECK (FechaEmision<FechaExpiracion),
      CONSTRAINT CHK_SesionRevision_Consumos CHECK (CantidadConsumos>=0),
      CONSTRAINT CHK_SesionRevision_ActivaUnica CHECK (
        EsActivaUnica=0 OR (AccesoSnapshot=''unico'' AND Estado=''emitida'')
      )
    );');

  IF OBJECT_ID('dbo.AuditoriaRevisionIntento', 'U') IS NULL
    EXEC(N'CREATE TABLE dbo.AuditoriaRevisionIntento (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditoriaRevisionIntento PRIMARY KEY,
      IdPublicacion INT NOT NULL,
      IdIntento INT NULL,
      IdSesion UNIQUEIDENTIFIER NULL,
      IdUsuario INT NULL,
      ActorRol VARCHAR(15) NOT NULL,
      Accion VARCHAR(30) NOT NULL,
      Detalle NVARCHAR(1000) NULL,
      Fecha DATETIME2(3) NOT NULL CONSTRAINT DF_AuditoriaRevision_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_AuditoriaRevision_Publicacion FOREIGN KEY (IdPublicacion) REFERENCES dbo.Publicacion(Id),
      CONSTRAINT FK_AuditoriaRevision_Intento FOREIGN KEY (IdIntento) REFERENCES dbo.Intento(Id),
      CONSTRAINT FK_AuditoriaRevision_Sesion FOREIGN KEY (IdSesion) REFERENCES dbo.SesionRevisionIntento(Id),
      CONSTRAINT FK_AuditoriaRevision_Usuario FOREIGN KEY (IdUsuario) REFERENCES dbo.Usuario(Id),
      CONSTRAINT CHK_AuditoriaRevision_Rol CHECK (ActorRol IN (''admin'',''docente'',''alumno'',''sistema'')),
      CONSTRAINT CHK_AuditoriaRevision_Accion CHECK (Accion IN (
        ''politica_backfill'',''politica_actualizada'',
        ''permiso_otorgado'',''permiso_reactivado'',''permiso_revocado'',
        ''sesion_emitida'',''sesion_reutilizada'',''sesion_abierta'',
        ''sesion_consumida'',''sesion_expirada'',''sesion_revocada'',''contenido_consultado''
      ))
    );');

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.SesionRevisionIntento')
      AND name='UX_SesionRevision_Intento_ActivaUnica')
    EXEC(N'CREATE UNIQUE INDEX UX_SesionRevision_Intento_ActivaUnica
      ON dbo.SesionRevisionIntento(IdIntento) WHERE EsActivaUnica=1;');

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.SesionRevisionIntento')
      AND name='IX_SesionRevision_Intento_Fecha')
    EXEC(N'CREATE INDEX IX_SesionRevision_Intento_Fecha
      ON dbo.SesionRevisionIntento(IdIntento,FechaEmision DESC)
      INCLUDE (Estado,AccesoSnapshot,FechaExpiracion,IdUsuario);');

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.AuditoriaRevisionIntento')
      AND name='IX_AuditoriaRevision_Publicacion_Fecha')
    EXEC(N'CREATE INDEX IX_AuditoriaRevision_Publicacion_Fecha
      ON dbo.AuditoriaRevisionIntento(IdPublicacion,Fecha DESC,Id DESC)
      INCLUDE (IdIntento,IdSesion,Accion,IdUsuario,ActorRol);');

  EXEC(N'
    INSERT INTO dbo.PoliticaRevisionPublicacion
      (IdPublicacion,Modo,Acceso,Revision,ModificadoPor,FechaModificacion)
    SELECT P.Id,''al_corregir'',''libre'',1,NULL,SYSUTCDATETIME()
    FROM dbo.Publicacion P
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.PoliticaRevisionPublicacion PR WHERE PR.IdPublicacion=P.Id
    );

    INSERT INTO dbo.AuditoriaRevisionIntento
      (IdPublicacion,IdIntento,IdSesion,IdUsuario,ActorRol,Accion,Detalle,Fecha)
    SELECT P.Id,NULL,NULL,NULL,''sistema'',''politica_backfill'',
      N''{"modo":"al_corregir","acceso":"libre"}'',SYSUTCDATETIME()
    FROM dbo.Publicacion P
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.AuditoriaRevisionIntento A
      WHERE A.IdPublicacion=P.Id AND A.Accion=''politica_backfill''
    );
  ');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
