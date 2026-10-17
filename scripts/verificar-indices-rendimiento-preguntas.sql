/* Verificación de sólo lectura de 20261017_indices_rendimiento_preguntas.sql. */
SET NOCOUNT ON;

SELECT OBJECT_SCHEMA_NAME(i.object_id) AS Esquema,
  OBJECT_NAME(i.object_id) AS Tabla,i.name AS Indice,i.is_unique,
  i.is_disabled,i.has_filter,i.filter_definition
FROM sys.indexes i
WHERE i.name IN (
  'IX_Intento_Publicacion_Alumno_Estado_Fecha',
  'IX_IntentoPregunta_Intento_Pregunta_Rendimiento',
  'IX_MetricasNavegacion_Intento_Pregunta'
)
ORDER BY Tabla,Indice;

SELECT OBJECT_NAME(i.object_id) AS Tabla,i.name AS Indice,
  ic.key_ordinal,ic.is_included_column,c.name AS Columna
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE i.name IN (
  'IX_Intento_Publicacion_Alumno_Estado_Fecha',
  'IX_IntentoPregunta_Intento_Pregunta_Rendimiento',
  'IX_MetricasNavegacion_Intento_Pregunta'
)
ORDER BY Tabla,Indice,ic.is_included_column,ic.key_ordinal,c.column_id;

SELECT OBJECT_NAME(p.object_id) AS Tabla,SUM(p.rows) AS Filas
FROM sys.partitions p
WHERE p.index_id IN (0,1)
  AND OBJECT_NAME(p.object_id) IN (
    'Intento','IntentoPregunta','IncidenteIntento','MetricasNavegacion',
    'Respuesta','RespuestaOpcion','IntentoPreguntaOpcionSnapshot'
  )
GROUP BY p.object_id
ORDER BY Tabla;

SELECT OBJECT_NAME(i.object_id) AS Tabla,i.name AS Indice,
  COALESCE(s.user_seeks,0) AS UserSeeks,COALESCE(s.user_scans,0) AS UserScans,
  COALESCE(s.user_lookups,0) AS UserLookups,COALESCE(s.user_updates,0) AS UserUpdates,
  s.last_user_seek AS UltimoSeek,s.last_user_scan AS UltimoScan
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats s
  ON s.database_id=DB_ID() AND s.object_id=i.object_id AND s.index_id=i.index_id
WHERE i.name IN (
  'IX_Intento_Publicacion_Alumno_Estado_Fecha',
  'IX_IntentoPregunta_Intento_Pregunta_Rendimiento',
  'IX_MetricasNavegacion_Intento_Pregunta'
)
ORDER BY Tabla,Indice;

-- Posibles recomendaciones del optimizador después de ejecutar los tres reportes.
-- Son diagnóstico, no autorización para crear índices adicionales automáticamente.
SELECT TOP (20) OBJECT_NAME(d.object_id,d.database_id) AS Tabla,
  gs.user_seeks,gs.avg_total_user_cost,gs.avg_user_impact,
  d.equality_columns,d.inequality_columns,d.included_columns
FROM sys.dm_db_missing_index_group_stats gs
JOIN sys.dm_db_missing_index_groups g ON g.index_group_handle=gs.group_handle
JOIN sys.dm_db_missing_index_details d ON d.index_handle=g.index_handle
WHERE d.database_id=DB_ID()
  AND OBJECT_NAME(d.object_id,d.database_id) IN (
    'Intento','IntentoPregunta','IncidenteIntento','MetricasNavegacion',
    'Respuesta','RespuestaOpcion','IntentoPreguntaOpcionSnapshot'
  )
ORDER BY gs.user_seeks*gs.avg_total_user_cost*gs.avg_user_impact DESC;
