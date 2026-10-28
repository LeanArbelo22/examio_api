import { z } from 'zod';

const optionalBoolean = z.preprocess(
  value => value === undefined ? undefined
    : value === 'true' ? true
      : value === 'false' ? false
        : value,
  z.boolean().optional(),
);

export const SeveridadesIncidente = [
  'sin_clasificar',
  'informar',
  'advertir',
  'bloquear_interfaz',
  'anular_intento',
] as const;

export const RevisionIncidenteSchema = z.object({
  Estado: z.enum(['pendiente', 'revisado', 'descartado']),
  RevisionEsperada: z.number().int().nonnegative(),
  Comentario: z.string().trim().min(1).max(500).optional().nullable(),
}).strict();

export const ListaIncidentesPublicacionQuerySchema = z.object({
  tipoIncidente: z.string().trim().min(1).max(30).optional(),
  severidad: z.enum(SeveridadesIncidente).optional(),
  estadoRevision: z.enum(['pendiente', 'revisado', 'descartado']).optional(),
  soloIncidentesSinRevisar: optionalBoolean,
  pagina: z.coerce.number().int().positive().max(1_000_000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
}).strict().superRefine((value, ctx) => {
  if (value.soloIncidentesSinRevisar === true &&
      value.estadoRevision && value.estadoRevision !== 'pendiente') {
    ctx.addIssue({
      code: 'custom',
      path: ['estadoRevision'],
      message: 'soloIncidentesSinRevisar=true sólo admite estadoRevision=pendiente',
    });
  }
});

export type RevisionIncidenteInput = z.infer<typeof RevisionIncidenteSchema>;
export type ListaIncidentesPublicacionQuery = z.infer<typeof ListaIncidentesPublicacionQuerySchema>;
