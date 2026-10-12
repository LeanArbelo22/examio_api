import { z } from 'zod';
import { isIsoDate } from '../utils/isoDate';

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

const fechaCliente = z.string().refine(
  value => value.includes('T') && isIsoDate(value),
  'Debe ser un timestamp ISO 8601 válido',
);

export const IncidenteFocoSchema = z.object({
  Tipo: z.literal('focus_lost'),
  FechaInicioCliente: fechaCliente.optional(),
  FechaFinCliente: fechaCliente.optional(),
  DuracionMilisegundos: z.number().int().nonnegative().safe().optional(),
}).strict().superRefine((value, ctx) => {
  const tieneFin = value.FechaFinCliente !== undefined;
  const tieneDuracion = value.DuracionMilisegundos !== undefined;
  if (tieneFin !== tieneDuracion) {
    ctx.addIssue({
      code: 'custom',
      path: tieneFin ? ['DuracionMilisegundos'] : ['FechaFinCliente'],
      message: 'FechaFinCliente y DuracionMilisegundos deben enviarse juntos',
    });
  }
  if (!value.FechaInicioCliente && !tieneFin) {
    ctx.addIssue({
      code: 'custom',
      path: ['FechaInicioCliente'],
      message: 'El inicio requiere FechaInicioCliente',
    });
  }
});

export const IdIntentoTelemetriaSchema = z.coerce.number().int().positive();
export const EventoIdSchema = z.string().uuid();
export type IncidenteFocoInput = z.infer<typeof IncidenteFocoSchema>;
