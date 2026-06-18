import { z } from 'zod';

export const ActaSchema = z.object({
  IdMateriaDivision: z.number().int(),
  Libro: z.string().min(1).max(20),
  Folio: z.string().min(1).max(20),
});

export const DetalleActaSchema = z.object({
  IdActa: z.number().int(),
  IdAlumno: z.number().int(),
  NotaCursada: z.number().min(0).max(10).multipleOf(0.01),
  NotaFinalExamen: z.number().min(0).max(10).multipleOf(0.01).optional().nullable(),
  CondicionFinal: z.enum(['regular', 'promocionado', 'libre']),
});
