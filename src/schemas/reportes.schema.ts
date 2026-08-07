import { z } from 'zod';

const optionalPositiveInteger = z.preprocess(
  (value) => value === undefined ? undefined : Number(value),
  z.number().int().positive().optional(),
);

const isIsoDate = (value: string): boolean => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return parsed.toISOString().slice(0, 10) === value;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
};

export const RendimientoEvaluacionesQuerySchema = z.object({
  idMateria: optionalPositiveInteger,
  idMateriaDivision: optionalPositiveInteger,
  idActividad: optionalPositiveInteger,
  idPublicacion: optionalPositiveInteger,
  estado: z.enum(['borrador', 'publicada', 'archivada']).optional(),
  fechaDesde: z.string().refine(isIsoDate, 'fechaDesde debe ser una fecha ISO 8601 válida').optional(),
  fechaHasta: z.string().refine(isIsoDate, 'fechaHasta debe ser una fecha ISO 8601 válida').optional(),
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
