import * as sql from 'mssql';
import { pool } from '../config/db';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { EventoTemporalInput } from '../schemas/telemetria.schema';
import { ActorBanco, BancoError, DbBanco } from './banco-common.service';
import {
  TOLERANCIA_DURACION_MS,
  TOLERANCIA_RELOJ_MS,
  TOLERANCIA_SINCRONIZACION_MS,
} from './telemetria-focus.service';
import { evaluarEventoSupervision } from './supervision.service';

type AlcanceTemporal = {
  Id: number;
  IdAlumno: number;
  FechaInicio: Date | string;
  FechaFin: Date | string | null;
  IdDocente: number | null;
  DocenteActivo: boolean | number | null;
};

type TipoTemporal = {
  Tipo: string;
  EsIntervalo: boolean | number;
  EsIncidente: boolean | number;
  RequierePregunta: boolean | number;
  AdmiteCierrePosterior: boolean | number;
};

type EventoPersistido = {
  Id: number;
  EventoId: string;
  IdIntento: number;
  Tipo: string;
  IdIntentoPregunta: number | null;
  SesionClienteId: string | null;
  SecuenciaCliente: number | string | null;
  FechaInicioCliente: Date | string;
  FechaFinCliente: Date | string | null;
  DuracionMilisegundos: number | string | null;
  Codigo: string | null;
  VersionContrato: number;
  Estado: 'iniciado' | 'completado';
  FechaRecepcionInicio: Date | string;
  FechaRecepcionFin: Date | string | null;
};

const fechaMs = (value: Date | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const uuidIgual = (left: unknown, right: string) => String(left).toLowerCase() === right.toLowerCase();
const textoIgual = (left: unknown, right: unknown) => (left ?? null) === (right ?? null);
const numeroIgual = (left: unknown, right: unknown) => Number(left) === Number(right);

async function obtenerAlcance(db: DbBanco, idIntento: number, bloquear = false) {
  const result = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .query(`SELECT I.Id,I.IdAlumno,I.FechaInicio,I.FechaFin,MD.IdDocente,D.Estado AS DocenteActivo
      FROM dbo.Intento I ${bloquear ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
      JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
      JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
      LEFT JOIN dbo.Docente D ON D.Legajo=MD.IdDocente
      WHERE I.Id=@IdIntento;`);
  return result.recordset[0] as AlcanceTemporal | undefined;
}

function autorizarEscritura(actor: ActorBanco, alcance: AlcanceTemporal | undefined): asserts alcance is AlcanceTemporal {
  if (!alcance) {
    if (actor.role === 'admin') throw new BancoError(404, 'Intento no encontrado', 'TELEMETRY_ATTEMPT_NOT_FOUND');
    throw new BancoError(403, 'El intento no pertenece al alumno autenticado', 'TELEMETRY_SCOPE_FORBIDDEN');
  }
  if (actor.role === 'admin') return;
  if (actor.role !== 'alumno' || !Number.isInteger(actor.idAlumno)
      || Number(actor.idAlumno) !== Number(alcance.IdAlumno)) {
    throw new BancoError(403, 'El intento no pertenece al alumno autenticado', 'TELEMETRY_SCOPE_FORBIDDEN');
  }
}

function autorizarLectura(actor: ActorBanco, alcance: AlcanceTemporal | undefined): asserts alcance is AlcanceTemporal {
  if (!alcance) {
    if (actor.role === 'admin') throw new BancoError(404, 'Intento no encontrado', 'TELEMETRY_ATTEMPT_NOT_FOUND');
    throw new BancoError(403, 'El intento no pertenece a una comisión del docente', 'TELEMETRY_SCOPE_FORBIDDEN');
  }
  if (actor.role === 'admin') return;
  if (actor.role !== 'docente' || !Number.isInteger(actor.idDocente)
      || Number(actor.idDocente) !== Number(alcance.IdDocente) || !Boolean(alcance.DocenteActivo)) {
    throw new BancoError(403, 'El intento no pertenece a una comisión del docente', 'TELEMETRY_SCOPE_FORBIDDEN');
  }
}

const ventanaHasta = (alcance: AlcanceTemporal) => {
  const fin = fechaMs(alcance.FechaFin);
  return fin === null ? null : new Date(fin + TOLERANCIA_SINCRONIZACION_MS).toISOString();
};

function validarVentana(
  alcance: AlcanceTemporal,
  inicioValue: string,
  finValue: string | undefined,
  duracion: number | undefined,
  now: Date,
) {
  const inicio = fechaMs(inicioValue)!;
  const fin = fechaMs(finValue);
  const inicioIntento = fechaMs(alcance.FechaInicio)!;
  const finIntento = fechaMs(alcance.FechaFin);
  const ahora = now.getTime();

  if (finIntento !== null && ahora > finIntento + TOLERANCIA_SINCRONIZACION_MS) {
    throw new BancoError(409, 'Venció la ventana de sincronización del evento', 'TELEMETRY_SYNC_WINDOW_EXPIRED');
  }
  if (inicio < inicioIntento - TOLERANCIA_RELOJ_MS || inicio > ahora + TOLERANCIA_RELOJ_MS
      || (finIntento !== null && inicio > finIntento + TOLERANCIA_RELOJ_MS)) {
    throw new BancoError(400, 'FechaInicioCliente está fuera del intervalo permitido', 'TELEMETRY_EVENT_INVALID');
  }
  if (fin !== null && (fin > ahora + TOLERANCIA_RELOJ_MS
      || (finIntento !== null && fin > finIntento + TOLERANCIA_RELOJ_MS))) {
    throw new BancoError(400, 'FechaFinCliente está fuera del intervalo permitido', 'TELEMETRY_EVENT_INVALID');
  }
  if (fin !== null) {
    const diferencia = fin - inicio;
    if (diferencia < 0 || duracion === undefined
        || Math.abs(diferencia - duracion) > TOLERANCIA_DURACION_MS) {
      throw new BancoError(400, 'La duración no coincide con los timestamps del evento', 'TELEMETRY_EVENT_INVALID');
    }
  }
}

function validarCoincidencia(existente: EventoPersistido, input: EventoTemporalInput) {
  if (existente.Tipo !== input.Tipo
      || !uuidIgual(existente.SesionClienteId, input.SesionClienteId)
      || !numeroIgual(existente.SecuenciaCliente, input.SecuenciaCliente)
      || !numeroIgual(existente.VersionContrato, input.VersionContrato)
      || !textoIgual(existente.IdIntentoPregunta, input.IdIntentoPregunta)
      || (input.Codigo !== undefined && !textoIgual(existente.Codigo, input.Codigo))
      || (input.FechaInicioCliente !== undefined
        && fechaMs(existente.FechaInicioCliente) !== fechaMs(input.FechaInicioCliente))) {
    throw new BancoError(409, 'EventoId ya fue usado con otros datos', 'TELEMETRY_EVENT_CONFLICT');
  }
  if (existente.Estado === 'completado' && input.FechaFinCliente !== undefined
      && (fechaMs(existente.FechaFinCliente) !== fechaMs(input.FechaFinCliente)
        || !numeroIgual(existente.DuracionMilisegundos, input.DuracionMilisegundos))) {
    throw new BancoError(409, 'EventoId ya fue completado con otros datos', 'TELEMETRY_EVENT_CONFLICT');
  }
}

async function obtenerTipo(db: DbBanco, tipo: string): Promise<TipoTemporal> {
  const result = await db.request()
    .input('Tipo', sql.VarChar(30), tipo)
    .query(`SELECT Tipo,EsIntervalo,EsIncidente,RequierePregunta,AdmiteCierrePosterior
      FROM dbo.TipoEventoTelemetria WHERE Tipo=@Tipo AND Activo=1;`);
  const row = result.recordset[0] as TipoTemporal | undefined;
  if (!row) throw new BancoError(400, 'Tipo de evento no soportado', 'TELEMETRY_TYPE_INVALID');
  return row;
}

async function validarPregunta(db: DbBanco, idIntento: number, idIntentoPregunta: number | null | undefined) {
  const result = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('IdIntentoPregunta', sql.Int, idIntentoPregunta ?? null)
    .query(`SELECT Id FROM dbo.IntentoPregunta
      WHERE Id=@IdIntentoPregunta AND IdIntento=@IdIntento;`);
  if (!result.recordset.length) {
    throw new BancoError(400, 'La pregunta no pertenece al intento', 'TELEMETRY_QUESTION_INVALID');
  }
}

async function validarOrden(db: DbBanco, idIntento: number, input: EventoTemporalInput) {
  const result = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('SesionClienteId', sql.UniqueIdentifier, input.SesionClienteId)
    .input('SecuenciaCliente', sql.BigInt, input.SecuenciaCliente)
    .query(`
      SELECT
        (SELECT TOP (1) FechaInicioCliente FROM dbo.IncidenteIntento
          WHERE IdIntento=@IdIntento AND SesionClienteId=@SesionClienteId
            AND SecuenciaCliente<@SecuenciaCliente ORDER BY SecuenciaCliente DESC) AS InicioAnterior,
        (SELECT TOP (1) FechaInicioCliente FROM dbo.IncidenteIntento
          WHERE IdIntento=@IdIntento AND SesionClienteId=@SesionClienteId
            AND SecuenciaCliente>@SecuenciaCliente ORDER BY SecuenciaCliente ASC) AS InicioSiguiente;
    `);
  const row = result.recordset[0] as { InicioAnterior?: Date | string | null; InicioSiguiente?: Date | string | null } | undefined;
  const actual = fechaMs(input.FechaInicioCliente)!;
  const anterior = fechaMs(row?.InicioAnterior);
  const siguiente = fechaMs(row?.InicioSiguiente);
  if ((anterior !== null && actual < anterior) || (siguiente !== null && actual > siguiente)) {
    throw new BancoError(409, 'La secuencia no coincide con el orden temporal', 'TELEMETRY_ORDER_CONFLICT');
  }
}

export async function guardarEventoTemporal(
  db: DbBanco,
  actor: ActorBanco,
  idIntento: number,
  eventoId: string,
  input: EventoTemporalInput,
  now = new Date(),
) {
  const alcance = await obtenerAlcance(db, idIntento, true);
  autorizarEscritura(actor, alcance);
  const tipo = await obtenerTipo(db, input.Tipo);

  if (Boolean(tipo.RequierePregunta)) await validarPregunta(db, idIntento, input.IdIntentoPregunta);

  const existenteResult = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('EventoId', sql.UniqueIdentifier, eventoId)
    .input('SesionClienteId', sql.UniqueIdentifier, input.SesionClienteId)
    .input('SecuenciaCliente', sql.BigInt, input.SecuenciaCliente)
    .query(`SELECT * FROM dbo.IncidenteIntento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdIntento=@IdIntento AND (
        EventoId=@EventoId OR
        (SesionClienteId=@SesionClienteId AND SecuenciaCliente=@SecuenciaCliente)
      );`);
  const existente = existenteResult.recordset[0] as EventoPersistido | undefined;

  if (existente) {
    if (!uuidIgual(existente.EventoId, eventoId)) {
      throw new BancoError(409, 'La secuencia ya pertenece a otro evento', 'TELEMETRY_SEQUENCE_CONFLICT');
    }
    validarCoincidencia(existente, input);
    if (existente.Estado === 'completado' || input.FechaFinCliente === undefined) {
      const supervision = await evaluarEventoSupervision(db, idIntento, eventoId, 'replay');
      return { ...existente, Resultado: 'replay', VentanaSincronizacionHasta: ventanaHasta(alcance),
        Supervision: supervision };
    }
    if (!Boolean(tipo.EsIntervalo) || !Boolean(tipo.AdmiteCierrePosterior)) {
      throw new BancoError(409, 'El evento no admite cierre posterior', 'TELEMETRY_EVENT_CONFLICT');
    }
    const inicio = input.FechaInicioCliente ?? new Date(existente.FechaInicioCliente).toISOString();
    validarVentana(alcance, inicio, input.FechaFinCliente, input.DuracionMilisegundos, now);
    const result = await db.request()
      .input('Id', sql.BigInt, existente.Id)
      .input('FechaFinCliente', sql.DateTime2, new Date(input.FechaFinCliente))
      .input('DuracionMilisegundos', sql.BigInt, input.DuracionMilisegundos!)
      .query(`UPDATE dbo.IncidenteIntento SET FechaFinCliente=@FechaFinCliente,
        DuracionMilisegundos=@DuracionMilisegundos,FechaRecepcionFin=SYSUTCDATETIME(),Estado='completado'
        OUTPUT inserted.* WHERE Id=@Id;`);
    const supervision = await evaluarEventoSupervision(db, idIntento, eventoId, 'actualizado');
    return { ...result.recordset[0], Resultado: 'actualizado', VentanaSincronizacionHasta: ventanaHasta(alcance),
      Supervision: supervision };
  }

  if (!input.FechaInicioCliente) {
    throw new BancoError(409, 'El evento debe iniciarse antes de completarse', 'TELEMETRY_EVENT_NOT_STARTED');
  }

  const esIntervalo = Boolean(tipo.EsIntervalo);
  const fechaFin = esIntervalo ? input.FechaFinCliente : input.FechaInicioCliente;
  const duracion = esIntervalo ? input.DuracionMilisegundos : 0;
  validarVentana(alcance, input.FechaInicioCliente, fechaFin, duracion, now);
  await validarOrden(db, idIntento, input);

  const completado = !esIntervalo || fechaFin !== undefined;
  const result = await db.request()
    .input('EventoId', sql.UniqueIdentifier, eventoId)
    .input('IdIntento', sql.Int, idIntento)
    .input('Tipo', sql.VarChar(30), input.Tipo)
    .input('IdIntentoPregunta', sql.Int, input.IdIntentoPregunta ?? null)
    .input('SesionClienteId', sql.UniqueIdentifier, input.SesionClienteId)
    .input('SecuenciaCliente', sql.BigInt, input.SecuenciaCliente)
    .input('FechaInicioCliente', sql.DateTime2, new Date(input.FechaInicioCliente))
    .input('FechaFinCliente', sql.DateTime2, completado ? new Date(fechaFin!) : null)
    .input('DuracionMilisegundos', sql.BigInt, completado ? duracion! : null)
    .input('Codigo', sql.VarChar(50), input.Codigo ?? null)
    .input('VersionContrato', sql.Int, input.VersionContrato)
    .input('Estado', sql.VarChar(20), completado ? 'completado' : 'iniciado')
    .query(`INSERT INTO dbo.IncidenteIntento
      (EventoId,IdIntento,Tipo,IdIntentoPregunta,SesionClienteId,SecuenciaCliente,
       FechaInicioCliente,FechaFinCliente,DuracionMilisegundos,Codigo,VersionContrato,
       FechaRecepcionFin,Estado)
      OUTPUT inserted.*
      VALUES(@EventoId,@IdIntento,@Tipo,@IdIntentoPregunta,@SesionClienteId,@SecuenciaCliente,
       @FechaInicioCliente,@FechaFinCliente,@DuracionMilisegundos,@Codigo,@VersionContrato,
       CASE WHEN @Estado='completado' THEN SYSUTCDATETIME() ELSE NULL END,@Estado);`);
  const supervision = await evaluarEventoSupervision(db, idIntento, eventoId, 'creado');
  return { ...result.recordset[0], Resultado: 'creado', VentanaSincronizacionHasta: ventanaHasta(alcance),
    Supervision: supervision };
}

export async function listarEventosTemporales(
  actor: ActorBanco,
  idIntento: number,
  pagina: number,
  limite: number,
) {
  const alcance = await obtenerAlcance(pool, idIntento);
  autorizarLectura(actor, alcance);
  const result = await pool.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('Offset', sql.Int, (pagina - 1) * limite)
    .input('Limite', sql.Int, limite)
    .query(`
      SELECT E.Id,E.EventoId,E.IdIntento,E.Tipo,E.IdIntentoPregunta,E.SesionClienteId,
        E.SecuenciaCliente,E.FechaInicioCliente,E.FechaFinCliente,E.DuracionMilisegundos,
        E.Codigo,E.VersionContrato,E.FechaRecepcionInicio,E.FechaRecepcionFin,E.Estado,
        T.EsIntervalo,T.EsIncidente
      FROM dbo.IncidenteIntento E
      JOIN dbo.TipoEventoTelemetria T ON T.Tipo=E.Tipo
      WHERE E.IdIntento=@IdIntento
      ORDER BY E.FechaInicioCliente ASC,E.Id ASC
      OFFSET @Offset ROWS FETCH NEXT @Limite ROWS ONLY;

      SELECT COUNT(*) AS Total,
        SUM(CASE WHEN Estado='iniciado' THEN 1 ELSE 0 END) AS IntervalosAbiertos
      FROM dbo.IncidenteIntento WHERE IdIntento=@IdIntento;

      ;WITH Base AS (
        SELECT E.Id,E.Tipo,E.FechaInicioCliente,E.FechaFinCliente,
          MAX(E.FechaFinCliente) OVER (
            PARTITION BY E.Tipo ORDER BY E.FechaInicioCliente,E.Id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS MaxFinAnterior
        FROM dbo.IncidenteIntento E
        JOIN dbo.TipoEventoTelemetria T ON T.Tipo=E.Tipo AND T.EsIntervalo=1
        WHERE E.IdIntento=@IdIntento AND E.Estado='completado'
      ), Marcas AS (
        SELECT *,CASE WHEN MaxFinAnterior IS NULL OR FechaInicioCliente>MaxFinAnterior THEN 1 ELSE 0 END AS NuevoGrupo
        FROM Base
      ), Grupos AS (
        SELECT *,SUM(NuevoGrupo) OVER (
          PARTITION BY Tipo ORDER BY FechaInicioCliente,Id ROWS UNBOUNDED PRECEDING
        ) AS Grupo
        FROM Marcas
      ), Islas AS (
        SELECT Tipo,Grupo,MIN(FechaInicioCliente) AS Inicio,MAX(FechaFinCliente) AS Fin
        FROM Grupos GROUP BY Tipo,Grupo
      )
      SELECT Tipo,SUM(DATEDIFF_BIG(MILLISECOND,Inicio,Fin)) AS DuracionMilisegundos
      FROM Islas GROUP BY Tipo ORDER BY Tipo;

      ;WITH BasePregunta AS (
        SELECT E.Id,E.IdIntentoPregunta,E.FechaInicioCliente,E.FechaFinCliente,
          MAX(E.FechaFinCliente) OVER (
            PARTITION BY E.IdIntentoPregunta ORDER BY E.FechaInicioCliente,E.Id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS MaxFinAnterior
        FROM dbo.IncidenteIntento E
        WHERE E.IdIntento=@IdIntento AND E.Tipo='question_active'
          AND E.Estado='completado' AND E.IdIntentoPregunta IS NOT NULL
      ), MarcasPregunta AS (
        SELECT *,CASE WHEN MaxFinAnterior IS NULL OR FechaInicioCliente>MaxFinAnterior THEN 1 ELSE 0 END AS NuevoGrupo
        FROM BasePregunta
      ), GruposPregunta AS (
        SELECT *,SUM(NuevoGrupo) OVER (
          PARTITION BY IdIntentoPregunta ORDER BY FechaInicioCliente,Id ROWS UNBOUNDED PRECEDING
        ) AS Grupo
        FROM MarcasPregunta
      ), IslasPregunta AS (
        SELECT IdIntentoPregunta,Grupo,MIN(FechaInicioCliente) AS Inicio,MAX(FechaFinCliente) AS Fin
        FROM GruposPregunta GROUP BY IdIntentoPregunta,Grupo
      ), Nueva AS (
        SELECT IdIntentoPregunta,SUM(DATEDIFF_BIG(MILLISECOND,Inicio,Fin)) AS DuracionMilisegundos
        FROM IslasPregunta GROUP BY IdIntentoPregunta
      ), Legacy AS (
        SELECT MN.IdPregunta,SUM(CAST(MN.SegundosPermanencia AS BIGINT))*1000 AS DuracionMilisegundos
        FROM dbo.MetricasNavegacion MN
        WHERE MN.IdIntento=@IdIntento
        GROUP BY MN.IdPregunta
      )
      SELECT IP.Id AS IdIntentoPregunta,IP.IdPregunta,
        CASE WHEN N.IdIntentoPregunta IS NOT NULL THEN N.DuracionMilisegundos
             ELSE L.DuracionMilisegundos END AS DuracionMilisegundos,
        CASE WHEN N.IdIntentoPregunta IS NOT NULL THEN 'nueva'
             WHEN L.IdPregunta IS NOT NULL THEN 'legacy' ELSE 'sin_datos' END AS Fuente
      FROM dbo.IntentoPregunta IP
      LEFT JOIN Nueva N ON N.IdIntentoPregunta=IP.Id
      LEFT JOIN Legacy L ON L.IdPregunta=IP.IdPregunta
      WHERE IP.IdIntento=@IdIntento
      ORDER BY IP.Id;
    `);

  const [items = [], totalRows = [], porTipo = [], porPregunta = []] = result.recordsets ?? [];
  const total = Number(totalRows[0]?.Total ?? 0);
  return {
    items: mapKeysToCamelCase(items),
    resumen: {
      total,
      intervalosAbiertos: Number(totalRows[0]?.IntervalosAbiertos ?? 0),
      duracionesPorTipo: mapKeysToCamelCase(porTipo),
      tiemposPorPregunta: mapKeysToCamelCase(porPregunta),
    },
    paginacion: {
      pagina,
      limite,
      total,
      totalPaginas: total === 0 ? 0 : Math.ceil(total / limite),
    },
  };
}
