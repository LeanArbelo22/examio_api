import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getAllCarreras = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('EXEC SP_Carrera_ObtenerTodo');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getCarreraById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Carrera_ObtenerPorId');

    if (result.recordset.length === 0) return res.status(404).json({ success: false, message: 'Carrera no encontrada' });
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset[0]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const createCarrera = async (req: Request, res: Response) => {
  try {
    const { Nombre, Descripcion, DuracionSemestres } = req.body;
    await pool.request()
      .input('Nombre', sql.NVarChar, Nombre)
      .input('Descripcion', sql.NVarChar, Descripcion)
      .input('DuracionSemestres', sql.Int, DuracionSemestres)
      .execute('SP_Carrera_Crear');

    res.status(201).json({ success: true, message: 'Carrera creada correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const updateCarrera = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { Nombre, Descripcion, DuracionSemestres } = req.body;
    await pool.request()
      .input('Id', sql.Int, id)
      .input('Nombre', sql.NVarChar, Nombre)
      .input('Descripcion', sql.NVarChar, Descripcion)
      .input('DuracionSemestres', sql.Int, DuracionSemestres)
      .execute('SP_Carrera_Actualizar');

    res.json({ success: true, message: 'Carrera actualizada correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const deleteCarrera = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Carrera_Eliminar');

    res.json({ success: true, message: 'Carrera dada de baja' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getPlanDeEstudios = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Carrera_VerPlanDeEstudio');

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getAlumnosInscriptos = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Carrera_ListarAlumnos');

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
