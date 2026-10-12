import { z } from 'zod';
import { isIsoDate } from '../utils/isoDate';

const optionalPositiveInteger = z.preprocess(
  (value) => value === undefined ? undefined : Number(value),
  z.number().int().positive().optional(),
);

const optionalBoolean = z.preprocess(
  value => value === undefined ? undefined
    : value === 'true' ? true
      : value === 'false' ? false
        : value,
  z.boolean().optional(),
);

export const RendimientoEvaluacionesQuerySchema = z.object({
  idMateria: optionalPositiveInteger,
  idMateriaDivision: optionalPositiveInteger,
  idActividad: optionalPositiveInteger,
  idPublicacion: optionalPositiveInteger,
  estado: z.enum(['borrador', 'publicada', 'archivada']).optional(),
  fechaDesde: z.string().refine(isIsoDate, 'fechaDesde debe ser una fecha ISO 8601 válida').optional(),
  fechaHasta: z.string().refine(isIsoDate, 'fechaHasta debe ser una fecha ISO 8601 válida').optional(),
  alcanceIntentos: z.enum(['todos', 'validos']).default('todos'),
  conPendientesCorreccion: optionalBoolean,
  pagina: z.preprocess(
    (value) => value === undefined ? 1 : Number(value),
    z.number().int().positive(),
  ),
  limite: z.preprocess(
    (value) => value === undefined ? 20 : Number(value),
    z.number().int().min(1).max(100),
  ),
  ordenarPor: z.enum([
    'evaluacion',
    'fecha',
    'promedio',
    'entregados',
    'aprobacion',
    'pendientesCorreccion',
  ]).default('fecha'),
  ordenDireccion: z.enum(['asc', 'desc']).default('desc'),
}).strict().superRefine((value, ctx) => {
  if (value.fechaDesde && value.fechaHasta && new Date(value.fechaDesde) > new Date(value.fechaHasta)) {
    ctx.addIssue({
      code: 'custom',
      path: ['fechaHasta'],
      message: 'fechaDesde no puede ser posterior a fechaHasta',
    });
  }
});

export type RendimientoEvaluacionesQuery = z.infer<typeof RendimientoEvaluacionesQuerySchema>;
