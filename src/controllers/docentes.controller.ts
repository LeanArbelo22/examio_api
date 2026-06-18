import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getAllDocentes = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('EXEC SP_Docente_ObtenerTodo');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getDocenteByLegajo = async (req: Request, res: Response) => {
  try {
    const { legajo } = req.params;
    const result = await pool.request()
      .input('Legajo', sql.Int, legajo)
      .execute('SP_Docente_ObtenerPorId');

    if (result.recordset.length === 0) return res.status(404).json({ success: false, message: 'Docente no encontrado' });
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset[0]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const createDocente = async (req: Request, res: Response) => {
  try {
    const { Legajo, Nombre, Apellido, Cuil, Correo } = req.body;
    await pool.request()
      .input('Legajo', sql.Int, Legajo)
      .input('Nombre', sql.NVarChar, Nombre)
      .input('Apellido', sql.NVarChar, Apellido)
      .input('Cuil', sql.NVarChar, Cuil)
      .input('Correo', sql.NVarChar, Correo)
      .execute('SP_Docente_Crear');

    res.status(201).json({ success: true, message: 'Docente creado correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const updateDocente = async (req: Request, res: Response) => {
  try {
    const { legajo } = req.params;
    const { Nombre, Apellido, Correo } = req.body;
    await pool.request()
      .input('Legajo', sql.Int, legajo)
      .input('Nombre', sql.NVarChar, Nombre)
      .input('Apellido', sql.NVarChar, Apellido)
      .input('Correo', sql.NVarChar, Correo)
      .execute('SP_Docente_Actualizar');

    res.json({ success: true, message: 'Docente actualizado correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const deleteDocente = async (req: Request, res: Response) => {
  try {
    const { legajo } = req.params;
    await pool.request()
      .input('Legajo', sql.Int, legajo)
      .execute('SP_Docente_Eliminar');

    res.json({ success: true, message: 'Docente dado de baja' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getComisionesByDocente = async (req: Request, res: Response) => {
  try {
    const { legajo } = req.params;
    const result = await pool.request()
      .input('Legajo', sql.Int, legajo)
      .execute('SP_Docente_VerMaterias');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getDocentesByEstado = async (req: Request, res: Response) => {
  try {
    const { estado } = req.params;
    const result = await pool.request()
      .input('Estado', sql.Bit, estado === 'true' ? 1 : 0)
      .execute('SP_Docente_ObtenerPorEstado');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const asignarComision = async (req: Request, res: Response) => {
  try {
    const { legajo } = req.params;
    const { IdMateriaDivision } = req.body;
    await pool.request()
      .input('Legajo', sql.Int, legajo)
      .input('IdMateriaDivision', sql.Int, IdMateriaDivision)
      .execute('SP_Docente_AsignarComision');

    res.json({ success: true, message: 'Comisión asignada correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getMateriasByDocente = async (req: Request, res: Response) => {
  try {
    const { legajo } = req.params;
    const result = await pool.request()
      .input('Legajo', sql.Int, legajo)
      .execute('SP_Docente_VerMaterias');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getEvaluacionesByDocente = async (req: Request, res: Response) => {
  try {
    const { legajo } = req.params;
    const result = await pool.request()
      .input('Legajo', sql.Int, legajo)
      .query(`
        SELECT P.Id AS IdPublicacion, A.Titulo, A.Tipo, A.DuracionMinutos,
               A.CantidadIntentosMaximos, A.Estado, P.FechaInicio, P.FechaFin,
               M.Nombre AS Materia, Dv.Descripcion AS Division,
               (SELECT COUNT(*) FROM InscripcionMateria WHERE IdMateriaDivision = MD.Id) AS AlumnosInscriptos,
               (SELECT COUNT(*) FROM Intento WHERE IdPublicacion = P.Id) AS TotalIntentos
        FROM Publicacion P
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Division Dv ON MD.IdDivision = Dv.Id
        WHERE MD.IdDocente = @Legajo
        ORDER BY P.FechaFin DESC
      `);

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
