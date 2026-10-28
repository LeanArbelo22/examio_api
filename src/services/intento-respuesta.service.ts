import { randomUUID } from 'crypto';
import * as sql from 'mssql';
import { ActorBanco, BancoError, atomico } from './banco-common.service';
import { pool } from '../config/db';

type GuardarRespuestaInput = {
  IdIntento: number;
  IdPregunta: number;
  IdOpcionNueva?: number | null;
  IdOpcionesSeleccionadas?: number[];
  RtaTexto?: string | null;
  Justificacion?: string | null;
  RevisionEsperada?: number;
  EventoId?: string;
};

type ContenidoRespuesta = {
  idsOpcionesSeleccionadas: number[];
  rtaTexto: string | null;
  justificacion: string | null;
};

type ScopeRespuesta = {
  IdIntentoPregunta: number;
  IdAlumno: number;
  Estado: string;
  Tipo: string;
  ModoJustificacion: string;
  IdRespuesta: number | null;
  RtaTexto: string | null;
  Justificacion: string | null;
  Revision: number;
};

const textoNullable = (value: string | null | undefined) =>
  value == null || value.trim().length === 0 ? null : value;

const contenidoCanonico = (contenido: ContenidoRespuesta): ContenidoRespuesta => ({
  idsOpcionesSeleccionadas: [...new Set(contenido.idsOpcionesSeleccionadas)].sort((a, b) => a - b),
  rtaTexto: textoNullable(contenido.rtaTexto),
  justificacion: textoNullable(contenido.justificacion),
});

const serializar = (contenido: ContenidoRespuesta) => JSON.stringify(contenidoCanonico(contenido));

const parsearContenido = (value: unknown): ContenidoRespuesta => {
  if (typeof value !== 'string') throw new BancoError(409, 'El evento guardado no puede reconstruirse', 'RESPONSE_EVENT_INVALID');
  const parsed = JSON.parse(value) as Partial<ContenidoRespuesta>;
  return contenidoCanonico({
    idsOpcionesSeleccionadas: Array.isArray(parsed.idsOpcionesSeleccionadas)
      ? parsed.idsOpcionesSeleccionadas.map(Number).filter(Number.isInteger)
      : [],
    rtaTexto: typeof parsed.rtaTexto === 'string' ? parsed.rtaTexto : null,
    justificacion: typeof parsed.justificacion === 'string' ? parsed.justificacion : null,
  });
};

const mezclarContenido = (
  base: ContenidoRespuesta,
  input: GuardarRespuestaInput,
): ContenidoRespuesta => contenidoCanonico({
  idsOpcionesSeleccionadas: input.IdOpcionesSeleccionadas !== undefined
    ? input.IdOpcionesSeleccionadas
    : input.IdOpcionNueva !== undefined
      ? (input.IdOpcionNueva == null ? [] : [input.IdOpcionNueva])
      : base.idsOpcionesSeleccionadas,
  rtaTexto: input.RtaTexto !== undefined ? input.RtaTexto : base.rtaTexto,
  justificacion: input.Justificacion !== undefined ? input.Justificacion : base.justificacion,
});

const respuestaDto = (
  input: GuardarRespuestaInput,
  idRespuesta: number | null,
  revision: number,
  contenido: ContenidoRespuesta,
  replay: boolean,
) => ({
  IdRespuesta: idRespuesta,
  IdIntento: input.IdIntento,
  IdPregunta: input.IdPregunta,
  IdsOpcionesSeleccionadas: contenido.idsOpcionesSeleccionadas,
  RtaTexto: contenido.rtaTexto,
  Justificacion: contenido.justificacion,
  Revision: revision,
  Replay: replay,
});

const autorizarAlumno = (actor: ActorBanco, idAlumno: number) => {
  if (!Number.isInteger(actor.id) || !actor.id || actor.id <= 0) {
    throw new BancoError(403, 'No se pudo identificar al usuario', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
  if (actor.role === 'admin') return;
  if (actor.role !== 'alumno' || !actor.idAlumno || actor.idAlumno !== idAlumno) {
    throw new BancoError(403, 'El intento no pertenece al alumno', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
};

const validarContenido = (
  scope: ScopeRespuesta,
  contenido: ContenidoRespuesta,
  opcionesDisponibles: Set<number>,
) => {
  const cerrada = ['mc', 'multiple', 'vf'].includes(scope.Tipo);
  if (cerrada && contenido.rtaTexto !== null) {
    throw new BancoError(400, 'La pregunta cerrada no admite respuesta de texto', 'RESPONSE_CONTENT_INVALID');
  }
  if (!cerrada && contenido.idsOpcionesSeleccionadas.length > 0) {
    throw new BancoError(400, 'La pregunta de texto no admite opciones seleccionadas', 'RESPONSE_CONTENT_INVALID');
  }
  if ((scope.Tipo === 'mc' || scope.Tipo === 'vf') && contenido.idsOpcionesSeleccionadas.length > 1) {
    throw new BancoError(400, 'La pregunta admite una única opción', 'RESPONSE_OPTIONS_INVALID');
  }
  if (contenido.idsOpcionesSeleccionadas.some(id => !opcionesDisponibles.has(id))) {
    throw new BancoError(400, 'Una opción no pertenece al snapshot de la pregunta', 'RESPONSE_OPTIONS_INVALID');
  }
  if (scope.ModoJustificacion === 'sin_justificacion' && contenido.justificacion !== null) {
    throw new BancoError(400, 'La pregunta no admite justificación', 'JUSTIFICATION_NOT_ALLOWED');
  }
};

export async function guardarRespuestaIntento(actor: ActorBanco, input: GuardarRespuestaInput) {
  return atomico(async tx => {
    const scopeResult = await tx.request()
      .input('IdIntento', sql.Int, input.IdIntento)
      .input('IdPregunta', sql.Int, input.IdPregunta)
      .query(`
        SELECT IP.Id AS IdIntentoPregunta, I.IdAlumno, I.Estado,
               COALESCE(IP.TipoSnapshot,P.Tipo) AS Tipo,
               COALESCE(IP.ModoJustificacionSnapshot,P.ModoJustificacion,N'sin_justificacion') AS ModoJustificacion,
               R.Id AS IdRespuesta, R.RtaTexto, R.Justificacion, ISNULL(R.Revision,0) AS Revision
        FROM dbo.IntentoPregunta IP WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.Intento I WITH (UPDLOCK,HOLDLOCK) ON I.Id=IP.IdIntento
        LEFT JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
        LEFT JOIN dbo.Respuesta R WITH (UPDLOCK,HOLDLOCK)
          ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
        WHERE IP.IdIntento=@IdIntento AND IP.IdPregunta=@IdPregunta;
      `);
    const scope = scopeResult.recordset[0] as ScopeRespuesta | undefined;
    if (!scope) throw new BancoError(404, 'La pregunta no pertenece al intento', 'ATTEMPT_QUESTION_NOT_FOUND');
    autorizarAlumno(actor, Number(scope.IdAlumno));

    if (input.EventoId) {
      const replayResult = await tx.request()
        .input('IdIntentoPregunta', sql.Int, scope.IdIntentoPregunta)
        .input('EventoId', sql.UniqueIdentifier, input.EventoId)
        .query(`SELECT IdRespuesta,RevisionAnterior,RevisionNueva,RespuestaAnteriorJson,RespuestaNuevaJson
                FROM dbo.HistorialRespuestaCambio WITH (UPDLOCK,HOLDLOCK)
                WHERE IdIntentoPregunta=@IdIntentoPregunta AND EventoId=@EventoId;`);
      const event = replayResult.recordset[0];
      if (event) {
        const anterior = parsearContenido(event.RespuestaAnteriorJson);
        const esperado = mezclarContenido(anterior, input);
        const persistido = parsearContenido(event.RespuestaNuevaJson);
        if (serializar(esperado) !== serializar(persistido)) {
          throw new BancoError(409, 'EventoId ya fue usado con otro contenido', 'RESPONSE_EVENT_CONFLICT');
        }
        return respuestaDto(input, Number(event.IdRespuesta), Number(event.RevisionNueva), persistido, true);
      }
    }

    if (scope.Estado !== 'en_progreso') {
      throw new BancoError(409, 'El intento ya no admite respuestas', 'ATTEMPT_NOT_IN_PROGRESS');
    }
    if (input.RevisionEsperada !== undefined && input.RevisionEsperada !== Number(scope.Revision)) {
      throw new BancoError(409, 'La respuesta cambió; recargar antes de continuar', 'RESPONSE_REVISION_CONFLICT');
    }

    const opcionesResult = await tx.request()
      .input('IdIntentoPregunta', sql.Int, scope.IdIntentoPregunta)
      .query(`SELECT IdOpcionOrigen AS IdOpcion
              FROM dbo.IntentoPreguntaOpcionSnapshot
              WHERE IdIntentoPregunta=@IdIntentoPregunta AND IdOpcionOrigen IS NOT NULL;`);
    const opcionesDisponibles = new Set<number>(opcionesResult.recordset.map((row: any) => Number(row.IdOpcion)));

    const seleccionResult = scope.IdRespuesta == null
      ? { recordset: [] }
      : await tx.request()
        .input('IdRespuesta', sql.Int, scope.IdRespuesta)
        .query('SELECT IdOpcion FROM dbo.RespuestaOpcion WHERE IdRespuesta=@IdRespuesta ORDER BY IdOpcion;');
    const anterior = contenidoCanonico({
      idsOpcionesSeleccionadas: seleccionResult.recordset.map((row: any) => Number(row.IdOpcion)),
      rtaTexto: scope.RtaTexto,
      justificacion: scope.Justificacion,
    });
    const nuevo = mezclarContenido(anterior, input);
    validarContenido(scope, nuevo, opcionesDisponibles);

    const cambio = serializar(anterior) !== serializar(nuevo);
    if (!cambio && !input.EventoId) {
      return respuestaDto(input, scope.IdRespuesta, Number(scope.Revision), anterior, true);
    }

    const eventoId = input.EventoId ?? randomUUID();
    const revisionNueva = Number(scope.Revision) + 1;
    const mutation = await tx.request()
      .input('IdIntento', sql.Int, input.IdIntento)
      .input('IdPregunta', sql.Int, input.IdPregunta)
      .input('IdIntentoPregunta', sql.Int, scope.IdIntentoPregunta)
      .input('IdRespuesta', sql.Int, scope.IdRespuesta)
      .input('RtaTexto', sql.NVarChar, nuevo.rtaTexto)
      .input('Justificacion', sql.NVarChar, nuevo.justificacion)
      .input('RevisionNueva', sql.Int, revisionNueva)
      .input('EventoId', sql.UniqueIdentifier, eventoId)
      .input('AnteriorJson', sql.NVarChar, serializar(anterior))
      .input('NuevoJson', sql.NVarChar, serializar(nuevo))
      .input('OpcionesJson', sql.NVarChar, JSON.stringify(nuevo.idsOpcionesSeleccionadas))
      .input('IdUsuario', sql.Int, actor.id)
      .query(`
        DECLARE @RespuestaId INT=@IdRespuesta;
        IF @RespuestaId IS NULL
        BEGIN
          INSERT INTO dbo.Respuesta(IdIntento,IdPregunta,RtaTexto,Justificacion,Revision)
          VALUES(@IdIntento,@IdPregunta,@RtaTexto,@Justificacion,@RevisionNueva);
          SET @RespuestaId=SCOPE_IDENTITY();
        END
        ELSE
          UPDATE dbo.Respuesta SET RtaTexto=@RtaTexto,Justificacion=@Justificacion,Revision=@RevisionNueva
          WHERE Id=@RespuestaId;

        DELETE FROM dbo.RespuestaOpcion WHERE IdRespuesta=@RespuestaId;
        INSERT INTO dbo.RespuestaOpcion(IdRespuesta,IdOpcion)
        SELECT @RespuestaId,CONVERT(INT,[value]) FROM OPENJSON(@OpcionesJson);

        INSERT INTO dbo.HistorialRespuestaCambio
          (IdIntentoPregunta,IdRespuesta,EventoId,RevisionAnterior,RevisionNueva,
           RespuestaAnteriorJson,RespuestaNuevaJson,IdUsuario)
        VALUES(@IdIntentoPregunta,@RespuestaId,@EventoId,@RevisionNueva-1,@RevisionNueva,
               @AnteriorJson,@NuevoJson,@IdUsuario);
        SELECT @RespuestaId AS IdRespuesta;
      `);
    const idRespuesta = Number(mutation.recordset[0].IdRespuesta);
    return respuestaDto(input, idRespuesta, revisionNueva, nuevo, false);
  });
}

type ScopeIntentoRuntime = {
  IdIntento: number;
  IdAlumno: number;
  Estado: string;
  IdDocente: number | null;
  DocenteActivo: boolean | number | null;
};

export async function autorizarAccesoIntento(actor: ActorBanco, idIntento: number) {
  const result = await pool.request()
    .input('IdIntento', sql.Int, idIntento)
    .query(`
      SELECT I.Id AS IdIntento,I.IdAlumno,I.Estado,MD.IdDocente,D.Estado AS DocenteActivo
      FROM dbo.Intento I
      JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
      JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
      LEFT JOIN dbo.Docente D ON D.Legajo=MD.IdDocente
      WHERE I.Id=@IdIntento;
    `);
  const scope = result.recordset[0] as ScopeIntentoRuntime | undefined;
  if (!scope) throw new BancoError(404, 'Intento no encontrado');
  if (actor.role === 'admin') return scope;
  if (actor.role === 'alumno' && actor.idAlumno === Number(scope.IdAlumno)) return scope;
  if (actor.role === 'docente' && actor.idDocente === Number(scope.IdDocente) && scope.DocenteActivo) return scope;
  throw new BancoError(403, 'El intento no pertenece al usuario', 'ATTEMPT_SCOPE_FORBIDDEN');
}

const numeroSql = (error: unknown) => {
  const value = error as { number?: number; originalError?: { info?: { number?: number } } };
  return value?.number ?? value?.originalError?.info?.number;
};

export async function finalizarIntentoRuntime(actor: ActorBanco, idIntento: number) {
  await autorizarAccesoIntento(actor, idIntento);
  try {
    const result = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .execute('SP_Intento_FinalizarExamen');
    return result.recordset;
  } catch (error) {
    if (numeroSql(error) === 51320) {
      throw new BancoError(
        409,
        'Hay respuestas contestadas que requieren justificación antes de entregar',
        'REQUIRED_JUSTIFICATION_MISSING',
      );
    }
    throw error;
  }
}
