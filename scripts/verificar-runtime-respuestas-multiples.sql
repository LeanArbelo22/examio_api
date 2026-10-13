/* Verificación de sólo lectura para 20261014_runtime_respuestas_multiples.sql. */
SET NOCOUNT ON;

SELECT t.name AS Tabla,c.name AS Columna,ty.name AS Tipo,c.max_length,c.is_nullable
FROM sys.tables t
JOIN sys.columns c ON c.object_id=t.object_id
JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.name='IntentoPregunta' AND c.name IN ('EnunciadoSnapshot','GrupoTituloSnapshot')
ORDER BY c.column_id;

SELECT o.name AS Procedimiento,o.modify_date
FROM sys.objects o
WHERE o.type='P' AND o.name IN (
  'SP_Intento_IniciarExamen','SP_Intento_ObtenerExamenDinamico',
  'SP_Pregunta_ObtenerOpciones','SP_Intento_FinalizarExamen'
)
ORDER BY o.name;

SELECT name,is_unique,has_filter,filter_definition
FROM sys.indexes
WHERE object_id=OBJECT_ID(N'dbo.Respuesta') AND name='UX_Respuesta_Intento_Pregunta';

SELECT IdIntento,IdPregunta,COUNT_BIG(*) AS Cantidad
FROM dbo.Respuesta
GROUP BY IdIntento,IdPregunta
HAVING COUNT_BIG(*)>1;

SELECT IP.Id,IP.IdIntento,IP.IdPregunta,IP.TipoSnapshot,
  IP.EnunciadoSnapshot,IP.GrupoTituloSnapshot,IP.SnapshotReconstruido
FROM dbo.IntentoPregunta IP
WHERE IP.EnunciadoSnapshot IS NULL OR IP.GrupoTituloSnapshot IS NULL
   OR IP.TipoSnapshot IS NULL;

SELECT IP.Id AS IdIntentoPregunta,IP.TipoSnapshot,
  COUNT(S.Id) AS OpcionesSnapshot
FROM dbo.IntentoPregunta IP
LEFT JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
GROUP BY IP.Id,IP.TipoSnapshot
HAVING (IP.TipoSnapshot IN ('mc','multiple','vf') AND COUNT(S.Id)<2)
    OR (IP.TipoSnapshot IN ('abierta','code') AND COUNT(S.Id)>0);

SELECT R.Id AS IdRespuesta,R.IdIntento,R.IdPregunta,RO.IdOpcion
FROM dbo.Respuesta R
JOIN dbo.RespuestaOpcion RO ON RO.IdRespuesta=R.Id
JOIN dbo.IntentoPregunta IP ON IP.IdIntento=R.IdIntento AND IP.IdPregunta=R.IdPregunta
LEFT JOIN dbo.IntentoPreguntaOpcionSnapshot S
  ON S.IdIntentoPregunta=IP.Id AND S.IdOpcionOrigen=RO.IdOpcion
WHERE S.Id IS NULL;

SELECT R.Id,R.IdIntento,R.IdPregunta,R.Revision
FROM dbo.Respuesta R WHERE R.Revision<0;
