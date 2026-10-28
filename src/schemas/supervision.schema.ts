import { z } from 'zod';
import { TiposEventoTemporal } from './telemetria.schema';

export const MetricaSupervisionSchema = z.enum([
  'cantidad', 'duracion_individual', 'duracion_acumulada',
]);
export const AccionSupervisionSchema = z.enum([
  'informar', 'advertir', 'bloquear_interfaz', 'anular_intento',
]);

export const ReglaSupervisionSchema = z.object({
  Codigo: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_.-]+$/),
  TipoEvento: z.enum(TiposEventoTemporal),
  Metrica: MetricaSupervisionSchema,
  Umbral: z.number().int().positive().safe(),
  VentanaSegundos: z.number().int().positive().max(604800).nullable().optional(),
  Prioridad: z.number().int().min(0).max(10000),
  Accion: AccionSupervisionSchema,
  Activa: z.boolean().default(true),
}).strict();

export const PoliticaSupervisionSchema = z.object({
  PantallaCompletaObligatoria: z.boolean(),
  RevisionEsperada: z.number().int().min(0),
  Reglas: z.array(ReglaSupervisionSchema).max(50),
}).strict().superRefine((value, ctx) => {
  const codigos = new Set<string>();
  value.Reglas.forEach((regla, index) => {
    const codigo = regla.Codigo.toLowerCase();
    if (codigos.has(codigo)) {
      ctx.addIssue({ code: 'custom', path: ['Reglas', index, 'Codigo'], message: 'Código de regla duplicado' });
    }
    codigos.add(codigo);
  });
});

export const OverrideSupervisionSchema = z.object({
  Accion: z.enum(['desbloquear', 'reconocer', 'descartar']),
  EventoId: z.string().uuid().nullable().optional(),
  Motivo: z.string().trim().min(1).max(250),
  RevisionEsperada: z.number().int().min(0),
}).strict().superRefine((value, ctx) => {
  if (value.Accion !== 'desbloquear' && !value.EventoId) {
    ctx.addIssue({ code: 'custom', path: ['EventoId'], message: 'La decisión requiere EventoId' });
  }
});

export type PoliticaSupervisionInput = z.infer<typeof PoliticaSupervisionSchema>;
export type OverrideSupervisionInput = z.infer<typeof OverrideSupervisionSchema>;
