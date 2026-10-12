import { z } from 'zod';
import { ImportacionesBancoSchema } from './banco.schema';

const id = z.number().int().positive().max(2147483647);
const tipo = z.enum(['evaluacion', 'tp', 'tarea']);
const tipoPregunta = z.enum(['mc', 'vf', 'abierta', 'code']);
// Los rangos y códigos funcionales estables se resuelven en el service.
const escalaCalificacion = z.number();
const nota = z.number();
const modoPuntaje = z.enum(['iguales', 'personalizados']);
const referenciaPregunta = z.object({ IdPregunta: id, RevisionEsperada: id }).strict();
const referenciaGrupo = z.object({ IdGrupo: id, RevisionEsperada: id }).strict();

const OpcionBorradorSchema = z.object({
  Id: id.optional(), Texto: z.string().max(500).default(''), EsCorrecta: z.boolean().default(false),
}).strict();
const VarianteBorradorSchema = z.object({
  Id: id.optional(), Enunciado: z.string().max(100000).default(''), Tipo: tipoPregunta.default('mc'),
  ReferenciaBanco: referenciaPregunta.optional(), Opciones: z.array(OpcionBorradorSchema).max(100).default([]),
}).strict();
const GrupoBorradorSchema = z.object({
  Id: id.optional(), TituloReferencia: z.string().max(150).default(''),
  PuntajeMaximo: nota.optional().nullable(),
  ReferenciaBanco: referenciaGrupo.optional(), Variantes: z.array(VarianteBorradorSchema).max(200).default([]),
}).strict();

const OpcionPublicableSchema = z.object({
  Id: id.optional(), Texto: z.string().trim().min(1).max(500), EsCorrecta: z.boolean(),
}).strict();
const VariantePublicableSchema = z.object({
  Id: id.optional(), Enunciado: z.string().trim().min(1).max(100000), Tipo: tipoPregunta,
  ReferenciaBanco: referenciaPregunta.optional(), Opciones: z.array(OpcionPublicableSchema).max(100).default([]),
}).strict().superRefine((value, ctx) => {
  const correctas = value.Opciones.filter(o => o.EsCorrecta).length;
  if (value.Tipo === 'mc' && (value.Opciones.length < 2 || correctas !== 1))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['Opciones'], message: 'mc requiere al menos dos opciones y exactamente una correcta' });
  if (value.Tipo === 'vf') {
    const textos = value.Opciones.map(o => o.Texto.trim().toLowerCase());
    if (value.Opciones.length !== 2 || new Set(textos).size !== 2 || !textos.includes('verdadero') ||
        !textos.includes('falso') || correctas !== 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['Opciones'], message: 'vf requiere exactamente Verdadero y Falso y una correcta' });
  }
  if ((value.Tipo === 'abierta' || value.Tipo === 'code') && value.Opciones.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['Opciones'], message: `${value.Tipo} no admite opciones` });
});
const GrupoPublicableSchema = z.object({
  Id: id.optional(), TituloReferencia: z.string().trim().min(1).max(150),
  PuntajeMaximo: nota.optional().nullable(),
  ReferenciaBanco: referenciaGrupo.optional(), Variantes: z.array(VariantePublicableSchema).min(1).max(200),
}).strict();

const camposComunes = {
  Titulo: z.string().trim().min(1).max(150), Descripcion: z.string().max(1000).optional(),
  Tipo: tipo.default('evaluacion'), CantidadIntentosMaximos: z.number().int().min(1).max(10).default(1),
  DuracionMinutos: z.number().int().positive().nullable().default(90),
  RecursosPermitidos: z.string().max(500).optional(), IdMateriaDivision: id,
  FechaInicio: z.string().datetime().optional(), FechaFin: z.string().datetime().optional(),
  EscalaCalificacion: escalaCalificacion.optional(), NotaAprobacion: nota.optional(),
  ModoPuntaje: modoPuntaje.optional(), MostrarPuntajePorPregunta: z.boolean().optional(),
  CorreccionAutomaticaCerradas: z.boolean().optional(),
  ImportacionesBanco: ImportacionesBancoSchema.optional(),
};

function completarFechas<T extends { FechaInicio?: string; FechaFin?: string }>(value: T) {
  const inicio = value.FechaInicio ? new Date(value.FechaInicio) : new Date(Date.now() + 5 * 60_000);
  const fin = value.FechaFin ? new Date(value.FechaFin) : new Date(inicio.getTime() + 24 * 60 * 60_000);
  return { ...value, FechaInicio: inicio.toISOString(), FechaFin: fin.toISOString() };
}
function validarFechas(value: { FechaInicio?: string; FechaFin?: string }, ctx: z.RefinementCtx, permitirPasado: boolean) {
  if (!value.FechaInicio || !value.FechaFin) return;
  const inicio = new Date(value.FechaInicio); const fin = new Date(value.FechaFin);
  if (fin <= inicio) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['FechaFin'], message: 'FechaFin debe ser posterior a FechaInicio' });
  if (!permitirPasado && fin <= new Date())
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['FechaFin'], message: 'La publicación no puede estar vencida' });
}

const BorradorBaseSchema = z.object({
  ...camposComunes, Estado: z.literal('borrador'), GuardarTodoEnBanco: z.literal(false).optional(),
  GruposPreguntas: z.array(GrupoBorradorSchema).max(100).default([]),
}).strict().superRefine((v, ctx) => validarFechas(v, ctx, true)).transform(completarFechas);
const PublicadaBaseSchema = z.object({
  ...camposComunes, Estado: z.literal('publicada'), GuardarTodoEnBanco: z.boolean().default(false),
  GruposPreguntas: z.array(GrupoPublicableSchema).min(1).max(100),
}).strict().superRefine((v, ctx) => validarFechas(v, ctx, false)).transform(completarFechas);

// Compatibilidad legacy: omitir Estado equivale a crear una actividad publicada.
export const ActividadSchema = z.preprocess(value => {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('Estado' in value))
    return { ...(value as Record<string, unknown>), Estado: 'publicada' };
  return value;
}, z.union([BorradorBaseSchema, PublicadaBaseSchema]));

export const ActividadUpdateSchema = z.object({
  ...camposComunes, IdPublicacion: id, RevisionEsperada: id,
  GruposPreguntas: z.array(GrupoBorradorSchema).max(100).default([]),
}).strict().superRefine((v, ctx) => validarFechas(v, ctx, true)).transform(completarFechas);

export const PublicarActividadSchema = z.object({
  ...camposComunes, IdPublicacion: id, RevisionEsperada: id, GuardarTodoEnBanco: z.boolean(),
  GruposPreguntas: z.array(GrupoPublicableSchema).min(1).max(100),
}).strict().superRefine((v, ctx) => validarFechas(v, ctx, false)).transform(completarFechas);

export const SeleccionarIntentoValidoSchema = z.object({ IdIntento: id }).strict();

export type ActividadInput = z.infer<typeof ActividadSchema>;
export type ActividadUpdateInput = z.infer<typeof ActividadUpdateSchema>;
export type PublicarActividadInput = z.infer<typeof PublicarActividadSchema>;
