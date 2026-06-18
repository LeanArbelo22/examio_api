import { z } from 'zod';

export const MateriaSchema = z.object({
  Nombre: z.string().min(1).max(100),
  Semestre: z.number().int().optional(),
  IdCarrera: z.number().int(),
});
