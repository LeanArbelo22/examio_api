import * as sql from 'mssql';
import { ActorBanco, BancoError, atomico } from './banco-common.service';
import { distribuirPuntajesIguales, EscalaCalificacion } from './evaluacion-scoring.service';

type CorreccionPreguntaInput = {
  puntajeObtenido?: number | null;
  esCorrecta?: boolean | null;
  comentariosDocente?: string | null;
};

type IntentoPreguntaScope = {
  IdIntento: number;
  Estado: string;
  EscalaCalificacion: EscalaCalificacion;
  IdDocente: number | null;
  DocenteActivo: boolean | number | null;
  IdIntentoPregunta: number | null;
  PuntajeMaximoSnapshot: number | null;
  PuntajeMaximoGrupo: number | null;
  PosicionGrupo: number | null;
  TotalGrupos: number;
};

const tieneHastaDosDecimales = (valor: number) =>
  Number.isFinite(valor) && Math.round(valor * 100) === valor * 100;

const autorizarActor = (actor: ActorBanco, scope: IntentoPreguntaScope | Record<string, unknown>) => {
  if (!Number.isInteger(actor.id) || !actor.id || actor.id <= 0) {
    throw new BancoError(403, 'No se pudo identificar al usuario', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
  if (actor.role === 'admin') return;
  const idDocente = Number(scope.IdDocente);
  if (actor.role !== 'docente' || !actor.idDocente || actor.idDocente !== idDocente || !scope.DocenteActivo) {
    throw new BancoError(403, 'El intento no pertenece a una comisión del docente', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
};

const validarEstadoCorregible = (estado: unknown, operacion: 'pregunta' | 'nota') => {
  if (estado === 'en_progreso') {
    throw new BancoError(
      400,
      operacion === 'nota'
        ? 'No se puede calificar un examen que aún está en progreso.'
        : 'No se puede corregir un examen en progreso',
      'ATTEMPT_NOT_DELIVERED',
    );
  }
};

const resolverPuntajeMaximo = (scope: IntentoPreguntaScope): number => {
  if (scope.PuntajeMaximoSnapshot !== null) return Number(scope.PuntajeMaximoSnapshot);
  if (scope.PuntajeMaximoGrupo !== null) return Number(scope.PuntajeMaximoGrupo);
  const posicion = Number(scope.PosicionGrupo);
  const puntajes = distribuirPuntajesIguales(Number(scope.TotalGrupos), scope.EscalaCalificacion);
  const puntaje = puntajes[posicion - 1];
  if (puntaje === undefined) {
    throw new BancoError(409, 'No se pudo resolver el puntaje máximo de la pregunta', 'QUESTION_SCORE_TOTAL_INVALID');
  }
  return puntaje;
};

const resolverPuntaje = (input: CorreccionPreguntaInput, maximo: number): number | null => {
  if (input.puntajeObtenido !== undefined) return input.puntajeObtenido;
  if (input.esCorrecta === null) return null;
  return input.esCorrecta ? maximo : 0;
};

export async function corregirPreguntaIntento(
  actor: ActorBanco,
  idIntento: number,
  idPregunta: number,
  input: CorreccionPreguntaInput,
) {
  return atomico(async tx => {
    const scopeRequest = tx.request();
    const scopeResult = await scopeRequest
      .input('IdIntento', sql.Int, idIntento)
      .input('IdPregunta', sql.Int, idPregunta)
      .query(`
        WITH Grupos AS (
          SELECT GP.Id, GP.IdActividad, GP.PuntajeMaximo,
                 ROW_NUMBER() OVER (PARTITION BY GP.IdActividad ORDER BY GP.Id) AS PosicionGrupo,
                 COUNT(*) OVER (PARTITION BY GP.IdActividad) AS TotalGrupos
          FROM dbo.GrupoPregunta GP
        )
        SELECT I.Id AS IdIntento, I.Estado, A.EscalaCalificacion,
               MD.IdDocente, D.Estado AS DocenteActivo,
               IP.Id AS IdIntentoPregunta, IP.PuntajeMaximoSnapshot,
               G.PuntajeMaximo AS PuntajeMaximoGrupo,
               G.PosicionGrupo, G.TotalGrupos
        FROM dbo.Intento I WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.Publicacion PU ON PU.Id = I.IdPublicacion
        JOIN dbo.Actividad A ON A.Id = PU.IdActividad
        JOIN dbo.MateriaDivision MD ON MD.Id = PU.IdMateriaDivision
        LEFT JOIN dbo.Docente D ON D.Legajo = MD.IdDocente
        LEFT JOIN dbo.IntentoPregunta IP ON IP.IdIntento = I.Id AND IP.IdPregunta = @IdPregunta
        LEFT JOIN dbo.Pregunta P ON P.Id = IP.IdPregunta
        LEFT JOIN Grupos G ON G.Id = P.IdGrupoPregunta
        WHERE I.Id = @IdIntento
      `);

    const scope = scopeResult.recordset[0] as IntentoPreguntaScope | undefined;
    if (!scope) throw new BancoError(404, 'Intento no encontrado');
    autorizarActor(actor, scope);
    validarEstadoCorregible(scope.Estado, 'pregunta');
    if (!scope.IdIntentoPregunta) {
      throw new BancoError(404, 'La pregunta no pertenece al intento');
    }

    const puntajeMaximo = resolverPuntajeMaximo(scope);
    const puntajeObtenido = resolverPuntaje(input, puntajeMaximo);
    if (puntajeObtenido !== null && (
      !tieneHastaDosDecimales(puntajeObtenido) || puntajeObtenido < 0 || puntajeObtenido > puntajeMaximo
    )) {
      throw new BancoError(
        400,
        'PuntajeObtenido debe estar entre 0 y el puntaje máximo de la pregunta, con hasta dos decimales',
        'QUESTION_SCORE_OUT_OF_RANGE',
      );
    }

    const updateRequest = tx.request();
    const result = await updateRequest
      .input('IdIntento', sql.Int, idIntento)
      .input('IdPregunta', sql.Int, idPregunta)
      .input('IdIntentoPregunta', sql.Int, scope.IdIntentoPregunta)
      .input('PuntajeMaximo', sql.Decimal(5, 2), puntajeMaximo)
      .input('PuntajeObtenido', sql.Decimal(5, 2), puntajeObtenido)
      .input('ComentariosDocente', sql.NVarChar, input.comentariosDocente ?? null)
      .input('ModificadoPor', sql.Int, actor.id)
      .query(`
        INSERT INTO dbo.HistorialCorreccionIntentoPregunta
          (IdIntentoPregunta, PuntajeAnterior, PuntajeNuevo, ComentarioAnterior,
           ComentarioNuevo, OrigenAnterior, OrigenNuevo, ModificadoPor)
        SELECT IP.Id, IP.PuntajeObtenido, @PuntajeObtenido, IP.ComentariosDocente,
               @ComentariosDocente, IP.OrigenCorreccion, 'manual', @ModificadoPor
        FROM dbo.IntentoPregunta IP
        WHERE IP.Id = @IdIntentoPregunta;

        UPDATE dbo.IntentoPregunta
        SET PuntajeMaximoSnapshot = COALESCE(PuntajeMaximoSnapshot, @PuntajeMaximo),
            PuntajeObtenido = @PuntajeObtenido,
            OrigenCorreccion = 'manual',
            ComentariosDocente = @ComentariosDocente,
            CorregidoPor = @ModificadoPor,
            FechaCorreccion = SYSUTCDATETIME()
        WHERE Id = @IdIntentoPregunta;

        UPDATE dbo.Respuesta
        SET EsCorrecta = CASE
              WHEN @PuntajeObtenido IS NULL THEN NULL
              WHEN @PuntajeObtenido = @PuntajeMaximo THEN 1
              WHEN @PuntajeObtenido = 0 THEN 0
              ELSE NULL
            END,
            ComentariosDocente = @ComentariosDocente
        WHERE IdIntento = @IdIntento AND IdPregunta = @IdPregunta;

        DECLARE @Pendientes INT, @NotaCalculada DECIMAL(5,2),
                @CantidadAutomaticas INT, @NotaAutomatica DECIMAL(5,2);
        SELECT @Pendientes = SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END),
               @NotaCalculada = SUM(PuntajeObtenido),
               @CantidadAutomaticas = SUM(CASE WHEN OrigenCorreccion = 'automatica' THEN 1 ELSE 0 END),
               @NotaAutomatica = SUM(CASE WHEN OrigenCorreccion = 'automatica' THEN PuntajeObtenido ELSE 0 END)
        FROM dbo.IntentoPregunta
        WHERE IdIntento = @IdIntento;

        IF ISNULL(@Pendientes, 0) > 0 SET @NotaCalculada = NULL;
        IF ISNULL(@CantidadAutomaticas, 0) = 0 SET @NotaAutomatica = NULL;

        UPDATE dbo.Intento
        SET NotaAutomatica = @NotaAutomatica,
            NotaFinal = CASE
              WHEN NotaFinalManual IS NOT NULL THEN NotaFinalManual
              WHEN NotaFinalCalculada IS NULL AND NotaFinal IS NOT NULL THEN NotaFinal
              ELSE @NotaCalculada
            END,
            NotaFinalCalculada = @NotaCalculada
        WHERE Id = @IdIntento;

        SELECT IP.IdIntento, IP.IdPregunta, IP.PuntajeMaximoSnapshot,
               IP.PuntajeObtenido, IP.OrigenCorreccion, IP.ComentariosDocente,
               IP.CorregidoPor, IP.FechaCorreccion,
               I.NotaAutomatica, I.NotaFinalCalculada, I.NotaFinalManual, I.NotaFinal,
               A.EscalaCalificacion, A.NotaAprobacion
        FROM dbo.IntentoPregunta IP
        JOIN dbo.Intento I ON I.Id = IP.IdIntento
        JOIN dbo.Publicacion PU ON PU.Id = I.IdPublicacion
        JOIN dbo.Actividad A ON A.Id = PU.IdActividad
        WHERE IP.Id = @IdIntentoPregunta;
      `);
    return result.recordset[0];
  });
}

export async function asignarNotaFinalManual(
  actor: ActorBanco,
  idIntento: number,
  notaFinal: number,
) {
  return atomico(async tx => {
    const scopeRequest = tx.request();
    const scopeResult = await scopeRequest
      .input('IdIntento', sql.Int, idIntento)
      .query(`
        SELECT I.Id AS IdIntento, I.Estado, I.NotaFinal, I.NotaFinalManual,
               A.EscalaCalificacion, A.NotaAprobacion,
               MD.IdDocente, D.Estado AS DocenteActivo
        FROM dbo.Intento I WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.Publicacion PU ON PU.Id = I.IdPublicacion
        JOIN dbo.Actividad A ON A.Id = PU.IdActividad
        JOIN dbo.MateriaDivision MD ON MD.Id = PU.IdMateriaDivision
        LEFT JOIN dbo.Docente D ON D.Legajo = MD.IdDocente
        WHERE I.Id = @IdIntento
      `);
    const scope = scopeResult.recordset[0] as (IntentoPreguntaScope & {
      NotaFinal: number | null;
      NotaFinalManual: number | null;
      NotaAprobacion: number;
    }) | undefined;
    if (!scope) throw new BancoError(404, 'Intento no encontrado');
    autorizarActor(actor, scope);
    validarEstadoCorregible(scope.Estado, 'nota');
    if (!tieneHastaDosDecimales(notaFinal) || notaFinal < 0 || notaFinal > Number(scope.EscalaCalificacion)) {
      throw new BancoError(
        400,
        'NotaFinal debe estar entre 0 y la escala de la evaluación, con hasta dos decimales',
        'FINAL_GRADE_OUT_OF_RANGE',
      );
    }

    const result = await tx.request()
      .input('IdIntento', sql.Int, idIntento)
      .input('NotaFinal', sql.Decimal(5, 2), notaFinal)
      .input('ModificadoPor', sql.Int, actor.id)
      .query(`
        INSERT INTO dbo.HistorialNotaIntento
          (IdIntento, NotaAnterior, NotaNueva, ModificadoPor)
        SELECT Id, COALESCE(NotaFinalManual, NotaFinal), @NotaFinal, @ModificadoPor
        FROM dbo.Intento
        WHERE Id = @IdIntento;

        UPDATE dbo.Intento
        SET NotaFinalManual = @NotaFinal,
            NotaFinal = @NotaFinal
        WHERE Id = @IdIntento;

        SELECT I.Id AS IdIntento, I.NotaAutomatica, I.NotaFinalCalculada,
               I.NotaFinalManual, I.NotaFinal,
               A.EscalaCalificacion, A.NotaAprobacion
        FROM dbo.Intento I
        JOIN dbo.Publicacion PU ON PU.Id = I.IdPublicacion
        JOIN dbo.Actividad A ON A.Id = PU.IdActividad
        WHERE I.Id = @IdIntento;
      `);
    return result.recordset[0];
  });
}
