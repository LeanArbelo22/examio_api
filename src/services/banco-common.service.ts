import * as sql from 'mssql';
import { pool } from '../config/db';
import { PreguntaBancoInput } from '../schemas/banco.schema';

export class BancoError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export type ActorBanco = { id?: number; role: string; idDocente?: number | null };
export type DbBanco = Pick<sql.Transaction, 'request'>;
export type ParametrosBanco = Record<string, string | number | boolean | null>;
export async function consultar(db: DbBanco, texto: string, parametros: ParametrosBanco = {}) {
  const request = db.request();
  for (const [nombre, valor] of Object.entries(parametros)) {
    request.input(nombre, typeof valor === 'number' ? sql.Int : typeof valor === 'boolean' ? sql.Bit : sql.NVarChar, valor);
  }
  return request.query(texto);
}
export async function atomico<T>(operacion: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try { const result = await operacion(tx); await tx.commit(); return result; }
  catch (error) { await tx.rollback(); throw error; }
}
export async function propietario(db: DbBanco, actor: ActorBanco, escritura: boolean, seleccionado?: number) {
  if (actor.role === 'admin' && !escritura) {
    if (!seleccionado) throw new BancoError(400, 'Indicar idDocente para consultar un banco');
    return seleccionado;
  }
  if (actor.role !== 'docente' || !Number.isInteger(actor.idDocente) || !actor.idDocente || actor.idDocente <= 0)
    throw new BancoError(403, 'Se requiere una vinculación docente');
  if (seleccionado !== undefined && seleccionado !== actor.idDocente) throw new BancoError(404, 'Banco no encontrado');
  const activo = await consultar(db, 'SELECT Legajo FROM dbo.Docente WHERE Legajo=@Docente AND Estado=1', { Docente: actor.idDocente });
  if (!activo.recordset.length) throw new BancoError(403, 'La vinculación docente no está activa');
  return actor.idDocente;
}
export function validarDisponible(p: Pick<PreguntaBancoInput, 'Tipo' | 'Enunciado' | 'Opciones'>) {
  const opciones = p.Opciones;
  if (!p.Enunciado.trim() || p.Tipo === 'code') throw new BancoError(400, 'La pregunta no puede estar disponible', 'BANK_CONTENT_INVALID');
  if (p.Tipo === 'abierta') {
    if (opciones.length) throw new BancoError(400, 'Una pregunta abierta no admite opciones', 'BANK_CONTENT_INVALID');
    return;
  }
  if (opciones.length < 2 || opciones.some(o => !o.Texto.trim()) || opciones.filter(o => o.EsCorrecta).length !== 1)
    throw new BancoError(400, 'Se requieren al menos dos opciones y exactamente una correcta', 'BANK_CONTENT_INVALID');
  if (p.Tipo === 'vf' && (opciones.length !== 2 ||
      new Set(opciones.map(o => o.Texto.trim().toLowerCase())).size !== 2 ||
      opciones.some(o => !['verdadero', 'falso'].includes(o.Texto.trim().toLowerCase()))))
    throw new BancoError(400, 'Verdadero/falso requiere las opciones Verdadero y Falso', 'BANK_CONTENT_INVALID');
}
export function verificarRevision(actual: number, esperada: number) {
  if (actual !== esperada) throw new BancoError(409, 'El recurso cambió; recargar antes de continuar', 'BANK_REVISION_CONFLICT');
}
