import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { ActorBanco, BancoError } from '../services/banco-common.service';
import { responderErrorBanco } from './banco.controller';
import { asignarNotaFinalManual, corregirPreguntaIntento } from '../services/intento-correccion.service';
import { MisIntentosQuerySchema } from '../schemas/intento.schema';
import { obtenerMisIntentos } from '../services/intento-historial.service';
import { finalizarIntentoRuntime, guardarRespuestaIntento } from '../services/intento-respuesta.service';
import { anularIntentoPorIncidente, confirmarCorreccionIntento } from '../services/intento-estado.service';
import { EventoIdSchema } from '../schemas/telemetria.schema';

const idPositivo = (value: string, nombre: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new BancoError(400, `${nombre} inválido`, 'REQUEST_INVALID');
  return parsed;
};

const revisionDisponibleSql = `CAST(CASE
  WHEN I.Estado='entregado'
   AND I.CorreccionConfirmada=1
   AND ISNULL(PER.Estado,'')<>'revocado'
   AND (
     (PER.Estado='activo'
       AND (PER.FechaDesde IS NULL OR PER.FechaDesde<=SYSUTCDATETIME())
       AND (PER.FechaHasta IS NULL OR PER.FechaHasta>=SYSUTCDATETIME()))
     OR
     (COALESCE(IVO.IdIntento,IA.IdIntento)=I.Id
       AND (
         COALESCE(PREV.Modo,'al_corregir')='al_corregir'
         OR (PREV.Modo='ventana'
           AND PREV.VentanaDesde<=SYSUTCDATETIME()
           AND PREV.VentanaHasta>=SYSUTCDATETIME())
       ))
   )
  THEN 1 ELSE 0 END AS bit)`;

export const iniciarExamen = async (req: Request, res: Response) => {
  try {
    const { IdPublicacion, IdAlumno } = req.body;
    const actor = (req as Request & { user: ActorBanco }).user;
    if (actor.role === 'alumno' && actor.idAlumno !== IdAlumno) {
      throw new BancoError(403, 'No puede iniciar un intento para otro alumno', 'ATTEMPT_SCOPE_FORBIDDEN');
    }

    // ── Candado de seguridad: verificar límite de intentos ──
    const check = await pool.request()
      .input('IdPublicacion', sql.Int, IdPublicacion)
      .input('IdAlumno', sql.Int, IdAlumno)
      .query(`
        SELECT ISNULL(CNT.IntentosRealizados, 0) AS IntentosRealizados,
               A.CantidadIntentosMaximos
        FROM Publicacion P
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        OUTER APPLY (
            SELECT COUNT(*) AS IntentosRealizados
            FROM Intento II
            WHERE II.IdPublicacion = @IdPublicacion
              AND II.IdAlumno = @IdAlumno
        ) CNT
        WHERE P.Id = @IdPublicacion
      `);

    const row = check.recordset[0];
    if (row && Number(row.IntentosRealizados) >= Number(row.CantidadIntentosMaximos)) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: Has alcanzado el límite máximo de intentos permitidos para esta evaluación.',
      });
    }

    const result = await pool.request()
      .input('IdPublicacion', sql.Int, IdPublicacion)
      .input('IdAlumno', sql.Int, IdAlumno)
      .execute('SP_Intento_IniciarExamen');

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) { responderErrorBanco(res, err); }
};

export const guardarRespuesta = async (req: Request, res: Response) => {
  try {
    const data = await guardarRespuestaIntento(
      (req as Request & { user: ActorBanco }).user,
      req.body,
    );
    res.json({
      success: true,
      message: 'Respuesta guardada y auditada correctamente.',
      data: mapKeysToCamelCase(data),
    });
  } catch (err: unknown) { responderErrorBanco(res, err); }
};

export const finalizarExamen = async (req: Request, res: Response) => {
  try {
    const idIntento = idPositivo(req.params.id, 'id');
    const data = await finalizarIntentoRuntime(
      (req as Request & { user: ActorBanco }).user,
      idIntento,
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (err: unknown) { responderErrorBanco(res, err); }
};

export const anularPorIncidente = async (req: Request, res: Response) => {
  try {
    const idIntento = idPositivo(req.params.idIntento, 'idIntento');
    const eventoId = EventoIdSchema.parse(req.params.eventoId);
    const data = await anularIntentoPorIncidente(
      (req as Request & { user: ActorBanco }).user,
      idIntento,
      eventoId,
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (err: unknown) { responderErrorBanco(res, err); }
};

export const getHistorialPorAlumno = async (req: Request, res: Response) => {
  try {
    const { idAlumno } = req.params;
    const result = await pool.request()
      .input('IdAlumno', sql.Int, idAlumno)
      .query('SELECT * FROM Intento WHERE IdAlumno = @IdAlumno ORDER BY FechaInicio DESC');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getMisIntentos = async (req: Request, res: Response) => {
  try {
    const actor = (req as any).user;
    if (!Number.isInteger(actor.idAlumno) || actor.idAlumno <= 0) {
      throw new BancoError(403, 'El usuario no tiene un alumno asociado', 'ATTEMPT_SCOPE_FORBIDDEN');
    }
    const filters = MisIntentosQuerySchema.parse(req.query);
    const data = await obtenerMisIntentos(actor.idAlumno, filters);
    res.json({ success: true, data });
  } catch (error) { responderErrorBanco(res, error); }
};

export const getIntentosDetallados = async (req: Request, res: Response) => {
  try {
    const { idAlumno } = req.params;
    const result = await pool.request()
      .input('IdAlumno', sql.Int, idAlumno)
      .query(`
        SELECT I.Id AS IdIntento, I.IdAlumno, I.IdPublicacion, I.Estado,
               I.NotaFinal, I.NotaAutomatica, I.FechaInicio, I.FechaFin,
               I.CorreccionConfirmada,
               CAST(CASE WHEN I.CorreccionConfirmada=1 THEN 0 ELSE 1 END AS bit) AS CorreccionPendiente,
               ${revisionDisponibleSql} AS RevisionDisponible,
               I.NumeroIntento,
               A.Titulo AS TituloEvaluacion, A.Tipo AS TipoEvaluacion,
               A.DuracionMinutos,
               M.Nombre AS Materia, DV.Descripcion AS Division
        FROM Intento I
        INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Division DV ON MD.IdDivision = DV.Id
        LEFT JOIN PoliticaRevisionPublicacion PREV ON PREV.IdPublicacion=I.IdPublicacion
        LEFT JOIN PermisoRevisionIntento PER ON PER.IdIntento=I.Id
        LEFT JOIN IntentoValidoOverride IVO
          ON IVO.IdPublicacion=I.IdPublicacion AND IVO.IdAlumno=I.IdAlumno
        OUTER APPLY (
          SELECT TOP (1) IV.Id AS IdIntento
          FROM Intento IV
          WHERE IV.IdPublicacion=I.IdPublicacion AND IV.IdAlumno=I.IdAlumno
            AND IV.Estado='entregado'
          ORDER BY IV.FechaFin DESC,IV.NumeroIntento DESC,IV.Id DESC
        ) IA
        WHERE I.IdAlumno = @IdAlumno
        ORDER BY I.FechaInicio DESC
      `);
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getHistorialCorregido = async (req: Request, res: Response) => {
  try {
    const { idAlumno } = req.params;
    const result = await pool.request()
      .input('IdAlumno', sql.Int, idAlumno)
      .query(`
        SELECT I.Id AS IdIntento,
               A.Titulo AS TituloEvaluacion,
               M.Nombre AS Materia,
               DV.Descripcion AS Division,
               I.FechaFin,
               I.NotaFinal,
               I.NumeroIntento,I.CorreccionConfirmada,
               CAST(CASE WHEN I.CorreccionConfirmada=1 THEN 0 ELSE 1 END AS bit) AS CorreccionPendiente,
               ${revisionDisponibleSql} AS RevisionDisponible
        FROM Intento I
        INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Division DV ON MD.IdDivision = DV.Id
        LEFT JOIN PoliticaRevisionPublicacion PREV ON PREV.IdPublicacion=I.IdPublicacion
        LEFT JOIN PermisoRevisionIntento PER ON PER.IdIntento=I.Id
        LEFT JOIN IntentoValidoOverride IVO
          ON IVO.IdPublicacion=I.IdPublicacion AND IVO.IdAlumno=I.IdAlumno
        OUTER APPLY (
          SELECT TOP (1) IV.Id AS IdIntento
          FROM Intento IV
          WHERE IV.IdPublicacion=I.IdPublicacion AND IV.IdAlumno=I.IdAlumno
            AND IV.Estado='entregado'
          ORDER BY IV.FechaFin DESC,IV.NumeroIntento DESC,IV.Id DESC
        ) IA
        WHERE I.IdAlumno = @IdAlumno
          AND I.NotaFinal IS NOT NULL
          AND I.Estado = 'entregado'
        ORDER BY I.FechaFin DESC
      `);
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getIntentoCompleto = async (req: Request, res: Response) => {
  try {
    const { idIntento } = req.params;

    const headerResult = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .query(`
        SELECT I.Id AS IdIntento, I.IdAlumno, I.IdPublicacion, I.Estado,
               I.NotaFinal, I.NotaAutomatica, I.NotaFinalCalculada, I.NotaFinalManual,
               I.CorreccionConfirmada,I.CorreccionConfirmadaPor,
               I.FechaCorreccionConfirmada,I.OrigenConfirmacionCorreccion,
               I.FechaInicio, I.FechaFin,
               I.NumeroIntento,
               AL.Nombre, AL.Apellido, AL.Correo,
               A.Titulo AS TituloEvaluacion, A.Tipo AS TipoEvaluacion,
               A.DuracionMinutos, A.EscalaCalificacion, A.NotaAprobacion,
               MD.IdDocente, D.Estado AS DocenteActivo
        FROM Intento I
        INNER JOIN Alumno AL ON I.IdAlumno = AL.Matricula
        INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        LEFT JOIN Docente D ON MD.IdDocente = D.Legajo
        WHERE I.Id = @IdIntento
      `);

    if (headerResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Intento no encontrado' });
    }

    const intento = headerResult.recordset[0];

    const actor = (req as any).user;
    if (actor.role === 'alumno' && intento.IdAlumno !== actor.idAlumno) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. No tienes permisos para ver la radiografía de este intento.',
      });
    }
    if (actor.role === 'docente' && (
      !actor.idDocente || intento.IdDocente !== actor.idDocente || !intento.DocenteActivo
    )) {
      return res.status(403).json({
        success: false,
        message: 'El intento no pertenece a una comisión del docente',
        code: 'ATTEMPT_SCOPE_FORBIDDEN',
      });
    }

    if (actor.role === 'alumno') {
      return res.status(409).json({
        success: false,
        message: 'La revisión del alumno requiere una sesión autorizada',
        code: 'REVIEW_SESSION_REQUIRED',
      });
    }
    const revisionDisponible = intento.Estado === 'entregado' && Boolean(intento.CorreccionConfirmada);

    const preguntasResult = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .query(`
        SELECT IP.IdPregunta,
               COALESCE(IP.EnunciadoSnapshot,PR.Enunciado) AS Enunciado,
               COALESCE(IP.TipoSnapshot,PR.Tipo) AS Tipo,
               COALESCE(IP.GrupoTituloSnapshot,GP.TituloReferencia) AS GrupoConceptualmente,
               IP.ModoJustificacionSnapshot AS ModoJustificacion,
               IP.EstrategiaCorreccionSnapshot AS EstrategiaCorreccion,
               IP.TratamientoJustificacionSnapshot AS TratamientoJustificacion,
               IP.PuntajeMaximoSnapshot, IP.PuntajeObtenido, IP.OrigenCorreccion,
               IP.PuntajeAutomaticoOpciones,
               IP.ComentariosDocente AS ComentariosCorreccion,
               IP.CorregidoPor, IP.FechaCorreccion,
               S.IdOpcionOrigen AS IdOpcion,S.TextoSnapshot AS OpcionTexto,
               S.EsCorrectaSnapshot AS EsCorrecta,
               R.Id AS IdRespuesta,R.RtaTexto,R.Justificacion,R.Revision,
               R.EsCorrecta AS RespuestaEsCorrecta,R.ComentariosDocente,
               CASE WHEN RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END AS FueSeleccionada
        FROM dbo.IntentoPregunta IP
        LEFT JOIN dbo.Pregunta PR ON IP.IdPregunta=PR.Id
        LEFT JOIN dbo.GrupoPregunta GP ON PR.IdGrupoPregunta=GP.Id
        LEFT JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
        LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
        LEFT JOIN dbo.RespuestaOpcion RO ON R.Id=RO.IdRespuesta AND RO.IdOpcion=S.IdOpcionOrigen
        WHERE IP.IdIntento = @IdIntento
        ORDER BY IP.Id,S.Posicion
      `);

    const preguntasMap: Record<number, any> = {};

    for (const row of preguntasResult.recordset) {
      if (!preguntasMap[row.IdPregunta]) {
        preguntasMap[row.IdPregunta] = {
          idPregunta: row.IdPregunta,
          enunciado: row.Enunciado,
          tipo: row.Tipo,
          grupoConceptualmente: row.GrupoConceptualmente,
          puntajeMaximo: row.PuntajeMaximoSnapshot,
          puntajeObtenido: row.PuntajeObtenido,
          puntajeAutomaticoOpciones: row.PuntajeAutomaticoOpciones,
          origenCorreccion: row.OrigenCorreccion,
          modoJustificacion: row.ModoJustificacion,
          estrategiaCorreccion: row.EstrategiaCorreccion,
          tratamientoJustificacion: row.TratamientoJustificacion,
          comentariosDocente: row.ComentariosCorreccion,
          corregidoPor: row.CorregidoPor,
          fechaCorreccion: row.FechaCorreccion,
          respuesta: null,
          opciones: [],
        };
      }

      if (row.IdOpcion != null) {
        preguntasMap[row.IdPregunta].opciones.push({
          idOpcion: row.IdOpcion,
          texto: row.OpcionTexto,
          esCorrecta: row.EsCorrecta,
          fueSeleccionada: row.FueSeleccionada === 1,
        });
      }

      if (row.IdRespuesta != null && !preguntasMap[row.IdPregunta].respuesta) {
        preguntasMap[row.IdPregunta].respuesta = {
          idRespuesta: row.IdRespuesta,
          rtaTexto: row.RtaTexto,
          justificacion: row.Justificacion,
          revision: row.Revision,
          esCorrecta: row.RespuestaEsCorrecta,
          comentariosDocente: row.ComentariosDocente,
        };
      }
    }

    const header = mapKeysToCamelCase(headerResult.recordset[0]) as Record<string, unknown>;
    delete header.idDocente;
    delete header.docenteActivo;
    const preguntas = Object.values(preguntasMap);
    res.json({
      success: true,
      data: {
        ...header,
        correccionPendiente: !Boolean(intento.CorreccionConfirmada),
        revisionDisponible,
        preguntas,
      },
    });
  } catch (error: unknown) { responderErrorBanco(res, error); }
};

export const calificarIntento = async (req: Request, res: Response) => {
  try {
    const idIntento = idPositivo(req.params.idIntento, 'idIntento');
    const { notaFinal } = req.body;
    const data = await asignarNotaFinalManual(
      (req as Request & { user: ActorBanco }).user,
      idIntento,
      notaFinal,
    );
    res.json({ success: true, message: 'Nota asignada correctamente', data: mapKeysToCamelCase(data) });
  } catch (err: unknown) { responderErrorBanco(res, err); }
};

export const corregirRespuesta = async (req: Request, res: Response) => {
  try {
    const idIntento = idPositivo(req.params.idIntento, 'idIntento');
    const idPregunta = idPositivo(req.params.idPregunta, 'idPregunta');
    const data = await corregirPreguntaIntento(
      (req as Request & { user: ActorBanco }).user,
      idIntento,
      idPregunta,
      req.body,
    );
    res.json({ success: true, message: 'Respuesta corregida correctamente', data: mapKeysToCamelCase(data) });
  } catch (err: unknown) { responderErrorBanco(res, err); }
};

export const confirmarCorreccion = async (req: Request, res: Response) => {
  try {
    const idIntento = idPositivo(req.params.idIntento, 'idIntento');
    const data = await confirmarCorreccionIntento(
      (req as Request & { user: ActorBanco }).user,
      idIntento,
    );
    res.json({ success: true, message: 'Corrección confirmada correctamente', data: mapKeysToCamelCase(data) });
  } catch (err: unknown) { responderErrorBanco(res, err); }
};
