import { z } from 'zod';

export const AlumnoSchema = z.object({
  Matricula: z.number().int(),
  Nombre: z.string().min(1).max(50),
  Apellido: z.string().min(1).max(50),
  Cuil: z.string().max(20).optional(),
  Correo: z.string().email().max(50),
});

export const MatriculaParamSchema = z.object({
  matricula: z.coerce.number().int().positive(),
});

export const InscripcionAlumnoSchema = z.object({
  IdMateriaDivision: z.number().int().positive(),
});

export const DocenteSchema = z.object({
  Legajo: z.number().int(),
  Nombre: z.string().min(1).max(50),
  Apellido: z.string().min(1).max(50),
  Cuil: z.string().max(20).optional(),
  Correo: z.string().email().max(50),
});

export const CarreraSchema = z.object({
  Nombre: z.string().min(1).max(100),
  Descripcion: z.string().max(500).optional(),
  DuracionSemestres: z.number().int().optional(),
});
