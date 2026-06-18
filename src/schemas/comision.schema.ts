import { z } from 'zod';

export const AsignarDivisionSchema = z.object({
  Id: z.number().int(),
});

export const AsignarComisionSchema = z.object({
  IdMateriaDivision: z.number().int(),
});
