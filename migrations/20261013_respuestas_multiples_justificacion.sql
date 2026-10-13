/*
  Etapa 1: modelo de selección múltiple, justificación, identidad de contenido
  y snapshots preparados para el runtime de la etapa 2.

  Requiere 20261011_calificacion_intentos_telemetria.sql.
  Es transaccional e idempotente y no recalifica intentos históricos.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.Pregunta', N'U') IS NULL OR OBJECT_ID(N'dbo.Opcion', N'U') IS NULL OR
     OBJECT_ID(N'dbo.BancoPregunta', N'U') IS NULL OR OBJECT_ID(N'dbo.BancoOpcion', N'U') IS NULL OR
     OBJECT_ID(N'dbo.Respuesta', N'U') IS NULL OR OBJECT_ID(N'dbo.IntentoPregunta', N'U') IS NULL OR
     OBJECT_ID(N'dbo.Usuario', N'U') IS NULL
    THROW 51300, 'Faltan tablas requeridas para instalar respuestas múltiples.', 1;
  IF COL_LENGTH('dbo.IntentoPregunta', 'PuntajeMaximoSnapshot') IS NULL
    THROW 51303, 'Debe aplicarse primero 20261011_calificacion_intentos_telemetria.sql.', 1;

  IF COL_LENGTH('dbo.Pregunta', 'ModoJustificacion') IS NULL
    ALTER TABLE dbo.Pregunta ADD ModoJustificacion NVARCHAR(25) NOT NULL
      CONSTRAINT DF_Pregunta_ModoJustificacion DEFAULT (N'sin_justificacion') WITH VALUES;
  IF COL_LENGTH('dbo.Pregunta', 'EstrategiaCorreccion') IS NULL
    ALTER TABLE dbo.Pregunta ADD EstrategiaCorreccion NVARCHAR(30) NOT NULL
      CONSTRAINT DF_Pregunta_EstrategiaCorreccion DEFAULT (N'exacta') WITH VALUES;
  IF COL_LENGTH('dbo.Pregunta', 'TratamientoJustificacion') IS NULL
    ALTER TABLE dbo.Pregunta ADD TratamientoJustificacion NVARCHAR(25) NOT NULL
      CONSTRAINT DF_Pregunta_TratamientoJustificacion DEFAULT (N'informativa') WITH VALUES;
  IF COL_LENGTH('dbo.Pregunta', 'ContenidoHash') IS NULL
    ALTER TABLE dbo.Pregunta ADD ContenidoHash CHAR(64) NULL;

  IF COL_LENGTH('dbo.BancoPregunta', 'ModoJustificacion') IS NULL
    ALTER TABLE dbo.BancoPregunta ADD ModoJustificacion NVARCHAR(25) NOT NULL
      CONSTRAINT DF_BancoPregunta_ModoJustificacion DEFAULT (N'sin_justificacion') WITH VALUES;
  IF COL_LENGTH('dbo.BancoPregunta', 'EstrategiaCorreccion') IS NULL
    ALTER TABLE dbo.BancoPregunta ADD EstrategiaCorreccion NVARCHAR(30) NOT NULL
      CONSTRAINT DF_BancoPregunta_EstrategiaCorreccion DEFAULT (N'exacta') WITH VALUES;
  IF COL_LENGTH('dbo.BancoPregunta', 'TratamientoJustificacion') IS NULL
    ALTER TABLE dbo.BancoPregunta ADD TratamientoJustificacion NVARCHAR(25) NOT NULL
      CONSTRAINT DF_BancoPregunta_TratamientoJustificacion DEFAULT (N'informativa') WITH VALUES;
  IF COL_LENGTH('dbo.BancoPregunta', 'ContenidoHash') IS NULL
    ALTER TABLE dbo.BancoPregunta ADD ContenidoHash CHAR(64) NULL;

  -- Reemplaza todos los checks exclusivos de Tipo. Algunas bases conservan a la vez
  -- el check autogenerado legacy y el check estable; cualquiera de ellos puede bloquear
  -- 'multiple', aunque CHK_*_Tipo ya tenga la definición nueva.
  BEGIN
    DECLARE @Sql NVARCHAR(MAX)=N'';
    SELECT @Sql=@Sql+N'ALTER TABLE dbo.Pregunta DROP CONSTRAINT '+QUOTENAME(cc.name)+N';'
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id=OBJECT_ID(N'dbo.Pregunta')
      AND (cc.name=N'CHK_Pregunta_Tipo' OR cc.definition LIKE N'%Tipo%')
      AND cc.definition NOT LIKE N'%ModoJustificacion%'
      AND cc.definition NOT LIKE N'%EstrategiaCorreccion%';
    IF @Sql<>N''
      EXEC sys.sp_executesql @Sql;
    EXEC(N'ALTER TABLE dbo.Pregunta WITH CHECK ADD CONSTRAINT CHK_Pregunta_Tipo
      CHECK (Tipo IN (N''mc'',N''multiple'',N''vf'',N''abierta'',N''code''));');
  END;

  BEGIN
    SET @Sql=N'';
    SELECT @Sql=@Sql+N'ALTER TABLE dbo.BancoPregunta DROP CONSTRAINT '+QUOTENAME(cc.name)+N';'
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id=OBJECT_ID(N'dbo.BancoPregunta')
      AND (cc.name=N'CHK_BancoPregunta_Tipo' OR cc.definition LIKE N'%Tipo%')
      AND cc.definition NOT LIKE N'%ModoJustificacion%'
      AND cc.definition NOT LIKE N'%EstrategiaCorreccion%';
    IF @Sql<>N''
      EXEC sys.sp_executesql @Sql;
    EXEC(N'ALTER TABLE dbo.BancoPregunta WITH CHECK ADD CONSTRAINT CHK_BancoPregunta_Tipo
      CHECK (Tipo IN (N''mc'',N''multiple'',N''vf'',N''abierta'',N''code''));');
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CHK_Pregunta_Configuracion')
    EXEC(N'ALTER TABLE dbo.Pregunta WITH CHECK ADD CONSTRAINT CHK_Pregunta_Configuracion CHECK (
      ModoJustificacion IN (N''sin_justificacion'',N''opcional'',N''obligatoria'') AND
      EstrategiaCorreccion IN (N''exacta'',N''parcial_sin_penalizacion'',N''parcial_penalizada'') AND
      TratamientoJustificacion IN (N''informativa'',N''revision_manual'') AND
      (Tipo=N''multiple'' OR EstrategiaCorreccion=N''exacta'') AND
      (ModoJustificacion<>N''sin_justificacion'' OR TratamientoJustificacion=N''informativa'') AND
      (Tipo NOT IN (N''abierta'',N''code'') OR TratamientoJustificacion=N''informativa'')
    );');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CHK_BancoPregunta_Configuracion')
    EXEC(N'ALTER TABLE dbo.BancoPregunta WITH CHECK ADD CONSTRAINT CHK_BancoPregunta_Configuracion CHECK (
      ModoJustificacion IN (N''sin_justificacion'',N''opcional'',N''obligatoria'') AND
      EstrategiaCorreccion IN (N''exacta'',N''parcial_sin_penalizacion'',N''parcial_penalizada'') AND
      TratamientoJustificacion IN (N''informativa'',N''revision_manual'') AND
      (Tipo=N''multiple'' OR EstrategiaCorreccion=N''exacta'') AND
      (ModoJustificacion<>N''sin_justificacion'' OR TratamientoJustificacion=N''informativa'') AND
      (Tipo NOT IN (N''abierta'',N''code'') OR TratamientoJustificacion=N''informativa'')
    );');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CHK_Pregunta_ContenidoHash')
    EXEC(N'ALTER TABLE dbo.Pregunta WITH CHECK ADD CONSTRAINT CHK_Pregunta_ContenidoHash
      CHECK (ContenidoHash IS NULL OR LEN(ContenidoHash)=64);');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CHK_BancoPregunta_ContenidoHash')
    EXEC(N'ALTER TABLE dbo.BancoPregunta WITH CHECK ADD CONSTRAINT CHK_BancoPregunta_ContenidoHash
      CHECK (ContenidoHash IS NULL OR LEN(ContenidoHash)=64);');

  IF COL_LENGTH('dbo.Respuesta', 'Justificacion') IS NULL
    ALTER TABLE dbo.Respuesta ADD Justificacion NVARCHAR(MAX) NULL;
  IF COL_LENGTH('dbo.Respuesta', 'Revision') IS NULL
    ALTER TABLE dbo.Respuesta ADD Revision INT NOT NULL CONSTRAINT DF_Respuesta_Revision DEFAULT (0) WITH VALUES;
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CHK_Respuesta_Revision')
    EXEC(N'ALTER TABLE dbo.Respuesta WITH CHECK ADD CONSTRAINT CHK_Respuesta_Revision CHECK (Revision>=0);');

  IF COL_LENGTH('dbo.IntentoPregunta', 'TipoSnapshot') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD TipoSnapshot NVARCHAR(25) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'ModoJustificacionSnapshot') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD ModoJustificacionSnapshot NVARCHAR(25) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'EstrategiaCorreccionSnapshot') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD EstrategiaCorreccionSnapshot NVARCHAR(30) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'TratamientoJustificacionSnapshot') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD TratamientoJustificacionSnapshot NVARCHAR(25) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'ContenidoHashSnapshot') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD ContenidoHashSnapshot CHAR(64) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'PuntajeAutomaticoOpciones') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD PuntajeAutomaticoOpciones DECIMAL(5,2) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta', 'SnapshotReconstruido') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD SnapshotReconstruido BIT NOT NULL
      CONSTRAINT DF_IntentoPregunta_SnapshotReconstruido DEFAULT (0) WITH VALUES;
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CHK_IntentoPregunta_PuntajeAutomaticoOpciones')
    EXEC(N'ALTER TABLE dbo.IntentoPregunta WITH CHECK ADD CONSTRAINT CHK_IntentoPregunta_PuntajeAutomaticoOpciones CHECK (
      PuntajeAutomaticoOpciones IS NULL OR
      (PuntajeMaximoSnapshot IS NOT NULL AND PuntajeAutomaticoOpciones>=0 AND PuntajeAutomaticoOpciones<=PuntajeMaximoSnapshot)
    );');

  IF OBJECT_ID(N'dbo.IntentoPreguntaOpcionSnapshot', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.IntentoPreguntaOpcionSnapshot (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_IntentoPreguntaOpcionSnapshot PRIMARY KEY,
      IdIntentoPregunta INT NOT NULL,
      IdOpcionOrigen INT NULL,
      TextoSnapshot NVARCHAR(500) NOT NULL,
      EsCorrectaSnapshot BIT NOT NULL,
      Posicion INT NOT NULL,
      CONSTRAINT FK_IntentoPreguntaOpcionSnapshot_IntentoPregunta FOREIGN KEY (IdIntentoPregunta)
        REFERENCES dbo.IntentoPregunta(Id),
      CONSTRAINT UQ_IntentoPreguntaOpcionSnapshot_Posicion UNIQUE (IdIntentoPregunta,Posicion),
      CONSTRAINT CHK_IntentoPreguntaOpcionSnapshot_Posicion CHECK (Posicion>0)
    );
  END;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.IntentoPreguntaOpcionSnapshot') AND name=N'UX_IntentoPreguntaOpcionSnapshot_Origen')
    EXEC(N'CREATE UNIQUE INDEX UX_IntentoPreguntaOpcionSnapshot_Origen
      ON dbo.IntentoPreguntaOpcionSnapshot(IdIntentoPregunta,IdOpcionOrigen) WHERE IdOpcionOrigen IS NOT NULL;');

  IF OBJECT_ID(N'dbo.HistorialRespuestaCambio', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.HistorialRespuestaCambio (
      Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_HistorialRespuestaCambio PRIMARY KEY,
      IdIntentoPregunta INT NOT NULL,
      IdRespuesta INT NULL,
      EventoId UNIQUEIDENTIFIER NOT NULL,
      RevisionAnterior INT NOT NULL,
      RevisionNueva INT NOT NULL,
      RespuestaAnteriorJson NVARCHAR(MAX) NULL,
      RespuestaNuevaJson NVARCHAR(MAX) NULL,
      IdUsuario INT NOT NULL,
      FechaCambio DATETIME2(3) NOT NULL CONSTRAINT DF_HistorialRespuestaCambio_Fecha DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_HistorialRespuestaCambio_IntentoPregunta FOREIGN KEY (IdIntentoPregunta) REFERENCES dbo.IntentoPregunta(Id),
      CONSTRAINT FK_HistorialRespuestaCambio_Respuesta FOREIGN KEY (IdRespuesta) REFERENCES dbo.Respuesta(Id),
      CONSTRAINT FK_HistorialRespuestaCambio_Usuario FOREIGN KEY (IdUsuario) REFERENCES dbo.Usuario(Id),
      CONSTRAINT UQ_HistorialRespuestaCambio_Evento UNIQUE (IdIntentoPregunta,EventoId),
      CONSTRAINT CHK_HistorialRespuestaCambio_Revisiones CHECK (RevisionAnterior>=0 AND RevisionNueva=RevisionAnterior+1),
      CONSTRAINT CHK_HistorialRespuestaCambio_Json CHECK (
        (RespuestaAnteriorJson IS NULL OR ISJSON(RespuestaAnteriorJson)=1) AND
        (RespuestaNuevaJson IS NULL OR ISJSON(RespuestaNuevaJson)=1)
      )
    );
  END;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.HistorialRespuestaCambio') AND name=N'IX_HistorialRespuestaCambio_IntentoPregunta_Fecha')
    EXEC(N'CREATE INDEX IX_HistorialRespuestaCambio_IntentoPregunta_Fecha
      ON dbo.HistorialRespuestaCambio(IdIntentoPregunta,FechaCambio DESC);');

  -- Hash común entre banco y evaluación; la posición se deriva del orden estable.
  EXEC(N'UPDATE P SET ContenidoHash=CONVERT(char(64),HASHBYTES(''SHA2_256'',CONVERT(nvarchar(max),
      CONCAT(N''v1|'',P.Tipo,N''|'',P.Enunciado,N''|'',P.ModoJustificacion,N''|'',P.EstrategiaCorreccion,N''|'',
        P.TratamientoJustificacion,N''|'',COALESCE((SELECT ROW_NUMBER() OVER (ORDER BY O.Id) AS posicion,
          O.Texto AS texto,O.EsCorrecta AS esCorrecta FROM dbo.Opcion O WHERE O.IdPregunta=P.Id
          ORDER BY O.Id FOR JSON PATH),N''[]'')))),2) FROM dbo.Pregunta P;');
  EXEC(N'UPDATE P SET ContenidoHash=CONVERT(char(64),HASHBYTES(''SHA2_256'',CONVERT(nvarchar(max),
      CONCAT(N''v1|'',P.Tipo,N''|'',P.Enunciado,N''|'',P.ModoJustificacion,N''|'',P.EstrategiaCorreccion,N''|'',
        P.TratamientoJustificacion,N''|'',COALESCE((SELECT ROW_NUMBER() OVER (ORDER BY O.Posicion,O.Id) AS posicion,
          O.Texto AS texto,O.EsCorrecta AS esCorrecta FROM dbo.BancoOpcion O WHERE O.IdPregunta=P.Id
          ORDER BY O.Posicion,O.Id FOR JSON PATH),N''[]'')))),2) FROM dbo.BancoPregunta P;');

  EXEC(N'UPDATE IP SET
      TipoSnapshot=COALESCE(IP.TipoSnapshot,P.Tipo),
      ModoJustificacionSnapshot=COALESCE(IP.ModoJustificacionSnapshot,P.ModoJustificacion),
      EstrategiaCorreccionSnapshot=COALESCE(IP.EstrategiaCorreccionSnapshot,P.EstrategiaCorreccion),
      TratamientoJustificacionSnapshot=COALESCE(IP.TratamientoJustificacionSnapshot,P.TratamientoJustificacion),
      ContenidoHashSnapshot=COALESCE(IP.ContenidoHashSnapshot,P.ContenidoHash),
      SnapshotReconstruido=CASE WHEN IP.TipoSnapshot IS NULL OR IP.ModoJustificacionSnapshot IS NULL OR
        IP.EstrategiaCorreccionSnapshot IS NULL OR IP.TratamientoJustificacionSnapshot IS NULL OR
        IP.ContenidoHashSnapshot IS NULL THEN 1 ELSE IP.SnapshotReconstruido END
    FROM dbo.IntentoPregunta IP JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta;');

  EXEC(N'INSERT INTO dbo.IntentoPreguntaOpcionSnapshot
    (IdIntentoPregunta,IdOpcionOrigen,TextoSnapshot,EsCorrectaSnapshot,Posicion)
  SELECT IP.Id,O.Id,O.Texto,O.EsCorrecta,ROW_NUMBER() OVER (PARTITION BY IP.Id ORDER BY O.Id)
  FROM dbo.IntentoPregunta IP
  JOIN dbo.Opcion O ON O.IdPregunta=IP.IdPregunta
  WHERE NOT EXISTS (SELECT 1 FROM dbo.IntentoPreguntaOpcionSnapshot S WHERE S.IdIntentoPregunta=IP.Id);');

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.Pregunta') AND name=N'IX_Pregunta_ContenidoHash')
    EXEC(N'CREATE INDEX IX_Pregunta_ContenidoHash ON dbo.Pregunta(ContenidoHash) WHERE ContenidoHash IS NOT NULL;');
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.BancoPregunta') AND name=N'IX_BancoPregunta_ContenidoHash')
    EXEC(N'CREATE INDEX IX_BancoPregunta_ContenidoHash ON dbo.BancoPregunta(ContenidoHash) WHERE ContenidoHash IS NOT NULL;');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
