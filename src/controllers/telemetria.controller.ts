import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

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
