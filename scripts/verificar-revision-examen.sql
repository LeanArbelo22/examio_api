/* Verificación de sólo lectura de 20261018_revision_examen.sql. */
SET NOCOUNT ON;

SELECT o.name AS Tabla,o.type_desc
FROM sys.objects o
WHERE o.name IN (
  'PoliticaRevisionPublicacion','PermisoRevisionIntento',
  'SesionRevisionIntento','AuditoriaRevisionIntento'
)
ORDER BY o.name;

SELECT OBJECT_NAME(c.object_id) AS Tabla,c.column_id,c.name AS Columna,
  t.name AS Tipo,c.max_length,c.is_nullable
FROM sys.columns c
JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE c.object_id IN (
  OBJECT_ID('dbo.PoliticaRevisionPublicacion'),OBJECT_ID('dbo.PermisoRevisionIntento'),
  OBJECT_ID('dbo.SesionRevisionIntento'),OBJECT_ID('dbo.AuditoriaRevisionIntento')
)
ORDER BY Tabla,c.column_id;

SELECT OBJECT_NAME(i.object_id) AS Tabla,i.name AS Indice,i.is_unique,
  i.has_filter,i.filter_definition
FROM sys.indexes i
WHERE i.object_id IN (
  OBJECT_ID('dbo.PoliticaRevisionPublicacion'),OBJECT_ID('dbo.PermisoRevisionIntento'),
  OBJECT_ID('dbo.SesionRevisionIntento'),OBJECT_ID('dbo.AuditoriaRevisionIntento')
)
ORDER BY Tabla,i.name;

SELECT OBJECT_NAME(fk.parent_object_id) AS Tabla,fk.name AS ForeignKey
FROM sys.foreign_keys fk
WHERE fk.parent_object_id IN (
  OBJECT_ID('dbo.PoliticaRevisionPublicacion'),OBJECT_ID('dbo.PermisoRevisionIntento'),
  OBJECT_ID('dbo.SesionRevisionIntento'),OBJECT_ID('dbo.AuditoriaRevisionIntento')
)
ORDER BY Tabla,ForeignKey;

SELECT OBJECT_NAME(cc.parent_object_id) AS Tabla,cc.name AS CheckConstraint,cc.definition
FROM sys.check_constraints cc
WHERE cc.parent_object_id IN (
  OBJECT_ID('dbo.PoliticaRevisionPublicacion'),OBJECT_ID('dbo.PermisoRevisionIntento'),
  OBJECT_ID('dbo.SesionRevisionIntento'),OBJECT_ID('dbo.AuditoriaRevisionIntento')
)
ORDER BY Tabla,CheckConstraint;

SELECT
  (SELECT COUNT(*) FROM dbo.Publicacion) AS Publicaciones,
  (SELECT COUNT(*) FROM dbo.PoliticaRevisionPublicacion) AS Politicas,
  (SELECT COUNT(*) FROM dbo.Publicacion P
    WHERE NOT EXISTS (SELECT 1 FROM dbo.PoliticaRevisionPublicacion PR WHERE PR.IdPublicacion=P.Id))
    AS PublicacionesSinPolitica,
  (SELECT COUNT(*) FROM dbo.PoliticaRevisionPublicacion
    WHERE Modo='al_corregir' AND Acceso='libre') AS PoliticasCompatibles;

SELECT Estado,Acceso,COUNT(*) AS Cantidad
FROM dbo.PermisoRevisionIntento GROUP BY Estado,Acceso ORDER BY Estado,Acceso;

SELECT Estado,AccesoSnapshot,COUNT(*) AS Cantidad,
  SUM(CASE WHEN EsActivaUnica=1 THEN 1 ELSE 0 END) AS ActivasUnicas
FROM dbo.SesionRevisionIntento GROUP BY Estado,AccesoSnapshot ORDER BY Estado,AccesoSnapshot;

SELECT IdIntento,COUNT(*) AS SesionesActivasUnicas
FROM dbo.SesionRevisionIntento
WHERE EsActivaUnica=1
GROUP BY IdIntento HAVING COUNT(*)>1;

SELECT TOP (50) Id,IdPublicacion,IdIntento,IdSesion,IdUsuario,ActorRol,Accion,Fecha
FROM dbo.AuditoriaRevisionIntento ORDER BY Id DESC;
