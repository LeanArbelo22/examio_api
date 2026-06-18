import { z } from 'zod';

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
  notaFinal: z.number().min(0).max(10).multipleOf(0.01),
});

export const CorregirRespuestaSchema = z.object({
  esCorrecta: z.boolean().nullable(),
  comentariosDocente: z.string().nullable().optional(),
});
