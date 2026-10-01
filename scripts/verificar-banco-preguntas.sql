-- Solo lectura. Ejecutar manualmente después de la migración, en la base destino.
-- No inserta datos ni invoca procedimientos almacenados.
SET NOCOUNT ON;

SELECT DB_NAME() AS BaseActual;

-- Deben aparecer las siete tablas; revisar tipos, NULL, identity y auditoría.
SELECT t.name AS Tabla,c.name AS Columna,TYPE_NAME(c.user_type_id) AS Tipo,
       c.max_length,c.scale,c.is_nullable,c.is_identity,c.is_computed
FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN
 ('BancoPregunta','BancoOpcion','BancoGrupo','BancoGrupoPregunta','BancoEtiqueta','BancoPreguntaEtiqueta','BancoGrupoEtiqueta')
ORDER BY t.name,c.column_id;

-- Todas las FK y CHECK deben estar habilitadas y confiables (0,0).
SELECT OBJECT_NAME(parent_object_id) AS Tabla,name,is_disabled,is_not_trusted
FROM sys.foreign_keys
WHERE OBJECT_NAME(parent_object_id) LIKE 'Banco%' OR name IN ('FK_Pregunta_BancoOrigen','FK_GrupoPregunta_BancoOrigen');
SELECT OBJECT_NAME(parent_object_id) AS Tabla,name,is_disabled,is_not_trusted,definition
FROM sys.check_constraints
WHERE OBJECT_NAME(parent_object_id) LIKE 'Banco%' OR name IN ('CK_Pregunta_BancoOrigen','CK_GrupoPregunta_BancoOrigen');

SELECT OBJECT_NAME(i.object_id) AS Tabla,i.name,i.is_unique,i.is_disabled,c.name AS Columna,ic.key_ordinal
FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE OBJECT_NAME(i.object_id) LIKE 'Banco%' ORDER BY Tabla,i.name,ic.key_ordinal;

-- Las siguientes consultas requieren la migración aplicada.
-- Conteos informativos: una instalación nueva puede estar vacía.
SELECT IdDocente,Estado,COUNT(*) AS Preguntas FROM dbo.BancoPregunta GROUP BY IdDocente,Estado;
SELECT IdDocente,Estado,COUNT(*) AS Grupos FROM dbo.BancoGrupo GROUP BY IdDocente,Estado;

-- Deben devolver cero filas: grupos disponibles con composición inválida.
SELECT g.Id,g.TituloReferencia
FROM dbo.BancoGrupo g
WHERE g.Estado='disponible' AND
 (NOT EXISTS(SELECT 1 FROM dbo.BancoGrupoPregunta gp WHERE gp.IdGrupo=g.Id)
 OR EXISTS(SELECT 1 FROM dbo.BancoGrupoPregunta gp JOIN dbo.BancoPregunta p ON p.Id=gp.IdPregunta
           WHERE gp.IdGrupo=g.Id AND (p.Estado<>'disponible' OR p.IdDocente<>g.IdDocente)));

-- Preguntas disponibles no utilizables por el motor actual: cero filas.
SELECT p.Id,p.Tipo,p.Estado
FROM dbo.BancoPregunta p
OUTER APPLY(SELECT COUNT(*) AS Total,
 SUM(CASE WHEN o.EsCorrecta=1 THEN 1 ELSE 0 END) AS Correctas,
 SUM(CASE WHEN LEN(LTRIM(RTRIM(o.Texto)))=0 THEN 1 ELSE 0 END) AS Vacias
 FROM dbo.BancoOpcion o WHERE o.IdPregunta=p.Id) o
WHERE p.Estado='disponible' AND
 (LEN(LTRIM(RTRIM(p.Enunciado)))=0 OR p.Tipo='code'
 OR (p.Tipo='abierta' AND o.Total<>0)
 OR (p.Tipo IN ('mc','vf') AND (o.Total<2 OR ISNULL(o.Correctas,0)<>1 OR o.Vacias>0))
 OR (p.Tipo='vf' AND (o.Total<>2 OR
     NOT EXISTS(SELECT 1 FROM dbo.BancoOpcion v WHERE v.IdPregunta=p.Id AND LOWER(LTRIM(RTRIM(v.Texto)))=N'verdadero') OR
     NOT EXISTS(SELECT 1 FROM dbo.BancoOpcion f WHERE f.IdPregunta=p.Id AND LOWER(LTRIM(RTRIM(f.Texto)))=N'falso'))));

-- Procedencia: una revisión de origen inferior a la actual es normal.
-- Nunca debe corregirse automáticamente ni sincronizarse el examen.
SELECT p.Id AS IdPreguntaEvaluacion,g.IdActividad,p.IdBancoPreguntaOrigen,
       p.RevisionBancoOrigen,b.Revision AS RevisionActualBanco,p.FechaIncorporacionBanco
FROM dbo.Pregunta p JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta
JOIN dbo.BancoPregunta b ON b.Id=p.IdBancoPreguntaOrigen
ORDER BY g.IdActividad,p.Id;

-- Deuda previa: borradores que ya tienen intentos; la API bloquea su edición.
SELECT DISTINCT a.Id,a.Estado FROM dbo.Actividad a
JOIN dbo.Publicacion p ON p.IdActividad=a.Id JOIN dbo.Intento i ON i.IdPublicacion=p.Id
WHERE a.Estado='borrador';
