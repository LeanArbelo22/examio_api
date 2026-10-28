import { ActorBanco, BancoError, DbBanco, consultar } from './banco-common.service';
import { autorizarPublicacion } from './evaluacion-access.service';

type ActorIntentoValido = ActorBanco & { idAlumno?: number | null };

type IntentoSeleccionable = Record<string, unknown> & {
  IdIntento: number;
  Estado: string;
  FechaFin: Date | string | null;
  NumeroIntento: number;
};

const fechaOrden = (value: Date | string | null): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

export function resolverIntentoValido<T extends IntentoSeleccionable>(
  intentos: T[],
  idOverride: number | null,
): Array<T & { EsIntentoValido: boolean; SeleccionIntentoValido: 'automatica' | 'manual' | null }> {
  const entregados = intentos.filter(intento => intento.Estado === 'entregado');
  const override = idOverride === null
    ? undefined
    : entregados.find(intento => Number(intento.IdIntento) === idOverride);
  if (idOverride !== null && !override) {
    throw new BancoError(409, 'El override de intento válido es inconsistente', 'ATTEMPT_SELECTION_INVALID');
  }

  const automatico = [...entregados].sort((a, b) =>
    fechaOrden(b.FechaFin) - fechaOrden(a.FechaFin)
      || Number(b.NumeroIntento) - Number(a.NumeroIntento)
      || Number(b.IdIntento) - Number(a.IdIntento)
  )[0];
  const seleccionado = override ?? automatico;
  const seleccion = override ? 'manual' : automatico ? 'automatica' : null;

  return intentos.map(intento => {
    const esValido = seleccionado !== undefined && Number(intento.IdIntento) === Number(seleccionado.IdIntento);
    return {
      ...intento,
      EsIntentoValido: esValido,
      SeleccionIntentoValido: esValido ? seleccion : null,
    };
  });
}

async function autorizarLectura(
  db: DbBanco,
  actor: ActorIntentoValido,
  idPublicacion: number,
  matricula: number,
) {
  if (actor.role === 'alumno') {
    if (!actor.idAlumno || actor.idAlumno !== matricula) {
      throw new BancoError(403, 'No puede consultar intentos de otro alumno', 'ATTEMPT_SCOPE_FORBIDDEN');
    }
    const publicacion = await consultar(db, 'SELECT Id FROM dbo.Publicacion WHERE Id=@Id', { Id: idPublicacion });
    if (!publicacion.recordset.length) throw new BancoError(404, 'Publicación no encontrada');
    return;
  }
  await autorizarPublicacion(db, actor, idPublicacion, false);
}

export async function listarIntentosPublicacion(
  db: DbBanco,
  actor: ActorIntentoValido,
  idPublicacion: number,
  matricula: number,
) {
  await autorizarLectura(db, actor, idPublicacion, matricula);
  const intentos = (await consultar(db, `
    SELECT I.Id AS IdIntento, I.IdPublicacion, I.IdAlumno, I.NumeroIntento, I.Estado,
           I.FechaInicio, I.FechaFin, I.NotaAutomatica, I.NotaFinalCalculada,
           I.NotaFinalManual, I.NotaFinal,
           A.EscalaCalificacion, A.NotaAprobacion,
           CASE WHEN I.Estado <> 'entregado' THEN NULL
                WHEN ISNULL(C.PendientesCorreccion, 0) > 0 THEN 'pendiente'
                ELSE 'completa' END AS EstadoCorreccion,
           ISNULL(C.PendientesCorreccion, 0) AS PreguntasPendientesCorreccion
    FROM dbo.Intento I
    JOIN dbo.Publicacion PU ON PU.Id=I.IdPublicacion
    JOIN dbo.Actividad A ON A.Id=PU.IdActividad
    OUTER APPLY (
      SELECT SUM(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS PendientesCorreccion
      FROM dbo.IntentoPregunta IP WHERE IP.IdIntento=I.Id
    ) C
    WHERE I.IdPublicacion=@Publicacion AND I.IdAlumno=@Alumno
    ORDER BY I.NumeroIntento DESC,I.FechaInicio DESC,I.Id DESC
  `, { Publicacion: idPublicacion, Alumno: matricula })).recordset as IntentoSeleccionable[];
  const override = (await consultar(db, `SELECT IdIntento FROM dbo.IntentoValidoOverride
    WHERE IdPublicacion=@Publicacion AND IdAlumno=@Alumno`,
  { Publicacion: idPublicacion, Alumno: matricula })).recordset[0];
  return resolverIntentoValido(intentos, override ? Number(override.IdIntento) : null);
}

export async function seleccionarIntentoValido(
  db: DbBanco,
  actor: ActorBanco,
  idPublicacion: number,
  matricula: number,
  idIntento: number,
) {
  await autorizarPublicacion(db, actor, idPublicacion, true);
  if (!Number.isInteger(actor.id) || !actor.id || actor.id <= 0) {
    throw new BancoError(403, 'No se pudo identificar al usuario', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
  const intento = (await consultar(db, `SELECT Id,Estado FROM dbo.Intento WITH (UPDLOCK,HOLDLOCK)
    WHERE Id=@Intento AND IdPublicacion=@Publicacion AND IdAlumno=@Alumno`,
  { Intento: idIntento, Publicacion: idPublicacion, Alumno: matricula })).recordset[0];
  if (!intento || intento.Estado !== 'entregado') {
    throw new BancoError(
      409,
      'El intento seleccionado debe estar entregado y pertenecer al alumno y publicación indicados',
      'ATTEMPT_SELECTION_INVALID',
    );
  }

  const existente = (await consultar(db, `SELECT IdIntento,FechaSeleccion
    FROM dbo.IntentoValidoOverride WITH (UPDLOCK,HOLDLOCK)
    WHERE IdPublicacion=@Publicacion AND IdAlumno=@Alumno`,
  { Publicacion: idPublicacion, Alumno: matricula })).recordset[0];
  if (existente && Number(existente.IdIntento) === idIntento) {
    return {
      IdPublicacion: idPublicacion, IdAlumno: matricula, IdIntento: idIntento,
      EsIntentoValido: true, SeleccionIntentoValido: 'manual', FechaSeleccion: existente.FechaSeleccion,
    };
  }

  if (existente) {
    await consultar(db, `UPDATE dbo.IntentoValidoOverride
      SET IdIntento=@Intento,SeleccionadoPor=@Usuario,FechaSeleccion=SYSUTCDATETIME()
      WHERE IdPublicacion=@Publicacion AND IdAlumno=@Alumno`,
    { Intento: idIntento, Usuario: actor.id, Publicacion: idPublicacion, Alumno: matricula });
  } else {
    await consultar(db, `INSERT INTO dbo.IntentoValidoOverride
      (IdPublicacion,IdAlumno,IdIntento,SeleccionadoPor)
      VALUES(@Publicacion,@Alumno,@Intento,@Usuario)`,
    { Publicacion: idPublicacion, Alumno: matricula, Intento: idIntento, Usuario: actor.id });
  }
  await consultar(db, `INSERT INTO dbo.HistorialIntentoValidoOverride
    (IdPublicacion,IdAlumno,IdIntento,Accion,ModificadoPor)
    VALUES(@Publicacion,@Alumno,@Intento,'seleccionado',@Usuario)`,
  { Publicacion: idPublicacion, Alumno: matricula, Intento: idIntento, Usuario: actor.id });
  const actualizado = (await consultar(db, `SELECT FechaSeleccion FROM dbo.IntentoValidoOverride
    WHERE IdPublicacion=@Publicacion AND IdAlumno=@Alumno`,
  { Publicacion: idPublicacion, Alumno: matricula })).recordset[0];
  return {
    IdPublicacion: idPublicacion, IdAlumno: matricula, IdIntento: idIntento,
    EsIntentoValido: true, SeleccionIntentoValido: 'manual', FechaSeleccion: actualizado?.FechaSeleccion,
  };
}

export async function eliminarSeleccionIntentoValido(
  db: DbBanco,
  actor: ActorBanco,
  idPublicacion: number,
  matricula: number,
) {
  await autorizarPublicacion(db, actor, idPublicacion, true);
  if (!Number.isInteger(actor.id) || !actor.id || actor.id <= 0) {
    throw new BancoError(403, 'No se pudo identificar al usuario', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
  const existente = (await consultar(db, `SELECT IdIntento FROM dbo.IntentoValidoOverride WITH (UPDLOCK,HOLDLOCK)
    WHERE IdPublicacion=@Publicacion AND IdAlumno=@Alumno`,
  { Publicacion: idPublicacion, Alumno: matricula })).recordset[0];
  if (existente) {
    await consultar(db, `DELETE FROM dbo.IntentoValidoOverride
      WHERE IdPublicacion=@Publicacion AND IdAlumno=@Alumno`,
    { Publicacion: idPublicacion, Alumno: matricula });
    await consultar(db, `INSERT INTO dbo.HistorialIntentoValidoOverride
      (IdPublicacion,IdAlumno,IdIntento,Accion,ModificadoPor)
      VALUES(@Publicacion,@Alumno,@Intento,'eliminado',@Usuario)`,
    { Publicacion: idPublicacion, Alumno: matricula, Intento: Number(existente.IdIntento), Usuario: actor.id });
  }
  const automatico = (await consultar(db, `SELECT TOP 1 Id FROM dbo.Intento
    WHERE IdPublicacion=@Publicacion AND IdAlumno=@Alumno AND Estado='entregado'
    ORDER BY FechaFin DESC,NumeroIntento DESC,Id DESC`,
  { Publicacion: idPublicacion, Alumno: matricula })).recordset[0];
  return {
    IdPublicacion: idPublicacion,
    IdAlumno: matricula,
    IdIntento: automatico ? Number(automatico.Id) : null,
    EsIntentoValido: Boolean(automatico),
    SeleccionIntentoValido: automatico ? 'automatica' : null,
  };
}
