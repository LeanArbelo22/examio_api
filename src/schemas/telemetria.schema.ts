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
  Tipo: z.enum(['focus_lost', 'fullscreen_exit']),
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

export const TiposEventoTemporal = [
  'question_active',
  'focus_lost',
  'fullscreen_exit',
  'connectivity_lost',
  'auth_session_unavailable',
  'exam_resumed',
  'page_reload',
  'sync_error',
  'submission_failed',
  'attempt_finished',
] as const;

const TipoEventoTemporalSchema = z.enum(TiposEventoTemporal);
const tiposIntervalo = new Set<string>([
  'question_active',
  'focus_lost',
  'fullscreen_exit',
  'connectivity_lost',
  'auth_session_unavailable',
]);

export const EventoTemporalSchema = z.object({
  Tipo: TipoEventoTemporalSchema,
  IdIntentoPregunta: z.number().int().positive().optional().nullable(),
  SesionClienteId: z.string().uuid(),
  SecuenciaCliente: z.number().int().nonnegative().safe(),
  FechaInicioCliente: fechaCliente.optional(),
  FechaFinCliente: fechaCliente.optional(),
  DuracionMilisegundos: z.number().int().nonnegative().safe().optional(),
  Codigo: z.string().min(1).max(50).regex(/^[A-Za-z0-9_.-]+$/).optional().nullable(),
  VersionContrato: z.literal(1).default(1),
}).strict().superRefine((value, ctx) => {
  const intervalo = tiposIntervalo.has(value.Tipo);
  const tieneFin = value.FechaFinCliente !== undefined;
  const tieneDuracion = value.DuracionMilisegundos !== undefined;

  if (value.Tipo === 'question_active' && !value.IdIntentoPregunta) {
    ctx.addIssue({ code: 'custom', path: ['IdIntentoPregunta'], message: 'question_active requiere IdIntentoPregunta' });
  }
  if (value.Tipo !== 'question_active' && value.IdIntentoPregunta != null) {
    ctx.addIssue({ code: 'custom', path: ['IdIntentoPregunta'], message: 'IdIntentoPregunta sólo corresponde a question_active' });
  }
  if (tieneFin !== tieneDuracion) {
    ctx.addIssue({
      code: 'custom',
      path: tieneFin ? ['DuracionMilisegundos'] : ['FechaFinCliente'],
      message: 'FechaFinCliente y DuracionMilisegundos deben enviarse juntos',
    });
  }
  if (!value.FechaInicioCliente && !tieneFin) {
    ctx.addIssue({ code: 'custom', path: ['FechaInicioCliente'], message: 'El evento debe iniciarse antes de cerrarse' });
  }
  if (!intervalo && (tieneFin || tieneDuracion)) {
    ctx.addIssue({ code: 'custom', path: ['FechaFinCliente'], message: 'Un evento puntual no admite duración' });
  }
});

export const EventoTemporalLoteItemSchema = EventoTemporalSchema.safeExtend({
  EventoId: z.string().uuid(),
});

export const LoteEventosTemporalesSchema = z.object({
  Eventos: z.array(z.unknown()).min(1).max(500),
}).strict();

export const ListaEventosTemporalesQuerySchema = z.object({
  pagina: z.coerce.number().int().positive().max(1000000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export type EventoTemporalInput = z.infer<typeof EventoTemporalSchema>;
