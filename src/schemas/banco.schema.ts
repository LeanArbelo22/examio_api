import { z } from 'zod';
import {
  ConfiguracionPreguntaSchema,
  TipoPreguntaSchema,
  validarConfiguracionPregunta,
} from './pregunta.schema';

export const IdBancoSchema = z.coerce.number().int().positive().max(2147483647);
const id = z.number().int().positive().max(2147483647);
export const EstadoBancoSchema = z.enum(['borrador', 'disponible', 'archivado']);
export const TipoBancoSchema = TipoPreguntaSchema;
const ids = z.array(id).max(200).refine(a => new Set(a).size === a.length, 'IDs repetidos');
const opciones = z.array(z.object({ Texto: z.string().max(500), EsCorrecta: z.boolean() }).strict()).max(100);
export const IdempotencyKeySchema = z.string().uuid();

const PreguntaBancoBaseSchema = z.object({
  Titulo: z.string().trim().min(1).max(150), Enunciado: z.string().max(100000).default(''),
  Tipo: TipoBancoSchema, Estado: EstadoBancoSchema.default('borrador'),
  ...ConfiguracionPreguntaSchema,
  Opciones: opciones.default([]), Etiquetas: ids.default([]),
}).strict();
export const PreguntaBancoSchema = PreguntaBancoBaseSchema.superRefine(validarConfiguracionPregunta);
export const PreguntaBancoUpdateSchema = PreguntaBancoBaseSchema.extend({ RevisionEsperada: id })
  .superRefine(validarConfiguracionPregunta);
export const GrupoBancoSchema = z.object({
  TituloReferencia: z.string().trim().min(1).max(150), Estado: EstadoBancoSchema.default('borrador'),
  Preguntas: ids.default([]), Etiquetas: ids.default([]),
}).strict();
export const GrupoBancoUpdateSchema = GrupoBancoSchema.extend({ RevisionEsperada: id });
export const EstadoBancoUpdateSchema = z.object({ Estado: EstadoBancoSchema, RevisionEsperada: id }).strict();
export const EtiquetaBancoSchema = z.object({ Nombre: z.string().trim().min(1).max(50) }).strict();
export const ListaBancoSchema = z.object({
  idDocente: IdBancoSchema.optional(), texto: z.string().trim().max(150).optional(),
  estado: EstadoBancoSchema.optional(), tipo: TipoBancoSchema.optional(), etiqueta: IdBancoSchema.optional(),
  pagina: IdBancoSchema.max(1000000).default(1), tamano: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const referencia = z.object({ IdPregunta: id, RevisionEsperada: id }).strict();
export const ImportacionesBancoSchema = z.array(z.discriminatedUnion('Tipo', [
  z.object({ Tipo: z.literal('pregunta'), IdPregunta: id, RevisionEsperada: id,
    TituloReferencia: z.string().trim().min(1).max(150) }).strict(),
  z.object({ Tipo: z.literal('grupo'), IdGrupo: id, RevisionEsperada: id,
    Preguntas: z.array(referencia).min(1).max(200).refine(a => new Set(a.map(p => p.IdPregunta)).size === a.length, 'IDs repetidos') }).strict(),
])).min(1).max(100);
export const ImportarBancoSchema = z.object({ ImportacionesBanco: ImportacionesBancoSchema }).strict();
export const DesdeEvaluacionSchema = z.object({
  IdActividad: id, Preguntas: ids.default([]), Grupos: ids.default([]),
}).strict().refine(v => v.Preguntas.length + v.Grupos.length > 0, 'Seleccionar preguntas o grupos');
const PreguntaGrupoExistenteSchema = z.object({
  Origen: z.literal('existente'), IdPregunta: id, RevisionEsperada: id,
}).strict();
const PreguntaGrupoNuevaSchema = z.object({
  Origen: z.literal('nueva'), ClaveCliente: z.string().uuid(),
  Pregunta: PreguntaBancoBaseSchema.omit({ Estado: true }).superRefine(validarConfiguracionPregunta),
}).strict();
export const GrupoDesdeContenidoSchema = z.object({
  TituloReferencia: z.string().trim().min(1).max(150),
  Etiquetas: ids.default([]),
  Preguntas: z.array(z.discriminatedUnion('Origen', [PreguntaGrupoExistenteSchema, PreguntaGrupoNuevaSchema])).min(1).max(200),
}).strict().superRefine((value, ctx) => {
  const existentes = value.Preguntas.filter(p => p.Origen === 'existente').map(p => p.IdPregunta);
  const claves = value.Preguntas.filter(p => p.Origen === 'nueva').map(p => p.ClaveCliente);
  if (new Set(existentes).size !== existentes.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['Preguntas'], message: 'Preguntas existentes repetidas' });
  if (new Set(claves).size !== claves.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['Preguntas'], message: 'ClaveCliente repetida' });
});
export type PreguntaBancoInput = z.infer<typeof PreguntaBancoSchema>;
export type GrupoBancoInput = z.infer<typeof GrupoBancoSchema>;
export type ImportacionesBanco = z.infer<typeof ImportacionesBancoSchema>;
export type GrupoDesdeContenidoInput = z.infer<typeof GrupoDesdeContenidoSchema>;
