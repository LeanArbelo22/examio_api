import * as sql from 'mssql';
import { pool } from '../config/db';
import { OverrideSupervisionInput, PoliticaSupervisionInput } from '../schemas/supervision.schema';
import { ActorBanco, atomico, BancoError, DbBanco } from './banco-common.service';
import { autorizarPublicacion } from './evaluacion-access.service';
import { anularIntentoPorIncidenteEnDb } from './intento-estado.service';

type AccionSupervision = 'informar' | 'advertir' | 'bloquear_interfaz' | 'anular_intento';

type ContextoEvento = {
  IdIntento: number;
  IdPublicacion: number;
  IdAlumno: number;
  EstadoIntento: string;
  IdDocente: number | null;
  DocenteActivo: boolean | number | null;
  PantallaCompletaObligatoria: boolean | number;
  RevisionOrigen: number;
  CodigoConfiguracion: string;
  EstadoSupervision: 'normal' | 'advertido' | 'bloqueado' | 'anulado';
  UltimaAccion: AccionSupervision;
  UltimoEventoId: string | null;
  RevisionEstado: number;
  TipoEvento: string;
  EstadoEvento: string;
};

const pesoAccion: Record<AccionSupervision, number> = {
  informar: 1,
  advertir: 2,
  bloquear_interfaz: 3,
  anular_intento: 4,
};

const autorizarIntento = (
  actor: ActorBanco,
  scope: { IdAlumno: number; IdDocente: number | null; DocenteActivo: boolean | number | null },
  detalle: boolean,
) => {
  if (actor.role === 'admin') return;
  if (!detalle && actor.role === 'alumno' && Number(actor.idAlumno) === Number(scope.IdAlumno)) return;
  if (actor.role === 'docente' && Number(actor.idDocente) === Number(scope.IdDocente)
      && Boolean(scope.DocenteActivo)) return;
  throw new BancoError(403, 'El intento está fuera del alcance del usuario', 'SUPERVISION_SCOPE_FORBIDDEN');
};

async function scopeIntento(db: DbBanco, idIntento: number, bloquear = false) {
  const result = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .query(`SELECT I.Id,I.IdAlumno,I.IdPublicacion,I.Estado,
      MD.IdDocente,D.Estado AS DocenteActivo
      FROM dbo.Intento I ${bloquear ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
      JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
      JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
      LEFT JOIN dbo.Docente D ON D.Legajo=MD.IdDocente
      WHERE I.Id=@IdIntento;`);
  const row = result.recordset[0];
  if (!row) throw new BancoError(404, 'Intento no encontrado', 'ATTEMPT_NOT_FOUND');
  return row;
}

export async function obtenerPoliticaSupervision(actor: ActorBanco, idPublicacion: number) {
  await autorizarPublicacion(pool, actor, idPublicacion, false);
  const result = await pool.request()
    .input('IdPublicacion', sql.Int, idPublicacion)
    .query(`SELECT IdPublicacion,PantallaCompletaObligatoria,CodigoConfiguracion,
        Revision,ModificadoPor,FechaModificacion
      FROM dbo.PoliticaSupervisionPublicacion WHERE IdPublicacion=@IdPublicacion;
      SELECT Id,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa
      FROM dbo.ReglaSupervisionPublicacion WHERE IdPublicacion=@IdPublicacion
      ORDER BY Prioridad DESC,Id ASC;`);
  const [politicas = [], reglas = []] = result.recordsets ?? [];
  const politica = politicas[0];
  if (!politica) throw new BancoError(404, 'Política de supervisión no encontrada', 'SUPERVISION_POLICY_NOT_FOUND');
  return { ...politica, Reglas: reglas };
}

export async function actualizarPoliticaSupervision(
  actor: ActorBanco,
  idPublicacion: number,
  input: PoliticaSupervisionInput,
) {
  if (!actor.id) throw new BancoError(403, 'No se pudo identificar al usuario', 'FORBIDDEN');
  return atomico(async tx => {
    await autorizarPublicacion(tx, actor, idPublicacion, true);
    const actual = (await tx.request()
      .input('IdPublicacion', sql.Int, idPublicacion)
      .query(`SELECT Revision FROM dbo.PoliticaSupervisionPublicacion WITH (UPDLOCK,HOLDLOCK)
        WHERE IdPublicacion=@IdPublicacion;`)).recordset[0];
    if (!actual) throw new BancoError(404, 'Política de supervisión no encontrada', 'SUPERVISION_POLICY_NOT_FOUND');
    if (Number(actual.Revision) !== input.RevisionEsperada) {
      throw new BancoError(409, 'La política cambió; recargar antes de continuar', 'SUPERVISION_POLICY_REVISION_CONFLICT');
    }

    const tipos = [...new Set(input.Reglas.map(regla => regla.TipoEvento))];
    if (tipos.length) {
      const request = tx.request();
      const placeholders = tipos.map((tipo, index) => {
        request.input(`Tipo${index}`, sql.VarChar(30), tipo);
        return `@Tipo${index}`;
      });
      const rows = (await request.query(`SELECT Tipo,EsIncidente FROM dbo.TipoEventoTelemetria
        WHERE Activo=1 AND Tipo IN (${placeholders.join(',')});`)).recordset;
      const incidentes = new Set(rows.filter((row: any) => Boolean(row.EsIncidente)).map((row: any) => row.Tipo));
      if (rows.length !== tipos.length || tipos.some(tipo => !incidentes.has(tipo))) {
        throw new BancoError(400, 'Las reglas sólo admiten tipos de incidente activos', 'SUPERVISION_RULE_INVALID');
      }
    }

    await tx.request()
      .input('IdPublicacion', sql.Int, idPublicacion)
      .input('PantallaCompleta', sql.Bit, input.PantallaCompletaObligatoria)
      .input('Usuario', sql.Int, actor.id)
      .input('Revision', sql.Int, input.RevisionEsperada)
      .query(`UPDATE dbo.PoliticaSupervisionPublicacion SET
          PantallaCompletaObligatoria=@PantallaCompleta,CodigoConfiguracion='personalizada',
          Revision=Revision+1,ModificadoPor=@Usuario,FechaModificacion=SYSUTCDATETIME()
        WHERE IdPublicacion=@IdPublicacion AND Revision=@Revision;
        IF @@ROWCOUNT<>1 THROW 51360,'La política de supervisión cambió',1;
        DELETE FROM dbo.ReglaSupervisionPublicacion WHERE IdPublicacion=@IdPublicacion;`);

    for (const regla of input.Reglas) {
      await tx.request()
        .input('IdPublicacion', sql.Int, idPublicacion)
        .input('Codigo', sql.VarChar(50), regla.Codigo)
        .input('TipoEvento', sql.VarChar(30), regla.TipoEvento)
        .input('Metrica', sql.VarChar(30), regla.Metrica)
        .input('Umbral', sql.BigInt, regla.Umbral)
        .input('VentanaSegundos', sql.Int, regla.VentanaSegundos ?? null)
        .input('Prioridad', sql.Int, regla.Prioridad)
        .input('Accion', sql.VarChar(30), regla.Accion)
        .input('Activa', sql.Bit, regla.Activa)
        .query(`INSERT INTO dbo.ReglaSupervisionPublicacion
          (IdPublicacion,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa)
          VALUES(@IdPublicacion,@Codigo,@TipoEvento,@Metrica,@Umbral,@VentanaSegundos,
            @Prioridad,@Accion,@Activa);`);
    }

    const result = await tx.request().input('IdPublicacion', sql.Int, idPublicacion).query(`
      SELECT IdPublicacion,PantallaCompletaObligatoria,CodigoConfiguracion,
        Revision,ModificadoPor,FechaModificacion
      FROM dbo.PoliticaSupervisionPublicacion WHERE IdPublicacion=@IdPublicacion;
      SELECT Id,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa
      FROM dbo.ReglaSupervisionPublicacion WHERE IdPublicacion=@IdPublicacion
      ORDER BY Prioridad DESC,Id ASC;`);
    const [politicas = [], reglas = []] = result.recordsets ?? [];
    return { ...politicas[0], Reglas: reglas };
  });
}

const respuestaEstado = (row: any) => ({
  IdIntento: Number(row.IdIntento),
  Estado: row.EstadoSupervision,
  Accion: row.EstadoSupervision === 'anulado' ? 'anular_intento'
    : row.EstadoSupervision === 'bloqueado' ? 'bloquear_interfaz'
    : row.EstadoSupervision === 'advertido' ? 'advertir' : 'informar',
  InteraccionBloqueada: row.EstadoSupervision === 'bloqueado' || row.EstadoSupervision === 'anulado',
  IntentoAnulado: row.EstadoSupervision === 'anulado',
  PantallaCompletaObligatoria: Boolean(row.PantallaCompletaObligatoria),
  Revision: Number(row.RevisionEstado),
  FechaActualizacion: row.FechaActualizacion,
});

export async function obtenerEstadoSupervision(actor: ActorBanco, idIntento: number) {
  const scope = await scopeIntento(pool, idIntento);
  autorizarIntento(actor, scope, false);
  const result = await pool.request().input('IdIntento', sql.Int, idIntento).query(`
    SELECT E.IdIntento,E.Estado AS EstadoSupervision,E.Revision AS RevisionEstado,
      E.FechaActualizacion,S.PantallaCompletaObligatoria
    FROM dbo.EstadoSupervisionIntento E
    JOIN dbo.IntentoPoliticaSupervision S ON S.IdIntento=E.IdIntento
    WHERE E.IdIntento=@IdIntento;`);
  const row = result.recordset[0];
  if (!row) throw new BancoError(409, 'El intento no tiene snapshot de supervisión', 'SUPERVISION_SNAPSHOT_MISSING');
  return respuestaEstado(row);
}

export async function obtenerDetalleSupervision(actor: ActorBanco, idIntento: number) {
  const scope = await scopeIntento(pool, idIntento);
  autorizarIntento(actor, scope, true);
  const result = await pool.request().input('IdIntento', sql.Int, idIntento).query(`
    SELECT E.IdIntento,E.Estado AS EstadoSupervision,E.UltimaAccion,E.UltimoEventoId,
      E.Revision AS RevisionEstado,E.FechaActualizacion,S.IdPublicacionOrigen,S.RevisionOrigen,
      S.CodigoConfiguracion,S.PantallaCompletaObligatoria,S.FechaSnapshot
    FROM dbo.EstadoSupervisionIntento E
    JOIN dbo.IntentoPoliticaSupervision S ON S.IdIntento=E.IdIntento
    WHERE E.IdIntento=@IdIntento;
    SELECT Id,Codigo,TipoEvento,Metrica,Umbral,VentanaSegundos,Prioridad,Accion,Activa
    FROM dbo.IntentoReglaSupervision WHERE IdIntento=@IdIntento ORDER BY Prioridad DESC,Id;
    SELECT Id,EventoId,IdReglaSnapshot,Accion,ValorMetrica,ConsecuenciaAplicada,
      Resultado,EstadoRevision,FechaDecision,FechaActualizacion
    FROM dbo.DecisionSupervisionIntento WHERE IdIntento=@IdIntento ORDER BY FechaDecision DESC,Id DESC;
    SELECT O.Id,O.IdDecision,O.Accion,O.Motivo,O.ActorId,O.ActorRol,
      O.RevisionAnterior,O.RevisionNueva,O.Fecha
    FROM dbo.OverrideSupervisionIntento O WHERE O.IdIntento=@IdIntento ORDER BY O.Fecha DESC,O.Id DESC;`);
  const [estado = [], reglas = [], decisiones = [], overrides = []] = result.recordsets ?? [];
  if (!estado[0]) throw new BancoError(409, 'El intento no tiene snapshot de supervisión', 'SUPERVISION_SNAPSHOT_MISSING');
  return { ...estado[0], Reglas: reglas, Decisiones: decisiones, Overrides: overrides };
}

export async function aplicarOverrideSupervision(
  actor: ActorBanco,
  idIntento: number,
  input: OverrideSupervisionInput,
) {
  if (!actor.id) throw new BancoError(403, 'No se pudo identificar al usuario', 'FORBIDDEN');
  return atomico(async tx => {
    const scope = await scopeIntento(tx, idIntento, true);
    autorizarIntento(actor, scope, true);
    const estado = (await tx.request().input('IdIntento', sql.Int, idIntento).query(`
      SELECT * FROM dbo.EstadoSupervisionIntento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdIntento=@IdIntento;`)).recordset[0];
    if (!estado) throw new BancoError(409, 'El intento no tiene snapshot de supervisión', 'SUPERVISION_SNAPSHOT_MISSING');
    if (Number(estado.Revision) !== input.RevisionEsperada) {
      const replay = (await tx.request()
        .input('IdIntento', sql.Int, idIntento)
        .input('Accion', sql.VarChar(20), input.Accion)
        .input('Motivo', sql.NVarChar, input.Motivo)
        .input('RevisionAnterior', sql.Int, input.RevisionEsperada)
        .input('RevisionNueva', sql.Int, Number(estado.Revision))
        .input('EventoId', sql.UniqueIdentifier, input.EventoId ?? null)
        .query(`SELECT TOP (1) O.Id FROM dbo.OverrideSupervisionIntento O
          LEFT JOIN dbo.DecisionSupervisionIntento D ON D.Id=O.IdDecision
          WHERE O.IdIntento=@IdIntento AND O.Accion=@Accion AND O.Motivo=@Motivo
            AND O.RevisionAnterior=@RevisionAnterior AND O.RevisionNueva=@RevisionNueva
            AND ((@EventoId IS NULL AND O.IdDecision IS NULL) OR D.EventoId=@EventoId)
          ORDER BY O.Id DESC;`)).recordset[0];
      if (replay) return {
        ...estado, AccionOverride: input.Accion, EventoId: input.EventoId ?? null, Replay: true,
      };
      throw new BancoError(409, 'El estado de supervisión cambió', 'SUPERVISION_REVISION_CONFLICT');
    }
    if (scope.Estado === 'anulado' || estado.Estado === 'anulado') {
      throw new BancoError(409, 'Un override no puede reabrir un intento anulado', 'SUPERVISION_CANCELLED_IMMUTABLE');
    }

    let decision: any = null;
    if (input.EventoId) {
      decision = (await tx.request()
        .input('IdIntento', sql.Int, idIntento)
        .input('EventoId', sql.UniqueIdentifier, input.EventoId)
        .query(`SELECT * FROM dbo.DecisionSupervisionIntento WITH (UPDLOCK,HOLDLOCK)
          WHERE IdIntento=@IdIntento AND EventoId=@EventoId;`)).recordset[0];
      if (!decision) throw new BancoError(404, 'Decisión de supervisión no encontrada', 'SUPERVISION_DECISION_NOT_FOUND');
    }

    if (input.Accion === 'reconocer' || input.Accion === 'descartar') {
      await tx.request()
        .input('Id', sql.BigInt, decision.Id)
        .input('Estado', sql.VarChar(20), input.Accion === 'reconocer' ? 'reconocida' : 'descartada')
        .query(`UPDATE dbo.DecisionSupervisionIntento SET EstadoRevision=@Estado,
          FechaActualizacion=SYSUTCDATETIME() WHERE Id=@Id;`);
    }

    const desbloquea = input.Accion === 'desbloquear'
      || (input.Accion === 'descartar' && String(estado.UltimoEventoId ?? '').toLowerCase()
        === String(input.EventoId ?? '').toLowerCase());
    const updated = (await tx.request()
      .input('IdIntento', sql.Int, idIntento)
      .input('Desbloquea', sql.Bit, desbloquea)
      .input('Revision', sql.Int, input.RevisionEsperada)
      .query(`UPDATE dbo.EstadoSupervisionIntento SET
          Estado=CASE WHEN @Desbloquea=1 THEN 'normal' ELSE Estado END,
          UltimaAccion=CASE WHEN @Desbloquea=1 THEN 'informar' ELSE UltimaAccion END,
          UltimoEventoId=CASE WHEN @Desbloquea=1 THEN NULL ELSE UltimoEventoId END,
          Revision=Revision+1,FechaActualizacion=SYSUTCDATETIME()
        OUTPUT inserted.* WHERE IdIntento=@IdIntento AND Revision=@Revision;`)).recordset[0];
    if (!updated) throw new BancoError(409, 'El estado de supervisión cambió', 'SUPERVISION_REVISION_CONFLICT');

    await tx.request()
      .input('IdIntento', sql.Int, idIntento)
      .input('IdDecision', sql.BigInt, decision?.Id ?? null)
      .input('Accion', sql.VarChar(20), input.Accion)
      .input('Motivo', sql.NVarChar, input.Motivo)
      .input('ActorId', sql.Int, actor.id)
      .input('ActorRol', sql.VarChar(20), actor.role)
      .input('RevisionAnterior', sql.Int, input.RevisionEsperada)
      .input('RevisionNueva', sql.Int, Number(updated.Revision))
      .query(`INSERT INTO dbo.OverrideSupervisionIntento
        (IdIntento,IdDecision,Accion,Motivo,ActorId,ActorRol,RevisionAnterior,RevisionNueva)
        VALUES(@IdIntento,@IdDecision,@Accion,@Motivo,@ActorId,@ActorRol,@RevisionAnterior,@RevisionNueva);`);

    return { ...updated, AccionOverride: input.Accion, EventoId: input.EventoId ?? null };
  });
}

async function contextoEvento(db: DbBanco, idIntento: number, eventoId: string) {
  const result = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('EventoId', sql.UniqueIdentifier, eventoId)
    .query(`SELECT I.Id AS IdIntento,I.IdPublicacion,I.IdAlumno,I.Estado AS EstadoIntento,
      MD.IdDocente,D.Estado AS DocenteActivo,S.PantallaCompletaObligatoria,
      S.RevisionOrigen,S.CodigoConfiguracion,E.Estado AS EstadoSupervision,
      E.UltimaAccion,E.UltimoEventoId,E.Revision AS RevisionEstado,
      X.Tipo AS TipoEvento,X.Estado AS EstadoEvento
      FROM dbo.Intento I
      JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
      JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
      LEFT JOIN dbo.Docente D ON D.Legajo=MD.IdDocente
      JOIN dbo.IntentoPoliticaSupervision S ON S.IdIntento=I.Id
      JOIN dbo.EstadoSupervisionIntento E WITH (UPDLOCK,HOLDLOCK) ON E.IdIntento=I.Id
      JOIN dbo.IncidenteIntento X ON X.IdIntento=I.Id AND X.EventoId=@EventoId
      WHERE I.Id=@IdIntento;`);
  return result.recordset[0] as ContextoEvento | undefined;
}

async function calcularReglas(db: DbBanco, idIntento: number, eventoId: string) {
  const result = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('EventoId', sql.UniqueIdentifier, eventoId)
    .query(`;WITH Referencia AS (
        SELECT Tipo,FechaInicioCliente,DuracionMilisegundos,Estado
        FROM dbo.IncidenteIntento WHERE IdIntento=@IdIntento AND EventoId=@EventoId
      ), Reglas AS (
        SELECT R.* FROM dbo.IntentoReglaSupervision R
        CROSS JOIN Referencia F
        WHERE R.IdIntento=@IdIntento AND R.Activa=1 AND R.TipoEvento=F.Tipo
      ), Eventos AS (
        SELECT R.Id AS IdRegla,E.Id,E.FechaInicioCliente,E.FechaFinCliente
        FROM Reglas R CROSS JOIN Referencia F
        JOIN dbo.IncidenteIntento E ON E.IdIntento=@IdIntento AND E.Tipo=R.TipoEvento
          AND E.Estado='completado'
          AND E.FechaInicioCliente<=F.FechaInicioCliente
          AND (R.VentanaSegundos IS NULL OR
            E.FechaInicioCliente>=DATEADD(SECOND,-R.VentanaSegundos,F.FechaInicioCliente))
      ), Ordenados AS (
        SELECT *,MAX(FechaFinCliente) OVER (PARTITION BY IdRegla ORDER BY FechaInicioCliente,Id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS MaxFinAnterior
        FROM Eventos
      ), Marcas AS (
        SELECT *,CASE WHEN MaxFinAnterior IS NULL OR FechaInicioCliente>MaxFinAnterior THEN 1 ELSE 0 END AS NuevaIsla
        FROM Ordenados
      ), Grupos AS (
        SELECT *,SUM(NuevaIsla) OVER (PARTITION BY IdRegla ORDER BY FechaInicioCliente,Id
          ROWS UNBOUNDED PRECEDING) AS Grupo FROM Marcas
      ), Islas AS (
        SELECT IdRegla,Grupo,MIN(FechaInicioCliente) AS Inicio,MAX(FechaFinCliente) AS Fin
        FROM Grupos GROUP BY IdRegla,Grupo
      ), Acumulados AS (
        SELECT IdRegla,SUM(DATEDIFF_BIG(MILLISECOND,Inicio,Fin)) AS Duracion
        FROM Islas GROUP BY IdRegla
      )
      SELECT R.Id,R.Codigo,R.Metrica,R.Umbral,R.Prioridad,R.Accion,
        CAST(CASE R.Metrica
          WHEN 'cantidad' THEN (SELECT COUNT_BIG(*) FROM dbo.IncidenteIntento E CROSS JOIN Referencia F
            WHERE E.IdIntento=@IdIntento AND E.Tipo=R.TipoEvento
              AND E.FechaInicioCliente<=F.FechaInicioCliente
              AND (R.VentanaSegundos IS NULL OR E.FechaInicioCliente>=DATEADD(SECOND,-R.VentanaSegundos,F.FechaInicioCliente)))
          WHEN 'duracion_individual' THEN CASE WHEN F.Estado='completado'
            THEN COALESCE(F.DuracionMilisegundos,0) ELSE 0 END
          WHEN 'duracion_acumulada' THEN COALESCE(A.Duracion,0)
          ELSE 0 END AS BIGINT) AS ValorMetrica
      FROM Reglas R CROSS JOIN Referencia F LEFT JOIN Acumulados A ON A.IdRegla=R.Id;`);
  return result.recordset;
}

export async function evaluarEventoSupervision(
  db: DbBanco,
  idIntento: number,
  eventoId: string,
  resultadoEvento: string,
) {
  const contexto = await contextoEvento(db, idIntento, eventoId);
  if (!contexto) {
    return {
      Accion: 'informar', Estado: 'normal', InteraccionBloqueada: false,
      IntentoAnulado: false, DecisionId: null, Replay: resultadoEvento === 'replay',
    };
  }

  const decisionExistente = (await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('EventoId', sql.UniqueIdentifier, eventoId)
    .query(`SELECT * FROM dbo.DecisionSupervisionIntento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdIntento=@IdIntento AND EventoId=@EventoId;`)).recordset[0];
  if (resultadoEvento === 'replay' && decisionExistente) {
    return {
      Accion: contexto.EstadoSupervision === 'anulado' ? 'anular_intento'
        : contexto.EstadoSupervision === 'bloqueado' ? 'bloquear_interfaz'
        : contexto.EstadoSupervision === 'advertido' ? 'advertir' : 'informar',
      Estado: contexto.EstadoSupervision,
      InteraccionBloqueada: ['bloqueado', 'anulado'].includes(contexto.EstadoSupervision),
      IntentoAnulado: contexto.EstadoSupervision === 'anulado',
      DecisionId: decisionExistente.Id,
      Replay: true,
    };
  }

  const reglas = await calcularReglas(db, idIntento, eventoId);
  const cumplidas = reglas.filter((regla: any) => Number(regla.ValorMetrica) >= Number(regla.Umbral));
  cumplidas.sort((a: any, b: any) =>
    pesoAccion[b.Accion as AccionSupervision] - pesoAccion[a.Accion as AccionSupervision]
      || Number(b.Prioridad) - Number(a.Prioridad) || Number(a.Id) - Number(b.Id));
  const ganadora = cumplidas[0];
  const accionDecision: AccionSupervision = ganadora?.Accion ?? 'informar';
  let accionEfectiva = accionDecision;
  let estadoNuevo = contexto.EstadoSupervision;
  let aplicada = false;
  let resultado = 'registrada';

  const recuperacion = contexto.EstadoEvento === 'completado'
    && accionDecision === 'bloquear_interfaz'
    && String(contexto.UltimoEventoId ?? '').toLowerCase() === eventoId.toLowerCase();

  if (contexto.EstadoIntento !== 'en_progreso') {
    accionEfectiva = contexto.EstadoSupervision === 'anulado' ? 'anular_intento' : 'informar';
    resultado = 'no_aplicada_estado_intento';
  } else if (recuperacion) {
    estadoNuevo = 'normal';
    accionEfectiva = 'informar';
    aplicada = true;
    resultado = 'recuperada';
  } else if (accionDecision === 'anular_intento') {
    await anularIntentoPorIncidenteEnDb(
      db, { role: 'sistema' }, idIntento, eventoId, 'SUPERVISION_POLICY_RULE',
    );
    estadoNuevo = 'anulado';
    accionEfectiva = 'anular_intento';
    aplicada = true;
    resultado = 'aplicada';
  } else if (pesoAccion[accionDecision] >= pesoAccion[contexto.UltimaAccion]) {
    if (accionDecision === 'bloquear_interfaz') estadoNuevo = 'bloqueado';
    else if (accionDecision === 'advertir' && estadoNuevo === 'normal') estadoNuevo = 'advertido';
    aplicada = accionDecision !== 'informar';
    resultado = aplicada ? 'aplicada' : 'registrada';
  } else {
    accionEfectiva = contexto.UltimaAccion;
  }

  const decision = decisionExistente
    ? (await db.request()
      .input('Id', sql.BigInt, decisionExistente.Id)
      .input('IdRegla', sql.BigInt, ganadora?.Id ?? null)
      .input('Accion', sql.VarChar(30), accionDecision)
      .input('Valor', sql.BigInt, ganadora?.ValorMetrica ?? null)
      .input('Aplicada', sql.Bit, aplicada)
      .input('Resultado', sql.VarChar(40), resultado)
      .query(`UPDATE dbo.DecisionSupervisionIntento SET IdReglaSnapshot=@IdRegla,
        Accion=@Accion,ValorMetrica=@Valor,ConsecuenciaAplicada=@Aplicada,
        Resultado=@Resultado,FechaActualizacion=SYSUTCDATETIME()
        OUTPUT inserted.* WHERE Id=@Id;`)).recordset[0]
    : (await db.request()
      .input('IdIntento', sql.Int, idIntento)
      .input('EventoId', sql.UniqueIdentifier, eventoId)
      .input('IdRegla', sql.BigInt, ganadora?.Id ?? null)
      .input('Accion', sql.VarChar(30), accionDecision)
      .input('Valor', sql.BigInt, ganadora?.ValorMetrica ?? null)
      .input('Aplicada', sql.Bit, aplicada)
      .input('Resultado', sql.VarChar(40), resultado)
      .query(`INSERT INTO dbo.DecisionSupervisionIntento
        (IdIntento,EventoId,IdReglaSnapshot,Accion,ValorMetrica,ConsecuenciaAplicada,Resultado,EstadoRevision)
        OUTPUT inserted.* VALUES(@IdIntento,@EventoId,@IdRegla,@Accion,@Valor,@Aplicada,@Resultado,'pendiente');`)).recordset[0];

  const estado = (await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('Estado', sql.VarChar(20), estadoNuevo)
    .input('Accion', sql.VarChar(30), accionEfectiva)
    .input('EventoId', sql.UniqueIdentifier, estadoNuevo === 'normal' ? null : eventoId)
    .query(`UPDATE dbo.EstadoSupervisionIntento SET Estado=@Estado,UltimaAccion=@Accion,
      UltimoEventoId=@EventoId,Revision=Revision+1,FechaActualizacion=SYSUTCDATETIME()
      OUTPUT inserted.* WHERE IdIntento=@IdIntento;`)).recordset[0];

  return {
    Accion: accionEfectiva,
    Estado: estado.Estado,
    InteraccionBloqueada: ['bloqueado', 'anulado'].includes(estado.Estado),
    IntentoAnulado: estado.Estado === 'anulado',
    DecisionId: decision.Id,
    Replay: false,
  };
}

