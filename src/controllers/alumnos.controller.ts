import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getAllAlumnos = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('EXEC SP_Alumno_ObtenerTodo');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getAlumnoById = async (req: Request, res: Response) => {
  try {
    const { matricula } = req.params;
    const result = await pool.request()
      .input('Matricula', sql.Int, matricula)
      .execute('SP_Alumno_ObtenerPorId');

    if (result.recordset.length === 0) return res.status(404).json({ success: false, message: 'Alumno no encontrado' });
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset[0]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const createAlumno = async (req: Request, res: Response) => {
  try {
    const { Matricula, Nombre, Apellido, Cuil, Correo } = req.body;
    await pool.request()
      .input('Matricula', sql.Int, Matricula)
      .input('Nombre', sql.NVarChar, Nombre)
      .input('Apellido', sql.NVarChar, Apellido)
      .input('Cuil', sql.NVarChar, Cuil)
      .input('Correo', sql.NVarChar, Correo)
      .execute('SP_Alumno_Crear');

    res.status(201).json({ success: true, message: 'Alumno creado correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const updateAlumno = async (req: Request, res: Response) => {
  try {
    const { matricula } = req.params;
    const { Nombre, Apellido, Correo } = req.body;
    await pool.request()
      .input('Matricula', sql.Int, matricula)
      .input('Nombre', sql.NVarChar, Nombre)
      .input('Apellido', sql.NVarChar, Apellido)
      .input('Correo', sql.NVarChar, Correo)
      .execute('SP_Alumno_Actualizar');

    res.json({ success: true, message: 'Alumno actualizado correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const deleteAlumno = async (req: Request, res: Response) => {
  try {
    const { matricula } = req.params;
    await pool.request()
      .input('Matricula', sql.Int, matricula)
      .execute('SP_Alumno_Eliminar');

    res.json({ success: true, message: 'Alumno dado de baja' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getMateriasByAlumno = async (req: Request, res: Response) => {
  try {
    const { matricula } = req.params;
    const result = await pool.request()
      .input('Matricula', sql.Int, matricula)
      .execute('SP_Alumno_VerMaterias');

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getEstadisticasAlumno = async (req: Request, res: Response) => {
  try {
    const { matricula } = req.params;
    const result = await pool.request()
      .input('Matricula', sql.Int, matricula)
      .query(`
        SELECT
            COUNT(*)                                          AS TotalCorregidos,
            CAST(AVG(CAST(I.NotaFinal AS DECIMAL(10,2))) AS DECIMAL(4,2)) AS PromedioGeneral,
            SUM(CASE WHEN I.NotaFinal >= 6 THEN 1 ELSE 0 END) AS Aprobados,
            ROUND(
                CAST(SUM(CASE WHEN I.NotaFinal >= 6 THEN 1 ELSE 0 END) AS FLOAT)
                / NULLIF(COUNT(*), 0) * 100, 1
            )                                                 AS PorcentajeAprobacion
        FROM Intento I
        INNER JOIN Publicacion P   ON I.IdPublicacion = P.Id
        INNER JOIN Actividad A     ON P.IdActividad = A.Id
        WHERE I.IdAlumno = @Matricula
          AND I.NotaFinal IS NOT NULL
          AND I.Estado = 'entregado'
      `);

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset[0] || {}) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
