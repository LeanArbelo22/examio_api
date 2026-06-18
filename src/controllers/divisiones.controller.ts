import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getAllDivisiones = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('EXEC SP_Division_ObtenerTodo');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getDivisionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Division_ObtenerPorId');

    if (result.recordset.length === 0) return res.status(404).json({ success: false, message: 'División no encontrada' });
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset[0]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const createDivision = async (req: Request, res: Response) => {
  try {
    await pool.request()
      .input('Descripcion', sql.NVarChar, req.body.Descripcion)
      .execute('SP_Division_Crear');

    res.status(201).json({ success: true, message: 'División creada correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const updateDivision = async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: 'Endpoint no implementado' });
};

export const deleteDivision = async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: 'Endpoint no implementado' });
};
