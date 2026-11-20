import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getAllComisiones = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        MD.Id AS IdMateriaDivision,
        MD.IdMateria,
        M.Nombre AS Materia,
        D.Descripcion AS Division,
        MD.IdDocente,
        ISNULL(Doc.Nombre + ' ' + Doc.Apellido, 'No asignado') AS DocenteAsignado
      FROM MateriaDivision AS MD
      INNER JOIN Materia AS M ON M.Id = MD.IdMateria
      INNER JOIN Division AS D ON D.Id = MD.IdDivision
      LEFT JOIN Docente AS Doc ON MD.IdDocente = Doc.Legajo
    `);
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
