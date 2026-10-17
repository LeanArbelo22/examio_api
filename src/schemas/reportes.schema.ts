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

const rendimientoPreguntasBaseShape = {
  idMateria: optionalPositiveInteger,
  idMateriaDivision: optionalPositiveInteger,
  idActividad: optionalPositiveInteger,
  idPublicacion: optionalPositiveInteger,
  idGrupoPregunta: optionalPositiveInteger,
  idPregunta: optionalPositiveInteger,
  fechaDesde: z.string().refine(isIsoDate, 'fechaDesde debe ser una fecha ISO 8601 válida').optional(),
  fechaHasta: z.string().refine(isIsoDate, 'fechaHasta debe ser una fecha ISO 8601 válida').optional(),
  estadoIntento: z.enum(['en_progreso', 'entregado', 'vencido', 'anulado']).optional(),
  alcanceIntentos: z.enum(['todos', 'validos']).default('todos'),
  estadoCorreccion: z.enum(['todas', 'pendiente', 'confirmada']).default('todas'),
  pagina: z.preprocess(
    value => value === undefined ? 1 : Number(value),
    z.number().int().positive(),
  ),
  limite: z.preprocess(
    value => value === undefined ? 25 : Number(value),
    z.number().int().min(1).max(100),
  ),
  ordenDireccion: z.enum(['asc', 'desc']).default('desc'),
};

const validarRangoFechas = (
  value: { fechaDesde?: string; fechaHasta?: string },
  ctx: z.RefinementCtx,
) => {
  if (value.fechaDesde && value.fechaHasta && new Date(value.fechaDesde) > new Date(value.fechaHasta)) {
    ctx.addIssue({
      code: 'custom',
      path: ['fechaHasta'],
      message: 'fechaDesde no puede ser posterior a fechaHasta',
    });
  }
};

export const RendimientoPreguntasQuerySchema = z.object({
  ...rendimientoPreguntasBaseShape,
  ordenarPor: z.enum([
    'pregunta', 'presentadas', 'respondidas', 'omitidas', 'pendientesCorreccion',
    'tasaAcierto', 'porcentajePuntaje', 'tiempoPromedio',
  ]).default('presentadas'),
}).strict().superRefine(validarRangoFechas);

export const RendimientoGruposQuerySchema = z.object({
  ...rendimientoPreguntasBaseShape,
  ordenarPor: z.enum([
    'grupo', 'presentadas', 'respondidas', 'omitidas', 'pendientesCorreccion',
    'tasaAcierto', 'porcentajePuntaje', 'tiempoPromedio',
  ]).default('presentadas'),
}).strict().superRefine(validarRangoFechas);

const opcionesShape = { ...rendimientoPreguntasBaseShape };
delete (opcionesShape as Partial<typeof rendimientoPreguntasBaseShape>).idPregunta;

export const RendimientoOpcionesQuerySchema = z.object({
  ...opcionesShape,
  ordenarPor: z.enum(['posicion', 'selecciones', 'porcentajeSeleccion']).default('posicion'),
}).strict().superRefine(validarRangoFechas);

export const IdPreguntaReporteSchema = z.coerce.number().int().positive();

export type RendimientoPreguntasQuery = z.infer<typeof RendimientoPreguntasQuerySchema>;
export type RendimientoGruposQuery = z.infer<typeof RendimientoGruposQuerySchema>;
export type RendimientoOpcionesQuery = z.infer<typeof RendimientoOpcionesQuerySchema>;
export type FiltrosRendimientoPregunta = RendimientoPreguntasQuery | RendimientoGruposQuery;
