import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const crearActa = async (req: Request, res: Response) => {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const { IdMateriaDivision, Libro, Folio } = req.body;

    const result = await transaction.request()
      .input('IdMateriaDivision', sql.Int, IdMateriaDivision)
      .input('Libro', sql.NVarChar, Libro)
      .input('Folio', sql.NVarChar, Folio)
      .query(`
        INSERT INTO ActaMateria (IdMateriaDivision, Libro, Folio, Estado)
        VALUES (@IdMateriaDivision, @Libro, @Folio, 'abierta');
        SELECT SCOPE_IDENTITY() AS idActa;
      `);

    await transaction.commit();
    res.status(201).json({ success: true, data: { idActa: result.recordset[0].idActa } });
  } catch (err: unknown) {
    if (transaction) await transaction.rollback();
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const cargarDetalleActa = async (req: Request, res: Response) => {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const { IdActa, IdAlumno, NotaCursada, NotaFinalExamen, CondicionFinal } = req.body;

    await transaction.request()
      .input('IdActa', sql.Int, IdActa)
      .input('IdAlumno', sql.Int, IdAlumno)
      .input('NotaCursada', sql.Decimal(4, 2), NotaCursada)
      .input('NotaFinalExamen', sql.Decimal(4, 2), NotaFinalExamen ?? null)
      .input('CondicionFinal', sql.NVarChar, CondicionFinal)
      .query(`
        INSERT INTO DetalleActa (IdActa, IdAlumno, NotaCursada, NotaFinalExamen, CondicionFinal)
        VALUES (@IdActa, @IdAlumno, @NotaCursada, @NotaFinalExamen, @CondicionFinal);
      `);

    await transaction.commit();
    res.status(201).json({ success: true, message: 'Detalle cargado' });
  } catch (err: unknown) {
    if (transaction) await transaction.rollback();
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getAllActas = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM ActaMateria');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getActaById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .query('SELECT * FROM ActaMateria WHERE Id = @Id');

    if (result.recordset.length === 0) return res.status(404).json({ success: false, message: 'Acta no encontrada' });

    const detalle = await pool.request()
      .input('IdActa', sql.Int, id)
      .query('SELECT * FROM DetalleActa WHERE IdActa = @IdActa');

    res.json({
      success: true,
      data: mapKeysToCamelCase({ ...result.recordset[0], detalles: detalle.recordset }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const cerrarActa = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.request()
      .input('Id', sql.Int, id)
      .query("UPDATE ActaMateria SET Estado = 'cerrada' WHERE Id = @Id");

    res.json({ success: true, message: 'Acta cerrada exitosamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
