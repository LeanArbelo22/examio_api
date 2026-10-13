import { z } from 'zod';

export const TipoPreguntaSchema = z.enum(['mc', 'multiple', 'vf', 'abierta', 'code']);
export const ModoJustificacionSchema = z.enum(['sin_justificacion', 'opcional', 'obligatoria']);
export const EstrategiaCorreccionSchema = z.enum(['exacta', 'parcial_sin_penalizacion', 'parcial_penalizada']);
export const TratamientoJustificacionSchema = z.enum(['informativa', 'revision_manual']);

export const ConfiguracionPreguntaSchema = {
  ModoJustificacion: ModoJustificacionSchema.default('sin_justificacion'),
  EstrategiaCorreccion: EstrategiaCorreccionSchema.default('exacta'),
  TratamientoJustificacion: TratamientoJustificacionSchema.default('informativa'),
};

export type ConfiguracionPregunta = {
  Tipo: z.infer<typeof TipoPreguntaSchema>;
  ModoJustificacion: z.infer<typeof ModoJustificacionSchema>;
  EstrategiaCorreccion: z.infer<typeof EstrategiaCorreccionSchema>;
  TratamientoJustificacion: z.infer<typeof TratamientoJustificacionSchema>;
};

export function validarConfiguracionPregunta(value: ConfiguracionPregunta, ctx: z.RefinementCtx) {
  if (value.Tipo !== 'multiple' && value.EstrategiaCorreccion !== 'exacta') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EstrategiaCorreccion'],
      message: 'Las estrategias parciales sólo corresponden a preguntas multiple',
    });
  }
  if (value.ModoJustificacion === 'sin_justificacion' && value.TratamientoJustificacion !== 'informativa') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TratamientoJustificacion'],
      message: 'revision_manual requiere una justificación opcional u obligatoria',
    });
  }
  if ((value.Tipo === 'abierta' || value.Tipo === 'code') && value.TratamientoJustificacion !== 'informativa') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TratamientoJustificacion'],
      message: `${value.Tipo} ya requiere corrección manual y usa tratamiento informativa`,
    });
  }
}
