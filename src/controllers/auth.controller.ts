import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as authService from '../services/auth.service';

const JWT_SECRET: string = process.env.JWT_SECRET ?? (() => { throw new Error('JWT_SECRET no está definido en las variables de entorno'); })();

export const login = async (req: Request, res: Response) => {
  const { Email, Password } = req.body;

  try {
    const user = await authService.findUserByEmail(Email);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
    }

    console.log("👉 Intentando login para:", Email);
    console.log("👉 Password ingresada (plana):", Password);
    console.log("👉 Password en BD (hash o plana):", user.PasswordHash);

    const passwordMatch = await bcrypt.compare(Password, user.PasswordHash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
    }

    const token = jwt.sign({ id: user.Id, email: user.Email, role: user.Rol, idAlumno: user.IdAlumno, idDocente: user.IdDocente }, JWT_SECRET, { expiresIn: '1h' });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.Id,
          email: user.Email,
          role: user.Rol,
          name: user.NombreCompleto,
          identificadorInstitucional: user.IdentificadorInstitucional,
        },
      },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Error interno';
    res.status(500).json({ success: false, message: errorMessage });
  }
};
