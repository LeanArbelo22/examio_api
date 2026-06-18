import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getAllMaterias = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('EXEC SP_Materia_ObtenerTodo');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getMateriaById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Materia_ObtenerPorId');

    if (result.recordset.length === 0) return res.status(404).json({ success: false, message: 'Materia no encontrada' });
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset[0]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const createMateria = async (req: Request, res: Response) => {
  try {
    const { Nombre, Semestre, IdCarrera } = req.body;
    await pool.request()
      .input('Nombre', sql.NVarChar, Nombre)
      .input('Semestre', sql.Int, Semestre)
      .input('IdCarrera', sql.Int, IdCarrera)
      .execute('SP_Materia_Crear');

    res.status(201).json({ success: true, message: 'Materia creada correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const updateMateria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { Nombre, Semestre } = req.body;
    await pool.request()
      .input('Id', sql.Int, id)
      .input('Nombre', sql.NVarChar, Nombre)
      .input('Semestre', sql.Int, Semestre)
      .execute('SP_Materia_Actualizar');

    res.json({ success: true, message: 'Materia actualizada correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const deleteMateria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Materia_Eliminar');

    res.json({ success: true, message: 'Materia dada de baja' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getAlumnosPorMateria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Materia_ListarAlumnos');

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const asignarDivision = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { Id } = req.body;
    await pool.request()
      .input('IdMateria', sql.Int, id)
      .input('IdDivision', sql.Int, Id)
      .execute('SP_Materia_AsignarDivision');

    res.json({ success: true, message: 'División asignada a la materia' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getComisionesPorMateria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .execute('SP_Materia_ListarComisiones');

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
