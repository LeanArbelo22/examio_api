/* Verificación de sólo lectura de 20261019_semantica_revision_unica.sql. */
SET NOCOUNT ON;

SELECT c.column_id,c.name AS Columna,t.name AS Tipo,c.max_length,c.is_nullable
FROM sys.columns c
JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE c.object_id=OBJECT_ID('dbo.SesionRevisionIntento')
  AND c.name IN ('DisponibleDesdeSnapshot','DisponibleHastaSnapshot','ExpiracionLimitadaPor')
ORDER BY c.column_id;

SELECT o.name AS Tabla,o.type_desc
FROM sys.objects o
WHERE o.object_id=OBJECT_ID('dbo.ConsumoRevisionUnicaIntento');

SELECT c.column_id,c.name AS Columna,t.name AS Tipo,c.max_length,c.is_nullable
FROM sys.columns c
JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE c.object_id=OBJECT_ID('dbo.ConsumoRevisionUnicaIntento')
ORDER BY c.column_id;

SELECT i.name AS Indice,i.is_unique,i.is_primary_key,i.has_filter,i.filter_definition
FROM sys.indexes i
WHERE i.object_id=OBJECT_ID('dbo.ConsumoRevisionUnicaIntento')
ORDER BY i.index_id;

SELECT fk.name AS ForeignKey,OBJECT_NAME(fk.referenced_object_id) AS TablaReferenciada
FROM sys.foreign_keys fk
WHERE fk.parent_object_id=OBJECT_ID('dbo.ConsumoRevisionUnicaIntento')
ORDER BY fk.name;

SELECT OBJECT_NAME(cc.parent_object_id) AS Tabla,cc.name AS CheckConstraint,cc.definition
FROM sys.check_constraints cc
WHERE (cc.parent_object_id=OBJECT_ID('dbo.ConsumoRevisionUnicaIntento'))
   OR (cc.parent_object_id=OBJECT_ID('dbo.SesionRevisionIntento')
       AND cc.name='CHK_SesionRevision_LimiteExpiracion')
   OR (cc.parent_object_id=OBJECT_ID('dbo.AuditoriaRevisionIntento')
       AND cc.name='CHK_AuditoriaRevision_Accion')
ORDER BY Tabla,CheckConstraint;

SELECT
  (SELECT COUNT(*) FROM dbo.ConsumoRevisionUnicaIntento) AS IntentosConAccesoUnicoConsumido,
  (SELECT COUNT(DISTINCT IdIntento) FROM dbo.SesionRevisionIntento
    WHERE AccesoSnapshot='unico' AND (Estado='consumida' OR CantidadConsumos>0))
    AS IntentosHistoricosConsumidos,
  (SELECT COUNT(*) FROM dbo.SesionRevisionIntento S
    WHERE S.AccesoSnapshot='unico' AND (S.Estado='consumida' OR S.CantidadConsumos>0)
      AND NOT EXISTS (
        SELECT 1 FROM dbo.ConsumoRevisionUnicaIntento U WHERE U.IdIntento=S.IdIntento
      )) AS SesionesConsumidasSinMarcador;

SELECT IdIntento,COUNT(*) AS Cantidad
FROM dbo.ConsumoRevisionUnicaIntento
GROUP BY IdIntento HAVING COUNT(*)>1;

SELECT U.IdIntento,U.IdSesion,U.IdUsuario,U.FechaConsumo,U.Origen
FROM dbo.ConsumoRevisionUnicaIntento U
LEFT JOIN dbo.SesionRevisionIntento S ON S.Id=U.IdSesion
WHERE S.Id IS NULL OR S.IdIntento<>U.IdIntento OR S.AccesoSnapshot<>'unico';

SELECT ExpiracionLimitadaPor,COUNT(*) AS Cantidad
FROM dbo.SesionRevisionIntento
GROUP BY ExpiracionLimitadaPor
ORDER BY ExpiracionLimitadaPor;
