import { Request, Response } from 'express';
import { IdBancoSchema, IdempotencyKeySchema } from '../schemas/banco.schema';
import {
  AuditoriaRevisionQuerySchema,
  IdSesionRevisionSchema,
  PermisoRevisionSchema,
  PermisosRevisionQuerySchema,
  PoliticaRevisionSchema,
} from '../schemas/revision.schema';
import { ActorBanco, BancoError } from '../services/banco-common.service';
import {
  actualizarPoliticaRevision,
  consultarDisponibilidadRevision,
  consumirContenidoRevision,
  emitirSesionRevision,
  listarAuditoriaRevision,
  listarPermisosRevision,
  obtenerPoliticaRevision,
  otorgarPermisoRevision,
  revocarPermisoRevision,
} from '../services/revision-examen.service';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { responderErrorBanco } from './banco.controller';

const actor = (req: Request) => (req as Request & { user: ActorBanco }).user;

const key = (req: Request) => {
  const parsed = IdempotencyKeySchema.safeParse(req.header('Idempotency-Key'));
  if (!parsed.success) throw new BancoError(400, 'Idempotency-Key debe ser un UUID válido', 'REQUEST_INVALID');
  return parsed.data;
};

export const getPoliticaRevision = async (req: Request, res: Response) => {
  try {
    const data = await obtenerPoliticaRevision(actor(req), IdBancoSchema.parse(req.params.idPublicacion));
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const putPoliticaRevision = async (req: Request, res: Response) => {
  try {
    const data = await actualizarPoliticaRevision(
      actor(req), IdBancoSchema.parse(req.params.idPublicacion), PoliticaRevisionSchema.parse(req.body),
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const putPermisoRevision = async (req: Request, res: Response) => {
  try {
    const data = await otorgarPermisoRevision(
      actor(req), IdBancoSchema.parse(req.params.idIntento), PermisoRevisionSchema.parse(req.body),
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const deletePermisoRevision = async (req: Request, res: Response) => {
  try {
    const data = await revocarPermisoRevision(actor(req), IdBancoSchema.parse(req.params.idIntento));
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const getPermisosRevision = async (req: Request, res: Response) => {
  try {
    const data = await listarPermisosRevision(
      actor(req), IdBancoSchema.parse(req.params.idPublicacion), PermisosRevisionQuerySchema.parse(req.query),
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const getAuditoriaRevision = async (req: Request, res: Response) => {
  try {
    const data = await listarAuditoriaRevision(
      actor(req), IdBancoSchema.parse(req.params.idPublicacion), AuditoriaRevisionQuerySchema.parse(req.query),
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const getRevisionDisponible = async (req: Request, res: Response) => {
  try {
    const data = await consultarDisponibilidadRevision(actor(req), IdBancoSchema.parse(req.params.idIntento));
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const postSesionRevision = async (req: Request, res: Response) => {
  try {
    const result = await emitirSesionRevision(
      actor(req), IdBancoSchema.parse(req.params.idIntento), key(req),
    );
    res.status(result.status).json({ success: true, data: mapKeysToCamelCase(result.data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const getContenidoRevision = async (req: Request, res: Response) => {
  try {
    const data = await consumirContenidoRevision(actor(req), IdSesionRevisionSchema.parse(req.params.idSesion));
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};
