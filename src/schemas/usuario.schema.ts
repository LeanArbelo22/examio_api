import { z } from 'zod';

export const UsuarioSchema = z.object({
  Email: z.string().email().max(150),
  Password: z.string().min(1),
  Rol: z.enum(['admin', 'docente', 'alumno']),
  IdDocente: z.number().int().optional().nullable(),
  IdAlumno: z.number().int().optional().nullable(),
  Activo: z.boolean().optional(),
});

export const UsuarioUpdateSchema = z.object({
  Email: z.string().email().max(150).optional(),
  Password: z.string().min(1).optional(),
  Rol: z.enum(['admin', 'docente', 'alumno']).optional(),
  IdDocente: z.number().int().optional().nullable(),
  IdAlumno: z.number().int().optional().nullable(),
  Activo: z.boolean().optional(),
});
