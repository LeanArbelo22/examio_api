import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { z } from 'zod';
import { IdBancoSchema, IdempotencyKeySchema } from '../schemas/banco.schema';
import { autorizarActividad } from '../services/evaluacion-access.service';
import { ActorBanco, BancoError, atomico, consultar } from '../services/banco-common.service';
import { responderErrorBanco } from './banco.controller';
import { completarIdempotencia, iniciarIdempotencia } from '../services/idempotency.service';
import { crearEvaluacion, modificarBorrador, publicarBorrador } from '../services/evaluacion-write.service';
import { eliminarSeleccionIntentoValido, listarIntentosPublicacion, seleccionarIntentoValido } from '../services/intento-valido.service';
import { autorizarAccesoIntento } from '../services/intento-respuesta.service';

function obtenerIdempotencyKey(req: Request) {
  const parsed = IdempotencyKeySchema.safeParse(req.header('Idempotency-Key'));
  if (!parsed.success) throw new BancoError(400, 'Idempotency-Key debe ser un UUID válido', 'REQUEST_INVALID');
  return parsed.data;
}

export const guardarEvaluacionCompleta = async (req: Request, res: Response) => {
  try {
    const actor = (req as Request & { user: ActorBanco }).user;
    const key = obtenerIdempotencyKey(req);
    const data = await atomico(async tx => {
      const idem = await iniciarIdempotencia(tx, actor, 'evaluacion.guardar-completo', key, req.body);
      if (idem.replay) {
        const reference = idem.result as { IdActividad: number };
        await autorizarActividad(tx, actor, reference.IdActividad, false);
        return idem.result;
      }
      const result = await crearEvaluacion(tx, actor, req.body);
      await completarIdempotencia(tx, idem.id, result, 201);
      return result;
    });
    res.status(201).json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const modificarEvaluacionCompleta = async (req: Request, res: Response) => {
  try {
    const id = IdBancoSchema.parse(req.params.id);
    const data = await atomico(tx => modificarBorrador(tx, (req as Request & { user: ActorBanco }).user, id, req.body));
    res.json({ success: true, message: 'Evaluación modificada correctamente', data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const publicarEvaluacionCompleta = async (req: Request, res: Response) => {
  try {
    const id = IdBancoSchema.parse(req.params.idActividad);
    const actor = (req as Request & { user: ActorBanco }).user;
    const key = obtenerIdempotencyKey(req);
    const data = await atomico(async tx => {
      const idem = await iniciarIdempotencia(tx, actor, `evaluacion.${id}.publicar-completo`, key, req.body);
      if (idem.replay) { await autorizarActividad(tx, actor, id, false); return idem.result; }
      const result = await publicarBorrador(tx, actor, id, req.body);
      await completarIdempotencia(tx, idem.id, result, 200);
      return result;
    });
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const obtenerExamenSorteado = async (req: Request, res: Response) => {
  try {
    const idIntento = IdBancoSchema.parse(req.params.idIntento);
    await autorizarAccesoIntento((req as Request & { user: ActorBanco }).user, idIntento);
    const result = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .execute('SP_Intento_ObtenerExamenDinamico');
    const data = result.recordset.map((row: any) => {
      const mapped = mapKeysToCamelCase(row) as Record<string, unknown>;
      const mostrarPuntaje = Boolean(row.MostrarPuntajePorPregunta);
      delete mapped.mostrarPuntajePorPregunta;
      if (!mostrarPuntaje) delete mapped.puntajeMaximo;
      if (row.IdRespuesta != null) {
        let idsOpcionesSeleccionadas: number[] = [];
        if (typeof row.OpcionesSeleccionadasJson === 'string') {
          try {
            idsOpcionesSeleccionadas = (JSON.parse(row.OpcionesSeleccionadasJson) as Array<{ idOpcion: number }>)
              .map(item => Number(item.idOpcion));
          } catch { idsOpcionesSeleccionadas = []; }
        }
        mapped.respuesta = {
          idRespuesta: row.IdRespuesta,
          idsOpcionesSeleccionadas,
          rtaTexto: row.RtaTexto ?? null,
          justificacion: row.Justificacion ?? null,
          revision: Number(row.Revision ?? 0),
        };
      } else mapped.respuesta = null;
      delete mapped.idRespuesta;
      delete mapped.opcionesSeleccionadasJson;
      delete mapped.rtaTexto;
      delete mapped.justificacion;
      delete mapped.revision;
      return mapped;
    });
    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const obtenerOpcionesPregunta = async (req: Request, res: Response) => {
  try {
    const actor = (req as Request & { user: ActorBanco }).user;
    const idIntento = IdBancoSchema.parse(req.params.idIntento);
    const idPregunta = IdBancoSchema.parse(req.params.idPregunta);
    await autorizarAccesoIntento(actor, idIntento);
    const result = await pool.request()
      .input('IdPregunta', sql.Int, idPregunta)
      .input('IdIntento', sql.Int, idIntento)
      .execute('SP_Pregunta_ObtenerOpciones');
    const data = mapKeysToCamelCase(result.recordset) as Array<Record<string, unknown>>;
    if (actor.role === 'alumno') data.forEach(option => delete option.esCorrecta);
    res.json({ success: true, data });
  } catch (err: unknown) { responderErrorBanco(res, err); }
};

export const actualizarEstadoEvaluacion = async (req: Request, res: Response) => {
  try {
    const id = IdBancoSchema.parse(req.params.id);
    const { estado } = z.object({ estado: z.enum(['borrador','publicada','archivada']) }).strict().parse(req.body);
    await atomico(async tx => {
      const actual = await autorizarActividad(tx, (req as any).user, id, false);
      if (actual.Estado === estado) return;
      if (estado === 'borrador' || actual.Estado === 'archivada')
        throw new BancoError(400, 'Transición de estado no permitida', 'EVALUATION_ALREADY_PUBLISHED');
      if (actual.Estado === 'borrador' && estado === 'publicada')
        throw new BancoError(400, 'Use publicar-completo para validar y publicar el borrador', 'DRAFT_NOT_PUBLISHABLE');
      await consultar(tx, 'UPDATE dbo.Actividad SET Estado=@Estado,Revision=Revision+1 WHERE Id=@Id', { Id: id, Estado: estado });
    });

    res.json({ success: true, message: 'Estado actualizado' });
  } catch (err: unknown) {
    responderErrorBanco(res, err);
  }
};

export const obtenerPendientesPorAlumno = async (req: Request, res: Response) => {
  try {
    const { matricula } = req.params;
    const result = await pool.request()
      .input('Matricula', sql.Int, matricula)
      .query(`
        SELECT P.Id AS IdPublicacion, A.Titulo, A.Descripcion, A.DuracionMinutos,
               P.FechaInicio, P.FechaFin, A.RecursosPermitidos,
               A.CantidadIntentosMaximos,A.EscalaCalificacion,A.NotaAprobacion,
               A.ModoPuntaje,A.MostrarPuntajePorPregunta,A.CorreccionAutomaticaCerradas,
               M.Nombre AS Materia, C.Nombre AS Carrera,
               D.Nombre + ' ' + D.Apellido AS Docente,
               ULT.Estado AS EstadoUltimoIntento,
               ISNULL(CNT.IntentosRealizados, 0) AS IntentosRealizados
        FROM Publicacion P
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Carrera C ON M.IdCarrera = C.Id
        LEFT JOIN Docente D ON MD.IdDocente = D.Legajo
        INNER JOIN InscripcionMateria IM ON IM.IdMateriaDivision = MD.Id
        OUTER APPLY (
            SELECT TOP 1 II.Estado
            FROM Intento II
            WHERE II.IdAlumno = IM.IdAlumno
              AND II.IdPublicacion = P.Id
            ORDER BY II.FechaInicio DESC
        ) ULT
        OUTER APPLY (
            SELECT COUNT(*) AS IntentosRealizados
            FROM Intento II
            WHERE II.IdAlumno = IM.IdAlumno
              AND II.IdPublicacion = P.Id
        ) CNT
        WHERE IM.IdAlumno = @Matricula
          AND A.Estado = 'publicada'
          AND P.Visible = 1
          AND SYSUTCDATETIME() BETWEEN P.FechaInicio AND P.FechaFin
        ORDER BY P.FechaFin ASC
      `);

    const data = result.recordset.map((row: any) => ({
      ...mapKeysToCamelCase(row),
      puedeReintentar: row.EstadoUltimoIntento !== 'en_progreso'
        && Number(row.IntentosRealizados) < Number(row.CantidadIntentosMaximos),
      enProgreso: row.EstadoUltimoIntento === 'en_progreso',
      intentosAgotados: Number(row.IntentosRealizados) >= Number(row.CantidadIntentosMaximos),
    }));

    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const obtenerPublicacionPorId = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .query(`
        SELECT P.Id AS IdPublicacion, A.Titulo, A.Descripcion, A.DuracionMinutos,
               P.FechaInicio, P.FechaFin, A.RecursosPermitidos,
               A.EscalaCalificacion,A.NotaAprobacion,A.ModoPuntaje,
               A.MostrarPuntajePorPregunta,A.CorreccionAutomaticaCerradas,
               M.Nombre AS Materia, C.Nombre AS Carrera,
               D.Nombre + ' ' + D.Apellido AS Docente,
               (SELECT COUNT(*) FROM GrupoPregunta WHERE IdActividad = A.Id) AS GruposCount
        FROM Publicacion P
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Carrera C ON M.IdCarrera = C.Id
        LEFT JOIN Docente D ON MD.IdDocente = D.Legajo
        WHERE P.Id = @Id
      `);

    if (result.recordset.length === 0) return res.status(404).json({ success: false, message: 'Publicación no encontrada' });
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset[0]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getDetallePublicacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const headerResult = await pool.request()
      .input('Id', sql.Int, id)
      .query(`
        SELECT A.Id AS IdActividad, A.Titulo, A.Descripcion, A.Tipo, A.DuracionMinutos,
               A.CantidadIntentosMaximos, A.Estado, A.RecursosPermitidos, A.Revision,
               A.EscalaCalificacion,A.NotaAprobacion,A.ModoPuntaje,
               A.MostrarPuntajePorPregunta,A.CorreccionAutomaticaCerradas,
               P.Id AS IdPublicacion, P.FechaInicio, P.FechaFin,
               M.Nombre AS Materia, Dv.Descripcion AS Division
        FROM Actividad A
        INNER JOIN Publicacion P ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Division Dv ON MD.IdDivision = Dv.Id
        WHERE P.Id = @Id
      `);

    if (headerResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' });
    }

    const header = headerResult.recordset[0];

    const detalleResult = await pool.request()
      .input('IdActividad', sql.Int, header.IdActividad)
      .query(`
        ;WITH GruposDetalle AS (
          SELECT GP.*,
            ROW_NUMBER() OVER (ORDER BY GP.Id) AS Posicion,
            COUNT(*) OVER () AS TotalGrupos
          FROM GrupoPregunta GP
          WHERE GP.IdActividad=@IdActividad
        )
        SELECT GP.Id AS IdGrupo, GP.TituloReferencia,
               CAST(CASE WHEN A.ModoPuntaje='iguales' THEN
                 (((A.EscalaCalificacion * 100) / GP.TotalGrupos) +
                   CASE WHEN GP.Posicion <= ((A.EscalaCalificacion * 100) % GP.TotalGrupos) THEN 1 ELSE 0 END) / 100.0
                 ELSE GP.PuntajeMaximo END AS decimal(5,2)) AS PuntajeMaximo,
               GP.IdBancoGrupoOrigen, GP.RevisionBancoOrigen AS RevisionGrupoBancoOrigen,
               GP.FechaIncorporacionBanco AS FechaGrupoIncorporacionBanco,
               PR.Id AS IdPregunta, PR.Enunciado, PR.Tipo,PR.ModoJustificacion,
               PR.EstrategiaCorreccion,PR.TratamientoJustificacion,PR.ContenidoHash,
               PR.IdBancoPreguntaOrigen, PR.RevisionBancoOrigen AS RevisionPreguntaBancoOrigen,
               PR.FechaIncorporacionBanco AS FechaPreguntaIncorporacionBanco,
               O.Id AS IdOpcion, O.Texto, O.EsCorrecta
        FROM GruposDetalle GP
        INNER JOIN Actividad A ON A.Id=GP.IdActividad
        INNER JOIN Pregunta PR ON PR.IdGrupoPregunta = GP.Id
        LEFT JOIN Opcion O ON O.IdPregunta = PR.Id
        WHERE GP.IdActividad = @IdActividad
        ORDER BY GP.Id, PR.Id, O.Id
      `);

    const gruposMap: Record<number, any> = {};
    const preguntasMap: Record<number, any> = {};

    for (const row of detalleResult.recordset) {
      if (!gruposMap[row.IdGrupo]) {
        gruposMap[row.IdGrupo] = {
          idGrupo: row.IdGrupo,
          tituloReferencia: row.TituloReferencia,
          puntajeMaximo: row.PuntajeMaximo,
          idBancoGrupoOrigen: row.IdBancoGrupoOrigen,
          revisionBancoOrigen: row.RevisionGrupoBancoOrigen,
          fechaIncorporacionBanco: row.FechaGrupoIncorporacionBanco,
          preguntas: [],
        };
      }

      if (row.IdPregunta && !preguntasMap[row.IdPregunta]) {
        preguntasMap[row.IdPregunta] = {
          idPregunta: row.IdPregunta,
          enunciado: row.Enunciado,
          tipo: row.Tipo,
          modoJustificacion: row.ModoJustificacion,
          estrategiaCorreccion: row.EstrategiaCorreccion,
          tratamientoJustificacion: row.TratamientoJustificacion,
          contenidoHash: row.ContenidoHash,
          idBancoPreguntaOrigen: row.IdBancoPreguntaOrigen,
          revisionBancoOrigen: row.RevisionPreguntaBancoOrigen,
          fechaIncorporacionBanco: row.FechaPreguntaIncorporacionBanco,
          opciones: [],
        };
        gruposMap[row.IdGrupo].preguntas.push(preguntasMap[row.IdPregunta]);
      }

      if (row.IdOpcion != null && preguntasMap[row.IdPregunta]) {
        preguntasMap[row.IdPregunta].opciones.push({
          idOpcion: row.IdOpcion,
          texto: row.Texto,
          esCorrecta: row.EsCorrecta,
        });
      }
    }

    res.json({
      success: true,
      data: {
        ...mapKeysToCamelCase(header),
        grupos: Object.values(gruposMap),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getAlumnosByPublicacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.request()
      .input('IdPublicacion', sql.Int, id)
      .query(`
        SELECT AL.Matricula, AL.Nombre, AL.Apellido, AL.Correo,
               I.Id AS IdIntento, I.Estado AS EstadoIntento, I.NotaFinal, I.NotaAutomatica,
               I.FechaInicio AS FechaInicioIntento, I.FechaFin AS FechaFinIntento,
               I.NumeroIntento, A.CantidadIntentosMaximos
        FROM InscripcionMateria IM
        INNER JOIN Alumno AL ON IM.IdAlumno = AL.Matricula
        LEFT JOIN Intento I ON I.IdPublicacion = @IdPublicacion AND I.IdAlumno = AL.Matricula
        INNER JOIN Publicacion P ON P.Id = @IdPublicacion
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        WHERE IM.IdMateriaDivision = P.IdMateriaDivision
        ORDER BY AL.Apellido, AL.Nombre
      `);

    const data = result.recordset.map((row: any) => ({
      ...mapKeysToCamelCase(row),
      intentosAgotados: row.NumeroIntento != null
        && Number(row.NumeroIntento) >= Number(row.CantidadIntentosMaximos),
    }));

    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const listarIntentosAlumnoPublicacion = async (req: Request, res: Response) => {
  try {
    const idPublicacion = IdBancoSchema.parse(req.params.idPublicacion);
    const matricula = IdBancoSchema.parse(req.params.matricula);
    const data = await listarIntentosPublicacion(
      pool,
      (req as any).user,
      idPublicacion,
      matricula,
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const seleccionarIntentoValidoAlumno = async (req: Request, res: Response) => {
  try {
    const idPublicacion = IdBancoSchema.parse(req.params.idPublicacion);
    const matricula = IdBancoSchema.parse(req.params.matricula);
    const data = await atomico(tx => seleccionarIntentoValido(
      tx,
      (req as any).user,
      idPublicacion,
      matricula,
      req.body.IdIntento,
    ));
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const eliminarIntentoValidoAlumno = async (req: Request, res: Response) => {
  try {
    const idPublicacion = IdBancoSchema.parse(req.params.idPublicacion);
    const matricula = IdBancoSchema.parse(req.params.matricula);
    const data = await atomico(tx => eliminarSeleccionIntentoValido(
      tx,
      (req as any).user,
      idPublicacion,
      matricula,
    ));
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};
