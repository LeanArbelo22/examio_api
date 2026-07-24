import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth-token.service';

export const checkRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'Acceso no autorizado', code: 'ACCESS_TOKEN_MISSING' });
    }

    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    const verification = verifyAccessToken(token);
    if (!verification.valid) {
      const expired = verification.reason === 'expired';
      return res.status(401).json({
        success: false,
        message: expired ? 'Access token vencido' : 'Access token inválido',
        code: expired ? 'ACCESS_TOKEN_EXPIRED' : 'ACCESS_TOKEN_INVALID',
      });
    }
    if (!roles.includes(verification.claims.role)) {
      return res.status(403).json({
        success: false,
        message: 'No tiene permisos para realizar esta acción',
        code: 'FORBIDDEN',
      });
    }
    (req as any).user = verification.claims;
    next();
  };
};

export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        code: 'REQUEST_INVALID',
        errors: result.error.issues,
      });
    }
    req.body = result.data;
    next();
  };
};
