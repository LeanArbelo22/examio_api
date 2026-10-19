import * as sql from 'mssql';
import { pool } from '../config/db';
import {
  ListaIncidentesPublicacionQuery,
  RevisionIncidenteInput,
} from '../schemas/incidentes.schema';
import { ActorBanco, atomico, BancoError, DbBanco } from './banco-common.service';
import { autorizarPublicacion } from './evaluacion-access.service';
import { completarIdempotencia, iniciarIdempotencia } from './idempotency.service';

const actorId = (actor: ActorBanco) => {
  if (!actor.id || !Number.isInteger(actor.id) || actor.id <= 0) {
    throw new BancoError(403, 'No se pudo identificar al actor', 'FORBIDDEN');
  }
  return actor.id;
};

const autorizarRevision = (actor: ActorBanco, row: any) => {
  if (actor.role === 'admin') return;
  if (actor.role !== 'docente' || !actor.idDocente ||
      Number(row.IdDocente) !== actor.idDocente || !Boolean(row.DocenteActivo)) {
    throw new BancoError(403, 'El incidente está fuera del alcance docente', 'INCIDENT_SCOPE_FORBIDDEN');
  }
};

export async function listarIncidentesPublicacion(
  actor: ActorBanco,
  idPublicacion: number,
  filtros: ListaIncidentesPublicacionQuery,
) {
  await autorizarPublicacion(pool, actor, idPublicacion, false);
  const request = pool.request()
    .input('IdPublicacion', sql.Int, idPublicacion)
    .input('Offset', sql.Int, (filtros.pagina - 1) * filtros.limite)
    .input('Limit', sql.Int, filtros.limite);
  if (filtros.tipoIncidente) request.input('TipoIncidente', sql.VarChar(30), filtros.tipoIncidente);
  if (filtros.severidad) request.input('Severidad', sql.VarChar(30), filtros.severidad);
  if (filtros.estadoRevision) request.input('EstadoRevision', sql.VarChar(20), filtros.estadoRevision);

  const tipo = filtros.tipoIncidente ? 'AND E.Tipo=@TipoIncidente' : '';
  const severidad = filtros.severidad
    ? "AND COALESCE(DS.Accion,'sin_clasificar')=@Severidad"
    : '';
  const estado = filtros.estadoRevision ? "AND COALESCE(R.Estado,'pendiente')=@EstadoRevision" : '';
  const pendientes = filtros.soloIncidentesSinRevisar === true
    ? "AND COALESCE(R.Estado,'pendiente')='pendiente'"
    : '';

  const result = await request.query(`
    SET NOCOUNT ON;
    SELECT E.Id AS IdIncidente,E.EventoId,E.IdIntento,E.Tipo,E.FechaInicioCliente,
      E.FechaFinCliente,E.DuracionMilisegundos,E.Estado AS EstadoEvento,
      I.IdAlumno,I.NumeroIntento,I.Estado AS EstadoIntento,
      AL.Nombre AS AlumnoNombre,AL.Apellido AS AlumnoApellido,
      COALESCE(DS.Accion,'sin_clasificar') AS Severidad,
      COALESCE(R.Estado,'pendiente') AS EstadoRevision,
      COALESCE(R.Revision,0) AS Revision,R.Comentario,R.ActorId,R.ActorRol,R.FechaRevision
    INTO #IncidentesPublicacion
    FROM dbo.IncidenteIntento E
    JOIN dbo.TipoEventoTelemetria T ON T.Tipo=E.Tipo AND T.EsIncidente=1
    JOIN dbo.Intento I ON I.Id=E.IdIntento
    JOIN dbo.Alumno AL ON AL.Matricula=I.IdAlumno
    LEFT JOIN dbo.DecisionSupervisionIntento DS
      ON DS.IdIntento=E.IdIntento AND DS.EventoId=E.EventoId
    OUTER APPLY (
      SELECT TOP (1) RI.Estado,RI.Revision,RI.Comentario,RI.ActorId,RI.ActorRol,RI.FechaRevision
      FROM dbo.RevisionIncidenteIntento RI
      WHERE RI.IdIncidente=E.Id
      ORDER BY RI.Revision DESC
    ) R
    WHERE I.IdPublicacion=@IdPublicacion ${tipo} ${severidad} ${estado} ${pendientes};

    SELECT COUNT_BIG(*) AS TotalIncidentes,
      COUNT(DISTINCT IdAlumno) AS AlumnosConIncidentes,
      COUNT(DISTINCT CASE WHEN EstadoIntento='anulado' THEN IdIntento END) AS IntentosAnulados,
      COALESCE(SUM(CASE WHEN EstadoRevision='pendiente' THEN 1 ELSE 0 END),0) AS IncidentesSinRevisar
    FROM #IncidentesPublicacion;

    SELECT IdIncidente,EventoId,IdIntento,Tipo,FechaInicioCliente,FechaFinCliente,
      DuracionMilisegundos,EstadoEvento,IdAlumno,NumeroIntento,EstadoIntento,
      AlumnoNombre,AlumnoApellido,Severidad,EstadoRevision,Revision,Comentario,
      ActorId,ActorRol,FechaRevision
    FROM #IncidentesPublicacion
    ORDER BY FechaInicioCliente DESC,IdIncidente DESC
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;

    SELECT COUNT_BIG(*) AS Total FROM #IncidentesPublicacion;
  `);
  const [resumenRows = [], incidentes = [], totalRows = []] = result.recordsets ?? [];
  const total = Number(totalRows[0]?.Total ?? 0);
  return {
    Resumen: resumenRows[0] ?? {
      TotalIncidentes: 0, AlumnosConIncidentes: 0, IntentosAnulados: 0, IncidentesSinRevisar: 0,
    },
    Incidentes: incidentes,
    Paginacion: {
      Pagina: filtros.pagina,
      Limite: filtros.limite,
      Total: total,
      TotalPaginas: total === 0 ? 0 : Math.ceil(total / filtros.limite),
    },
  };
}

export async function revisarIncidente(
  actor: ActorBanco,
  idIntento: number,
  eventoId: string,
  idempotencyKey: string,
  input: RevisionIncidenteInput,
) {
  return atomico(async tx => revisarIncidenteEnDb(
    tx, actor, idIntento, eventoId, idempotencyKey, input,
  ));
}

async function revisarIncidenteEnDb(
  db: DbBanco,
  actor: ActorBanco,
  idIntento: number,
  eventoId: string,
  idempotencyKey: string,
  input: RevisionIncidenteInput,
) {
  const idActor = actorId(actor);
  const incidente = (await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .input('EventoId', sql.UniqueIdentifier, eventoId)
    .query(`SELECT E.Id AS IdIncidente,E.IdIntento,E.EventoId,E.Tipo,T.EsIncidente,
        I.IdPublicacion,MD.IdDocente,D.Estado AS DocenteActivo
      FROM dbo.IncidenteIntento E WITH (UPDLOCK,HOLDLOCK)
      JOIN dbo.TipoEventoTelemetria T ON T.Tipo=E.Tipo
      JOIN dbo.Intento I ON I.Id=E.IdIntento
      JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
      JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
      LEFT JOIN dbo.Docente D ON D.Legajo=MD.IdDocente
      WHERE E.IdIntento=@IdIntento AND E.EventoId=@EventoId;`)).recordset[0];
  if (!incidente) throw new BancoError(404, 'Incidente no encontrado', 'INCIDENT_NOT_FOUND');
  if (!Boolean(incidente.EsIncidente)) {
    throw new BancoError(409, 'El evento no está clasificado como incidente', 'EVENT_NOT_INCIDENT');
  }
  autorizarRevision(actor, incidente);

  const payload = { IdIntento: idIntento, EventoId: eventoId, ...input };
  const idem = await iniciarIdempotencia(
    db, actor, 'telemetria.incidente.revision', idempotencyKey, payload,
  );
  if (idem.replay) return { ...(idem.result as Record<string, unknown>), Replay: true };

  const actual = (await db.request()
    .input('IdIncidente', sql.BigInt, incidente.IdIncidente)
    .query(`SELECT TOP (1) Revision,Estado
      FROM dbo.RevisionIncidenteIntento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdIncidente=@IdIncidente ORDER BY Revision DESC;`)).recordset[0];
  const revisionActual = Number(actual?.Revision ?? 0);
  if (revisionActual !== input.RevisionEsperada) {
    throw new BancoError(409, 'La revisión del incidente cambió', 'INCIDENT_REVISION_CONFLICT');
  }

  const inserted = (await db.request()
    .input('IdIncidente', sql.BigInt, incidente.IdIncidente)
    .input('Revision', sql.Int, revisionActual + 1)
    .input('Estado', sql.VarChar(20), input.Estado)
    .input('ActorId', sql.Int, idActor)
    .input('ActorRol', sql.VarChar(20), actor.role)
    .input('Comentario', sql.NVarChar, input.Comentario ?? null)
    .query(`INSERT INTO dbo.RevisionIncidenteIntento
      (IdIncidente,Revision,Estado,ActorId,ActorRol,Comentario,FechaRevision)
      OUTPUT inserted.Id,inserted.IdIncidente,inserted.Revision,inserted.Estado,
        inserted.ActorId,inserted.ActorRol,inserted.Comentario,inserted.FechaRevision
      VALUES(@IdIncidente,@Revision,@Estado,@ActorId,@ActorRol,@Comentario,SYSUTCDATETIME());`)).recordset[0];
  const response = {
    ...inserted,
    IdIntento: idIntento,
    EventoId: eventoId,
    Replay: false,
  };
  await completarIdempotencia(db, idem.id, response, 200);
  return response;
}
