import { Request, Response } from 'express';
import { IdBancoSchema } from '../schemas/banco.schema';
import { OverrideSupervisionSchema, PoliticaSupervisionSchema } from '../schemas/supervision.schema';
import { ActorBanco } from '../services/banco-common.service';
import {
  actualizarPoliticaSupervision,
  aplicarOverrideSupervision,
  obtenerDetalleSupervision,
  obtenerEstadoSupervision,
  obtenerPoliticaSupervision,
} from '../services/supervision.service';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { responderErrorBanco } from './banco.controller';

const actor = (req: Request) => (req as Request & { user: ActorBanco }).user;

export const getPoliticaSupervision = async (req: Request, res: Response) => {
  try {
    const data = await obtenerPoliticaSupervision(
      actor(req), IdBancoSchema.parse(req.params.idPublicacion),
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const putPoliticaSupervision = async (req: Request, res: Response) => {
  try {
    const data = await actualizarPoliticaSupervision(
      actor(req),
      IdBancoSchema.parse(req.params.idPublicacion),
      PoliticaSupervisionSchema.parse(req.body),
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const getEstadoSupervision = async (req: Request, res: Response) => {
  try {
    const data = await obtenerEstadoSupervision(actor(req), IdBancoSchema.parse(req.params.idIntento));
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const getDetalleSupervision = async (req: Request, res: Response) => {
  try {
    const data = await obtenerDetalleSupervision(actor(req), IdBancoSchema.parse(req.params.idIntento));
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};

export const putOverrideSupervision = async (req: Request, res: Response) => {
  try {
    const data = await aplicarOverrideSupervision(
      actor(req),
      IdBancoSchema.parse(req.params.idIntento),
      OverrideSupervisionSchema.parse(req.body),
    );
    res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) { responderErrorBanco(res, error); }
};
