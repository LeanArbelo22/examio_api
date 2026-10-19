import crypto from 'crypto';
import { pool } from '../config/db';
import {
  AuditoriaRevisionQuery,
  PermisoRevisionInput,
  PermisosRevisionQuery,
  PoliticaRevisionInput,
} from '../schemas/revision.schema';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { ActorBanco, atomico, BancoError, consultar, DbBanco } from './banco-common.service';
import { autorizarPublicacion } from './evaluacion-access.service';
import { completarIdempotencia, iniciarIdempotencia } from './idempotency.service';

type ScopeRevision = Record<string, any> & {
  IdIntento: number;
  IdAlumno: number;
  IdPublicacion: number;
  EstadoIntento: string;
  CorreccionConfirmada: boolean | number;
  IdIntentoValido: number | null;
  Modo: 'nunca' | 'al_corregir' | 'ventana' | 'manual';
  AccesoPolitica: 'unico' | 'libre';
  VentanaDesde: Date | string | null;
  VentanaHasta: Date | string | null;
  RevisionPolitica: number;
  IdPermiso: number | null;
  EstadoPermiso: 'activo' | 'revocado' | null;
  AccesoPermiso: 'unico' | 'libre' | null;
  PermisoDesde: Date | string | null;
  PermisoHasta: Date | string | null;
  IdConsumoUnico: number | null;
  FechaServidor: Date | string;
};

type DisponibilidadRevision = {
  IdIntento: number;
  IdPublicacion: number;
  RevisionDisponible: boolean;
  Motivo: string;
  Acceso: 'unico' | 'libre' | null;
  Origen: 'individual' | 'general' | null;
  Modo: ScopeRevision['Modo'];
  RevisionPolitica: number;
  IdPermiso: number | null;
  EsIntentoValido: boolean;
  DisponibleDesde: Date | string | null;
  DisponibleHasta: Date | string | null;
  DuracionSesionSegundos: number;
  AccesoUnicoConsumido: boolean;
};

type ErrorRevision = { status: number; message: string; code: string };

const DURACION_SESION_SEGUNDOS = 300;

const instant = (value: Date | string | null | undefined) => value ? new Date(value).getTime() : null;
const mismoInstante = (left: Date | string | null | undefined, right: Date | string | null | undefined) =>
  instant(left) === instant(right);

async function auditar(
  db: DbBanco,
  params: {
    publicacion: number;
    intento?: number | null;
    sesion?: string | null;
    actor?: ActorBanco | null;
    accion: string;
    detalle?: unknown;
  },
) {
  await consultar(db, `INSERT INTO dbo.AuditoriaRevisionIntento
    (IdPublicacion,IdIntento,IdSesion,IdUsuario,ActorRol,Accion,Detalle)
    VALUES(@Publicacion,@Intento,@Sesion,@Usuario,@Rol,@Accion,@Detalle)`, {
    Publicacion: params.publicacion,
    Intento: params.intento ?? null,
    Sesion: params.sesion ?? null,
    Usuario: params.actor?.id ?? null,
    Rol: params.actor?.role ?? 'sistema',
    Accion: params.accion,
    Detalle: params.detalle === undefined ? null : JSON.stringify(params.detalle),
  });
}

async function obtenerScopeRevision(db: DbBanco, idIntento: number, bloquear = false) {
  const lock = bloquear ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  const result = await consultar(db, `
    SELECT I.Id AS IdIntento,I.IdAlumno,I.IdPublicacion,I.Estado AS EstadoIntento,
      I.CorreccionConfirmada,
      COALESCE(IVO.IdIntento,IA.IdIntento) AS IdIntentoValido,
      COALESCE(PR.Modo,'al_corregir') AS Modo,
      COALESCE(PR.Acceso,'libre') AS AccesoPolitica,
      PR.VentanaDesde,PR.VentanaHasta,COALESCE(PR.Revision,0) AS RevisionPolitica,
      PE.Id AS IdPermiso,PE.Estado AS EstadoPermiso,PE.Acceso AS AccesoPermiso,
      PE.FechaDesde AS PermisoDesde,PE.FechaHasta AS PermisoHasta,
      CU.IdIntento AS IdConsumoUnico,
      SYSUTCDATETIME() AS FechaServidor
    FROM dbo.Intento I ${lock}
    LEFT JOIN dbo.IntentoValidoOverride IVO
      ON IVO.IdPublicacion=I.IdPublicacion AND IVO.IdAlumno=I.IdAlumno
    OUTER APPLY (
      SELECT TOP (1) IV.Id AS IdIntento
      FROM dbo.Intento IV
      WHERE IV.IdPublicacion=I.IdPublicacion AND IV.IdAlumno=I.IdAlumno
        AND IV.Estado='entregado'
      ORDER BY IV.FechaFin DESC,IV.NumeroIntento DESC,IV.Id DESC
    ) IA
    LEFT JOIN dbo.PoliticaRevisionPublicacion PR ON PR.IdPublicacion=I.IdPublicacion
    LEFT JOIN dbo.PermisoRevisionIntento PE ON PE.IdIntento=I.Id
    LEFT JOIN dbo.ConsumoRevisionUnicaIntento CU ON CU.IdIntento=I.Id
    WHERE I.Id=@Intento`, { Intento: idIntento });
  const row = result.recordset[0] as ScopeRevision | undefined;
  if (!row) throw new BancoError(404, 'Intento no encontrado', 'ATTEMPT_NOT_FOUND');
  return row;
}

export function evaluarScopeRevision(scope: ScopeRevision): DisponibilidadRevision {
  const now = instant(scope.FechaServidor)!;
  const base = {
    IdIntento: Number(scope.IdIntento),
    IdPublicacion: Number(scope.IdPublicacion),
    Modo: scope.Modo,
    RevisionPolitica: Number(scope.RevisionPolitica),
    IdPermiso: scope.IdPermiso == null ? null : Number(scope.IdPermiso),
    EsIntentoValido: Number(scope.IdIntentoValido) === Number(scope.IdIntento),
    DuracionSesionSegundos: DURACION_SESION_SEGUNDOS,
    AccesoUnicoConsumido: scope.IdConsumoUnico != null,
  };
  const denied = (Motivo: string): DisponibilidadRevision => ({
    ...base, RevisionDisponible: false, Motivo, Acceso: null, Origen: null,
    DisponibleDesde: null, DisponibleHasta: null,
  });
  const allowed = (
    Motivo: string,
    Acceso: 'unico' | 'libre',
    Origen: 'individual' | 'general',
    DisponibleDesde: Date | string | null,
    DisponibleHasta: Date | string | null,
  ): DisponibilidadRevision => {
    const result = {
      ...base, RevisionDisponible: true, Motivo, Acceso, Origen,
      DisponibleDesde, DisponibleHasta,
    };
    if (Acceso === 'unico' && base.AccesoUnicoConsumido) {
      return { ...result, RevisionDisponible: false, Motivo: 'UNIQUE_ACCESS_CONSUMED' };
    }
    return result;
  };

  if (scope.EstadoIntento !== 'entregado') return denied('ATTEMPT_NOT_DELIVERED');
  if (!Boolean(scope.CorreccionConfirmada)) return denied('CORRECTION_NOT_CONFIRMED');
  if (scope.Modo === 'nunca') return denied('POLICY_NEVER');
  if (scope.EstadoPermiso === 'revocado') return denied('INDIVIDUAL_PERMISSION_REVOKED');

  const permisoActivo = scope.EstadoPermiso === 'activo'
    && (instant(scope.PermisoDesde) === null || instant(scope.PermisoDesde)! <= now)
    && (instant(scope.PermisoHasta) === null || now < instant(scope.PermisoHasta)!);
  if (permisoActivo) return allowed(
    'INDIVIDUAL_PERMISSION_ACTIVE', scope.AccesoPermiso ?? 'libre', 'individual',
    scope.PermisoDesde, scope.PermisoHasta,
  );

  if (scope.Modo === 'manual') return denied('POLICY_MANUAL');
  if (!base.EsIntentoValido) return denied('NOT_CURRENT_VALID_ATTEMPT');
  if (scope.Modo === 'ventana') {
    if (instant(scope.VentanaDesde)! > now) return denied('POLICY_WINDOW_NOT_STARTED');
    if (instant(scope.VentanaHasta)! <= now) return denied('POLICY_WINDOW_EXPIRED');
    return allowed(
      'POLICY_ALLOWED', scope.AccesoPolitica, 'general',
      scope.VentanaDesde, scope.VentanaHasta,
    );
  }
  return allowed('POLICY_ALLOWED', scope.AccesoPolitica, 'general', null, null);
}

function errorDisponibilidad(disponibilidad: DisponibilidadRevision): ErrorRevision {
  if (disponibilidad.Motivo === 'POLICY_NEVER') return {
    status: 409,
    message: 'La política de la publicación no permite revisiones',
    code: 'REVIEW_POLICY_NEVER',
  };
  if (disponibilidad.Motivo === 'UNIQUE_ACCESS_CONSUMED') return {
    status: 409,
    message: 'El acceso único de este intento ya fue consumido',
    code: 'REVIEW_ACCESS_ALREADY_CONSUMED',
  };
  return {
    status: 409,
    message: 'La revisión del intento no está disponible',
    code: 'REVIEW_NOT_AVAILABLE',
  };
}

async function autorizarIntentoGestion(db: DbBanco, actor: ActorBanco, idIntento: number) {
  const row = (await consultar(db, 'SELECT IdPublicacion FROM dbo.Intento WHERE Id=@Intento',
    { Intento: idIntento })).recordset[0];
  if (!row) throw new BancoError(404, 'Intento no encontrado', 'ATTEMPT_NOT_FOUND');
  await autorizarPublicacion(db, actor, Number(row.IdPublicacion), true);
  return Number(row.IdPublicacion);
}

export async function obtenerPoliticaRevision(actor: ActorBanco, idPublicacion: number) {
  await autorizarPublicacion(pool, actor, idPublicacion, false);
  const row = (await consultar(pool, `SELECT IdPublicacion,Modo,Acceso,VentanaDesde,VentanaHasta,
    Revision,ModificadoPor,FechaModificacion FROM dbo.PoliticaRevisionPublicacion
    WHERE IdPublicacion=@Publicacion`, { Publicacion: idPublicacion })).recordset[0];
  return row ?? {
    IdPublicacion: idPublicacion, Modo: 'al_corregir', Acceso: 'libre',
    VentanaDesde: null, VentanaHasta: null, Revision: 0,
    ModificadoPor: null, FechaModificacion: null,
  };
}

export async function actualizarPoliticaRevision(
  actor: ActorBanco,
  idPublicacion: number,
  input: PoliticaRevisionInput,
) {
  if (!actor.id) throw new BancoError(403, 'No se pudo identificar al usuario', 'FORBIDDEN');
  return atomico(async tx => {
    await autorizarPublicacion(tx, actor, idPublicacion, true);
    const actual = (await consultar(tx, `SELECT IdPublicacion,Modo,Acceso,VentanaDesde,VentanaHasta,Revision
      FROM dbo.PoliticaRevisionPublicacion WITH (UPDLOCK,HOLDLOCK)
      WHERE IdPublicacion=@Publicacion`, { Publicacion: idPublicacion })).recordset[0];
    const desde = input.VentanaDesde ?? null;
    const hasta = input.VentanaHasta ?? null;
    const coincide = actual && actual.Modo === input.Modo && actual.Acceso === input.Acceso
      && mismoInstante(actual.VentanaDesde, desde) && mismoInstante(actual.VentanaHasta, hasta);
    if (actual && Number(actual.Revision) !== input.RevisionEsperada) {
      if (coincide) return { ...actual, Replay: true };
      throw new BancoError(409, 'La política cambió; recargar antes de continuar', 'REVIEW_POLICY_REVISION_CONFLICT');
    }
    if (!actual && input.RevisionEsperada !== 0) {
      throw new BancoError(409, 'La política cambió; recargar antes de continuar', 'REVIEW_POLICY_REVISION_CONFLICT');
    }

    const result = actual
      ? await consultar(tx, `UPDATE dbo.PoliticaRevisionPublicacion SET
          Modo=@Modo,Acceso=@Acceso,
          VentanaDesde=CAST(@Desde AS datetime2(3)),VentanaHasta=CAST(@Hasta AS datetime2(3)),
          Revision=Revision+1,ModificadoPor=@Usuario,FechaModificacion=SYSUTCDATETIME()
        OUTPUT inserted.* WHERE IdPublicacion=@Publicacion AND Revision=@Revision`, {
        Publicacion: idPublicacion, Modo: input.Modo, Acceso: input.Acceso,
        Desde: desde, Hasta: hasta, Usuario: actor.id, Revision: input.RevisionEsperada,
      })
      : await consultar(tx, `INSERT INTO dbo.PoliticaRevisionPublicacion
          (IdPublicacion,Modo,Acceso,VentanaDesde,VentanaHasta,Revision,ModificadoPor)
        OUTPUT inserted.* VALUES(@Publicacion,@Modo,@Acceso,CAST(@Desde AS datetime2(3)),
          CAST(@Hasta AS datetime2(3)),1,@Usuario)`, {
        Publicacion: idPublicacion, Modo: input.Modo, Acceso: input.Acceso,
        Desde: desde, Hasta: hasta, Usuario: actor.id,
      });
    const updated = result.recordset[0];
    if (!updated) throw new BancoError(409, 'La política cambió; recargar antes de continuar', 'REVIEW_POLICY_REVISION_CONFLICT');
    await auditar(tx, { publicacion: idPublicacion, actor, accion: 'politica_actualizada',
      detalle: { anterior: actual ? { modo: actual.Modo, acceso: actual.Acceso, revision: actual.Revision } : null,
        actual: { modo: updated.Modo, acceso: updated.Acceso, revision: updated.Revision } } });
    return { ...updated, Replay: false };
  });
}

export async function otorgarPermisoRevision(actor: ActorBanco, idIntento: number, input: PermisoRevisionInput) {
  if (!actor.id) throw new BancoError(403, 'No se pudo identificar al usuario', 'FORBIDDEN');
  const outcome = await atomico(async tx => {
    const idPublicacion = await autorizarIntentoGestion(tx, actor, idIntento);
    const politica = (await consultar(tx, `SELECT COALESCE(Modo,'al_corregir') AS Modo
      FROM dbo.PoliticaRevisionPublicacion WITH (UPDLOCK,HOLDLOCK)
      WHERE IdPublicacion=@Publicacion`, { Publicacion: idPublicacion })).recordset[0];
    if (politica?.Modo === 'nunca') {
      const error: ErrorRevision = {
        status: 409,
        message: 'La política de la publicación no permite permisos de revisión',
        code: 'REVIEW_POLICY_NEVER',
      };
      await auditar(tx, { publicacion: idPublicacion, intento: idIntento, actor,
        accion: 'permiso_denegado_nunca', detalle: { revisionEsperada: input.RevisionEsperada } });
      return { error };
    }
    const actual = (await consultar(tx, `SELECT * FROM dbo.PermisoRevisionIntento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdIntento=@Intento`, { Intento: idIntento })).recordset[0];
    const desde = input.FechaDesde ?? null;
    const hasta = input.FechaHasta ?? null;
    const coincide = actual && actual.Estado === 'activo' && actual.Acceso === input.Acceso
      && mismoInstante(actual.FechaDesde, desde) && mismoInstante(actual.FechaHasta, hasta)
      && (actual.Motivo ?? null) === (input.Motivo ?? null);
    if (actual && Number(actual.Revision) !== input.RevisionEsperada) {
      if (coincide) return { data: { ...actual, Replay: true } };
      throw new BancoError(409, 'El permiso cambió; recargar antes de continuar', 'REVIEW_PERMISSION_REVISION_CONFLICT');
    }
    if (!actual && input.RevisionEsperada !== 0) {
      throw new BancoError(409, 'El permiso cambió; recargar antes de continuar', 'REVIEW_PERMISSION_REVISION_CONFLICT');
    }
    const result = actual
      ? await consultar(tx, `UPDATE dbo.PermisoRevisionIntento SET Estado='activo',Acceso=@Acceso,
          FechaDesde=CAST(@Desde AS datetime2(3)),FechaHasta=CAST(@Hasta AS datetime2(3)),
          Motivo=@Motivo,Revision=Revision+1,ModificadoPor=@Usuario,FechaModificacion=SYSUTCDATETIME()
        OUTPUT inserted.* WHERE IdIntento=@Intento AND Revision=@Revision`, {
        Intento: idIntento, Acceso: input.Acceso, Desde: desde, Hasta: hasta,
        Motivo: input.Motivo ?? null, Usuario: actor.id, Revision: input.RevisionEsperada,
      })
      : await consultar(tx, `INSERT INTO dbo.PermisoRevisionIntento
          (IdIntento,Estado,Acceso,FechaDesde,FechaHasta,Motivo,Revision,ModificadoPor)
        OUTPUT inserted.* VALUES(@Intento,'activo',@Acceso,CAST(@Desde AS datetime2(3)),
          CAST(@Hasta AS datetime2(3)),@Motivo,1,@Usuario)`, {
        Intento: idIntento, Acceso: input.Acceso, Desde: desde, Hasta: hasta,
        Motivo: input.Motivo ?? null, Usuario: actor.id,
      });
    const updated = result.recordset[0];
    if (!updated) throw new BancoError(409, 'El permiso cambió; recargar antes de continuar', 'REVIEW_PERMISSION_REVISION_CONFLICT');
    await auditar(tx, { publicacion: idPublicacion, intento: idIntento, actor,
      accion: actual?.Estado === 'revocado' ? 'permiso_reactivado' : 'permiso_otorgado',
      detalle: { acceso: updated.Acceso, revision: updated.Revision,
        fechaDesde: updated.FechaDesde, fechaHasta: updated.FechaHasta } });
    return { data: { ...updated, Replay: false } };
  });
  if ('error' in outcome && outcome.error) {
    throw new BancoError(outcome.error.status, outcome.error.message, outcome.error.code);
  }
  return outcome.data;
}

export async function revocarPermisoRevision(actor: ActorBanco, idIntento: number) {
  if (!actor.id) throw new BancoError(403, 'No se pudo identificar al usuario', 'FORBIDDEN');
  return atomico(async tx => {
    const idPublicacion = await autorizarIntentoGestion(tx, actor, idIntento);
    const actual = (await consultar(tx, `SELECT * FROM dbo.PermisoRevisionIntento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdIntento=@Intento`, { Intento: idIntento })).recordset[0];
    if (actual?.Estado === 'revocado') return { ...actual, Replay: true };
    const acceso = actual?.Acceso ?? (await consultar(tx, `SELECT COALESCE(Acceso,'libre') AS Acceso
      FROM dbo.PoliticaRevisionPublicacion WHERE IdPublicacion=@Publicacion`,
    { Publicacion: idPublicacion })).recordset[0]?.Acceso ?? 'libre';
    const result = actual
      ? await consultar(tx, `UPDATE dbo.PermisoRevisionIntento SET Estado='revocado',Revision=Revision+1,
          ModificadoPor=@Usuario,FechaModificacion=SYSUTCDATETIME()
        OUTPUT inserted.* WHERE IdIntento=@Intento`, { Intento: idIntento, Usuario: actor.id })
      : await consultar(tx, `INSERT INTO dbo.PermisoRevisionIntento
          (IdIntento,Estado,Acceso,Revision,ModificadoPor)
        OUTPUT inserted.* VALUES(@Intento,'revocado',@Acceso,1,@Usuario)`,
      { Intento: idIntento, Acceso: acceso, Usuario: actor.id });
    const updated = result.recordset[0];

    await consultar(tx, `INSERT INTO dbo.AuditoriaRevisionIntento
        (IdPublicacion,IdIntento,IdSesion,IdUsuario,ActorRol,Accion,Detalle)
      SELECT @Publicacion,@Intento,S.Id,@Usuario,@Rol,'sesion_revocada',NULL
      FROM dbo.SesionRevisionIntento S
      WHERE S.IdIntento=@Intento AND S.Estado='emitida' AND S.FechaExpiracion>SYSUTCDATETIME();
      UPDATE dbo.SesionRevisionIntento SET Estado='revocada',EsActivaUnica=0
      WHERE IdIntento=@Intento AND Estado='emitida';`, {
      Publicacion: idPublicacion, Intento: idIntento, Usuario: actor.id, Rol: actor.role,
    });
    await auditar(tx, { publicacion: idPublicacion, intento: idIntento, actor,
      accion: 'permiso_revocado', detalle: { revision: updated.Revision } });
    return { ...updated, Replay: false };
  });
}

export async function listarPermisosRevision(
  actor: ActorBanco,
  idPublicacion: number,
  filters: PermisosRevisionQuery,
) {
  await autorizarPublicacion(pool, actor, idPublicacion, false);
  const estado = filters.estado ? 'AND PR.Estado=@Estado' : '';
  const alumno = filters.idAlumno ? 'AND I.IdAlumno=@Alumno' : '';
  const params: Record<string, string | number | boolean | null> = { Publicacion: idPublicacion };
  if (filters.estado) params.Estado = filters.estado;
  if (filters.idAlumno) params.Alumno = filters.idAlumno;
  return (await consultar(pool, `SELECT PR.Id,PR.IdIntento,I.IdAlumno,AL.Nombre,AL.Apellido,
      PR.Estado,PR.Acceso,PR.FechaDesde,PR.FechaHasta,PR.Motivo,PR.Revision,
      PR.ModificadoPor,PR.FechaModificacion
    FROM dbo.PermisoRevisionIntento PR
    JOIN dbo.Intento I ON I.Id=PR.IdIntento
    JOIN dbo.Alumno AL ON AL.Matricula=I.IdAlumno
    WHERE I.IdPublicacion=@Publicacion ${estado} ${alumno}
    ORDER BY PR.FechaModificacion DESC,PR.Id DESC`, params)).recordset;
}

export async function listarAuditoriaRevision(
  actor: ActorBanco,
  idPublicacion: number,
  filters: AuditoriaRevisionQuery,
) {
  await autorizarPublicacion(pool, actor, idPublicacion, false);
  const intento = filters.idIntento ? 'AND IdIntento=@Intento' : '';
  const accion = filters.accion ? 'AND Accion=@Accion' : '';
  const params: Record<string, string | number | boolean | null> = {
    Publicacion: idPublicacion,
    Offset: (filters.pagina - 1) * filters.limite,
    Limite: filters.limite,
  };
  if (filters.idIntento) params.Intento = filters.idIntento;
  if (filters.accion) params.Accion = filters.accion;
  const result = await consultar(pool, `SELECT Id,IdPublicacion,IdIntento,IdSesion,IdUsuario,
      ActorRol,Accion,Detalle,Fecha
    FROM dbo.AuditoriaRevisionIntento
    WHERE IdPublicacion=@Publicacion ${intento} ${accion}
    ORDER BY Fecha DESC,Id DESC OFFSET @Offset ROWS FETCH NEXT @Limite ROWS ONLY;
    SELECT COUNT(*) AS Total FROM dbo.AuditoriaRevisionIntento
    WHERE IdPublicacion=@Publicacion ${intento} ${accion};`, params);
  const sets = (result as any).recordsets ?? [result.recordset, []];
  const items = (sets[0] ?? []).map((row: any) => {
    let detalle: unknown = null;
    if (row.Detalle) {
      try { detalle = JSON.parse(row.Detalle); } catch { detalle = null; }
    }
    return { ...row, Detalle: detalle };
  });
  const total = Number(sets[1]?.[0]?.Total ?? 0);
  return {
    items,
    pagination: {
      page: filters.pagina, limit: filters.limite, total,
      totalPages: total === 0 ? 0 : Math.ceil(total / filters.limite),
    },
  };
}

async function autorizarConsultaDisponibilidad(db: DbBanco, actor: ActorBanco, scope: ScopeRevision) {
  if (actor.role === 'alumno') {
    if (!actor.idAlumno || Number(actor.idAlumno) !== Number(scope.IdAlumno)) {
      throw new BancoError(403, 'No puede consultar la revisión de otro alumno', 'REVIEW_SCOPE_FORBIDDEN');
    }
    return;
  }
  await autorizarPublicacion(db, actor, Number(scope.IdPublicacion), false);
}

export async function consultarDisponibilidadRevision(actor: ActorBanco, idIntento: number) {
  const scope = await obtenerScopeRevision(pool, idIntento);
  await autorizarConsultaDisponibilidad(pool, actor, scope);
  return evaluarScopeRevision(scope);
}

export async function evaluarDisponibilidadRevisionEnDb(db: DbBanco, idIntento: number) {
  return evaluarScopeRevision(await obtenerScopeRevision(db, idIntento));
}

export async function emitirSesionRevision(actor: ActorBanco, idIntento: number, key: string) {
  if (actor.role !== 'alumno' || !actor.id || !actor.idAlumno) {
    throw new BancoError(403, 'Sólo el alumno titular puede abrir una sesión', 'REVIEW_SCOPE_FORBIDDEN');
  }
  const outcome = await atomico(async tx => {
    const scope = await obtenerScopeRevision(tx, idIntento, true);
    await autorizarConsultaDisponibilidad(tx, actor, scope);
    const idem = await iniciarIdempotencia(tx, actor, `revision.${idIntento}.sesion`, key, { idIntento });
    if (idem.replay) {
      const replay = idem.result as { error?: ErrorRevision } | null;
      if (replay?.error) return { error: replay.error };
      return { data: idem.result, status: idem.status };
    }

    const disponibilidad = evaluarScopeRevision(scope);
    if (!disponibilidad.RevisionDisponible || !disponibilidad.Acceso) {
      const error = errorDisponibilidad(disponibilidad);
      if (error.code === 'REVIEW_POLICY_NEVER' || error.code === 'REVIEW_ACCESS_ALREADY_CONSUMED') {
        await auditar(tx, { publicacion: scope.IdPublicacion, intento: idIntento, actor,
          accion: error.code === 'REVIEW_POLICY_NEVER'
            ? 'emision_denegada_nunca' : 'emision_denegada_unico',
          detalle: { idempotencyKey: key, motivo: disponibilidad.Motivo } });
      }
      await completarIdempotencia(tx, idem.id, { error }, error.status);
      return { error };
    }

    if (disponibilidad.Acceso === 'unico') {
      const existente = (await consultar(tx, `SELECT TOP (1) * FROM dbo.SesionRevisionIntento WITH (UPDLOCK,HOLDLOCK)
        WHERE IdIntento=@Intento AND EsActivaUnica=1 ORDER BY FechaEmision DESC`,
      { Intento: idIntento })).recordset[0];
      if (existente && instant(existente.FechaExpiracion)! <= instant(scope.FechaServidor)!) {
        await consultar(tx, `UPDATE dbo.SesionRevisionIntento SET Estado='expirada',EsActivaUnica=0
          WHERE Id=@Sesion AND EsActivaUnica=1`, { Sesion: String(existente.Id) });
        await auditar(tx, { publicacion: scope.IdPublicacion, intento: idIntento,
          sesion: String(existente.Id), accion: 'sesion_expirada' });
      } else if (existente) {
        const reused = {
          IdSesion: existente.Id, IdIntento: idIntento, Acceso: existente.AccesoSnapshot,
          FechaEmision: existente.FechaEmision, FechaExpiracion: existente.FechaExpiracion,
          Reutilizada: true,
        };
        await auditar(tx, { publicacion: scope.IdPublicacion, intento: idIntento,
          sesion: String(existente.Id), actor, accion: 'sesion_reutilizada' });
        await completarIdempotencia(tx, idem.id, reused, 200);
        return { data: reused, status: 200 };
      }
    }

    const emisionMs = instant(scope.FechaServidor)!;
    const maximaMs = emisionMs + DURACION_SESION_SEGUNDOS * 1000;
    const limiteMs = instant(disponibilidad.DisponibleHasta);
    const expiracionMs = limiteMs === null ? maximaMs : Math.min(maximaMs, limiteMs);
    if (expiracionMs <= emisionMs) {
      const error = errorDisponibilidad({
        ...disponibilidad, RevisionDisponible: false, Motivo: 'EFFECTIVE_WINDOW_EXPIRED',
      });
      await completarIdempotencia(tx, idem.id, { error }, error.status);
      return { error };
    }
    const limitadaPor = limiteMs !== null && limiteMs < maximaMs
      ? (disponibilidad.Origen === 'individual' ? 'permiso' : 'ventana')
      : 'duracion';
    const idSesion = crypto.randomUUID();
    const inserted = (await consultar(tx, `INSERT INTO dbo.SesionRevisionIntento
      (Id,IdIntento,IdUsuario,ModoPoliticaSnapshot,AccesoSnapshot,RevisionPoliticaSnapshot,
       IdPermisoSnapshot,Estado,EsActivaUnica,FechaEmision,FechaExpiracion,
       DisponibleDesdeSnapshot,DisponibleHastaSnapshot,ExpiracionLimitadaPor)
      OUTPUT inserted.Id AS IdSesion,inserted.IdIntento,inserted.AccesoSnapshot AS Acceso,
        inserted.FechaEmision,inserted.FechaExpiracion
      VALUES(@Sesion,@Intento,@Usuario,@Modo,@Acceso,@Revision,@Permiso,'emitida',@ActivaUnica,
        CAST(@Emision AS datetime2(3)),CAST(@Expiracion AS datetime2(3)),
        CAST(@DisponibleDesde AS datetime2(3)),CAST(@DisponibleHasta AS datetime2(3)),@LimitadaPor)`, {
      Sesion: idSesion, Intento: idIntento, Usuario: actor.id, Modo: disponibilidad.Modo,
      Acceso: disponibilidad.Acceso, Revision: disponibilidad.RevisionPolitica,
      Permiso: disponibilidad.IdPermiso, ActivaUnica: disponibilidad.Acceso === 'unico',
      Emision: new Date(emisionMs).toISOString(), Expiracion: new Date(expiracionMs).toISOString(),
      DisponibleDesde: disponibilidad.DisponibleDesde == null
        ? null : new Date(instant(disponibilidad.DisponibleDesde)!).toISOString(),
      DisponibleHasta: disponibilidad.DisponibleHasta == null
        ? null : new Date(instant(disponibilidad.DisponibleHasta)!).toISOString(),
      LimitadaPor: limitadaPor,
    })).recordset[0];
    const data = { ...inserted, Reutilizada: false };
    await auditar(tx, { publicacion: scope.IdPublicacion, intento: idIntento,
      sesion: idSesion, actor, accion: 'sesion_emitida',
      detalle: { acceso: disponibilidad.Acceso, origen: disponibilidad.Origen,
        revisionPolitica: disponibilidad.RevisionPolitica, limitadaPor,
        disponibleDesde: disponibilidad.DisponibleDesde,
        disponibleHasta: disponibilidad.DisponibleHasta,
        fechaExpiracion: new Date(expiracionMs).toISOString() } });
    await completarIdempotencia(tx, idem.id, data, 201);
    return { data, status: 201 };
  });
  if ('error' in outcome && outcome.error) {
    throw new BancoError(outcome.error.status, outcome.error.message, outcome.error.code);
  }
  return outcome;
}

async function construirContenidoRevision(db: DbBanco, idIntento: number) {
  const header = (await consultar(db, `SELECT I.Id AS IdIntento,I.IdPublicacion,I.Estado,
      I.NotaFinal,I.NotaAutomatica,I.NotaFinalCalculada,I.NotaFinalManual,
      I.FechaInicio,I.FechaFin,I.NumeroIntento,I.CorreccionConfirmada,
      A.Titulo AS TituloEvaluacion,A.EscalaCalificacion,A.NotaAprobacion
    FROM dbo.Intento I JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
    JOIN dbo.Actividad A ON A.Id=P.IdActividad WHERE I.Id=@Intento`,
  { Intento: idIntento })).recordset[0];
  const rows = (await consultar(db, `SELECT IP.Id AS IdIntentoPregunta,IP.IdPregunta,
      IP.EnunciadoSnapshot AS Enunciado,IP.TipoSnapshot AS Tipo,
      IP.GrupoTituloSnapshot AS Grupo,IP.ModoJustificacionSnapshot AS ModoJustificacion,
      IP.EstrategiaCorreccionSnapshot AS EstrategiaCorreccion,
      IP.PuntajeMaximoSnapshot,IP.PuntajeObtenido,IP.OrigenCorreccion,
      IP.PuntajeAutomaticoOpciones,IP.ComentariosDocente,
      R.Id AS IdRespuesta,R.RtaTexto,R.Justificacion,R.EsCorrecta AS RespuestaEsCorrecta,
      S.IdOpcionOrigen AS IdOpcion,S.TextoSnapshot AS OpcionTexto,
      S.EsCorrectaSnapshot AS EsCorrecta,
      CAST(CASE WHEN RO.IdOpcion IS NULL THEN 0 ELSE 1 END AS bit) AS FueSeleccionada
    FROM dbo.IntentoPregunta IP
    LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
    LEFT JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
    LEFT JOIN dbo.RespuestaOpcion RO ON RO.IdRespuesta=R.Id AND RO.IdOpcion=S.IdOpcionOrigen
    WHERE IP.IdIntento=@Intento ORDER BY IP.Id,S.Posicion`, { Intento: idIntento })).recordset;
  const preguntas = new Map<number, any>();
  for (const row of rows) {
    const key = Number(row.IdIntentoPregunta);
    if (!preguntas.has(key)) preguntas.set(key, {
      idIntentoPregunta: key,
      idPregunta: row.IdPregunta,
      enunciado: row.Enunciado,
      tipo: row.Tipo,
      grupo: row.Grupo,
      modoJustificacion: row.ModoJustificacion,
      estrategiaCorreccion: row.EstrategiaCorreccion,
      puntajeMaximo: row.PuntajeMaximoSnapshot,
      puntajeObtenido: row.PuntajeObtenido,
      puntajeAutomaticoOpciones: row.PuntajeAutomaticoOpciones,
      origenCorreccion: row.OrigenCorreccion,
      comentariosDocente: row.ComentariosDocente,
      respuesta: row.IdRespuesta == null ? null : {
        idRespuesta: row.IdRespuesta,
        rtaTexto: row.RtaTexto,
        justificacion: row.Justificacion,
        esCorrecta: row.RespuestaEsCorrecta,
      },
      opciones: [],
    });
    if (row.IdOpcion != null) preguntas.get(key).opciones.push({
      idOpcion: row.IdOpcion,
      texto: row.OpcionTexto,
      esCorrecta: Boolean(row.EsCorrecta),
      fueSeleccionada: Boolean(row.FueSeleccionada),
    });
  }
  return { ...mapKeysToCamelCase(header), preguntas: [...preguntas.values()] };
}

export async function consumirContenidoRevision(actor: ActorBanco, idSesion: string) {
  if (actor.role !== 'alumno' || !actor.id || !actor.idAlumno) {
    throw new BancoError(403, 'Sólo el alumno titular puede consumir una sesión', 'REVIEW_SCOPE_FORBIDDEN');
  }
  const outcome = await atomico(async tx => {
    const referencia = (await consultar(tx, `SELECT IdIntento FROM dbo.SesionRevisionIntento
      WHERE Id=@Sesion`, { Sesion: idSesion })).recordset[0];
    if (!referencia) return {
      error: new BancoError(404, 'Sesión de revisión no encontrada', 'REVIEW_SESSION_NOT_FOUND'),
    };
    await consultar(tx, `SELECT Id FROM dbo.Intento WITH (UPDLOCK,HOLDLOCK)
      WHERE Id=@Intento`, { Intento: Number(referencia.IdIntento) });
    const session = (await consultar(tx, `SELECT S.*,I.IdAlumno,I.IdPublicacion,I.CorreccionConfirmada,
        SYSUTCDATETIME() AS FechaServidor,PE.Estado AS EstadoPermisoActual
      FROM dbo.SesionRevisionIntento S WITH (UPDLOCK,HOLDLOCK)
      JOIN dbo.Intento I ON I.Id=S.IdIntento
      LEFT JOIN dbo.PermisoRevisionIntento PE ON PE.Id=S.IdPermisoSnapshot
      WHERE S.Id=@Sesion`, { Sesion: idSesion })).recordset[0];
    if (!session) return { error: new BancoError(404, 'Sesión de revisión no encontrada', 'REVIEW_SESSION_NOT_FOUND') };
    if (Number(session.IdAlumno) !== Number(actor.idAlumno) || Number(session.IdUsuario) !== Number(actor.id)) {
      return { error: new BancoError(403, 'La sesión no pertenece al alumno', 'REVIEW_SCOPE_FORBIDDEN') };
    }
    if (!Boolean(session.CorreccionConfirmada)) {
      return { error: new BancoError(409, 'La corrección volvió a quedar pendiente', 'REVIEW_NOT_AVAILABLE') };
    }
    if (session.Estado === 'revocada' || session.EstadoPermisoActual === 'revocado') {
      if (session.Estado !== 'revocada') {
        await consultar(tx, `UPDATE dbo.SesionRevisionIntento SET Estado='revocada',EsActivaUnica=0
          WHERE Id=@Sesion`, { Sesion: idSesion });
        await auditar(tx, { publicacion: session.IdPublicacion, intento: session.IdIntento,
          sesion: idSesion, accion: 'sesion_revocada' });
      }
      return { error: new BancoError(409, 'La sesión fue revocada', 'REVIEW_SESSION_REVOKED') };
    }
    if (instant(session.FechaExpiracion)! <= instant(session.FechaServidor)!) {
      if (session.Estado === 'emitida') {
        await consultar(tx, `UPDATE dbo.SesionRevisionIntento SET Estado='expirada',EsActivaUnica=0
          WHERE Id=@Sesion`, { Sesion: idSesion });
        await auditar(tx, { publicacion: session.IdPublicacion, intento: session.IdIntento,
          sesion: idSesion, accion: 'sesion_expirada' });
      }
      return { error: new BancoError(409, 'La sesión de revisión venció', 'REVIEW_SESSION_EXPIRED') };
    }
    if (session.AccesoSnapshot === 'unico' && session.Estado === 'consumida') {
      return { error: new BancoError(409, 'La sesión de revisión ya fue consumida', 'REVIEW_SESSION_CONSUMED') };
    }

    const primerConsumo = Number(session.CantidadConsumos) === 0;
    if (session.AccesoSnapshot === 'unico') {
      const consumoExistente = (await consultar(tx, `SELECT IdIntento FROM dbo.ConsumoRevisionUnicaIntento
        WITH (UPDLOCK,HOLDLOCK) WHERE IdIntento=@Intento`,
      { Intento: Number(session.IdIntento) })).recordset[0];
      if (consumoExistente) {
        return { error: new BancoError(409, 'El acceso único ya fue consumido', 'REVIEW_SESSION_CONSUMED') };
      }
      const changed = await consultar(tx, `UPDATE dbo.SesionRevisionIntento
        SET Estado='consumida',EsActivaUnica=0,FechaPrimerConsumo=SYSUTCDATETIME(),
          FechaUltimoConsumo=SYSUTCDATETIME(),CantidadConsumos=1
        OUTPUT inserted.Id WHERE Id=@Sesion AND Estado='emitida' AND EsActivaUnica=1`, { Sesion: idSesion });
      if (!changed.recordset.length) {
        return { error: new BancoError(409, 'La sesión de revisión ya fue consumida', 'REVIEW_SESSION_CONSUMED') };
      }
      await consultar(tx, `INSERT INTO dbo.ConsumoRevisionUnicaIntento
        (IdIntento,IdSesion,IdUsuario,FechaConsumo,Origen)
        VALUES(@Intento,@Sesion,@Usuario,SYSUTCDATETIME(),'runtime')`, {
        Intento: Number(session.IdIntento), Sesion: idSesion, Usuario: actor.id,
      });
    } else {
      await consultar(tx, `UPDATE dbo.SesionRevisionIntento SET
        FechaPrimerConsumo=COALESCE(FechaPrimerConsumo,SYSUTCDATETIME()),
        FechaUltimoConsumo=SYSUTCDATETIME(),CantidadConsumos=CantidadConsumos+1
        WHERE Id=@Sesion AND Estado='emitida'`, { Sesion: idSesion });
    }
    if (primerConsumo) await auditar(tx, { publicacion: session.IdPublicacion,
      intento: session.IdIntento, sesion: idSesion, actor, accion: 'sesion_abierta' });
    await auditar(tx, { publicacion: session.IdPublicacion, intento: session.IdIntento,
      sesion: idSesion, actor,
      accion: session.AccesoSnapshot === 'unico' ? 'sesion_consumida' : 'contenido_consultado' });
    const contenido = await construirContenidoRevision(tx, Number(session.IdIntento));
    return { data: { idSesion, acceso: session.AccesoSnapshot, contenido } };
  });
  if ('error' in outcome && outcome.error) throw outcome.error;
  return outcome.data;
}

