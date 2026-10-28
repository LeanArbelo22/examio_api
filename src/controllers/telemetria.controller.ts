import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { ZodError } from 'zod';
import { ActorBanco, BancoError, atomico } from '../services/banco-common.service';
import {
  EventoIdSchema,
  EventoTemporalLoteItemSchema,
  EventoTemporalSchema,
  IdIntentoTelemetriaSchema,
  ListaEventosTemporalesQuerySchema,
  LoteEventosTemporalesSchema,
} from '../schemas/telemetria.schema';
import {
  guardarIncidenteFoco,
  listarIncidentesFoco,
  resumirIncidentesFoco,
} from '../services/telemetria-focus.service';
import { guardarEventoTemporal, listarEventosTemporales } from '../services/telemetria-temporal.service';

type ActorTelemetria = ActorBanco & { idAlumno?: number | null };

const responderErrorTelemetria = (res: Response, error: unknown) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Datos inválidos',
      code: 'REQUEST_INVALID',
      errors: error.issues,
    });
  }
  if (error instanceof BancoError) {
    return res.status(error.status).json({ success: false, message: error.message, code: error.code });
  }
  console.error('[telemetria] Error de persistencia');
  return res.status(500).json({ success: false, message: 'No se pudo completar la operación' });
};

export const registrarAlerta = async (req: Request, res: Response) => {
  try {
    const { IdIntento, TipoIncidente, Detalle } = req.body;
    await pool.request()
      .input('IdIntento', sql.Int, IdIntento)
      .input('TipoIncidente', sql.NVarChar, TipoIncidente)
      .input('Detalle', sql.NVarChar, Detalle || null)
      .execute('SP_Antifraude_RegistrarAlerta');

    res.json({ success: true, message: 'Incidente reportado en auditoría.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const registrarNavegacion = async (req: Request, res: Response) => {
  try {
    const { IdIntento, IdPregunta, SegundosPermanencia } = req.body;
    await pool.request()
      .input('IdIntento', sql.Int, IdIntento)
      .input('IdPregunta', sql.Int, IdPregunta)
      .input('SegundosPermanencia', sql.Int, SegundosPermanencia)
      .execute('SP_Telemetria_RegistrarNavegacion');

    res.json({ success: true, message: 'Métrica de tiempo consolidada.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getAlertasByIntento = async (req: Request, res: Response) => {
  try {
    const { idIntento } = req.params;
    const result = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .query('SELECT * FROM AlertaFraude WHERE IdIntento = @IdIntento');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const registrarIncidenteFoco = async (req: Request, res: Response) => {
  try {
    const idIntento = IdIntentoTelemetriaSchema.parse(req.params.idIntento);
    const eventoId = EventoIdSchema.parse(req.params.eventoId);
    const actor = (req as Request & { user: ActorTelemetria }).user;
    const data = await atomico(tx => guardarIncidenteFoco(tx, actor, idIntento, eventoId, req.body));
    return res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) {
    return responderErrorTelemetria(res, error);
  }
};

export const getResumenIncidentes = async (req: Request, res: Response) => {
  try {
    const idIntento = IdIntentoTelemetriaSchema.parse(req.params.idIntento);
    const actor = (req as Request & { user: ActorTelemetria }).user;
    const data = await resumirIncidentesFoco(actor, idIntento);
    return res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) {
    return responderErrorTelemetria(res, error);
  }
};

export const getIncidentesByIntento = async (req: Request, res: Response) => {
  try {
    const idIntento = IdIntentoTelemetriaSchema.parse(req.params.idIntento);
    const actor = (req as Request & { user: ActorTelemetria }).user;
    const data = await listarIncidentesFoco(actor, idIntento);
    return res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) {
    return responderErrorTelemetria(res, error);
  }
};

export const registrarEventoTemporal = async (req: Request, res: Response) => {
  try {
    const idIntento = IdIntentoTelemetriaSchema.parse(req.params.idIntento);
    const eventoId = EventoIdSchema.parse(req.params.eventoId);
    const input = EventoTemporalSchema.parse(req.body);
    const actor = (req as Request & { user: ActorTelemetria }).user;
    const data = await atomico(tx => guardarEventoTemporal(tx, actor, idIntento, eventoId, input));
    return res.json({ success: true, data: mapKeysToCamelCase(data) });
  } catch (error) {
    return responderErrorTelemetria(res, error);
  }
};

export const registrarEventosTemporalesLote = async (req: Request, res: Response) => {
  try {
    const idIntento = IdIntentoTelemetriaSchema.parse(req.params.idIntento);
    const { Eventos } = LoteEventosTemporalesSchema.parse(req.body);
    const actor = (req as Request & { user: ActorTelemetria }).user;
    const resultados: Record<string, unknown>[] = [];

    for (const raw of Eventos) {
      const parsed = EventoTemporalLoteItemSchema.safeParse(raw);
      if (!parsed.success) {
        resultados.push({
          eventoId: typeof (raw as any)?.EventoId === 'string' ? (raw as any).EventoId : null,
          resultado: 'rechazado',
          codigo: 'REQUEST_INVALID',
          errores: parsed.error.issues,
        });
        continue;
      }
      const { EventoId, ...input } = parsed.data;
      try {
        const data = await atomico(tx => guardarEventoTemporal(tx, actor, idIntento, EventoId, input));
        resultados.push(mapKeysToCamelCase({ EventoId, ...data }) as Record<string, unknown>);
      } catch (error) {
        if (error instanceof BancoError) {
          resultados.push({
            eventoId: EventoId,
            resultado: error.status === 409 ? 'conflicto' : 'rechazado',
            codigo: error.code ?? 'TELEMETRY_EVENT_REJECTED',
            message: error.message,
          });
        } else {
          console.error('[telemetria] Error de persistencia en elemento de lote');
          resultados.push({
            eventoId: EventoId,
            resultado: 'rechazado',
            codigo: 'TELEMETRY_PERSISTENCE_ERROR',
            message: 'No se pudo completar la operación',
          });
        }
      }
    }

    return res.json({ success: true, data: { resultados } });
  } catch (error) {
    return responderErrorTelemetria(res, error);
  }
};

export const getEventosTemporales = async (req: Request, res: Response) => {
  try {
    const idIntento = IdIntentoTelemetriaSchema.parse(req.params.idIntento);
    const query = ListaEventosTemporalesQuerySchema.parse(req.query);
    const actor = (req as Request & { user: ActorTelemetria }).user;
    const data = await listarEventosTemporales(actor, idIntento, query.pagina, query.limite);
    return res.json({ success: true, data });
  } catch (error) {
    return responderErrorTelemetria(res, error);
  }
};
