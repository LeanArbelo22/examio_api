/* Verificación de sólo lectura de 20261019_politicas_supervision.sql. */
SET NOCOUNT ON;

SELECT o.name AS Tabla,o.type_desc
FROM sys.objects o
WHERE o.name IN (
  'PoliticaSupervisionPublicacion','ReglaSupervisionPublicacion',
  'IntentoPoliticaSupervision','IntentoReglaSupervision',
  'EstadoSupervisionIntento','DecisionSupervisionIntento','OverrideSupervisionIntento'
)
ORDER BY o.name;

SELECT OBJECT_NAME(c.object_id) AS Tabla,c.column_id,c.name AS Columna,
  t.name AS Tipo,c.max_length,c.is_nullable
FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE c.object_id IN (
  OBJECT_ID('dbo.PoliticaSupervisionPublicacion'),OBJECT_ID('dbo.ReglaSupervisionPublicacion'),
  OBJECT_ID('dbo.IntentoPoliticaSupervision'),OBJECT_ID('dbo.IntentoReglaSupervision'),
  OBJECT_ID('dbo.EstadoSupervisionIntento'),OBJECT_ID('dbo.DecisionSupervisionIntento'),
  OBJECT_ID('dbo.OverrideSupervisionIntento')
)
ORDER BY Tabla,c.column_id;

SELECT OBJECT_NAME(i.object_id) AS Tabla,i.name AS Indice,i.is_unique,
  i.is_primary_key,i.has_filter,i.filter_definition
FROM sys.indexes i
WHERE i.object_id IN (
  OBJECT_ID('dbo.PoliticaSupervisionPublicacion'),OBJECT_ID('dbo.ReglaSupervisionPublicacion'),
  OBJECT_ID('dbo.IntentoPoliticaSupervision'),OBJECT_ID('dbo.IntentoReglaSupervision'),
  OBJECT_ID('dbo.EstadoSupervisionIntento'),OBJECT_ID('dbo.DecisionSupervisionIntento'),
  OBJECT_ID('dbo.OverrideSupervisionIntento')
) AND i.name IS NOT NULL
ORDER BY Tabla,i.index_id;

SELECT OBJECT_NAME(fk.parent_object_id) AS Tabla,fk.name AS ForeignKey,
  OBJECT_NAME(fk.referenced_object_id) AS TablaReferenciada,
  fk.delete_referential_action_desc
FROM sys.foreign_keys fk
WHERE fk.parent_object_id IN (
  OBJECT_ID('dbo.PoliticaSupervisionPublicacion'),OBJECT_ID('dbo.ReglaSupervisionPublicacion'),
  OBJECT_ID('dbo.IntentoPoliticaSupervision'),OBJECT_ID('dbo.IntentoReglaSupervision'),
  OBJECT_ID('dbo.EstadoSupervisionIntento'),OBJECT_ID('dbo.DecisionSupervisionIntento'),
  OBJECT_ID('dbo.OverrideSupervisionIntento')
)
ORDER BY Tabla,fk.name;

SELECT OBJECT_NAME(cc.parent_object_id) AS Tabla,cc.name AS CheckConstraint,cc.definition
FROM sys.check_constraints cc
WHERE cc.parent_object_id IN (
  OBJECT_ID('dbo.PoliticaSupervisionPublicacion'),OBJECT_ID('dbo.ReglaSupervisionPublicacion'),
  OBJECT_ID('dbo.IntentoPoliticaSupervision'),OBJECT_ID('dbo.IntentoReglaSupervision'),
  OBJECT_ID('dbo.EstadoSupervisionIntento'),OBJECT_ID('dbo.DecisionSupervisionIntento'),
  OBJECT_ID('dbo.OverrideSupervisionIntento'),OBJECT_ID('dbo.AnulacionIntentoIncidente')
)
ORDER BY Tabla,cc.name;

SELECT c.name AS Columna,t.name AS Tipo,c.is_nullable
FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE c.object_id=OBJECT_ID('dbo.AnulacionIntentoIncidente')
  AND c.name IN ('AnuladoPor','ActorTipo')
ORDER BY c.column_id;

SELECT
  (SELECT COUNT(*) FROM dbo.Publicacion P WHERE NOT EXISTS (
    SELECT 1 FROM dbo.PoliticaSupervisionPublicacion X WHERE X.IdPublicacion=P.Id
  )) AS PublicacionesSinPolitica,
  (SELECT COUNT(*) FROM dbo.Intento I WHERE NOT EXISTS (
    SELECT 1 FROM dbo.IntentoPoliticaSupervision X WHERE X.IdIntento=I.Id
  )) AS IntentosSinSnapshot,
  (SELECT COUNT(*) FROM dbo.Intento I WHERE NOT EXISTS (
    SELECT 1 FROM dbo.EstadoSupervisionIntento X WHERE X.IdIntento=I.Id
  )) AS IntentosSinEstado,
  (SELECT COUNT(*) FROM dbo.IntentoPoliticaSupervision P WHERE NOT EXISTS (
    SELECT 1 FROM dbo.IntentoReglaSupervision R WHERE R.IdIntento=P.IdIntento
  )) AS SnapshotsSinReglas;

SELECT IdPublicacion,Codigo,COUNT(*) AS Cantidad
FROM dbo.ReglaSupervisionPublicacion
GROUP BY IdPublicacion,Codigo HAVING COUNT(*)>1;

SELECT IdIntento,Codigo,COUNT(*) AS Cantidad
FROM dbo.IntentoReglaSupervision
GROUP BY IdIntento,Codigo HAVING COUNT(*)>1;

SELECT IdIntento,EventoId,COUNT(*) AS Cantidad
FROM dbo.DecisionSupervisionIntento
GROUP BY IdIntento,EventoId HAVING COUNT(*)>1;

SELECT IdIntento,EventoId,ActorTipo,AnuladoPor
FROM dbo.AnulacionIntentoIncidente
WHERE (ActorTipo='sistema' AND AnuladoPor IS NOT NULL)
   OR (ActorTipo='usuario' AND AnuladoPor IS NULL)
   OR ActorTipo NOT IN ('sistema','usuario');

SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.SP_Intento_IniciarExamen')) AS DefinicionInicio;
