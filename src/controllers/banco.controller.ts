import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { IdBancoSchema, IdempotencyKeySchema, ListaBancoSchema } from '../schemas/banco.schema';
import { ActorBanco, BancoError, atomico, propietario } from '../services/banco-common.service';
import * as banco from '../services/banco.service';
import { copiarBanco, desdeEvaluacion, grupoDesdeContenido } from '../services/banco-copy.service';
import { autorizarActividad, incrementarRevisionActividad } from '../services/evaluacion-access.service';
import { completarIdempotencia, iniciarIdempotencia } from '../services/idempotency.service';

export function responderErrorBanco(res: Response, error: unknown) {
  if (error instanceof ZodError) return res.status(400).json({ success: false, message: 'Datos inválidos', code: 'REQUEST_INVALID', errors: error.issues });
  if (error instanceof BancoError) return res.status(error.status).json({ success: false, message: error.message,
    ...(error.code ? { code: error.code } : {}) });
  // No imprimir enunciados, opciones, hashes ni mensajes del servidor SQL.
  console.error('[banco] Error de persistencia');
  return res.status(500).json({ success: false, message: 'No se pudo completar la operación' });
}
type Accion = 'listar' | 'detalle' | 'crear' | 'editar' | 'estado';
function idempotencyKey(req: Request) {
  const parsed = IdempotencyKeySchema.safeParse(req.header('Idempotency-Key'));
  if (!parsed.success) throw new BancoError(400, 'Idempotency-Key debe ser un UUID válido', 'REQUEST_INVALID');
  return parsed.data;
}
export const recursoBanco = (recurso: banco.RecursoBanco, accion: Accion) => async (req: Request, res: Response) => {
  try {
    const actor = (req as Request & {user: ActorBanco}).user;
    const escritura = !['listar','detalle'].includes(accion);
    const query = ListaBancoSchema.parse(req.query);
    if (recurso === 'grupos' && query.tipo) throw new BancoError(400, 'El filtro tipo solo corresponde a preguntas');
    const id = req.params.id === undefined ? undefined : IdBancoSchema.parse(req.params.id);
    const key = accion === 'crear' ? idempotencyKey(req) : undefined;
    const data = await atomico(async tx => {
      const docente = await propietario(tx, actor, escritura, query.idDocente);
      if (accion === 'listar') return banco.listarBanco(tx, recurso, docente, query);
      if (accion === 'detalle') return banco.detalleBanco(tx, recurso, id!, docente);
      if (accion === 'estado') return banco.cambiarEstadoBanco(tx, recurso, docente, id!, req.body.Estado, req.body.RevisionEsperada);
      if (accion === 'crear') {
        const operation = `banco.${recurso}.crear`;
        const idem = await iniciarIdempotencia(tx, actor, operation, key!, req.body);
        if (idem.replay) {
          const reference = idem.result as { id: number };
          return banco.detalleBanco(tx, recurso, reference.id, docente);
        }
        const created = recurso === 'preguntas' ? await banco.guardarPregunta(tx, docente, req.body)
          : await banco.guardarGrupo(tx, docente, req.body);
        await completarIdempotencia(tx, idem.id, { id: created.Id }, 201);
        return created;
      }
      return recurso === 'preguntas' ? banco.guardarPregunta(tx, docente, req.body, id, req.body.RevisionEsperada)
        : banco.guardarGrupo(tx, docente, req.body, id, req.body.RevisionEsperada);
    });
    res.status(accion === 'crear' ? 201 : 200).json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};
export const etiquetasBanco = (accion: 'listar'|'crear'|'editar'|'eliminar') => async (req: Request, res: Response) => {
  try {
    const actor = (req as Request & {user: ActorBanco}).user;
    const query = ListaBancoSchema.parse(req.query);
    const id = req.params.id === undefined ? undefined : IdBancoSchema.parse(req.params.id);
    const data = await atomico(async tx => {
      const docente = await propietario(tx, actor, accion !== 'listar', query.idDocente);
      if (accion === 'listar') return banco.listarEtiquetas(tx, docente);
      if (accion === 'eliminar') return banco.eliminarEtiqueta(tx, docente, id!);
      return banco.guardarEtiqueta(tx, docente, req.body.Nombre, id);
    });
    res.status(accion === 'crear' ? 201 : 200).json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};
export const importarBanco = async (req: Request, res: Response) => {
  try {
    const id = IdBancoSchema.parse(req.params.id);
    const actor = (req as Request & {user: ActorBanco}).user;
    const key = idempotencyKey(req);
    const data = await atomico(async tx => {
      await autorizarActividad(tx, actor, id, true);
      const idem = await iniciarIdempotencia(tx, actor, `evaluacion.${id}.importar-banco`, key, req.body);
      if (idem.replay) return idem.result;
      const importaciones = await copiarBanco(tx, actor, id, req.body.ImportacionesBanco);
      const revision = await incrementarRevisionActividad(tx, id);
      const result = { Importaciones: importaciones, Revision: revision };
      await completarIdempotencia(tx, idem.id, result, 201);
      return result;
    });
    res.status(201).json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};
export const guardarDesdeEvaluacion = async (req: Request, res: Response) => {
  try {
    const actor = (req as Request & {user: ActorBanco}).user;
    const key = idempotencyKey(req);
    const data = await atomico(async tx => {
      const idem = await iniciarIdempotencia(tx, actor, 'banco.desde-evaluacion', key, req.body);
      if (idem.replay) {
        await propietario(tx, actor, true);
        await autorizarActividad(tx, actor, req.body.IdActividad, false);
        return idem.result;
      }
      const result = await desdeEvaluacion(tx, actor, req.body);
      await completarIdempotencia(tx, idem.id, result, 201);
      return result;
    });
    res.status(201).json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const guardarGrupoDesdeContenido = async (req: Request, res: Response) => {
  try {
    const actor = (req as Request & {user: ActorBanco}).user;
    const key = idempotencyKey(req);
    const data = await atomico(async tx => {
      const idem = await iniciarIdempotencia(tx, actor, 'banco.grupos.desde-contenido', key, req.body);
      if (idem.replay) { await propietario(tx, actor, true); return idem.result; }
      const result = await grupoDesdeContenido(tx, actor, req.body);
      await completarIdempotencia(tx, idem.id, result, 201);
      return result;
    });
    res.status(201).json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};
