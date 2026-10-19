/* Verificación de sólo lectura de 20261020_visibilidad_incidentes.sql. */
SET NOCOUNT ON;

SELECT o.name AS Tabla,o.type_desc
FROM sys.objects o
WHERE o.object_id=OBJECT_ID('dbo.RevisionIncidenteIntento');

SELECT c.column_id,c.name AS Columna,t.name AS Tipo,c.max_length,c.is_nullable
FROM sys.columns c
JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE c.object_id=OBJECT_ID('dbo.RevisionIncidenteIntento')
ORDER BY c.column_id;

SELECT i.name AS Indice,i.is_unique,i.is_primary_key,i.has_filter,i.filter_definition
FROM sys.indexes i
WHERE i.object_id=OBJECT_ID('dbo.RevisionIncidenteIntento') AND i.name IS NOT NULL
ORDER BY i.index_id;

SELECT fk.name AS ForeignKey,OBJECT_NAME(fk.referenced_object_id) AS TablaReferenciada,
  fk.delete_referential_action_desc
FROM sys.foreign_keys fk
WHERE fk.parent_object_id=OBJECT_ID('dbo.RevisionIncidenteIntento')
ORDER BY fk.name;

SELECT cc.name AS CheckConstraint,cc.definition
FROM sys.check_constraints cc
WHERE cc.parent_object_id=OBJECT_ID('dbo.RevisionIncidenteIntento')
ORDER BY cc.name;

SELECT IdIncidente,Revision,COUNT(*) AS Cantidad
FROM dbo.RevisionIncidenteIntento
GROUP BY IdIncidente,Revision
HAVING COUNT(*)>1;

SELECT R.Id,R.IdIncidente
FROM dbo.RevisionIncidenteIntento R
LEFT JOIN dbo.IncidenteIntento E ON E.Id=R.IdIncidente
WHERE E.Id IS NULL;

WITH Ultima AS (
  SELECT R.*,ROW_NUMBER() OVER (PARTITION BY R.IdIncidente ORDER BY R.Revision DESC) AS rn
  FROM dbo.RevisionIncidenteIntento R
)
SELECT COALESCE(U.Estado,'pendiente') AS EstadoRevision,COUNT_BIG(*) AS Cantidad
FROM dbo.IncidenteIntento E
JOIN dbo.TipoEventoTelemetria T ON T.Tipo=E.Tipo AND T.EsIncidente=1
LEFT JOIN Ultima U ON U.IdIncidente=E.Id AND U.rn=1
GROUP BY COALESCE(U.Estado,'pendiente')
ORDER BY EstadoRevision;

SELECT TOP (100) E.Id AS IdIncidente,E.IdIntento,E.EventoId,E.Tipo,
  COALESCE(D.Accion,'sin_clasificar') AS Severidad,
  COALESCE(R.Estado,'pendiente') AS EstadoRevision,COALESCE(R.Revision,0) AS Revision
FROM dbo.IncidenteIntento E
JOIN dbo.TipoEventoTelemetria T ON T.Tipo=E.Tipo AND T.EsIncidente=1
LEFT JOIN dbo.DecisionSupervisionIntento D
  ON D.IdIntento=E.IdIntento AND D.EventoId=E.EventoId
OUTER APPLY (
  SELECT TOP (1) X.Estado,X.Revision
  FROM dbo.RevisionIncidenteIntento X
  WHERE X.IdIncidente=E.Id
  ORDER BY X.Revision DESC
) R
ORDER BY E.Id DESC;
