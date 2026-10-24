/*
  Inventario y verificación de sólo lectura para GestionExamio-Migracion.
  No contiene DML, DDL, TRUNCATE, DBCC ni ejecución de procedimientos.
  Ejecutar antes y después del vaciado y conservar ambos resultados.
*/

SET NOCOUNT ON;

/* 1. La columna BaseCorrecta debe valer 1. */
SELECT DB_NAME() AS BaseActual,
  CONVERT(BIT,CASE WHEN DB_NAME()=N'GestionExamio-Migracion' THEN 1 ELSE 0 END) AS BaseCorrecta,
  (SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0) AS TablasUsuario,
  (SELECT COUNT(*) FROM sys.views WHERE is_ms_shipped=0) AS VistasUsuario,
  (SELECT COUNT(*) FROM sys.procedures WHERE is_ms_shipped=0) AS ProcedimientosUsuario;

/* 2. Tablas y cantidades. Después del vaciado, Filas debe ser cero en todas. */
SELECT S.name AS Esquema,T.name AS Tabla,
  COALESCE(SUM(CASE WHEN P.index_id IN (0,1) THEN P.rows ELSE 0 END),0) AS Filas,
  T.temporal_type_desc,T.is_memory_optimized,T.durability_desc,
  T.is_filetable,T.is_node,T.is_edge,T.ledger_type_desc,
  SH.name AS EsquemaHistorial,H.name AS TablaHistorial
FROM sys.tables T
JOIN sys.schemas S ON S.schema_id=T.schema_id
LEFT JOIN sys.partitions P ON P.object_id=T.object_id
LEFT JOIN sys.tables H ON H.object_id=T.history_table_id
LEFT JOIN sys.schemas SH ON SH.schema_id=H.schema_id
WHERE T.is_ms_shipped=0
GROUP BY S.name,T.name,T.temporal_type_desc,T.is_memory_optimized,T.durability_desc,
  T.is_filetable,T.is_node,T.is_edge,T.ledger_type_desc,SH.name,H.name
ORDER BY S.name,T.name;
/* 3. Sólo tablas con filas: el resultado posterior debe quedar vacío. */
SELECT S.name AS Esquema,T.name AS Tabla,
  SUM(CASE WHEN P.index_id IN (0,1) THEN P.rows ELSE 0 END) AS Filas
FROM sys.tables T
JOIN sys.schemas S ON S.schema_id=T.schema_id
JOIN sys.partitions P ON P.object_id=T.object_id
WHERE T.is_ms_shipped=0
GROUP BY S.name,T.name
HAVING SUM(CASE WHEN P.index_id IN (0,1) THEN P.rows ELSE 0 END)>0
ORDER BY S.name,T.name;
/* 4. Relaciones y acciones de borrado reales. */
SELECT FK.name AS ForeignKey,
  SH.name AS EsquemaHijo,TH.name AS TablaHijo,
  SP.name AS EsquemaPadre,TP.name AS TablaPadre,
  FK.delete_referential_action_desc,FK.update_referential_action_desc,
  FK.is_disabled,FK.is_not_trusted,
  CONVERT(BIT,CASE WHEN FK.parent_object_id=FK.referenced_object_id THEN 1 ELSE 0 END) AS EsAutorreferencia
FROM sys.foreign_keys FK
JOIN sys.tables TH ON TH.object_id=FK.parent_object_id
JOIN sys.schemas SH ON SH.schema_id=TH.schema_id
JOIN sys.tables TP ON TP.object_id=FK.referenced_object_id
JOIN sys.schemas SP ON SP.schema_id=TP.schema_id
WHERE TH.is_ms_shipped=0 OR TP.is_ms_shipped=0
ORDER BY SH.name,TH.name,FK.name;

/* 5. Ciclos reales entre FKs habilitadas. Resultado vacío significa que no
      hace falta suspender FKs; las autorreferencias aparecen como ciclo. */
;WITH Aristas AS (
  SELECT FK.object_id,FK.name,FK.parent_object_id AS Hijo,FK.referenced_object_id AS Padre
  FROM sys.foreign_keys FK
  JOIN sys.tables H ON H.object_id=FK.parent_object_id
  JOIN sys.tables P ON P.object_id=FK.referenced_object_id
  WHERE FK.is_disabled=0 AND H.is_ms_shipped=0 AND P.is_ms_shipped=0
), Caminos AS (
  SELECT A.Hijo AS Inicio,A.Padre AS Actual,
    CAST(N'/'+CONVERT(NVARCHAR(20),A.Hijo)+N'/'+CONVERT(NVARCHAR(20),A.Padre)+N'/' AS NVARCHAR(MAX)) AS Ruta
  FROM Aristas A
  UNION ALL
  SELECT C.Inicio,A.Padre,CAST(C.Ruta+CONVERT(NVARCHAR(20),A.Padre)+N'/' AS NVARCHAR(MAX))
  FROM Caminos C JOIN Aristas A ON A.Hijo=C.Actual
  WHERE C.Ruta NOT LIKE N'%/'+CONVERT(NVARCHAR(20),A.Padre)+N'/%'
)
SELECT DISTINCT A.name AS ForeignKey,
  OBJECT_SCHEMA_NAME(A.Hijo) AS EsquemaHijo,OBJECT_NAME(A.Hijo) AS TablaHijo,
  OBJECT_SCHEMA_NAME(A.Padre) AS EsquemaPadre,OBJECT_NAME(A.Padre) AS TablaPadre
FROM Aristas A
WHERE A.Hijo=A.Padre
   OR EXISTS (SELECT 1 FROM Caminos C WHERE C.Inicio=A.Padre AND C.Actual=A.Hijo)
ORDER BY EsquemaHijo,TablaHijo,ForeignKey
OPTION (MAXRECURSION 32767);

/* 6. Triggers. Sus estados deben coincidir antes y después. */
SELECT S.name AS Esquema,T.name AS Tabla,TR.name AS TriggerNombre,
  TR.is_disabled,TR.is_instead_of_trigger,TR.type_desc
FROM sys.triggers TR
JOIN sys.tables T ON T.object_id=TR.parent_id
JOIN sys.schemas S ON S.schema_id=T.schema_id
WHERE TR.is_ms_shipped=0
ORDER BY S.name,T.name,TR.name;

/* 7. Constraints que ya estaban deshabilitadas o no confiables. */
SELECT N'FOREIGN_KEY' AS Tipo,OBJECT_SCHEMA_NAME(parent_object_id) AS Esquema,
  OBJECT_NAME(parent_object_id) AS Tabla,name,is_disabled,is_not_trusted
FROM sys.foreign_keys
WHERE is_disabled=1 OR is_not_trusted=1
UNION ALL
SELECT N'CHECK',OBJECT_SCHEMA_NAME(parent_object_id),OBJECT_NAME(parent_object_id),
  name,is_disabled,is_not_trusted
FROM sys.check_constraints
WHERE is_disabled=1 OR is_not_trusted=1
ORDER BY Tipo,Esquema,Tabla,name;

/* 8. Identidades. last_value puede cambiar si se habilita el reseed. */
SELECT S.name AS Esquema,T.name AS Tabla,C.name AS Columna,
  IC.seed_value,IC.increment_value,IC.last_value
FROM sys.identity_columns IC
JOIN sys.tables T ON T.object_id=IC.object_id
JOIN sys.schemas S ON S.schema_id=T.schema_id
JOIN sys.columns C ON C.object_id=IC.object_id AND C.column_id=IC.column_id
WHERE T.is_ms_shipped=0
ORDER BY S.name,T.name;

/* 9. Secuencias: el script de vaciado no las reinicia. */
SELECT S.name AS Esquema,Q.name AS Secuencia,Q.start_value,Q.increment,
  Q.current_value,Q.is_cycling,Q.is_cached
FROM sys.sequences Q
JOIN sys.schemas S ON S.schema_id=Q.schema_id
ORDER BY S.name,Q.name;

/* 10. Tablas potencialmente técnicas/configuración/migración. También se vacían. */
SELECT S.name AS Esquema,T.name AS Tabla,
  CASE
    WHEN T.name IN (N'TipoEventoTelemetria') THEN N'catalogo técnico requerido por telemetría'
    WHEN T.name IN (N'ExamioTestDataLote',N'ExamioTestDataEntidad') THEN N'auxiliar exclusiva de pruebas'
    WHEN T.name=N'sysdiagrams' THEN N'diagramas guardados por herramientas de SQL Server'
    WHEN T.name LIKE N'%Migration%' OR T.name LIKE N'%Migracion%' THEN N'posible historial de migraciones'
    WHEN T.name LIKE N'%Config%' OR T.name LIKE N'%Version%' THEN N'posible configuración/versionado'
    ELSE N'seguridad/idempotencia/sesiones'
  END AS Clasificacion
FROM sys.tables T
JOIN sys.schemas S ON S.schema_id=T.schema_id
WHERE T.is_ms_shipped=0
  AND (T.name IN (N'TipoEventoTelemetria',N'ExamioTestDataLote',N'ExamioTestDataEntidad',N'sysdiagrams',
      N'OperacionIdempotente',N'AuthSession',N'AuthRefreshToken')
    OR T.name LIKE N'%Migration%' OR T.name LIKE N'%Migracion%'
    OR T.name LIKE N'%Config%' OR T.name LIKE N'%Version%')
ORDER BY S.name,T.name;
