/* Verificación de sólo lectura para 20261013_respuestas_multiples_justificacion.sql. */
SET NOCOUNT ON;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id=OBJECT_ID(N'dbo.Pregunta')
    AND name=N'CHK_Pregunta_Tipo'
    AND definition LIKE N'%multiple%'
)
  THROW 51310, 'CHK_Pregunta_Tipo no admite el tipo multiple.', 1;

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id=OBJECT_ID(N'dbo.Pregunta')
    AND definition LIKE N'%Tipo%'
    AND definition NOT LIKE N'%ModoJustificacion%'
    AND definition NOT LIKE N'%EstrategiaCorreccion%'
    AND definition NOT LIKE N'%multiple%'
)
  THROW 51312, 'Existe otro check legacy que bloquea Pregunta.Tipo=multiple.', 1;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id=OBJECT_ID(N'dbo.BancoPregunta')
    AND name=N'CHK_BancoPregunta_Tipo'
    AND definition LIKE N'%multiple%'
)
  THROW 51311, 'CHK_BancoPregunta_Tipo no admite el tipo multiple.', 1;

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id=OBJECT_ID(N'dbo.BancoPregunta')
    AND definition LIKE N'%Tipo%'
    AND definition NOT LIKE N'%ModoJustificacion%'
    AND definition NOT LIKE N'%EstrategiaCorreccion%'
    AND definition NOT LIKE N'%multiple%'
)
  THROW 51313, 'Existe otro check legacy que bloquea BancoPregunta.Tipo=multiple.', 1;

SELECT t.name AS Tabla,c.name AS Columna,ty.name AS Tipo,c.max_length AS Longitud,c.is_nullable AS AdmiteNull
FROM sys.tables t
JOIN sys.columns c ON c.object_id=t.object_id
JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE (t.name IN ('Pregunta','BancoPregunta') AND c.name IN
  ('ModoJustificacion','EstrategiaCorreccion','TratamientoJustificacion','ContenidoHash'))
   OR (t.name='Respuesta' AND c.name IN ('Justificacion','Revision'))
   OR (t.name='IntentoPregunta' AND c.name IN
  ('TipoSnapshot','ModoJustificacionSnapshot','EstrategiaCorreccionSnapshot','TratamientoJustificacionSnapshot',
   'ContenidoHashSnapshot','PuntajeAutomaticoOpciones','SnapshotReconstruido'))
ORDER BY t.name,c.column_id;

SELECT name,type_desc
FROM sys.objects
WHERE name IN ('IntentoPreguntaOpcionSnapshot','HistorialRespuestaCambio')
ORDER BY name;

SELECT OBJECT_NAME(parent_object_id) AS Tabla,name,definition,is_disabled,is_not_trusted
FROM sys.check_constraints
WHERE name IN ('CHK_Pregunta_Tipo','CHK_BancoPregunta_Tipo','CHK_Pregunta_Configuracion',
  'CHK_BancoPregunta_Configuracion','CHK_Pregunta_ContenidoHash','CHK_BancoPregunta_ContenidoHash',
  'CHK_Respuesta_Revision','CHK_IntentoPregunta_PuntajeAutomaticoOpciones')
ORDER BY Tabla,name;

SELECT OBJECT_NAME(object_id) AS Tabla,name,is_unique,has_filter,filter_definition
FROM sys.indexes
WHERE name IN ('IX_Pregunta_ContenidoHash','IX_BancoPregunta_ContenidoHash',
  'UX_IntentoPreguntaOpcionSnapshot_Origen','IX_HistorialRespuestaCambio_IntentoPregunta_Fecha')
ORDER BY Tabla,name;

SELECT 'PreguntaConfiguracionInvalida' AS Control,COUNT_BIG(*) AS Errores
FROM dbo.Pregunta
WHERE Tipo NOT IN (N'mc',N'multiple',N'vf',N'abierta',N'code')
   OR ModoJustificacion NOT IN (N'sin_justificacion',N'opcional',N'obligatoria')
   OR EstrategiaCorreccion NOT IN (N'exacta',N'parcial_sin_penalizacion',N'parcial_penalizada')
   OR TratamientoJustificacion NOT IN (N'informativa',N'revision_manual')
   OR (Tipo<>N'multiple' AND EstrategiaCorreccion<>N'exacta')
   OR (ModoJustificacion=N'sin_justificacion' AND TratamientoJustificacion<>N'informativa')
UNION ALL
SELECT 'BancoConfiguracionInvalida',COUNT_BIG(*) FROM dbo.BancoPregunta
WHERE Tipo NOT IN (N'mc',N'multiple',N'vf',N'abierta',N'code')
   OR ModoJustificacion NOT IN (N'sin_justificacion',N'opcional',N'obligatoria')
   OR EstrategiaCorreccion NOT IN (N'exacta',N'parcial_sin_penalizacion',N'parcial_penalizada')
   OR TratamientoJustificacion NOT IN (N'informativa',N'revision_manual')
   OR (Tipo<>N'multiple' AND EstrategiaCorreccion<>N'exacta')
   OR (ModoJustificacion=N'sin_justificacion' AND TratamientoJustificacion<>N'informativa')
UNION ALL
SELECT 'PreguntaHashFaltante',COUNT_BIG(*) FROM dbo.Pregunta WHERE ContenidoHash IS NULL OR LEN(ContenidoHash)<>64
UNION ALL
SELECT 'BancoHashFaltante',COUNT_BIG(*) FROM dbo.BancoPregunta WHERE ContenidoHash IS NULL OR LEN(ContenidoHash)<>64
UNION ALL
SELECT 'IntentoSnapshotConfiguracionFaltante',COUNT_BIG(*) FROM dbo.IntentoPregunta
WHERE TipoSnapshot IS NULL OR ModoJustificacionSnapshot IS NULL OR EstrategiaCorreccionSnapshot IS NULL
   OR TratamientoJustificacionSnapshot IS NULL OR ContenidoHashSnapshot IS NULL
UNION ALL
SELECT 'SnapshotOpcionDuplicada',COUNT_BIG(*) FROM (
  SELECT IdIntentoPregunta,Posicion FROM dbo.IntentoPreguntaOpcionSnapshot
  GROUP BY IdIntentoPregunta,Posicion HAVING COUNT(*)>1
) D
UNION ALL
SELECT 'PuntajeAutomaticoFueraDeRango',COUNT_BIG(*) FROM dbo.IntentoPregunta
WHERE PuntajeAutomaticoOpciones<0 OR PuntajeAutomaticoOpciones>PuntajeMaximoSnapshot;

SELECT Tipo,ModoJustificacion,EstrategiaCorreccion,TratamientoJustificacion,COUNT_BIG(*) AS Cantidad
FROM dbo.Pregunta
GROUP BY Tipo,ModoJustificacion,EstrategiaCorreccion,TratamientoJustificacion
ORDER BY Tipo,ModoJustificacion,EstrategiaCorreccion,TratamientoJustificacion;

SELECT SnapshotReconstruido,COUNT_BIG(*) AS IntentosPregunta,
  SUM(CASE WHEN S.CantidadOpciones IS NULL THEN 0 ELSE S.CantidadOpciones END) AS OpcionesCongeladas
FROM dbo.IntentoPregunta IP
OUTER APPLY (SELECT COUNT_BIG(*) AS CantidadOpciones FROM dbo.IntentoPreguntaOpcionSnapshot O WHERE O.IdIntentoPregunta=IP.Id) S
GROUP BY SnapshotReconstruido
ORDER BY SnapshotReconstruido;
