/*
  Vaciado integral de GestionExamio-Migracion.

  ADVERTENCIA: elimina de forma irreversible todos los registros de todas las
  tablas de usuario inventariadas. Conserva tablas, índices, vistas, SPs,
  funciones, constraints, triggers, usuarios y permisos de la base.

  NO ES UNA MIGRACIÓN. Revisar README-vaciado-gestionexamio-migracion.md.
  El archivo se entrega sin ejecutar y bloqueado por defecto.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @BaseObjetivo SYSNAME = N'GestionExamio-Migracion';
DECLARE @CONFIRMAR_VACIADO_TOTAL BIT = 0; -- Cambiar exclusivamente a 1 para ejecutar.
DECLARE @REINICIAR_IDENTIDADES BIT = 1;  -- No afecta secuencias independientes.

IF DB_NAME() <> @BaseObjetivo
  THROW 54000, 'Base incorrecta. Seleccione exactamente GestionExamio-Migracion.', 1;

/*
  Manifiesto explícito. Incluye negocio, seguridad, auditoría, catálogos y
  auxiliares de pruebas conocidos por la versión actual de Examio.

  Las tablas ausentes se informan y se ignoran. Una tabla real no incluida en
  este manifiesto provoca un aborto ANTES de iniciar cualquier DELETE.
*/
DECLARE @Manifiesto TABLE (
  Esquema SYSNAME NOT NULL,
  Tabla SYSNAME NOT NULL,
  Categoria VARCHAR(40) NOT NULL,
  PRIMARY KEY (Esquema, Tabla)
);

INSERT INTO @Manifiesto (Esquema, Tabla, Categoria) VALUES
  (N'dbo',N'Carrera','negocio'),
  (N'dbo',N'Materia','negocio'),
  (N'dbo',N'Division','negocio'),
  (N'dbo',N'Docente','personas'),
  (N'dbo',N'Alumno','personas'),
  (N'dbo',N'MateriaDivision','negocio'),
  (N'dbo',N'InscripcionMateria','negocio'),
  (N'dbo',N'Actividad','evaluaciones'),
  (N'dbo',N'Publicacion','evaluaciones'),
  (N'dbo',N'GrupoPregunta','evaluaciones'),
  (N'dbo',N'Pregunta','evaluaciones'),
  (N'dbo',N'Opcion','evaluaciones'),
  (N'dbo',N'Intento','intentos'),
  (N'dbo',N'IntentoPregunta','intentos'),
  (N'dbo',N'IntentoPreguntaOpcionSnapshot','intentos'),
  (N'dbo',N'Respuesta','intentos'),
  (N'dbo',N'RespuestaOpcion','intentos'),
  (N'dbo',N'HistorialRespuesta','auditoria'),
  (N'dbo',N'HistorialRespuestaCambio','auditoria'),
  (N'dbo',N'AlertaFraude','telemetria'),
  (N'dbo',N'MetricasNavegacion','telemetria'),
  (N'dbo',N'IncidenteIntento','telemetria'),
  (N'dbo',N'TipoEventoTelemetria','catalogo_tecnico'),
  (N'dbo',N'RevisionIncidenteIntento','auditoria'),
  (N'dbo',N'AnulacionIntentoIncidente','auditoria'),
  (N'dbo',N'ActaMateria','actas'),
  (N'dbo',N'DetalleActa','actas'),
  (N'dbo',N'Usuario','seguridad'),
  (N'dbo',N'AuthSession','seguridad'),
  (N'dbo',N'AuthRefreshToken','seguridad'),
  (N'dbo',N'OperacionIdempotente','infraestructura'),
  (N'dbo',N'BancoPregunta','banco'),
  (N'dbo',N'BancoOpcion','banco'),
  (N'dbo',N'BancoGrupo','banco'),
  (N'dbo',N'BancoGrupoPregunta','banco'),
  (N'dbo',N'BancoEtiqueta','banco'),
  (N'dbo',N'BancoPreguntaEtiqueta','banco'),
  (N'dbo',N'BancoGrupoEtiqueta','banco'),
  (N'dbo',N'HistorialCorreccionIntentoPregunta','auditoria'),
  (N'dbo',N'HistorialNotaIntento','auditoria'),
  (N'dbo',N'IntentoValidoOverride','intentos'),
  (N'dbo',N'HistorialIntentoValidoOverride','auditoria'),
  (N'dbo',N'HistorialEstadoCorreccionIntento','auditoria'),
  (N'dbo',N'PoliticaRevisionPublicacion','revision'),
  (N'dbo',N'PermisoRevisionIntento','revision'),
  (N'dbo',N'SesionRevisionIntento','revision'),
  (N'dbo',N'AuditoriaRevisionIntento','auditoria'),
  (N'dbo',N'ConsumoRevisionUnicaIntento','revision'),
  (N'dbo',N'PoliticaSupervisionPublicacion','supervision'),
  (N'dbo',N'ReglaSupervisionPublicacion','supervision'),
  (N'dbo',N'IntentoPoliticaSupervision','supervision'),
  (N'dbo',N'IntentoReglaSupervision','supervision'),
  (N'dbo',N'EstadoSupervisionIntento','supervision'),
  (N'dbo',N'DecisionSupervisionIntento','supervision'),
  (N'dbo',N'OverrideSupervisionIntento','supervision'),
  (N'dbo',N'ExamioTestDataLote','auxiliar_pruebas'),
  (N'dbo',N'ExamioTestDataEntidad','auxiliar_pruebas'),
  (N'dbo',N'sysdiagrams','herramienta_sql_server');

DECLARE @NoInventariadas TABLE (Esquema SYSNAME, Tabla SYSNAME, Motivo NVARCHAR(200));

INSERT INTO @NoInventariadas (Esquema, Tabla, Motivo)
SELECT S.name,T.name,N'Tabla de usuario no incluida en el manifiesto explícito'
FROM sys.tables T
JOIN sys.schemas S ON S.schema_id=T.schema_id
WHERE T.is_ms_shipped=0
  AND NOT EXISTS (
    SELECT 1 FROM @Manifiesto M WHERE M.Esquema=S.name AND M.Tabla=T.name
  )
  AND NOT EXISTS (
    SELECT 1
    FROM sys.tables Actual
    JOIN sys.schemas SA ON SA.schema_id=Actual.schema_id
    JOIN @Manifiesto M ON M.Esquema=SA.name AND M.Tabla=Actual.name
    WHERE Actual.history_table_id=T.object_id
  );

IF EXISTS (SELECT 1 FROM @NoInventariadas)
BEGIN
  SELECT Esquema,Tabla,Motivo FROM @NoInventariadas ORDER BY Esquema,Tabla;
  THROW 54002, 'Se detectaron tablas no inventariadas. Actualice el manifiesto antes de borrar.', 1;
END;

DECLARE @Objetivo TABLE (
  ObjectId INT PRIMARY KEY,
  Esquema SYSNAME NOT NULL,
  Tabla SYSNAME NOT NULL,
  Categoria VARCHAR(40) NOT NULL,
  Eliminada BIT NOT NULL DEFAULT 0,
  OrdenBorrado INT NULL
);

INSERT INTO @Objetivo (ObjectId,Esquema,Tabla,Categoria)
SELECT T.object_id,S.name,T.name,M.Categoria
FROM @Manifiesto M
JOIN sys.schemas S ON S.name=M.Esquema
JOIN sys.tables T ON T.schema_id=S.schema_id AND T.name=M.Tabla
WHERE T.is_ms_shipped=0;

-- Una history table temporal sólo puede incorporarse si pertenece a una tabla
-- actual ya inventariada; se informa explícitamente en la salida previa.
INSERT INTO @Objetivo (ObjectId,Esquema,Tabla,Categoria)
SELECT H.object_id,SH.name,H.name,'historial_temporal'
FROM sys.tables A
JOIN @Objetivo OA ON OA.ObjectId=A.object_id
JOIN sys.tables H ON H.object_id=A.history_table_id
JOIN sys.schemas SH ON SH.schema_id=H.schema_id
WHERE A.temporal_type=2
  AND NOT EXISTS (SELECT 1 FROM @Objetivo X WHERE X.ObjectId=H.object_id);

SELECT O.Esquema,O.Tabla,O.Categoria,
  T.temporal_type_desc,T.is_memory_optimized,T.is_filetable,T.is_node,T.is_edge,T.ledger_type_desc
FROM @Objetivo O
JOIN sys.tables T ON T.object_id=O.ObjectId
ORDER BY O.Categoria,O.Esquema,O.Tabla;

SELECT M.Esquema,M.Tabla,M.Categoria
FROM @Manifiesto M
WHERE NOT EXISTS (
  SELECT 1 FROM sys.tables T JOIN sys.schemas S ON S.schema_id=T.schema_id
  WHERE S.name=M.Esquema AND T.name=M.Tabla
)
ORDER BY M.Categoria,M.Esquema,M.Tabla;

-- No se intenta vaciar silenciosamente estructuras con semántica especial que
-- no existen en el modelo actual y requieren una estrategia específica.
IF EXISTS (
  SELECT 1 FROM sys.tables T JOIN @Objetivo O ON O.ObjectId=T.object_id
  WHERE T.is_filetable=1 OR T.is_node=1 OR T.is_edge=1 OR T.ledger_type<>0
)
  THROW 54003, 'Se detectó FileTable, tabla graph o ledger. El script no realizará cambios.', 1;

-- Con confirmación 0, todo lo anterior funciona como preflight de sólo lectura y
-- la ejecución se detiene antes de BEGIN TRANSACTION y del primer cambio.
IF @CONFIRMAR_VACIADO_TOTAL <> 1
  THROW 54001, 'Preflight finalizado. Cambie @CONFIRMAR_VACIADO_TOTAL a 1 sólo después de realizar un respaldo.', 1;

DECLARE @EstadoFK TABLE (
  ObjectId INT PRIMARY KEY, EsquemaHijo SYSNAME, TablaHijo SYSNAME, ConstraintName SYSNAME,
  IsDisabled BIT, IsNotTrusted BIT
);
DECLARE @EstadoCheck TABLE (ObjectId INT PRIMARY KEY, IsDisabled BIT, IsNotTrusted BIT);
DECLARE @EstadoTrigger TABLE (ObjectId INT PRIMARY KEY, IsDisabled BIT);
DECLARE @EstadoTemporal TABLE (
  ObjectId INT PRIMARY KEY, EsquemaActual SYSNAME, TablaActual SYSNAME,
  HistoryObjectId INT, EsquemaHistorial SYSNAME, TablaHistorial SYSNAME
);
DECLARE @FksCiclo TABLE (ObjectId INT PRIMARY KEY);
DECLARE @Restantes TABLE (Esquema SYSNAME, Tabla SYSNAME, Filas BIGINT);

BEGIN TRY
  BEGIN TRANSACTION;

  /* Bloqueo exclusivo de las tablas durante toda la operación. La API y otros
     escritores deben estar detenidos para evitar esperas o deadlocks. */
  DECLARE @Sql NVARCHAR(MAX),@Esquema SYSNAME,@Tabla SYSNAME,@ObjectId INT,@Dummy BIGINT;
  DECLARE CurBloqueo CURSOR LOCAL FAST_FORWARD FOR
    SELECT Esquema,Tabla FROM @Objetivo ORDER BY Esquema,Tabla;
  OPEN CurBloqueo;
  FETCH NEXT FROM CurBloqueo INTO @Esquema,@Tabla;
  WHILE @@FETCH_STATUS=0
  BEGIN
    SET @Sql=N'SELECT @N=COUNT_BIG(*) FROM '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+N' WITH (TABLOCKX,HOLDLOCK);';
    EXEC sys.sp_executesql @Sql,N'@N BIGINT OUTPUT',@N=@Dummy OUTPUT;
    FETCH NEXT FROM CurBloqueo INTO @Esquema,@Tabla;
  END;
  CLOSE CurBloqueo;
  DEALLOCATE CurBloqueo;

  INSERT INTO @EstadoFK
  SELECT FK.object_id,SH.name,TH.name,FK.name,FK.is_disabled,FK.is_not_trusted
  FROM sys.foreign_keys FK
  JOIN sys.tables TH ON TH.object_id=FK.parent_object_id
  JOIN sys.schemas SH ON SH.schema_id=TH.schema_id
  WHERE EXISTS (SELECT 1 FROM @Objetivo O WHERE O.ObjectId=FK.parent_object_id)
     OR EXISTS (SELECT 1 FROM @Objetivo O WHERE O.ObjectId=FK.referenced_object_id);

  INSERT INTO @EstadoCheck
  SELECT C.object_id,C.is_disabled,C.is_not_trusted
  FROM sys.check_constraints C
  JOIN @Objetivo O ON O.ObjectId=C.parent_object_id;

  INSERT INTO @EstadoTrigger
  SELECT TR.object_id,TR.is_disabled
  FROM sys.triggers TR
  JOIN @Objetivo O ON O.ObjectId=TR.parent_id
  WHERE TR.is_ms_shipped=0;

  INSERT INTO @EstadoTemporal
  SELECT A.object_id,SA.name,A.name,H.object_id,SH.name,H.name
  FROM sys.tables A
  JOIN @Objetivo O ON O.ObjectId=A.object_id
  JOIN sys.schemas SA ON SA.schema_id=A.schema_id
  JOIN sys.tables H ON H.object_id=A.history_table_id
  JOIN sys.schemas SH ON SH.schema_id=H.schema_id
  WHERE A.temporal_type=2;

  /* Detecta exclusivamente FKs pertenecientes a ciclos reales. Las FKs
     autorreferenciales también se tratan como ciclos. */
  ;WITH Aristas AS (
    SELECT FK.object_id,FK.parent_object_id AS Hijo,FK.referenced_object_id AS Padre
    FROM sys.foreign_keys FK
    WHERE FK.is_disabled=0
      AND EXISTS (SELECT 1 FROM @Objetivo O WHERE O.ObjectId=FK.parent_object_id)
      AND EXISTS (SELECT 1 FROM @Objetivo O WHERE O.ObjectId=FK.referenced_object_id)
  ), Caminos AS (
    SELECT A.Hijo AS Inicio,A.Padre AS Actual,
      CAST(N'/'+CONVERT(NVARCHAR(20),A.Hijo)+N'/'+CONVERT(NVARCHAR(20),A.Padre)+N'/' AS NVARCHAR(MAX)) AS Ruta
    FROM Aristas A
    UNION ALL
    SELECT C.Inicio,A.Padre,
      CAST(C.Ruta+CONVERT(NVARCHAR(20),A.Padre)+N'/' AS NVARCHAR(MAX))
    FROM Caminos C
    JOIN Aristas A ON A.Hijo=C.Actual
    WHERE C.Ruta NOT LIKE N'%/'+CONVERT(NVARCHAR(20),A.Padre)+N'/%'
  )
  INSERT INTO @FksCiclo (ObjectId)
  SELECT DISTINCT A.object_id
  FROM Aristas A
  WHERE A.Hijo=A.Padre
     OR EXISTS (SELECT 1 FROM Caminos C WHERE C.Inicio=A.Padre AND C.Actual=A.Hijo)
  OPTION (MAXRECURSION 32767);

  -- SYSTEM_VERSIONING debe suspenderse para poder vaciar también el historial.
  DECLARE CurTemporalOff CURSOR LOCAL FAST_FORWARD FOR
    SELECT EsquemaActual,TablaActual FROM @EstadoTemporal ORDER BY ObjectId;
  OPEN CurTemporalOff;
  FETCH NEXT FROM CurTemporalOff INTO @Esquema,@Tabla;
  WHILE @@FETCH_STATUS=0
  BEGIN
    SET @Sql=N'ALTER TABLE '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+N' SET (SYSTEM_VERSIONING = OFF);';
    EXEC sys.sp_executesql @Sql;
    FETCH NEXT FROM CurTemporalOff INTO @Esquema,@Tabla;
  END;
  CLOSE CurTemporalOff;
  DEALLOCATE CurTemporalOff;

  -- Sólo se deshabilitan temporalmente FKs que forman un ciclo real.
  DECLARE @Constraint SYSNAME,@OriginalDisabled BIT,@OriginalNotTrusted BIT;
  DECLARE CurFkOff CURSOR LOCAL FAST_FORWARD FOR
    SELECT E.EsquemaHijo,E.TablaHijo,E.ConstraintName
    FROM @EstadoFK E JOIN @FksCiclo C ON C.ObjectId=E.ObjectId
    ORDER BY E.ObjectId;
  OPEN CurFkOff;
  FETCH NEXT FROM CurFkOff INTO @Esquema,@Tabla,@Constraint;
  WHILE @@FETCH_STATUS=0
  BEGIN
    SET @Sql=N'ALTER TABLE '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+N' NOCHECK CONSTRAINT '+QUOTENAME(@Constraint)+N';';
    EXEC sys.sp_executesql @Sql;
    FETCH NEXT FROM CurFkOff INTO @Esquema,@Tabla,@Constraint;
  END;
  CLOSE CurFkOff;
  DEALLOCATE CurFkOff;

  /* Orden hijo -> padre derivado de las FKs habilitadas reales. */
  DECLARE @Orden INT=0,@CantidadNivel INT;
  DECLARE @Nivel TABLE (ObjectId INT PRIMARY KEY,Esquema SYSNAME,Tabla SYSNAME);

  WHILE EXISTS (SELECT 1 FROM @Objetivo WHERE Eliminada=0)
  BEGIN
    DELETE FROM @Nivel;
    INSERT INTO @Nivel (ObjectId,Esquema,Tabla)
    SELECT O.ObjectId,O.Esquema,O.Tabla
    FROM @Objetivo O
    WHERE O.Eliminada=0
      AND NOT EXISTS (
        SELECT 1
        FROM sys.foreign_keys FK
        JOIN @Objetivo Hijo ON Hijo.ObjectId=FK.parent_object_id AND Hijo.Eliminada=0
        WHERE FK.referenced_object_id=O.ObjectId
          AND FK.parent_object_id<>FK.referenced_object_id
          AND FK.is_disabled=0
      );

    SET @CantidadNivel=@@ROWCOUNT;
    IF @CantidadNivel=0
      THROW 54004, 'No fue posible resolver el orden de borrado; existe un ciclo no tratado.', 1;

    SET @Orden+=1;
    DECLARE CurDelete CURSOR LOCAL FAST_FORWARD FOR
      SELECT ObjectId,Esquema,Tabla FROM @Nivel ORDER BY Esquema,Tabla;
    OPEN CurDelete;
    FETCH NEXT FROM CurDelete INTO @ObjectId,@Esquema,@Tabla;
    WHILE @@FETCH_STATUS=0
    BEGIN
      SET @Sql=N'DELETE FROM '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+N';';
      EXEC sys.sp_executesql @Sql;
      UPDATE @Objetivo SET Eliminada=1,OrdenBorrado=@Orden WHERE ObjectId=@ObjectId;
      FETCH NEXT FROM CurDelete INTO @ObjectId,@Esquema,@Tabla;
    END;
    CLOSE CurDelete;
    DEALLOCATE CurDelete;
  END;

  /* Reseed opcional: después de DELETE, seed-increment hace que el próximo ID
     vuelva al seed original. Las secuencias independientes no se modifican. */
  IF @REINICIAR_IDENTIDADES=1
  BEGIN
    DECLARE @ValorReseed NVARCHAR(100);
    DECLARE CurIdentity CURSOR LOCAL FAST_FORWARD FOR
      SELECT S.name,T.name,
        CONVERT(NVARCHAR(100),CONVERT(DECIMAL(38,0),IC.seed_value)-CONVERT(DECIMAL(38,0),IC.increment_value))
      FROM sys.identity_columns IC
      JOIN sys.tables T ON T.object_id=IC.object_id
      JOIN sys.schemas S ON S.schema_id=T.schema_id
      JOIN @Objetivo O ON O.ObjectId=T.object_id
      ORDER BY S.name,T.name;
    OPEN CurIdentity;
    FETCH NEXT FROM CurIdentity INTO @Esquema,@Tabla,@ValorReseed;
    WHILE @@FETCH_STATUS=0
    BEGIN
      SET @Sql=N'DBCC CHECKIDENT ('+QUOTENAME(@Esquema+N'.'+@Tabla,N'''')+N', RESEED, '+@ValorReseed+N') WITH NO_INFOMSGS;';
      EXEC sys.sp_executesql @Sql;
      FETCH NEXT FROM CurIdentity INTO @Esquema,@Tabla,@ValorReseed;
    END;
    CLOSE CurIdentity;
    DEALLOCATE CurIdentity;
  END;

  -- Restaura cada FK cíclica exactamente a su estado de confianza original.
  DECLARE CurFkOn CURSOR LOCAL FAST_FORWARD FOR
    SELECT E.EsquemaHijo,E.TablaHijo,E.ConstraintName,E.IsDisabled,E.IsNotTrusted
    FROM @EstadoFK E JOIN @FksCiclo C ON C.ObjectId=E.ObjectId
    ORDER BY E.ObjectId;
  OPEN CurFkOn;
  FETCH NEXT FROM CurFkOn INTO @Esquema,@Tabla,@Constraint,@OriginalDisabled,@OriginalNotTrusted;
  WHILE @@FETCH_STATUS=0
  BEGIN
    SET @Sql=CASE
      WHEN @OriginalDisabled=1 THEN
        N'ALTER TABLE '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+N' NOCHECK CONSTRAINT '+QUOTENAME(@Constraint)+N';'
      WHEN @OriginalNotTrusted=1 THEN
        N'ALTER TABLE '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+N' CHECK CONSTRAINT '+QUOTENAME(@Constraint)+N';'
      ELSE
        N'ALTER TABLE '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+N' WITH CHECK CHECK CONSTRAINT '+QUOTENAME(@Constraint)+N';'
    END;
    EXEC sys.sp_executesql @Sql;
    FETCH NEXT FROM CurFkOn INTO @Esquema,@Tabla,@Constraint,@OriginalDisabled,@OriginalNotTrusted;
  END;
  CLOSE CurFkOn;
  DEALLOCATE CurFkOn;

  -- Restaura temporalidad sobre la misma history table.
  DECLARE @EsquemaHistorial SYSNAME,@TablaHistorial SYSNAME;
  DECLARE CurTemporalOn CURSOR LOCAL FAST_FORWARD FOR
    SELECT EsquemaActual,TablaActual,EsquemaHistorial,TablaHistorial
    FROM @EstadoTemporal ORDER BY ObjectId;
  OPEN CurTemporalOn;
  FETCH NEXT FROM CurTemporalOn INTO @Esquema,@Tabla,@EsquemaHistorial,@TablaHistorial;
  WHILE @@FETCH_STATUS=0
  BEGIN
    SET @Sql=N'ALTER TABLE '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+
      N' SET (SYSTEM_VERSIONING = ON (HISTORY_TABLE = '+QUOTENAME(@EsquemaHistorial)+N'.'+QUOTENAME(@TablaHistorial)+
      N', DATA_CONSISTENCY_CHECK = ON));';
    EXEC sys.sp_executesql @Sql;
    FETCH NEXT FROM CurTemporalOn INTO @Esquema,@Tabla,@EsquemaHistorial,@TablaHistorial;
  END;
  CLOSE CurTemporalOn;
  DEALLOCATE CurTemporalOn;

  /* ======================= VERIFICACIONES PRE-COMMIT ======================= */
  DECLARE CurConteo CURSOR LOCAL FAST_FORWARD FOR
    SELECT Esquema,Tabla FROM @Objetivo ORDER BY Esquema,Tabla;
  OPEN CurConteo;
  FETCH NEXT FROM CurConteo INTO @Esquema,@Tabla;
  WHILE @@FETCH_STATUS=0
  BEGIN
    SET @Dummy=0;
    SET @Sql=N'SELECT @N=COUNT_BIG(*) FROM '+QUOTENAME(@Esquema)+N'.'+QUOTENAME(@Tabla)+N';';
    EXEC sys.sp_executesql @Sql,N'@N BIGINT OUTPUT',@N=@Dummy OUTPUT;
    IF @Dummy<>0 INSERT INTO @Restantes VALUES(@Esquema,@Tabla,@Dummy);
    FETCH NEXT FROM CurConteo INTO @Esquema,@Tabla;
  END;
  CLOSE CurConteo;
  DEALLOCATE CurConteo;

  IF EXISTS (SELECT 1 FROM @Restantes)
  BEGIN
    SELECT Esquema,Tabla,Filas FROM @Restantes ORDER BY Esquema,Tabla;
    THROW 54005, 'Una o más tablas conservaron registros. Se revertirá todo.', 1;
  END;

  IF EXISTS (
    SELECT 1 FROM @EstadoFK E
    JOIN sys.foreign_keys F ON F.object_id=E.ObjectId
    WHERE F.is_disabled<>E.IsDisabled OR F.is_not_trusted<>E.IsNotTrusted
  ) OR EXISTS (
    SELECT 1 FROM @EstadoFK E WHERE NOT EXISTS (SELECT 1 FROM sys.foreign_keys F WHERE F.object_id=E.ObjectId)
  )
    THROW 54006, 'El estado o confianza de una FK difiere del estado inicial.', 1;

  IF EXISTS (
    SELECT 1 FROM @EstadoCheck E
    JOIN sys.check_constraints C ON C.object_id=E.ObjectId
    WHERE C.is_disabled<>E.IsDisabled OR C.is_not_trusted<>E.IsNotTrusted
  ) OR EXISTS (
    SELECT 1 FROM @EstadoCheck E
    WHERE NOT EXISTS (SELECT 1 FROM sys.check_constraints C WHERE C.object_id=E.ObjectId)
  )
    THROW 54007, 'El estado o confianza de un CHECK difiere del estado inicial.', 1;

  IF EXISTS (
    SELECT 1 FROM @EstadoTrigger E
    JOIN sys.triggers T ON T.object_id=E.ObjectId
    WHERE T.is_disabled<>E.IsDisabled
  ) OR EXISTS (
    SELECT 1 FROM @EstadoTrigger E
    WHERE NOT EXISTS (SELECT 1 FROM sys.triggers T WHERE T.object_id=E.ObjectId)
  )
    THROW 54008, 'El estado de un trigger difiere del estado inicial.', 1;

  IF EXISTS (
    SELECT 1 FROM @EstadoTemporal E
    LEFT JOIN sys.tables T ON T.object_id=E.ObjectId
    WHERE T.object_id IS NULL OR T.temporal_type<>2 OR T.history_table_id<>E.HistoryObjectId
  )
    THROW 54009, 'Una tabla temporal no recuperó su historial o temporalidad original.', 1;

  IF EXISTS (
    SELECT 1 FROM sys.tables T
    WHERE T.is_ms_shipped=0
      AND NOT EXISTS (SELECT 1 FROM @Objetivo O WHERE O.ObjectId=T.object_id)
  )
    THROW 54010, 'Apareció una tabla de usuario fuera del objetivo durante el vaciado.', 1;

  COMMIT TRANSACTION;

  SELECT N'VACIADO_COMPLETO' AS Estado,@BaseObjetivo AS BaseObjetivo,
    COUNT(*) AS TablasVaciadas,@REINICIAR_IDENTIDADES AS IdentidadesReiniciadas
  FROM @Objetivo;
  SELECT OrdenBorrado,Esquema,Tabla,Categoria
  FROM @Objetivo ORDER BY OrdenBorrado,Esquema,Tabla;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  -- Todos los cursores son LOCAL y se liberan al terminar el batch.
  THROW;
END CATCH;
