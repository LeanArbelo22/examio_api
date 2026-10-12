/* Solo lectura. Ejecutar después de 20261011_calificacion_intentos_telemetria.sql. */
SET NOCOUNT ON;

SELECT 'columnas_requeridas' AS Verificacion, t.name AS Tabla, c.name AS Columna,
  ty.name AS Tipo, c.max_length AS Longitud, c.precision AS Precision, c.scale AS Escala, c.is_nullable AS EsNullable
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE (t.name = 'Actividad' AND c.name IN ('EscalaCalificacion','NotaAprobacion','ModoPuntaje','MostrarPuntajePorPregunta','CorreccionAutomaticaCerradas'))
   OR (t.name = 'GrupoPregunta' AND c.name = 'PuntajeMaximo')
   OR (t.name = 'Intento' AND c.name IN ('NotaFinal','NotaAutomatica','NotaFinalCalculada','NotaFinalManual'))
   OR (t.name = 'IntentoPregunta' AND c.name IN ('PuntajeMaximoSnapshot','PuntajeObtenido','OrigenCorreccion','ComentariosDocente','CorregidoPor','FechaCorreccion'))
ORDER BY t.name, c.column_id;

SELECT 'objetos_requeridos' AS Verificacion, name AS Objeto, type_desc AS Tipo
FROM sys.objects
WHERE name IN (
  'HistorialCorreccionIntentoPregunta','HistorialNotaIntento','IntentoValidoOverride',
  'HistorialIntentoValidoOverride','IncidenteIntento','SP_Intento_IniciarExamen',
  'SP_Intento_ObtenerExamenDinamico','SP_Intento_FinalizarExamen'
)
ORDER BY name;

SELECT 'constraints_calificacion' AS Verificacion, name, type_desc
FROM sys.objects
WHERE name IN (
  'CHK_Actividad_EscalaCalificacion','CHK_Actividad_NotaAprobacion','CHK_Actividad_ModoPuntaje',
  'CHK_GrupoPregunta_PuntajeMaximo','CHK_IntentoPregunta_Puntajes',
  'UQ_IntentoValidoOverride_Intento','UQ_IncidenteIntento_Intento_Evento'
)
ORDER BY name;

SELECT 'actividad_configuracion_invalida' AS Anomalia, A.Id, A.EscalaCalificacion,
  A.NotaAprobacion, A.ModoPuntaje
FROM dbo.Actividad A
WHERE A.EscalaCalificacion NOT IN (10,100)
   OR A.NotaAprobacion < 0 OR A.NotaAprobacion > A.EscalaCalificacion
   OR A.ModoPuntaje NOT IN ('iguales','personalizados');

SELECT 'puntaje_personalizado_invalido' AS Anomalia, A.Id AS IdActividad,
  A.EscalaCalificacion, SUM(GP.PuntajeMaximo) AS PuntajeTotal,
  SUM(CASE WHEN GP.PuntajeMaximo IS NULL THEN 1 ELSE 0 END) AS GruposSinPuntaje
FROM dbo.Actividad A
JOIN dbo.GrupoPregunta GP ON GP.IdActividad = A.Id
WHERE A.ModoPuntaje = 'personalizados' AND A.Estado IN ('publicada','archivada')
GROUP BY A.Id, A.EscalaCalificacion
HAVING SUM(CASE WHEN GP.PuntajeMaximo IS NULL THEN 1 ELSE 0 END) > 0
    OR SUM(GP.PuntajeMaximo) <> A.EscalaCalificacion;

SELECT 'puntaje_pregunta_fuera_de_rango' AS Anomalia, IP.Id, IP.IdIntento,
  IP.PuntajeMaximoSnapshot, IP.PuntajeObtenido
FROM dbo.IntentoPregunta IP
WHERE IP.PuntajeMaximoSnapshot < 0 OR IP.PuntajeObtenido < 0
   OR IP.PuntajeObtenido > IP.PuntajeMaximoSnapshot;

SELECT 'nota_intento_fuera_de_escala' AS Anomalia, I.Id, A.EscalaCalificacion,
  I.NotaFinal, I.NotaAutomatica, I.NotaFinalCalculada, I.NotaFinalManual
FROM dbo.Intento I
JOIN dbo.Publicacion P ON P.Id = I.IdPublicacion
JOIN dbo.Actividad A ON A.Id = P.IdActividad
WHERE I.NotaFinal < 0 OR I.NotaFinal > A.EscalaCalificacion
   OR I.NotaAutomatica < 0 OR I.NotaAutomatica > A.EscalaCalificacion
   OR I.NotaFinalCalculada < 0 OR I.NotaFinalCalculada > A.EscalaCalificacion
   OR I.NotaFinalManual < 0 OR I.NotaFinalManual > A.EscalaCalificacion;

SELECT 'correccion_sin_auditoria_basica' AS Anomalia, IP.Id, IP.IdIntento,
  IP.PuntajeObtenido, IP.OrigenCorreccion, IP.CorregidoPor, IP.FechaCorreccion
FROM dbo.IntentoPregunta IP
WHERE IP.PuntajeObtenido IS NOT NULL
  AND (IP.OrigenCorreccion IS NULL OR IP.OrigenCorreccion NOT IN ('automatica','manual')
    OR IP.FechaCorreccion IS NULL
    OR (IP.OrigenCorreccion = 'manual' AND IP.CorregidoPor IS NULL));

SELECT 'nota_manual_no_efectiva' AS Anomalia, I.Id, I.NotaFinal,
  I.NotaFinalManual, I.NotaFinalCalculada
FROM dbo.Intento I
WHERE I.NotaFinalManual IS NOT NULL
  AND (I.NotaFinal IS NULL OR I.NotaFinal <> I.NotaFinalManual);

;WITH Puntajes AS (
  SELECT IP.IdIntento,
    SUM(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS Pendientes,
    SUM(IP.PuntajeObtenido) AS NotaCalculada,
    SUM(CASE WHEN IP.OrigenCorreccion = 'automatica' THEN 1 ELSE 0 END) AS CantidadAutomaticas,
    SUM(CASE WHEN IP.OrigenCorreccion = 'automatica' THEN IP.PuntajeObtenido ELSE 0 END) AS NotaAutomatica,
    SUM(CASE WHEN IP.OrigenCorreccion IS NOT NULL THEN 1 ELSE 0 END) AS CorreccionesRegistradas
  FROM dbo.IntentoPregunta IP
  GROUP BY IP.IdIntento
)
SELECT 'nota_descompuesta_inconsistente' AS Anomalia, I.Id,
  I.NotaAutomatica, P.NotaAutomatica AS NotaAutomaticaEsperada,
  I.NotaFinalCalculada, P.NotaCalculada AS NotaCalculadaEsperada,
  P.Pendientes
FROM dbo.Intento I
JOIN Puntajes P ON P.IdIntento = I.Id
WHERE P.CorreccionesRegistradas > 0
  AND (
    (P.CantidadAutomaticas = 0 AND I.NotaAutomatica IS NOT NULL)
    OR (P.CantidadAutomaticas > 0 AND (I.NotaAutomatica IS NULL OR I.NotaAutomatica <> P.NotaAutomatica))
    OR (P.Pendientes > 0 AND I.NotaFinalCalculada IS NOT NULL)
    OR (P.Pendientes = 0 AND (I.NotaFinalCalculada IS NULL OR I.NotaFinalCalculada <> P.NotaCalculada))
  );

SELECT 'override_incoherente' AS Anomalia, O.*
FROM dbo.IntentoValidoOverride O
LEFT JOIN dbo.Intento I ON I.Id = O.IdIntento
WHERE I.Id IS NULL OR I.IdPublicacion <> O.IdPublicacion OR I.IdAlumno <> O.IdAlumno OR I.Estado <> 'entregado';

SELECT 'override_duplicado' AS Anomalia, IdPublicacion, IdAlumno, COUNT(*) AS Cantidad
FROM dbo.IntentoValidoOverride
GROUP BY IdPublicacion, IdAlumno
HAVING COUNT(*) > 1;

SELECT 'incidente_duplicado' AS Anomalia, IdIntento, EventoId, COUNT(*) AS Cantidad
FROM dbo.IncidenteIntento
GROUP BY IdIntento, EventoId
HAVING COUNT(*) > 1;

SELECT 'incidente_incoherente' AS Anomalia, I.*
FROM dbo.IncidenteIntento I
WHERE (I.Estado = 'iniciado' AND (I.FechaFinCliente IS NOT NULL OR I.DuracionMilisegundos IS NOT NULL OR I.FechaRecepcionFin IS NOT NULL))
   OR (I.Estado = 'completado' AND (I.FechaFinCliente IS NULL OR I.DuracionMilisegundos IS NULL OR I.FechaRecepcionFin IS NULL
       OR I.DuracionMilisegundos < 0 OR I.FechaFinCliente < I.FechaInicioCliente));

SELECT 'entregado_sin_seleccion_automatica_resoluble' AS Anomalia, I.Id, I.IdPublicacion, I.IdAlumno, I.FechaFin
FROM dbo.Intento I
WHERE I.Estado = 'entregado' AND I.FechaFin IS NULL;

