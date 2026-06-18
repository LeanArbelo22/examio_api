import { z } from 'zod';

export const AlertaSchema = z.object({
  IdIntento: z.number().int(),
  TipoIncidente: z.string().min(1).max(50),
  Detalle: z.string().max(250).optional(),
});

export const NavegacionSchema = z.object({
  IdIntento: z.number().int(),
  IdPregunta: z.number().int(),
  SegundosPermanencia: z.number().int(),
});
