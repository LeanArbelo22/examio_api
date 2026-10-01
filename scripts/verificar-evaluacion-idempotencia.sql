SET NOCOUNT ON;

SELECT c.name, TYPE_NAME(c.user_type_id) AS Tipo, c.max_length, c.is_nullable,
       dc.name AS DefaultConstraint
FROM sys.columns c
LEFT JOIN sys.default_constraints dc
  ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE c.object_id = OBJECT_ID(N'dbo.Actividad') AND c.name = N'Revision';

SELECT c.name, TYPE_NAME(c.user_type_id) AS Tipo, c.max_length, c.is_nullable
FROM sys.columns c
WHERE c.object_id = OBJECT_ID(N'dbo.OperacionIdempotente')
ORDER BY c.column_id;

SELECT i.name, i.is_unique, i.type_desc
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID(N'dbo.OperacionIdempotente') AND i.name IS NOT NULL
ORDER BY i.name;

SELECT Estado, COUNT_BIG(*) AS Cantidad, MIN(FechaCreacion) AS Primera, MAX(FechaActualizacion) AS Ultima
FROM dbo.OperacionIdempotente
GROUP BY Estado;
