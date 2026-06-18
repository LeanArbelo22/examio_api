import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import bcrypt from 'bcryptjs';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getAllUsuarios = async (req: Request, res: Response) => {
  try {
    const result = await pool.request().query(
      'SELECT Id, Email, Rol, IdDocente, IdAlumno, Activo FROM Usuario ORDER BY Id'
    );
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const createUsuario = async (req: Request, res: Response) => {
  try {
    const { Email, Password, Rol, IdDocente, IdAlumno, Activo } = req.body;

    const passwordHash = await bcrypt.hash(Password, 10);

    await pool.request()
      .input('Email', sql.NVarChar, Email)
      .input('PasswordHash', sql.NVarChar, passwordHash)
      .input('Rol', sql.NVarChar, Rol)
      .input('IdDocente', sql.Int, IdDocente ?? null)
      .input('IdAlumno', sql.Int, IdAlumno ?? null)
      .input('Activo', sql.Bit, Activo ?? true)
      .query(`INSERT INTO Usuario (Email, PasswordHash, Rol, IdDocente, IdAlumno, Activo)
              VALUES (@Email, @PasswordHash, @Rol, @IdDocente, @IdAlumno, @Activo)`);

    res.status(201).json({ success: true, message: 'Usuario creado correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const updateUsuario = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { Email, Password, Rol, IdDocente, IdAlumno, Activo } = req.body;

    if (Password) {
      const passwordHash = await bcrypt.hash(Password, 10);
      await pool.request()
        .input('Id', sql.Int, id)
        .input('Email', sql.NVarChar, Email ?? null)
        .input('PasswordHash', sql.NVarChar, passwordHash)
        .input('Rol', sql.NVarChar, Rol ?? null)
        .input('IdDocente', sql.Int, IdDocente ?? null)
        .input('IdAlumno', sql.Int, IdAlumno ?? null)
        .input('Activo', sql.Bit, Activo ?? null)
        .query(`UPDATE Usuario SET 
                Email = COALESCE(@Email, Email),
                PasswordHash = COALESCE(@PasswordHash, PasswordHash),
                Rol = COALESCE(@Rol, Rol),
                IdDocente = @IdDocente,
                IdAlumno = @IdAlumno,
                Activo = COALESCE(@Activo, Activo)
                WHERE Id = @Id`);
    } else {
      await pool.request()
        .input('Id', sql.Int, id)
        .input('Email', sql.NVarChar, Email ?? null)
        .input('Rol', sql.NVarChar, Rol ?? null)
        .input('IdDocente', sql.Int, IdDocente ?? null)
        .input('IdAlumno', sql.Int, IdAlumno ?? null)
        .input('Activo', sql.Bit, Activo ?? null)
        .query(`UPDATE Usuario SET 
                Email = COALESCE(@Email, Email),
                Rol = COALESCE(@Rol, Rol),
                IdDocente = @IdDocente,
                IdAlumno = @IdAlumno,
                Activo = COALESCE(@Activo, Activo)
                WHERE Id = @Id`);
    }

    res.json({ success: true, message: 'Usuario actualizado correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const deleteUsuario = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.request()
      .input('Id', sql.Int, id)
      .query('UPDATE Usuario SET Activo = 0 WHERE Id = @Id');

    res.json({ success: true, message: 'Usuario desactivado correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
