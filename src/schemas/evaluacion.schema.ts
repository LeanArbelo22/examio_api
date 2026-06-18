import { z } from 'zod';

// ─── Esquemas BASE (creación — sin Id) ───

const OpcionBaseSchema = z.object({
  Texto: z.string().max(500),
  EsCorrecta: z.boolean(),
});

const VarianteBaseSchema = z.object({
  Enunciado: z.string(),
  Tipo: z.enum(['mc', 'vf', 'abierta', 'code']),
  Opciones: z.array(OpcionBaseSchema).optional(),
}).refine((data) => {
  if (data.Tipo === 'mc' || data.Tipo === 'vf') {
    return data.Opciones !== undefined && data.Opciones.length > 0;
  }
  if (data.Tipo === 'abierta' || data.Tipo === 'code') {
    return data.Opciones === undefined || data.Opciones.length === 0;
  }
  return true;
}, {
  message: "Las preguntas 'mc'/'vf' requieren al menos una opción. Las preguntas 'abierta'/'code' no deben incluir opciones.",
  path: ['Opciones'],
});

const GrupoPreguntaBaseSchema = z.object({
  TituloReferencia: z.string().max(150),
  Variantes: z.array(VarianteBaseSchema),
});

export const ActividadSchema = z.object({
  Titulo: z.string().max(150),
  Descripcion: z.string().max(1000).optional(),
  Tipo: z.enum(['evaluacion', 'tp', 'tarea']),
  CantidadIntentosMaximos: z.number().int(),
  DuracionMinutos: z.number().int().nullable(),
  RecursosPermitidos: z.string().max(500).optional(),
  IdMateriaDivision: z.number().int(),
  FechaInicio: z.string().datetime(),
  FechaFin: z.string().datetime(),
  Estado: z.enum(['borrador', 'publicada']).optional(),
  GruposPreguntas: z.array(GrupoPreguntaBaseSchema),
});

// ─── Esquemas con Id (actualización) ───

const OpcionUpdateSchema = z.object({
  Id: z.number().int().optional(),
  Texto: z.string().max(500),
  EsCorrecta: z.boolean(),
});

const VarianteUpdateSchema = z.object({
  Id: z.number().int().optional(),
  Enunciado: z.string(),
  Tipo: z.enum(['mc', 'vf', 'abierta', 'code']),
  Opciones: z.array(OpcionUpdateSchema).optional(),
}).refine((data) => {
  if (data.Tipo === 'mc' || data.Tipo === 'vf') {
    return data.Opciones !== undefined && data.Opciones.length > 0;
  }
  if (data.Tipo === 'abierta' || data.Tipo === 'code') {
    return data.Opciones === undefined || data.Opciones.length === 0;
  }
  return true;
}, {
  message: "Las preguntas 'mc'/'vf' requieren al menos una opción. Las preguntas 'abierta'/'code' no deben incluir opciones.",
  path: ['Opciones'],
});

const GrupoPreguntaUpdateSchema = z.object({
  Id: z.number().int().optional(),
  TituloReferencia: z.string().max(150),
  Variantes: z.array(VarianteUpdateSchema),
});

export const ActividadUpdateSchema = z.object({
  Titulo: z.string().max(150),
  Descripcion: z.string().max(1000).optional(),
  Tipo: z.enum(['evaluacion', 'tp', 'tarea']),
  CantidadIntentosMaximos: z.number().int(),
  DuracionMinutos: z.number().int().nullable(),
  RecursosPermitidos: z.string().max(500).optional(),
  IdMateriaDivision: z.number().int(),
  FechaInicio: z.string().datetime(),
  FechaFin: z.string().datetime(),
  IdPublicacion: z.number().int(),
  GruposPreguntas: z.array(GrupoPreguntaUpdateSchema),
});
