import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { ZodError } from 'zod';
import { ActorBanco, BancoError, atomico } from '../services/banco-common.service';
import { EventoIdSchema, IdIntentoTelemetriaSchema } from '../schemas/telemetria.schema';
import {
  guardarIncidenteFoco,
  listarIncidentesFoco,
  resumirIncidentesFoco,
} from '../services/telemetria-focus.service';

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
