import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getAllComisiones = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('EXEC SP_MateriaDivision_ListarComisiones');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getAlumnosPorComision = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_MateriaDivision_ListarAlumnos');

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
