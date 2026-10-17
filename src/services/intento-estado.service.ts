import * as sql from 'mssql';
import { ActorBanco, BancoError, atomico, DbBanco } from './banco-common.service';
import { evaluarDisponibilidadRevisionEnDb } from './revision-examen.service';

type ScopeIntentoEstado = {
  IdIntento: number;
  IdAlumno: number;
  Estado: string;
  IdDocente: number | null;
  DocenteActivo: boolean | number | null;
  CorreccionConfirmada: boolean | number;
  CorreccionConfirmadaPor: number | null;
  FechaCorreccionConfirmada: Date | string | null;
  OrigenConfirmacionCorreccion: string | null;
  PendientesCorreccion: number;
};

const autorizarAlumnoOAdmin = (actor: ActorBanco, scope: ScopeIntentoEstado) => {
  if (!Number.isInteger(actor.id) || !actor.id || actor.id <= 0) {
    throw new BancoError(403, 'No se pudo identificar al usuario', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
  if (actor.role === 'admin') return;
  if (actor.role !== 'alumno' || !Number.isInteger(actor.idAlumno)
      || Number(actor.idAlumno) !== Number(scope.IdAlumno)) {
    throw new BancoError(403, 'El intento no pertenece al alumno autenticado', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
};

const autorizarDocenteOAdmin = (actor: ActorBanco, scope: ScopeIntentoEstado) => {
  if (!Number.isInteger(actor.id) || !actor.id || actor.id <= 0) {
    throw new BancoError(403, 'No se pudo identificar al usuario', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
  if (actor.role === 'admin') return;
  if (actor.role !== 'docente' || !Number.isInteger(actor.idDocente)
      || Number(actor.idDocente) !== Number(scope.IdDocente) || !Boolean(scope.DocenteActivo)) {
    throw new BancoError(403, 'El intento no pertenece a una comisión del docente', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
};

async function obtenerScopeBloqueado(db: DbBanco, idIntento: number): Promise<ScopeIntentoEstado> {
  const result = await db.request()
    .input('IdIntento', sql.Int, idIntento)
    .query(`
      SELECT I.Id AS IdIntento,I.IdAlumno,I.Estado,I.CorreccionConfirmada,
             I.CorreccionConfirmadaPor,I.FechaCorreccionConfirmada,
             I.OrigenConfirmacionCorreccion,
             MD.IdDocente,D.Estado AS DocenteActivo,
             ISNULL(C.PendientesCorreccion,0) AS PendientesCorreccion
      FROM dbo.Intento I WITH (UPDLOCK,HOLDLOCK)
      JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
      JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
      LEFT JOIN dbo.Docente D ON D.Legajo=MD.IdDocente
      OUTER APPLY (
        SELECT SUM(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS PendientesCorreccion
        FROM dbo.IntentoPregunta IP WHERE IP.IdIntento=I.Id
      ) C
      WHERE I.Id=@IdIntento;
    `);
  const scope = result.recordset[0] as ScopeIntentoEstado | undefined;
  if (!scope) throw new BancoError(404, 'Intento no encontrado', 'ATTEMPT_NOT_FOUND');
  return scope;
}

export async function anularIntentoPorIncidente(
  actor: ActorBanco,
  idIntento: number,
  eventoId: string,
) {
  return atomico(async tx => {
    const scope = await obtenerScopeBloqueado(tx, idIntento);
    autorizarAlumnoOAdmin(actor, scope);

    const existenteResult = await tx.request()
      .input('IdIntento', sql.Int, idIntento)
      .query(`SELECT IdIntento,EventoId,TipoIncidente,Motivo,AnuladoPor,FechaAnulacion
        FROM dbo.AnulacionIntentoIncidente WITH (UPDLOCK,HOLDLOCK)
        WHERE IdIntento=@IdIntento;`);
    const existente = existenteResult.recordset[0] as Record<string, unknown> | undefined;
    if (existente) {
      if (String(existente.EventoId).toLowerCase() !== eventoId.toLowerCase()) {
        throw new BancoError(409, 'El intento ya fue anulado por otro incidente', 'ATTEMPT_ALREADY_CANCELLED');
      }
      return { ...existente, Estado: 'anulado', Replay: true };
    }

    if (scope.Estado !== 'en_progreso') {
      throw new BancoError(409, 'Sólo puede anularse un intento en progreso', 'ATTEMPT_NOT_IN_PROGRESS');
    }

    const incidenteResult = await tx.request()
      .input('IdIntento', sql.Int, idIntento)
      .input('EventoId', sql.UniqueIdentifier, eventoId)
      .query(`SELECT Id,Tipo FROM dbo.IncidenteIntento WITH (UPDLOCK,HOLDLOCK)
        WHERE IdIntento=@IdIntento AND EventoId=@EventoId;`);
    const incidente = incidenteResult.recordset[0] as { Tipo: string } | undefined;
    if (!incidente || !['focus_lost', 'fullscreen_exit'].includes(incidente.Tipo)) {
      throw new BancoError(409, 'El incidente no existe o no habilita la anulación', 'INCIDENT_EVENT_NOT_ELIGIBLE');
    }

    const motivo = incidente.Tipo === 'fullscreen_exit'
      ? 'POLICY_FIRST_FULLSCREEN_EXIT'
      : 'POLICY_FIRST_FOCUS_LOSS';
    const result = await tx.request()
      .input('IdIntento', sql.Int, idIntento)
      .input('EventoId', sql.UniqueIdentifier, eventoId)
      .input('TipoIncidente', sql.VarChar(30), incidente.Tipo)
      .input('Motivo', sql.VarChar(100), motivo)
      .input('AnuladoPor', sql.Int, actor.id!)
      .query(`
        UPDATE dbo.Intento
        SET Estado='anulado',FechaFin=COALESCE(FechaFin,SYSUTCDATETIME()),
            NotaFinal=NULL,NotaAutomatica=NULL,NotaFinalCalculada=NULL,NotaFinalManual=NULL,
            CorreccionConfirmada=0,CorreccionConfirmadaPor=NULL,
            FechaCorreccionConfirmada=NULL,OrigenConfirmacionCorreccion=NULL
        WHERE Id=@IdIntento AND Estado='en_progreso';

        IF @@ROWCOUNT<>1 THROW 51330,'El intento ya no está en progreso',1;

        INSERT INTO dbo.AnulacionIntentoIncidente
          (IdIntento,EventoId,TipoIncidente,Motivo,AnuladoPor)
        VALUES(@IdIntento,@EventoId,@TipoIncidente,@Motivo,@AnuladoPor);

        SELECT A.IdIntento,A.EventoId,A.TipoIncidente,A.Motivo,A.AnuladoPor,
               A.FechaAnulacion,I.Estado,CAST(0 AS bit) AS Replay
        FROM dbo.AnulacionIntentoIncidente A
        JOIN dbo.Intento I ON I.Id=A.IdIntento
        WHERE A.IdIntento=@IdIntento;
      `);
    return result.recordset[0];
  });
}

export async function confirmarCorreccionIntento(actor: ActorBanco, idIntento: number) {
  return atomico(async tx => {
    const scope = await obtenerScopeBloqueado(tx, idIntento);
    autorizarDocenteOAdmin(actor, scope);
    if (scope.Estado === 'en_progreso') {
      throw new BancoError(409, 'No se puede confirmar un intento en progreso', 'ATTEMPT_NOT_DELIVERED');
    }
    if (Number(scope.PendientesCorreccion) > 0) {
      throw new BancoError(409, 'Todavía existen preguntas sin puntaje definitivo', 'CORRECTION_INCOMPLETE');
    }
    if (Boolean(scope.CorreccionConfirmada)) {
      const disponibilidad = await evaluarDisponibilidadRevisionEnDb(tx, idIntento);
      return {
        IdIntento: scope.IdIntento,
        CorreccionPendiente: false,
        CorreccionConfirmada: true,
        CorreccionConfirmadaPor: scope.CorreccionConfirmadaPor,
        FechaCorreccionConfirmada: scope.FechaCorreccionConfirmada,
        OrigenConfirmacionCorreccion: scope.OrigenConfirmacionCorreccion,
        RevisionDisponible: disponibilidad.RevisionDisponible,
        Replay: true,
      };
    }

    const result = await tx.request()
      .input('IdIntento', sql.Int, idIntento)
      .input('ConfirmadoPor', sql.Int, actor.id!)
      .query(`
        UPDATE dbo.Intento
        SET CorreccionConfirmada=1,CorreccionConfirmadaPor=@ConfirmadoPor,
            FechaCorreccionConfirmada=SYSUTCDATETIME(),OrigenConfirmacionCorreccion='manual'
        WHERE Id=@IdIntento;

        INSERT INTO dbo.HistorialEstadoCorreccionIntento
          (IdIntento,EstadoAnterior,EstadoNuevo,Accion,ModificadoPor)
        VALUES(@IdIntento,0,1,'confirmacion_manual',@ConfirmadoPor);

        SELECT Id AS IdIntento,CAST(0 AS bit) AS CorreccionPendiente,
               CorreccionConfirmada,CorreccionConfirmadaPor,FechaCorreccionConfirmada,
               OrigenConfirmacionCorreccion,
               CAST(0 AS bit) AS Replay
        FROM dbo.Intento WHERE Id=@IdIntento;
      `);
    const disponibilidad = await evaluarDisponibilidadRevisionEnDb(tx, idIntento);
    return { ...result.recordset[0], RevisionDisponible: disponibilidad.RevisionDisponible };
  });
}
