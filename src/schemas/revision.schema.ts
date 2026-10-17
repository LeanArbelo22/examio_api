import { z } from 'zod';
import { isIsoDate } from '../utils/isoDate';

export const ModoRevisionSchema = z.enum(['nunca', 'al_corregir', 'ventana', 'manual']);
export const AccesoRevisionSchema = z.enum(['unico', 'libre']);

const fechaOpcional = z.string().refine(isIsoDate, 'Debe ser una fecha ISO 8601 válida').nullable().optional();

export const PoliticaRevisionSchema = z.object({
  Modo: ModoRevisionSchema,
  Acceso: AccesoRevisionSchema,
  VentanaDesde: fechaOpcional,
  VentanaHasta: fechaOpcional,
  RevisionEsperada: z.number().int().min(0),
}).strict().superRefine((value, ctx) => {
  const desde = value.VentanaDesde ?? null;
  const hasta = value.VentanaHasta ?? null;
  if (value.Modo === 'ventana' && (!desde || !hasta)) {
    ctx.addIssue({ code: 'custom', path: ['VentanaDesde'], message: 'El modo ventana requiere inicio y fin' });
  }
  if (value.Modo !== 'ventana' && (desde || hasta)) {
    ctx.addIssue({ code: 'custom', path: ['VentanaDesde'], message: 'Sólo el modo ventana admite fechas' });
  }
  if (desde && hasta && new Date(desde) >= new Date(hasta)) {
    ctx.addIssue({ code: 'custom', path: ['VentanaHasta'], message: 'La ventana debe finalizar después de comenzar' });
  }
});

export const PermisoRevisionSchema = z.object({
  Acceso: AccesoRevisionSchema,
  FechaDesde: fechaOpcional,
  FechaHasta: fechaOpcional,
  Motivo: z.string().trim().min(1).max(250).nullable().optional(),
  RevisionEsperada: z.number().int().min(0),
}).strict().superRefine((value, ctx) => {
  const desde = value.FechaDesde ?? null;
  const hasta = value.FechaHasta ?? null;
  if (desde && hasta && new Date(desde) >= new Date(hasta)) {
    ctx.addIssue({ code: 'custom', path: ['FechaHasta'], message: 'El permiso debe finalizar después de comenzar' });
  }
});

export const AuditoriaRevisionQuerySchema = z.object({
  idIntento: z.coerce.number().int().positive().optional(),
  accion: z.enum([
    'politica_backfill', 'politica_actualizada',
    'permiso_otorgado', 'permiso_reactivado', 'permiso_revocado',
    'sesion_emitida', 'sesion_reutilizada', 'sesion_abierta',
    'sesion_consumida', 'sesion_expirada', 'sesion_revocada', 'contenido_consultado',
  ]).optional(),
  pagina: z.coerce.number().int().positive().max(1000000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const PermisosRevisionQuerySchema = z.object({
  estado: z.enum(['activo', 'revocado']).optional(),
  idAlumno: z.coerce.number().int().positive().optional(),
}).strict();

export const IdSesionRevisionSchema = z.string().uuid();

export type PoliticaRevisionInput = z.infer<typeof PoliticaRevisionSchema>;
export type PermisoRevisionInput = z.infer<typeof PermisoRevisionSchema>;
export type AuditoriaRevisionQuery = z.infer<typeof AuditoriaRevisionQuerySchema>;
export type PermisosRevisionQuery = z.infer<typeof PermisosRevisionQuerySchema>;
