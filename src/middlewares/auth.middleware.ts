import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET: string = process.env.JWT_SECRET ?? (() => { throw new Error('JWT_SECRET no está definido en las variables de entorno'); })();

export const checkRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'Acceso no autorizado' });

    const token = authHeader.split(' ')[1];
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      if (!roles.includes(decoded.role)) {
        return res.status(403).json({ success: false, message: 'No tiene permisos para realizar esta acción' });
      }
      (req as any).user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ success: false, message: 'Token inválido' });
    }
  };
};

export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      console.log("❌ [ZOD VALIDATION ERROR]:", JSON.stringify(result.error.issues, null, 2));
      return res.status(400).json({ success: false, message: 'Datos inválidos', errors: result.error.issues });
    }
    next();
  };
};
