import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import * as authService from '../services/auth.service';
import { IdempotencyKeySchema } from '../schemas/auth.schema';
import { verifyAccessToken } from '../services/auth-token.service';

const DUMMY_PASSWORD_HASH = '$2b$10$C6UzMDM.H6dfI/f/IKcEe.ouQF5K9zDg9FQ2Q7YQxK6WZ6Q4N4K8C';

export const login = async (req: Request, res: Response) => {
  const { Email, Password } = req.body;

  try {
    const user = await authService.findUserByEmail(Email);
    if (!user) {
      await bcrypt.compare(Password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.', code: 'INVALID_CREDENTIALS' });
    }

    const passwordMatch = await bcrypt.compare(Password, user.PasswordHash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.', code: 'INVALID_CREDENTIALS' });
    }
    if (!user.Activo) {
      return res.status(401).json({ success: false, message: 'El usuario no está habilitado.', code: 'USER_INACTIVE' });
    }
    if (!user.VinculacionActiva) {
      return res.status(401).json({ success: false, message: 'La vinculación institucional no es válida.', code: 'SESSION_REVOKED' });
    }

    const tokens = await authService.createSession(user);
    res.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
        user: {
          id: user.Id,
          email: user.Email,
          role: user.Rol,
          name: user.NombreCompleto,
          identificadorInstitucional: user.IdentificadorInstitucional,
          idAlumno: user.IdAlumno,
          idDocente: user.IdDocente,
        },
      },
    });
  } catch (err: unknown) {
    if (err instanceof authService.AuthServiceError) {
      return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    }
    res.status(503).json({
      success: false,
      message: 'El servicio de autenticación no está disponible temporalmente.',
      code: 'AUTH_INFRASTRUCTURE_ERROR',
    });
  }
};

export const refresh = async (req: Request, res: Response) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || !IdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return res.status(400).json({
      success: false,
      message: 'Idempotency-Key debe ser un UUID válido.',
      code: 'REQUEST_INVALID',
    });
  }

  try {
    const tokens = await authService.rotateRefreshToken(req.body.RefreshToken, idempotencyKey);
    return res.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    if (err instanceof authService.AuthServiceError) {
      return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    }
    return res.status(503).json({
      success: false,
      message: 'El servicio de autenticación no está disponible temporalmente.',
      code: 'AUTH_INFRASTRUCTURE_ERROR',
    });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const authHeader = req.header('Authorization');
    const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    const verification = verifyAccessToken(bearer);
    const accessSessionId = verification.valid && !verification.legacy
      ? verification.claims.sessionId
      : undefined;

    await authService.revokeByRefreshToken(req.body.RefreshToken, accessSessionId);
    return res.json({ success: true, message: 'Sesión cerrada correctamente' });
  } catch {
    return res.status(503).json({
      success: false,
      message: 'El servicio de autenticación no está disponible temporalmente.',
      code: 'AUTH_INFRASTRUCTURE_ERROR',
    });
  }
};
