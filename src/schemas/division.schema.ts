import { z } from 'zod';

export const DivisionSchema = z.object({
  Descripcion: z.string().min(1).max(50),
});
