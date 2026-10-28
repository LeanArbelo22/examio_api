import { Request, Response } from 'express';
import { IdBancoSchema, IdempotencyKeySchema } from '../schemas/banco.schema';
import {
  ListaIncidentesPublicacionQuerySchema,
  RevisionIncidenteSchema,
} from '../schemas/incidentes.schema';
import { EventoIdSchema, IdIntentoTelemetriaSchema } from '../schemas/telemetria.schema';
import { ActorBanco, BancoError } from '../services/banco-common.service';
import {
  listarIncidentesPublicacion,
  revisarIncidente,
} from '../services/visibilidad-incidentes.service';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { responderErrorBanco } from './banco.controller';

const actor = (req: Request) => (req as Request & { user: ActorBanco }).user;

export const getIncidentesPublicacion = async (req: Request, res: Response) => {
  try {
    const data = await listarIncidentesPublicacion(
      actor(req),
      IdBancoSchema.parse(req.params.idPublicacion),
      ListaIncidentesPublicacionQuerySchema.parse(req.query),
    );
    return res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) {
    return responderErrorBanco(res, error);
  }
};

export const putRevisionIncidente = async (req: Request, res: Response) => {
  try {
    const key = IdempotencyKeySchema.safeParse(req.header('Idempotency-Key'));
    if (!key.success) {
      throw new BancoError(400, 'Idempotency-Key debe ser un UUID válido', 'REQUEST_INVALID');
    }
    const data = await revisarIncidente(
      actor(req),
      IdIntentoTelemetriaSchema.parse(req.params.idIntento),
      EventoIdSchema.parse(req.params.eventoId),
      key.data,
      RevisionIncidenteSchema.parse(req.body),
    );
    return res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) {
    return responderErrorBanco(res, error);
  }
};
