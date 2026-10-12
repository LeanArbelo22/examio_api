import { z } from 'zod';
import { isIsoDate } from '../utils/isoDate';

const optionalPositiveInteger = z.preprocess(
  value => value === undefined ? undefined : Number(value),
  z.number().int().positive().max(2147483647).optional(),
);

export const IniciarExamenSchema = z.object({
  IdPublicacion: z.number().int(),
  IdAlumno: z.number().int(),
});

export const GuardarRespuestaSchema = z.object({
  IdIntento: z.number().int(),
  IdPregunta: z.number().int(),
  IdOpcionNueva: z.number().int().optional().nullable(),
  RtaTexto: z.string().optional().nullable(),
});

export const CalificarSchema = z.object({
  notaFinal: z.number().min(0).max(100).multipleOf(0.01),
});

export const CorregirRespuestaSchema = z.object({
  puntajeObtenido: z.number().min(0).max(100).multipleOf(0.01).nullable().optional(),
  esCorrecta: z.boolean().nullable().optional(),
  comentariosDocente: z.string().nullable().optional(),
}).refine(
  data => data.puntajeObtenido !== undefined || data.esCorrecta !== undefined,
  { message: 'Debe indicarse puntajeObtenido o esCorrecta' },
);

export const MisIntentosQuerySchema = z.object({
  idMateria: optionalPositiveInteger,
  idMateriaDivision: optionalPositiveInteger,
  fechaDesde: z.string().refine(isIsoDate, 'fechaDesde debe ser una fecha ISO 8601 válida').optional(),
  fechaHasta: z.string().refine(isIsoDate, 'fechaHasta debe ser una fecha ISO 8601 válida').optional(),
  estado: z.enum(['en_progreso', 'entregado', 'vencido', 'anulado']).optional(),
  resultado: z.enum(['aprobado', 'desaprobado', 'pendiente']).optional(),
  pagina: z.preprocess(
    value => value === undefined ? 1 : Number(value),
    z.number().int().positive().max(1000000),
  ),
  limite: z.preprocess(
    value => value === undefined ? 20 : Number(value),
    z.number().int().min(1).max(100),
  ),
  ordenarPor: z.enum(['fecha', 'materia', 'evaluacion', 'nota']).default('fecha'),
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

export type MisIntentosQuery = z.infer<typeof MisIntentosQuerySchema>;
