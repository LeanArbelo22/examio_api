import * as sql from 'mssql';
import { pool } from '../config/db';
import { IncidenteFocoInput } from '../schemas/telemetria.schema';
import { evaluarEventoSupervision } from './supervision.service';
import { ActorBanco, BancoError, DbBanco } from './banco-common.service';

type ActorTelemetria = ActorBanco & { idAlumno?: number | null };

type AlcanceIntento = {
  Id: number;
  IdAlumno: number;
  FechaInicio: Date | string;
  FechaFin: Date | string | null;
  IdDocente: number | null;
  DocenteActivo: boolean | number | null;
};

type IncidentePersistido = {
  Id: number;
  EventoId: string;
  IdIntento: number;
  Tipo: string;
  FechaInicioCliente: Date | string;
  FechaFinCliente: Date | string | null;
  DuracionMilisegundos: number | null;
  FechaRecepcionInicio: Date | string;
  FechaRecepcionFin: Date | string | null;
  Estado: 'iniciado' | 'completado';
};

export const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;
export const TOLERANCIA_SINCRONIZACION_MS = 7 * 24 * 60 * 60 * 1000;
export const TOLERANCIA_DURACION_MS = 2_000;

const fechaMs = (value: Date | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const igualesFecha = (left: Date | string | null, right: string | undefined): boolean => {
  if (right === undefined) return true;
  return fechaMs(left) === fechaMs(right);
};

async function obtenerAlcance(db: DbBanco, idIntento: number, bloquear = false): Promise<AlcanceIntento | null> {
  const result = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .query(`
      SELECT I.Id,I.IdAlumno,I.FechaInicio,I.FechaFin,MD.IdDocente,D.Estado AS DocenteActivo
      FROM dbo.Intento I ${bloquear ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
      JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
      JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
      LEFT JOIN dbo.Docente D ON D.Legajo=MD.IdDocente
      WHERE I.Id=@IdIntento
    `);
  return result.recordset[0] as AlcanceIntento | undefined ?? null;
}

function autorizarEscritura(actor: ActorTelemetria, alcance: AlcanceIntento | null): asserts alcance is AlcanceIntento {
  if (!alcance) {
    if (actor.role === 'admin') throw new BancoError(404, 'Intento no encontrado', 'FOCUS_EVENT_NOT_FOUND');
    throw new BancoError(403, 'El intento no pertenece al alumno autenticado', 'FOCUS_EVENT_SCOPE_FORBIDDEN');
  }
  if (actor.role === 'admin') return;
  if (actor.role !== 'alumno' || !Number.isInteger(actor.idAlumno) || actor.idAlumno !== Number(alcance.IdAlumno)) {
    throw new BancoError(403, 'El intento no pertenece al alumno autenticado', 'FOCUS_EVENT_SCOPE_FORBIDDEN');
  }
}

function autorizarLectura(actor: ActorTelemetria, alcance: AlcanceIntento | null): asserts alcance is AlcanceIntento {
  if (!alcance) {
    if (actor.role === 'admin') throw new BancoError(404, 'Intento no encontrado', 'FOCUS_EVENT_NOT_FOUND');
    throw new BancoError(403, 'El intento no pertenece a una comisión del docente', 'FOCUS_EVENT_SCOPE_FORBIDDEN');
  }
  if (actor.role === 'admin') return;
  if (actor.role !== 'docente' || !Number.isInteger(actor.idDocente)
      || actor.idDocente !== Number(alcance.IdDocente) || !Boolean(alcance.DocenteActivo)) {
    throw new BancoError(403, 'El intento no pertenece a una comisión del docente', 'FOCUS_EVENT_SCOPE_FORBIDDEN');
  }
}

function validarVentanaTemporal(alcance: AlcanceIntento, input: IncidenteFocoInput, now: Date) {
  const inicio = fechaMs(input.FechaInicioCliente);
  const fin = fechaMs(input.FechaFinCliente);
  const inicioIntento = fechaMs(alcance.FechaInicio)!;
  const finIntento = fechaMs(alcance.FechaFin);
  const ahora = now.getTime();

  if (finIntento !== null && ahora > finIntento + TOLERANCIA_SINCRONIZACION_MS) {
    throw new BancoError(409, 'Venció la ventana de sincronización del incidente', 'FOCUS_EVENT_SYNC_WINDOW_EXPIRED');
  }
  if (inicio !== null && (inicio < inicioIntento - TOLERANCIA_RELOJ_MS
      || inicio > ahora + TOLERANCIA_RELOJ_MS
      || (finIntento !== null && inicio > finIntento + TOLERANCIA_RELOJ_MS))) {
    throw new BancoError(400, 'FechaInicioCliente está fuera del intervalo permitido', 'FOCUS_EVENT_INVALID');
  }
  if (fin !== null && (fin > ahora + TOLERANCIA_RELOJ_MS
      || (finIntento !== null && fin > finIntento + TOLERANCIA_RELOJ_MS))) {
    throw new BancoError(400, 'FechaFinCliente está fuera del intervalo permitido', 'FOCUS_EVENT_INVALID');
  }
  if (inicio !== null && fin !== null) {
    const diferencia = fin - inicio;
    if (diferencia < 0 || Math.abs(diferencia - input.DuracionMilisegundos!) > TOLERANCIA_DURACION_MS) {
      throw new BancoError(400, 'La duración no coincide con los timestamps del incidente', 'FOCUS_EVENT_INVALID');
    }
  }
}

function validarCoincidencia(existente: IncidentePersistido, input: IncidenteFocoInput) {
  if (existente.Tipo !== input.Tipo || !igualesFecha(existente.FechaInicioCliente, input.FechaInicioCliente)) {
    throw new BancoError(409, 'EventoId ya fue usado con otros datos', 'FOCUS_EVENT_CONFLICT');
  }
  if (existente.Estado === 'completado' && input.FechaFinCliente !== undefined) {
    if (!igualesFecha(existente.FechaFinCliente, input.FechaFinCliente)
        || Number(existente.DuracionMilisegundos) !== input.DuracionMilisegundos) {
      throw new BancoError(409, 'EventoId ya fue completado con otros datos', 'FOCUS_EVENT_CONFLICT');
    }
  }
}

export async function guardarIncidenteFoco(
  db: DbBanco,
  actor: ActorTelemetria,
  idIntento: number,
  eventoId: string,
  input: IncidenteFocoInput,
  now = new Date(),
) {
  const alcance = await obtenerAlcance(db, idIntento, true);
  autorizarEscritura(actor, alcance);

  const existenteResult = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('EventoId', sql.UniqueIdentifier, eventoId)
    .query(`SELECT * FROM dbo.IncidenteIntento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdIntento=@IdIntento AND EventoId=@EventoId`);
  const existente = existenteResult.recordset[0] as IncidentePersistido | undefined;

  if (existente) {
    validarCoincidencia(existente, input);
    if (existente.Estado === 'completado' || input.FechaFinCliente === undefined) {
      const supervision = await evaluarEventoSupervision(db, idIntento, eventoId, 'replay');
      return { ...existente, Supervision: supervision };
    }
    validarVentanaTemporal(alcance, {
      ...input,
      FechaInicioCliente: input.FechaInicioCliente ?? new Date(existente.FechaInicioCliente).toISOString(),
    }, now);
    const actualizado = await db.request()
      .input('Id', sql.BigInt, existente.Id)
      .input('FechaFinCliente', sql.DateTime2, new Date(input.FechaFinCliente))
      .input('DuracionMilisegundos', sql.BigInt, input.DuracionMilisegundos)
      .query(`UPDATE dbo.IncidenteIntento SET FechaFinCliente=@FechaFinCliente,
        DuracionMilisegundos=@DuracionMilisegundos,FechaRecepcionFin=SYSUTCDATETIME(),Estado='completado'
        OUTPUT inserted.* WHERE Id=@Id`);
    const supervision = await evaluarEventoSupervision(db, idIntento, eventoId, 'actualizado');
    return { ...actualizado.recordset[0], Supervision: supervision };
  }

  if (!input.FechaInicioCliente) {
    throw new BancoError(409, 'El incidente debe iniciarse antes de completarse', 'FOCUS_EVENT_NOT_STARTED');
  }
  validarVentanaTemporal(alcance, input, now);
  const completado = input.FechaFinCliente !== undefined;
  const creado = await db.request()
    .input('EventoId', sql.UniqueIdentifier, eventoId)
    .input('IdIntento', sql.Int, idIntento)
    .input('Tipo', sql.VarChar(30), input.Tipo)
    .input('FechaInicioCliente', sql.DateTime2, new Date(input.FechaInicioCliente))
    .input('FechaFinCliente', sql.DateTime2, completado ? new Date(input.FechaFinCliente!) : null)
    .input('DuracionMilisegundos', sql.BigInt, completado ? input.DuracionMilisegundos! : null)
    .input('Estado', sql.VarChar(20), completado ? 'completado' : 'iniciado')
    .query(`INSERT INTO dbo.IncidenteIntento
      (EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,FechaRecepcionFin,Estado)
      OUTPUT inserted.*
      VALUES(@EventoId,@IdIntento,@Tipo,@FechaInicioCliente,@FechaFinCliente,@DuracionMilisegundos,
        CASE WHEN @Estado='completado' THEN SYSUTCDATETIME() ELSE NULL END,@Estado)`);
  const supervision = await evaluarEventoSupervision(db, idIntento, eventoId, 'creado');
  return { ...creado.recordset[0], Supervision: supervision };
}

async function autorizarConsulta(poolDb: DbBanco, actor: ActorTelemetria, idIntento: number) {
  const alcance = await obtenerAlcance(poolDb, idIntento);
  autorizarLectura(actor, alcance);
}

export async function listarIncidentesFoco(actor: ActorTelemetria, idIntento: number) {
  await autorizarConsulta(pool, actor, idIntento);
  const result = await pool.request()
    .input('IdIntento', sql.Int, idIntento)
    .query(`SELECT Id,EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,
      DuracionMilisegundos,FechaRecepcionInicio,FechaRecepcionFin,Estado
      FROM dbo.IncidenteIntento WHERE IdIntento=@IdIntento
      ORDER BY FechaInicioCliente ASC,Id ASC`);
  return result.recordset;
}

export async function resumirIncidentesFoco(actor: ActorTelemetria, idIntento: number) {
  await autorizarConsulta(pool, actor, idIntento);
  const result = await pool.request()
    .input('IdIntento', sql.Int, idIntento)
    .query(`SELECT
      COUNT(*) AS CantidadPerdidasFoco,
      CAST(COALESCE(SUM(CASE WHEN Estado='completado' THEN DuracionMilisegundos ELSE 0 END),0)/1000.0 AS DECIMAL(18,3)) AS SegundosTotalesFuera,
      CAST(COALESCE(AVG(CASE WHEN Estado='completado' THEN CAST(DuracionMilisegundos AS DECIMAL(18,3)) END),0)/1000.0 AS DECIMAL(18,3)) AS PromedioSegundosFuera,
      CAST(COALESCE(MAX(CASE WHEN Estado='completado' THEN DuracionMilisegundos END),0)/1000.0 AS DECIMAL(18,3)) AS MaximoSegundosFuera
      FROM dbo.IncidenteIntento WHERE IdIntento=@IdIntento AND Tipo='focus_lost'`);
  return result.recordset[0] ?? {
    CantidadPerdidasFoco: 0,
    SegundosTotalesFuera: 0,
    PromedioSegundosFuera: 0,
    MaximoSegundosFuera: 0,
  };
}
