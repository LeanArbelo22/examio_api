/* Verificación exclusivamente SELECT del seed integral 2026. No modifica datos. */
SET NOCOUNT ON;
DECLARE @LoteId UNIQUEIDENTIFIER='A1202603-2026-4C04-8EED-000000000001';
DECLARE @Desde DATETIME2(3)=CONVERT(DATETIME2(3),'2026-03-01T03:00:00.000',126);
DECLARE @Hasta DATETIME2(3)=CONVERT(DATETIME2(3),'2026-11-01T03:00:00.000',126);

/* 1. Identidad del lote y configuración efectiva. */
SELECT LoteId,ConfigHash,ConfigJson,FechaCreacionUtc,Advertencia
FROM dbo.ExamioTestDataLote WHERE LoteId=@LoteId;
SELECT Tipo,COUNT_BIG(*) CantidadMapeada FROM dbo.ExamioTestDataEntidad
WHERE LoteId=@LoteId GROUP BY Tipo ORDER BY Tipo;

/* 2. Cantidades contractuales. */
SELECT
 (SELECT COUNT(*) FROM dbo.Carrera) Carreras,
 (SELECT COUNT(*) FROM dbo.Materia) Materias,
 (SELECT COUNT(*) FROM dbo.Division) Divisiones,
 (SELECT COUNT(*) FROM dbo.Docente) Docentes,
 (SELECT COUNT(*) FROM dbo.Alumno) Alumnos,
 (SELECT COUNT(*) FROM dbo.Usuario) Usuarios,
 (SELECT COUNT(*) FROM dbo.MateriaDivision) Comisiones,
 (SELECT COUNT(*) FROM dbo.InscripcionMateria) Inscripciones,
 (SELECT COUNT(*) FROM dbo.Actividad) Actividades,
 (SELECT COUNT(*) FROM dbo.Publicacion) Publicaciones,
 (SELECT COUNT(*) FROM dbo.Intento WHERE NumeroIntento=1 AND Estado='entregado') IntentosBaseEntregados,
 (SELECT COUNT(*) FROM dbo.Intento WHERE NumeroIntento>1) Reintentos;

/* 3. Dos publicaciones por comisión y distribución marzo-octubre. */
SELECT P.IdMateriaDivision,COUNT(*) Publicaciones,MIN(P.FechaInicio) Primera,MAX(P.FechaInicio) Ultima
FROM dbo.Publicacion P GROUP BY P.IdMateriaDivision HAVING COUNT(*)<>2 ORDER BY P.IdMateriaDivision;
SELECT YEAR(P.FechaInicio) Anio,MONTH(P.FechaInicio) Mes,COUNT(*) Publicaciones,
 COUNT(DISTINCT C.Id) Carreras,COUNT(DISTINCT M.Id) Materias,COUNT(DISTINCT P.IdMateriaDivision) Comisiones
FROM dbo.Publicacion P JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
JOIN dbo.Materia M ON M.Id=MD.IdMateria JOIN dbo.Carrera C ON C.Id=M.IdCarrera
GROUP BY YEAR(P.FechaInicio),MONTH(P.FechaInicio) ORDER BY Anio,Mes;
SELECT P.Id,COUNT(I.Id) IntentosBase FROM dbo.Publicacion P
LEFT JOIN dbo.Intento I ON I.IdPublicacion=P.Id AND I.NumeroIntento=1 AND I.Estado='entregado'
GROUP BY P.Id HAVING COUNT(I.Id)<>30 ORDER BY P.Id;

/* 4. Coherencia académica y ausencia de cruces entre carreras/cohortes. */
SELECT C.Id IdCarrera,COUNT(DISTINCT M.Id) Materias,COUNT(DISTINCT MD.Id) Comisiones,
 COUNT(DISTINCT A.Matricula) AlumnosUnicos,COUNT(IM.IdAlumno) Inscripciones
FROM dbo.Carrera C JOIN dbo.Materia M ON M.IdCarrera=C.Id
JOIN dbo.MateriaDivision MD ON MD.IdMateria=M.Id
JOIN dbo.InscripcionMateria IM ON IM.IdMateriaDivision=MD.Id
JOIN dbo.Alumno A ON A.Matricula=IM.IdAlumno
GROUP BY C.Id ORDER BY C.Id;
SELECT IM.IdAlumno,COUNT(DISTINCT M.IdCarrera) CarrerasDistintas
FROM dbo.InscripcionMateria IM JOIN dbo.MateriaDivision MD ON MD.Id=IM.IdMateriaDivision
JOIN dbo.Materia M ON M.Id=MD.IdMateria GROUP BY IM.IdAlumno HAVING COUNT(DISTINCT M.IdCarrera)<>1;

/* 5. Estructura, variantes, escalas y suma de puntajes. */
SELECT A.Id,A.EscalaCalificacion,COUNT(DISTINCT G.Id) Grupos,COUNT(P.Id) Preguntas
FROM dbo.Actividad A JOIN dbo.GrupoPregunta G ON G.IdActividad=A.Id
JOIN dbo.Pregunta P ON P.IdGrupoPregunta=G.Id GROUP BY A.Id,A.EscalaCalificacion
HAVING COUNT(DISTINCT G.Id)<>10 OR COUNT(P.Id)<>30;
SELECT A.Id,A.EscalaCalificacion,SUM(G.PuntajeMaximo) PuntajeTotal
FROM dbo.Actividad A JOIN dbo.GrupoPregunta G ON G.IdActividad=A.Id
GROUP BY A.Id,A.EscalaCalificacion HAVING SUM(G.PuntajeMaximo)<>A.EscalaCalificacion;
SELECT P.Tipo,COUNT(*) Preguntas,COUNT(DISTINCT P.ContenidoHash) Hashes
FROM dbo.Pregunta P GROUP BY P.Tipo ORDER BY P.Tipo;
SELECT P.Id,P.ContenidoHash FROM dbo.Pregunta P WHERE P.ContenidoHash IS NULL OR LEN(P.ContenidoHash)<>64;

/* 6. Integridad de snapshots y respuestas. Todos estos resultsets deben quedar vacíos. */
SELECT I.Id IdIntento,COUNT(IP.Id) PreguntasIntento FROM dbo.Intento I
LEFT JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id GROUP BY I.Id HAVING COUNT(IP.Id)<>10;
SELECT IP.Id FROM dbo.IntentoPregunta IP JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
WHERE IP.ContenidoHashSnapshot<>P.ContenidoHash OR IP.PuntajeMaximoSnapshot IS NULL
 OR IP.TipoSnapshot IS NULL OR IP.EnunciadoSnapshot IS NULL;
SELECT IP.Id IdIntentoPregunta,COUNT(S.Id) OpcionesSnapshot,COUNT(O.Id) OpcionesOrigen
FROM dbo.IntentoPregunta IP JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
LEFT JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
LEFT JOIN dbo.Opcion O ON O.IdPregunta=P.Id
GROUP BY IP.Id HAVING COUNT(DISTINCT S.Id)<>COUNT(DISTINCT O.Id);
SELECT RO.IdRespuesta,RO.IdOpcion FROM dbo.RespuestaOpcion RO
JOIN dbo.Respuesta R ON R.Id=RO.IdRespuesta JOIN dbo.IntentoPregunta IP ON IP.IdIntento=R.IdIntento AND IP.IdPregunta=R.IdPregunta
WHERE NOT EXISTS(SELECT 1 FROM dbo.IntentoPreguntaOpcionSnapshot S
 WHERE S.IdIntentoPregunta=IP.Id AND S.IdOpcionOrigen=RO.IdOpcion);

/* 7. Puntajes/notas: nota calculada equivale a suma cuando no hay pendientes. */
;WITH T AS(
 SELECT I.Id,I.NotaFinalCalculada,I.NotaFinalManual,I.NotaFinal,
  SUM(IP.PuntajeObtenido) Suma,COUNT(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 END) Pendientes
 FROM dbo.Intento I JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
 GROUP BY I.Id,I.NotaFinalCalculada,I.NotaFinalManual,I.NotaFinal
)
SELECT * FROM T WHERE (Pendientes=0 AND (NotaFinalCalculada<>Suma OR NotaFinal<>COALESCE(NotaFinalManual,NotaFinalCalculada)))
 OR (Pendientes>0 AND NotaFinalCalculada IS NOT NULL);
SELECT IP.Id,IP.PuntajeObtenido,IP.PuntajeMaximoSnapshot FROM dbo.IntentoPregunta IP
WHERE IP.PuntajeObtenido<0 OR IP.PuntajeObtenido>IP.PuntajeMaximoSnapshot;
SELECT COUNT(*) OmisionesCalificadasCero FROM dbo.IntentoPregunta IP
WHERE IP.PuntajeObtenido=0 AND NOT EXISTS(SELECT 1 FROM dbo.Respuesta R WHERE R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta);
SELECT COUNT(*) CreditosParciales FROM dbo.IntentoPregunta
WHERE PuntajeObtenido>0 AND PuntajeObtenido<PuntajeMaximoSnapshot;

/* 8. Intento válido: override o último entregado; luego se evalúan nota/confirmación. */
;WITH Entregados AS(
 SELECT I.*,ROW_NUMBER() OVER(PARTITION BY I.IdPublicacion,I.IdAlumno ORDER BY I.NumeroIntento DESC,I.Id DESC) rn
 FROM dbo.Intento I WHERE I.Estado='entregado'
),Validos AS(
 SELECT E.*,CASE WHEN O.IdIntento IS NOT NULL THEN 1 ELSE 0 END OverrideManual
 FROM Entregados E LEFT JOIN dbo.IntentoValidoOverride O ON O.IdPublicacion=E.IdPublicacion AND O.IdAlumno=E.IdAlumno
 WHERE E.Id=COALESCE(O.IdIntento,CASE WHEN E.rn=1 THEN E.Id END)
)
SELECT COUNT(*) IntentosValidos,COUNT(CASE WHEN CorreccionConfirmada=1 AND NotaFinal IS NOT NULL THEN 1 END) ResultadosOficiales,
 COUNT(CASE WHEN CorreccionConfirmada=0 THEN 1 END) PendientesConfirmacion,
 COUNT(CASE WHEN NotaFinal IS NULL THEN 1 END) SinNota,COUNT(CASE WHEN OverrideManual=1 THEN 1 END) Overrides
FROM Validos;

/* 9. Cobertura/rankings por carrera, materia y comisión; porcentajes desde sumas. */
;WITH E AS(
 SELECT I.*,ROW_NUMBER() OVER(PARTITION BY I.IdPublicacion,I.IdAlumno ORDER BY I.NumeroIntento DESC,I.Id DESC) rn
 FROM dbo.Intento I WHERE I.Estado='entregado'
),V AS(
 SELECT E.* FROM E LEFT JOIN dbo.IntentoValidoOverride O ON O.IdPublicacion=E.IdPublicacion AND O.IdAlumno=E.IdAlumno
 WHERE E.Id=COALESCE(O.IdIntento,CASE WHEN E.rn=1 THEN E.Id END)
),Base AS(
 SELECT C.Id IdCarrera,M.Id IdMateria,MD.Id IdComision,P.Id IdPublicacion,A.NotaAprobacion,V.Id IdIntento,
  V.CorreccionConfirmada,V.NotaFinal,CASE WHEN V.NotaFinal>=A.NotaAprobacion THEN 1 ELSE 0 END Aprobado
 FROM dbo.Publicacion P JOIN dbo.Actividad A ON A.Id=P.IdActividad JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
 JOIN dbo.Materia M ON M.Id=MD.IdMateria JOIN dbo.Carrera C ON C.Id=M.IdCarrera JOIN V ON V.IdPublicacion=P.Id
)
SELECT IdCarrera,COUNT(*) ValidExpresados,COUNT(CASE WHEN CorreccionConfirmada=1 AND NotaFinal IS NOT NULL THEN 1 END) Considerados,
 COUNT(CASE WHEN CorreccionConfirmada=1 AND NotaFinal IS NOT NULL AND Aprobado=1 THEN 1 END) Aprobados,
 CAST(100.0*COUNT(CASE WHEN CorreccionConfirmada=1 AND NotaFinal IS NOT NULL AND Aprobado=1 THEN 1 END)/NULLIF(COUNT(CASE WHEN CorreccionConfirmada=1 AND NotaFinal IS NOT NULL THEN 1 END),0) AS DECIMAL(6,2)) PorcentajeAprobacion,
 CAST(100.0*COUNT(CASE WHEN CorreccionConfirmada=1 AND NotaFinal IS NOT NULL THEN 1 END)/NULLIF(COUNT(*),0) AS DECIMAL(6,2)) Cobertura
FROM Base GROUP BY IdCarrera ORDER BY IdCarrera;

/* 10. Hallazgos por contenido con muestra explícita (no interpreta causalidad). */
SELECT IP.ContenidoHashSnapshot,COUNT(*) Muestras,SUM(IP.PuntajeObtenido) Obtenido,SUM(IP.PuntajeMaximoSnapshot) Maximo,
 CAST(100.0*SUM(IP.PuntajeObtenido)/NULLIF(SUM(IP.PuntajeMaximoSnapshot),0) AS DECIMAL(6,2)) PorcentajePuntaje
FROM dbo.IntentoPregunta IP JOIN dbo.Intento I ON I.Id=IP.IdIntento
WHERE I.Estado='entregado' AND I.CorreccionConfirmada=1 AND IP.PuntajeObtenido IS NOT NULL AND IP.PuntajeMaximoSnapshot>0
GROUP BY IP.ContenidoHashSnapshot
HAVING COUNT(*)>=10 AND 1.0*SUM(IP.PuntajeObtenido)/NULLIF(SUM(IP.PuntajeMaximoSnapshot),0)<.30
ORDER BY PorcentajePuntaje,Muestras DESC;

/* 11. Telemetría e incidentes. */
SELECT Tipo,COUNT(*) Eventos,SUM(CASE WHEN Estado='completado' THEN 1 ELSE 0 END) Completados,
 SUM(DuracionMilisegundos) DuracionMs FROM dbo.IncidenteIntento GROUP BY Tipo ORDER BY Tipo;
SELECT COUNT(DISTINCT IdIntento) IntentosConIncidentes FROM dbo.IncidenteIntento
WHERE Tipo IN('focus_lost','fullscreen_exit','connectivity_lost','auth_session_unavailable','sync_error','submission_failed');
SELECT COUNT(*) Decisiones FROM dbo.DecisionSupervisionIntento;
SELECT COUNT(*) RevisionesOperativas FROM dbo.RevisionIncidenteIntento;

/* 12. Coherencia agregado global = carreras = materias = comisiones = meses. */
;WITH X AS(
 SELECT I.Id,P.Id AS IdPublicacion,M.Id IdMateria,C.Id IdCarrera,MD.Id IdComision,DATEFROMPARTS(YEAR(P.FechaInicio),MONTH(P.FechaInicio),1) Mes
 FROM dbo.Intento I JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
 JOIN dbo.Materia M ON M.Id=MD.IdMateria JOIN dbo.Carrera C ON C.Id=M.IdCarrera
 WHERE I.NumeroIntento=1 AND I.Estado='entregado'
)
SELECT (SELECT COUNT(*) FROM X) Global,(SELECT SUM(N) FROM(SELECT COUNT(*) N FROM X GROUP BY IdCarrera)Q) SumaCarreras,
 (SELECT SUM(N) FROM(SELECT COUNT(*) N FROM X GROUP BY IdMateria)Q) SumaMaterias,
 (SELECT SUM(N) FROM(SELECT COUNT(*) N FROM X GROUP BY IdComision)Q) SumaComisiones,
 (SELECT SUM(N) FROM(SELECT COUNT(*) N FROM X GROUP BY Mes)Q) SumaMeses;

/* 13. Cobertura de todas las tablas y excepciones deliberadas. */
SELECT S.name Esquema,T.name Tabla,SUM(P.row_count) Filas
FROM sys.tables T JOIN sys.schemas S ON S.schema_id=T.schema_id
JOIN sys.dm_db_partition_stats P ON P.object_id=T.object_id AND P.index_id IN(0,1)
WHERE T.is_ms_shipped=0 GROUP BY S.name,T.name ORDER BY S.name,T.name;
SELECT Tabla,Motivo FROM(VALUES
 ('AuthSession',N'Se crea sólo mediante login real; no se fabrican sesiones.'),
 ('AuthRefreshToken',N'Se crea sólo por el flujo de autenticación; no se fabrican tokens.'),
 ('OperacionIdempotente',N'Se crea al usar endpoints idempotentes; el seed no suplanta requests HTTP.'),
 ('SesionRevisionIntento',N'Se emite por autorización del alumno; no se fabrican sesiones.'),
 ('ConsumoRevisionUnicaIntento',N'Depende del consumo real de una sesión única.'),
 ('AnulacionIntentoIncidente',N'No se anulan los 14.400 intentos base; política seed sólo informa/advierte.'),
 ('AlertaFraude',N'Legado; los incidentes vigentes usan IncidenteIntento y Supervisión.'),
 ('MetricasNavegacion',N'Fallback legado; el seed usa question_active.'),
 ('HistorialRespuesta',N'Legado; no se simulan ediciones antiguas.'),
 ('sysdiagrams',N'Herramienta de SSMS, sin dato funcional.'))X(Tabla,Motivo);
