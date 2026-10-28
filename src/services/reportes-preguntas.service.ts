import * as sql from 'mssql';
import { pool } from '../config/db';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import {
  FiltrosRendimientoPregunta,
  RendimientoGruposQuery,
  RendimientoOpcionesQuery,
  RendimientoPreguntasQuery,
} from '../schemas/reportes.schema';

type FiltrosBase = FiltrosRendimientoPregunta | RendimientoOpcionesQuery;

const REGLA_BAJO_RENDIMIENTO = {
  codigo: 'pregunta_bajo_rendimiento',
  version: 1,
  porcentajePuntajeMaximoExclusivo: 30,
  muestrasConfirmadasMinimas: 10,
} as const;

export class ReportePreguntasError extends Error {
  constructor(
    public readonly code: 'QUESTION_CONTENT_NOT_FOUND' | 'QUESTION_OPTION_EVIDENCE_INCONSISTENT',
    message: string,
    public readonly status: 404 | 409,
  ) {
    super(message);
    this.name = 'ReportePreguntasError';
  }
}

const identifierFilters = [
  ['idMateria', 'MD.IdMateria=@IdMateria'],
  ['idMateriaDivision', 'MD.Id=@IdMateriaDivision'],
  ['idActividad', 'A.Id=@IdActividad'],
  ['idPublicacion', 'PU.Id=@IdPublicacion'],
  ['idGrupoPregunta', 'GP.Id=@IdGrupoPregunta'],
  ['idPregunta', 'P.Id=@IdPregunta'],
] as const;

const bindFilters = (request: sql.Request, filters: FiltrosBase) => {
  if (filters.idMateria) request.input('IdMateria', sql.Int, filters.idMateria);
  if (filters.idMateriaDivision) request.input('IdMateriaDivision', sql.Int, filters.idMateriaDivision);
  if (filters.idActividad) request.input('IdActividad', sql.Int, filters.idActividad);
  if (filters.idPublicacion) request.input('IdPublicacion', sql.Int, filters.idPublicacion);
  if (filters.idGrupoPregunta) request.input('IdGrupoPregunta', sql.Int, filters.idGrupoPregunta);
  if ('idPregunta' in filters && filters.idPregunta) request.input('IdPregunta', sql.Int, filters.idPregunta);
  if (filters.fechaDesde) request.input('FechaDesde', sql.DateTime2, new Date(filters.fechaDesde));
  if (filters.fechaHasta) request.input('FechaHasta', sql.DateTime2, new Date(filters.fechaHasta));
  if (filters.estadoIntento) request.input('EstadoIntento', sql.VarChar(20), filters.estadoIntento);
  if ('claveContenido' in filters && filters.claveContenido) {
    request.input('ClaveContenido', sql.VarChar(80), filters.claveContenido);
  }
  return request;
};

const identifierWhere = (filters: FiltrosBase) => identifierFilters
  .filter(([key]) => key in filters && filters[key as keyof FiltrosBase] !== undefined)
  .map(([, clause]) => `AND ${clause}`)
  .join(' ');

export async function isQuestionReportScopeAllowed(
  idDocente: number,
  filters: FiltrosBase,
  idPreguntaPath?: number,
) {
  const hasIdentifier = identifierFilters.some(([key]) =>
    key in filters && filters[key as keyof FiltrosBase] !== undefined);
  if (!hasIdentifier && idPreguntaPath === undefined) return true;

  const request = bindFilters(pool.request(), filters)
    .input('IdDocente', sql.Int, idDocente);
  if (idPreguntaPath !== undefined) request.input('IdPreguntaPath', sql.Int, idPreguntaPath);

  const pathClause = idPreguntaPath === undefined ? '' : 'AND P.Id=@IdPreguntaPath';
  const result = await request.query(`
    SELECT TOP (1) 1 AS Permitido
    FROM dbo.Pregunta P
    JOIN dbo.GrupoPregunta GP ON GP.Id=P.IdGrupoPregunta
    JOIN dbo.Actividad A ON A.Id=GP.IdActividad
    JOIN dbo.Publicacion PU ON PU.IdActividad=A.Id
    JOIN dbo.MateriaDivision MD ON MD.Id=PU.IdMateriaDivision
    WHERE A.Tipo='evaluacion' AND MD.IdDocente=@IdDocente
      ${identifierWhere(filters)} ${pathClause};
  `);
  return result.recordset.length > 0;
}

const baseSql = (
  filters: FiltrosBase,
  idDocente: number | null,
  extraIdentityClause = '',
  includeTimes = true,
) => {
  const scopeClause = idDocente === null ? '' : 'AND MD.IdDocente=@IdDocente';
  const dateFromClause = filters.fechaDesde ? 'AND I.FechaInicio>=@FechaDesde' : '';
  const dateToClause = filters.fechaHasta ? 'AND I.FechaInicio<=@FechaHasta' : '';
  const attemptStateClause = filters.estadoIntento ? 'AND EstadoIntento=@EstadoIntento' : '';
  const correctionClause = filters.estadoCorreccion === 'pendiente'
    ? 'AND (CorreccionConfirmada=0 OR PuntajeObtenido IS NULL)'
    : filters.estadoCorreccion === 'confirmada'
      ? 'AND CorreccionConfirmada=1 AND PuntajeObtenido IS NOT NULL'
      : '';
  const validJoins = `
    LEFT JOIN dbo.IntentoValidoOverride IVO
      ON IVO.IdPublicacion=I.IdPublicacion AND IVO.IdAlumno=I.IdAlumno
    OUTER APPLY (
      SELECT COALESCE(IVO.IdIntento,(
        SELECT TOP (1) IV.Id
        FROM dbo.Intento IV
        WHERE IV.IdPublicacion=I.IdPublicacion AND IV.IdAlumno=I.IdAlumno
          AND IV.Estado='entregado'
        ORDER BY IV.FechaFin DESC,IV.NumeroIntento DESC,IV.Id DESC
      )) AS IdIntentoValido
    ) IVS`;
  const validClause = filters.alcanceIntentos === 'validos'
    ? "AND EstadoIntento='entregado' AND IdIntento=IdIntentoValido"
    : '';

  const timeSql = includeTimes ? `
    ;WITH Eventos AS (
      SELECT E.Id,E.IdIntentoPregunta,E.FechaInicioCliente,E.FechaFinCliente,
        MAX(E.FechaFinCliente) OVER (
          PARTITION BY E.IdIntentoPregunta ORDER BY E.FechaInicioCliente,E.Id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS MaxFinAnterior
      FROM dbo.IncidenteIntento E
      JOIN #BaseRendimientoPregunta B ON B.IdIntentoPregunta=E.IdIntentoPregunta
      WHERE E.Tipo='question_active' AND E.Estado='completado'
    ), Marcas AS (
      SELECT *,CASE WHEN MaxFinAnterior IS NULL OR FechaInicioCliente>MaxFinAnterior
        THEN 1 ELSE 0 END AS NuevoGrupo
      FROM Eventos
    ), GruposTiempo AS (
      SELECT *,SUM(NuevoGrupo) OVER (
        PARTITION BY IdIntentoPregunta ORDER BY FechaInicioCliente,Id ROWS UNBOUNDED PRECEDING
      ) AS GrupoTiempo
      FROM Marcas
    ), Islas AS (
      SELECT IdIntentoPregunta,GrupoTiempo,MIN(FechaInicioCliente) AS Inicio,
        MAX(FechaFinCliente) AS Fin
      FROM GruposTiempo GROUP BY IdIntentoPregunta,GrupoTiempo
    )
    SELECT IdIntentoPregunta,SUM(DATEDIFF_BIG(MILLISECOND,Inicio,Fin)) AS TiempoMilisegundos,
      CAST('nueva' AS VARCHAR(10)) AS FuenteTemporal
    INTO #TiemposRendimientoPregunta
    FROM Islas GROUP BY IdIntentoPregunta;

    INSERT INTO #TiemposRendimientoPregunta
      (IdIntentoPregunta,TiempoMilisegundos,FuenteTemporal)
    SELECT B.IdIntentoPregunta,
      SUM(CAST(MN.SegundosPermanencia AS BIGINT))*1000,'legacy'
    FROM #BaseRendimientoPregunta B
    JOIN dbo.MetricasNavegacion MN
      ON MN.IdIntento=B.IdIntento AND MN.IdPregunta=B.IdPregunta
    WHERE NOT EXISTS (
      SELECT 1 FROM #TiemposRendimientoPregunta T
      WHERE T.IdIntentoPregunta=B.IdIntentoPregunta
    )
    GROUP BY B.IdIntentoPregunta;
  ` : '';

  return `
    SELECT
      IP.Id AS IdIntentoPregunta,IP.IdPregunta,P.IdGrupoPregunta,
      GP.IdActividad,PU.Id AS IdPublicacion,MD.Id AS IdMateriaDivision,MD.IdMateria,
      I.Id AS IdIntento,I.IdAlumno,I.Estado AS EstadoIntento,I.CorreccionConfirmada,
      IVS.IdIntentoValido,
      COALESCE(IP.ContenidoHashSnapshot,CONCAT('legacy:',IP.IdPregunta)) AS ClaveContenido,
      IP.ContenidoHashSnapshot,COALESCE(IP.EnunciadoSnapshot,P.Enunciado) AS Enunciado,
      COALESCE(IP.TipoSnapshot,P.Tipo) AS TipoPregunta,
      COALESCE(IP.GrupoTituloSnapshot,GP.TituloReferencia) AS GrupoTitulo,
      IP.SnapshotReconstruido,IP.PuntajeMaximoSnapshot,IP.PuntajeObtenido,
      IP.OrigenCorreccion,P.IdBancoPreguntaOrigen,GP.IdBancoGrupoOrigen,
      R.Id AS IdRespuesta,R.RtaTexto,R.Justificacion,
      COALESCE(ROS.OpcionesSeleccionadas,0) AS OpcionesSeleccionadas,
      CAST(CASE WHEN COALESCE(ROS.OpcionesSeleccionadas,0)>0
        OR NULLIF(LTRIM(RTRIM(COALESCE(R.RtaTexto,N''))),N'') IS NOT NULL
        THEN 1 ELSE 0 END AS bit) AS Respondida,
      CAST(CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(R.Justificacion,N''))),N'') IS NOT NULL
        THEN 1 ELSE 0 END AS bit) AS TieneJustificacion
    INTO #BaseRendimientoPreguntaCompleta
    FROM dbo.Intento I
    JOIN dbo.Publicacion PU ON PU.Id=I.IdPublicacion
    JOIN dbo.Actividad A ON A.Id=PU.IdActividad
    JOIN dbo.MateriaDivision MD ON MD.Id=PU.IdMateriaDivision
    JOIN dbo.Materia M ON M.Id=MD.IdMateria
    JOIN dbo.IntentoPregunta IP ON IP.IdIntento=I.Id
    JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
    JOIN dbo.GrupoPregunta GP ON GP.Id=P.IdGrupoPregunta
    LEFT JOIN dbo.Respuesta R ON R.IdIntento=I.Id AND R.IdPregunta=IP.IdPregunta
    LEFT JOIN (
      SELECT IdRespuesta,COUNT(*) AS OpcionesSeleccionadas
      FROM dbo.RespuestaOpcion GROUP BY IdRespuesta
    ) ROS ON ROS.IdRespuesta=R.Id
    ${validJoins}
    WHERE A.Tipo='evaluacion' ${scopeClause} ${identifierWhere(filters)}
      ${dateFromClause} ${dateToClause} ${extraIdentityClause};

    SELECT * INTO #BaseRendimientoPregunta
    FROM #BaseRendimientoPreguntaCompleta
    WHERE 1=1 ${attemptStateClause} ${correctionClause} ${validClause};

    SELECT * INTO #BaseRendimientoPreguntaOficial
    FROM #BaseRendimientoPreguntaCompleta
    WHERE EstadoIntento='entregado' AND IdIntento=IdIntentoValido
      AND CorreccionConfirmada=1;
    ${timeSql}
  `;
};

const kpisSql = `
  SELECT
    COUNT(*) AS Presentadas,
    COALESCE(SUM(CASE WHEN Respondida=1 THEN 1 ELSE 0 END),0) AS Respondidas,
    COALESCE(SUM(CASE WHEN Respondida=0 THEN 1 ELSE 0 END),0) AS Omitidas,
    COALESCE(SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END),0) AS PendientesCorreccion,
    COALESCE(SUM(CASE WHEN PuntajeObtenido=PuntajeMaximoSnapshot AND PuntajeObtenido IS NOT NULL
      THEN 1 ELSE 0 END),0) AS Correctas,
    COALESCE(SUM(CASE WHEN PuntajeObtenido>0 AND PuntajeObtenido<PuntajeMaximoSnapshot
      THEN 1 ELSE 0 END),0) AS Parciales,
    COALESCE(SUM(CASE WHEN PuntajeObtenido=0 THEN 1 ELSE 0 END),0) AS Incorrectas,
    COALESCE(SUM(CASE WHEN TieneJustificacion=1 THEN 1 ELSE 0 END),0) AS JustificacionesEntregadas,
    CAST(AVG(CASE WHEN PuntajeObtenido IS NOT NULL AND PuntajeMaximoSnapshot>0
      THEN PuntajeObtenido*100.0/PuntajeMaximoSnapshot END) AS DECIMAL(9,2)) AS PorcentajePuntajePromedio,
    CAST(CASE WHEN SUM(CASE WHEN PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END)>0
      THEN SUM(CASE WHEN PuntajeObtenido=PuntajeMaximoSnapshot THEN 1.0 ELSE 0 END)*100.0
        /SUM(CASE WHEN PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END)
      ELSE NULL END AS DECIMAL(9,2)) AS TasaAcierto,
    COUNT(T.IdIntentoPregunta) AS MuestrasTiempo,
    COALESCE(SUM(CASE WHEN T.FuenteTemporal='nueva' THEN 1 ELSE 0 END),0) AS MuestrasTiempoNuevas,
    COALESCE(SUM(CASE WHEN T.FuenteTemporal='legacy' THEN 1 ELSE 0 END),0) AS MuestrasTiempoLegacy,
    CAST(CASE WHEN COUNT(*)>0 THEN COUNT(T.IdIntentoPregunta)*1.0/COUNT(*) ELSE 0 END
      AS DECIMAL(9,4)) AS CoberturaTemporal,
    CAST(AVG(CAST(T.TiempoMilisegundos AS DECIMAL(18,2))) AS DECIMAL(18,2))
      AS TiempoPromedioMilisegundos,
    CAST(MAX(T.TiempoMilisegundos) AS DECIMAL(18,2)) AS TiempoMaximoMilisegundos
  FROM #BaseRendimientoPregunta B
  LEFT JOIN #TiemposRendimientoPregunta T ON T.IdIntentoPregunta=B.IdIntentoPregunta;

  SELECT COUNT(*) AS PresentacionesOficiales,
    COALESCE(SUM(CASE WHEN PuntajeObtenido IS NOT NULL AND PuntajeMaximoSnapshot>0
      THEN 1 ELSE 0 END),0) AS MuestrasConfirmadas,
    COALESCE(SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END),0)
      AS PresentacionesExcluidasSinPuntaje,
    COALESCE(SUM(CASE WHEN PuntajeObtenido IS NOT NULL
      AND (PuntajeMaximoSnapshot IS NULL OR PuntajeMaximoSnapshot<=0) THEN 1 ELSE 0 END),0)
      AS PresentacionesExcluidasSinMaximoPositivo
  FROM #BaseRendimientoPreguntaOficial;
`;

const criterios = (filters: FiltrosBase) => ({
  alcanceIntentos: filters.alcanceIntentos,
  estadoCorreccion: filters.estadoCorreccion,
  normalizacionPuntaje: 'porcentaje_puntaje_maximo',
  identidadContenido: 'contenidoHashSnapshot',
  poblacionOficial: {
    alcanceIntentos: 'validos',
    estadoCorreccion: 'confirmada',
    reglaExclusion: 'sin_puntaje_luego_sin_maximo_positivo',
  },
});

const pagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: total === 0 ? 0 : Math.ceil(total / limit),
});

const questionOrdering: Record<RendimientoPreguntasQuery['ordenarPor'], string> = {
  pregunta: 'Enunciado',
  presentadas: 'Presentadas',
  respondidas: 'Respondidas',
  omitidas: 'Omitidas',
  pendientesCorreccion: 'PendientesCorreccion',
  tasaAcierto: 'TasaAcierto',
  porcentajePuntaje: 'PorcentajePuntajePromedio',
  tiempoPromedio: 'TiempoPromedioMilisegundos',
};

const questionAggregationSql = `
  ;WITH TiempoConMediana AS (
    SELECT B.ClaveContenido,T.TiempoMilisegundos,T.FuenteTemporal,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY T.TiempoMilisegundos)
        OVER (PARTITION BY B.ClaveContenido) AS Mediana
    FROM #BaseRendimientoPregunta B
    JOIN #TiemposRendimientoPregunta T ON T.IdIntentoPregunta=B.IdIntentoPregunta
  )
  SELECT ClaveContenido,COUNT(*) AS MuestrasTiempo,
    SUM(CASE WHEN FuenteTemporal='nueva' THEN 1 ELSE 0 END) AS MuestrasTiempoNuevas,
    SUM(CASE WHEN FuenteTemporal='legacy' THEN 1 ELSE 0 END) AS MuestrasTiempoLegacy,
    CAST(AVG(CAST(TiempoMilisegundos AS DECIMAL(18,2))) AS DECIMAL(18,2)) AS TiempoPromedioMilisegundos,
    CAST(MAX(TiempoMilisegundos) AS DECIMAL(18,2)) AS TiempoMaximoMilisegundos,
    CAST(MAX(Mediana) AS DECIMAL(18,2)) AS TiempoMedianaMilisegundos
  INTO #TiempoPorContenido
  FROM TiempoConMediana GROUP BY ClaveContenido;

  SELECT ClaveContenido,
    COUNT(*) AS PresentacionesOficiales,
    SUM(CASE WHEN PuntajeObtenido IS NOT NULL AND PuntajeMaximoSnapshot>0
      THEN 1 ELSE 0 END) AS MuestrasConfirmadas,
    SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END)
      AS PresentacionesExcluidasSinPuntaje,
    SUM(CASE WHEN PuntajeObtenido IS NOT NULL
      AND (PuntajeMaximoSnapshot IS NULL OR PuntajeMaximoSnapshot<=0) THEN 1 ELSE 0 END)
      AS PresentacionesExcluidasSinMaximoPositivo,
    CAST(AVG(CASE WHEN PuntajeObtenido IS NOT NULL AND PuntajeMaximoSnapshot>0
      THEN PuntajeObtenido*100.0/PuntajeMaximoSnapshot END) AS DECIMAL(9,2))
      AS PorcentajePuntajePromedioOficial
  INTO #RendimientoOficialPorContenido
  FROM #BaseRendimientoPreguntaOficial
  GROUP BY ClaveContenido;

  SELECT
    B.ClaveContenido,B.ContenidoHashSnapshot,
    MIN(B.IdPregunta) AS IdPregunta,MIN(B.IdGrupoPregunta) AS IdGrupoPregunta,
    COUNT(DISTINCT B.IdPregunta) AS CantidadPreguntasOrigen,
    COUNT(DISTINCT B.IdGrupoPregunta) AS CantidadGrupos,
    MAX(CONVERT(NVARCHAR(4000),B.Enunciado)) AS Enunciado,
    MAX(B.TipoPregunta) AS Tipo,
    MAX(B.GrupoTitulo) AS Grupo,
    CAST(MAX(CASE WHEN B.IdBancoPreguntaOrigen IS NOT NULL THEN 1 ELSE 0 END) AS bit)
      AS TieneProcedenciaBanco,
    COUNT(DISTINCT B.IdBancoPreguntaOrigen) AS CantidadOrigenesBanco,
    CAST(MAX(CAST(B.SnapshotReconstruido AS int)) AS bit) AS IncluyeSnapshotReconstruido,
    COUNT(*) AS Presentadas,
    SUM(CASE WHEN B.Respondida=1 THEN 1 ELSE 0 END) AS Respondidas,
    SUM(CASE WHEN B.Respondida=0 THEN 1 ELSE 0 END) AS Omitidas,
    SUM(CASE WHEN B.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS PendientesCorreccion,
    SUM(CASE WHEN B.PuntajeObtenido=B.PuntajeMaximoSnapshot AND B.PuntajeObtenido IS NOT NULL
      THEN 1 ELSE 0 END) AS Correctas,
    SUM(CASE WHEN B.PuntajeObtenido>0 AND B.PuntajeObtenido<B.PuntajeMaximoSnapshot
      THEN 1 ELSE 0 END) AS Parciales,
    SUM(CASE WHEN B.PuntajeObtenido=0 THEN 1 ELSE 0 END) AS Incorrectas,
    SUM(CASE WHEN B.TieneJustificacion=1 THEN 1 ELSE 0 END) AS JustificacionesEntregadas,
    CAST(AVG(CAST(B.PuntajeObtenido AS DECIMAL(18,4))) AS DECIMAL(18,2)) AS PuntajePromedioObtenido,
    CAST(AVG(CASE WHEN B.PuntajeObtenido IS NOT NULL AND B.PuntajeMaximoSnapshot>0
      THEN B.PuntajeObtenido*100.0/B.PuntajeMaximoSnapshot END) AS DECIMAL(9,2))
      AS PorcentajePuntajePromedio,
    CAST(CASE WHEN SUM(CASE WHEN B.PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END)>0
      THEN SUM(CASE WHEN B.PuntajeObtenido=B.PuntajeMaximoSnapshot THEN 1.0 ELSE 0 END)*100.0
        /SUM(CASE WHEN B.PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END)
      ELSE NULL END AS DECIMAL(9,2)) AS TasaAcierto,
    COALESCE(MAX(T.MuestrasTiempo),0) AS MuestrasTiempo,
    COALESCE(MAX(T.MuestrasTiempoNuevas),0) AS MuestrasTiempoNuevas,
    COALESCE(MAX(T.MuestrasTiempoLegacy),0) AS MuestrasTiempoLegacy,
    CAST(COALESCE(MAX(T.MuestrasTiempo),0)*1.0/COUNT(*) AS DECIMAL(9,4)) AS CoberturaTemporal,
    MAX(T.TiempoPromedioMilisegundos) AS TiempoPromedioMilisegundos,
    MAX(T.TiempoMedianaMilisegundos) AS TiempoMedianaMilisegundos,
    MAX(T.TiempoMaximoMilisegundos) AS TiempoMaximoMilisegundos,
    COALESCE(MAX(O.PresentacionesOficiales),0) AS PresentacionesOficiales,
    COALESCE(MAX(O.MuestrasConfirmadas),0) AS MuestrasConfirmadas,
    COALESCE(MAX(O.PresentacionesExcluidasSinPuntaje),0)
      AS PresentacionesExcluidasSinPuntaje,
    COALESCE(MAX(O.PresentacionesExcluidasSinMaximoPositivo),0)
      AS PresentacionesExcluidasSinMaximoPositivo,
    MAX(O.PorcentajePuntajePromedioOficial) AS PorcentajePuntajePromedioOficial,
    CAST(CASE WHEN COALESCE(MAX(O.MuestrasConfirmadas),0)>=10
      AND MAX(O.PorcentajePuntajePromedioOficial)<30 THEN 1 ELSE 0 END AS bit)
      AS EsHallazgoBajoRendimiento
  INTO #ReportePreguntas
  FROM #BaseRendimientoPregunta B
  LEFT JOIN #TiempoPorContenido T ON T.ClaveContenido=B.ClaveContenido
  LEFT JOIN #RendimientoOficialPorContenido O ON O.ClaveContenido=B.ClaveContenido
  GROUP BY B.ClaveContenido,B.ContenidoHashSnapshot;
`;

export async function getRendimientoPreguntasReport(
  filters: RendimientoPreguntasQuery,
  idDocente: number | null,
) {
  const request = bindFilters(pool.request(), filters)
    .input('Offset', sql.Int, (filters.pagina - 1) * filters.limite)
    .input('Limit', sql.Int, filters.limite);
  if (idDocente !== null) request.input('IdDocente', sql.Int, idDocente);
  const order = questionOrdering[filters.ordenarPor];
  const direction = filters.ordenDireccion === 'asc' ? 'ASC' : 'DESC';

  const result = await request.query(`
    SET NOCOUNT ON;
    ${baseSql(filters, idDocente)}
    ${questionAggregationSql}
    ${kpisSql}
    SELECT
      COUNT(*) AS PreguntasEnCoberturaGeneral,
      COALESCE(SUM(CASE WHEN MuestrasConfirmadas>=10 THEN 1 ELSE 0 END),0)
        AS PreguntasConMuestraSuficiente,
      COALESCE(SUM(CASE WHEN MuestrasConfirmadas<10 THEN 1 ELSE 0 END),0)
        AS PreguntasConMuestraInsuficiente,
      COALESCE(SUM(CASE WHEN MuestrasConfirmadas>=10
        AND PorcentajePuntajePromedioOficial<30 THEN 1 ELSE 0 END),0)
        AS PreguntasCoincidentes,
      COALESCE(SUM(CASE WHEN MuestrasConfirmadas>=10
        AND PorcentajePuntajePromedioOficial<30
        THEN PresentacionesOficiales ELSE 0 END),0) AS PresentacionesCoincidentes,
      COALESCE(SUM(CASE WHEN MuestrasConfirmadas>=10
        AND PorcentajePuntajePromedioOficial<30
        THEN MuestrasConfirmadas ELSE 0 END),0) AS MuestrasConfirmadasCoincidentes
    FROM #RendimientoOficialPorContenido;
    ${filters.soloHallazgosBajoRendimiento === true
      ? 'DELETE FROM #ReportePreguntas WHERE EsHallazgoBajoRendimiento=0;'
      : ''}
    SELECT * FROM #ReportePreguntas
    ORDER BY ${order} ${direction},ClaveContenido ASC
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    SELECT COUNT(*) AS Total FROM #ReportePreguntas;
  `);
  const [legacyKpiRows = [], officialKpiRows = [], summaryRows = [], itemRows = [], totalRows = []]
    = result.recordsets ?? [];
  const total = Number(totalRows[0]?.Total ?? 0);
  const items = (mapKeysToCamelCase(itemRows) as Array<Record<string, unknown>>).map(item => ({
    ...item,
    hallazgoBajoRendimiento: {
      detectado: item.esHallazgoBajoRendimiento === true,
      codigo: REGLA_BAJO_RENDIMIENTO.codigo,
      version: REGLA_BAJO_RENDIMIENTO.version,
    },
  }));
  return {
    criterios: {
      ...criterios(filters),
      soloHallazgosBajoRendimiento: filters.soloHallazgosBajoRendimiento ?? false,
      reglaBajoRendimiento: REGLA_BAJO_RENDIMIENTO,
    },
    kpis: {
      ...mapKeysToCamelCase(legacyKpiRows[0] ?? {}),
      ...mapKeysToCamelCase(officialKpiRows[0] ?? {}),
    },
    reglaHallazgo: REGLA_BAJO_RENDIMIENTO,
    resumenFiltro: mapKeysToCamelCase(summaryRows[0] ?? {}),
    items,
    pagination: pagination(filters.pagina, filters.limite, total),
  };
}

const groupOrdering: Record<RendimientoGruposQuery['ordenarPor'], string> = {
  grupo: 'Grupo',
  presentadas: 'Presentadas',
  respondidas: 'Respondidas',
  omitidas: 'Omitidas',
  pendientesCorreccion: 'PendientesCorreccion',
  tasaAcierto: 'TasaAcierto',
  porcentajePuntaje: 'PorcentajePuntajePromedio',
  tiempoPromedio: 'TiempoPromedioMilisegundos',
};

export async function getRendimientoGruposReport(
  filters: RendimientoGruposQuery,
  idDocente: number | null,
) {
  const request = bindFilters(pool.request(), filters)
    .input('Offset', sql.Int, (filters.pagina - 1) * filters.limite)
    .input('Limit', sql.Int, filters.limite);
  if (idDocente !== null) request.input('IdDocente', sql.Int, idDocente);
  const order = groupOrdering[filters.ordenarPor];
  const direction = filters.ordenDireccion === 'asc' ? 'ASC' : 'DESC';

  const result = await request.query(`
    SET NOCOUNT ON;
    ${baseSql(filters, idDocente)}

    ;WITH TiempoConMediana AS (
      SELECT B.IdGrupoPregunta,B.ClaveContenido,T.TiempoMilisegundos,T.FuenteTemporal,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY T.TiempoMilisegundos)
          OVER (PARTITION BY B.IdGrupoPregunta,B.ClaveContenido) AS MedianaVariante,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY T.TiempoMilisegundos)
          OVER (PARTITION BY B.IdGrupoPregunta) AS MedianaGrupo
      FROM #BaseRendimientoPregunta B
      JOIN #TiemposRendimientoPregunta T ON T.IdIntentoPregunta=B.IdIntentoPregunta
    )
    SELECT IdGrupoPregunta,ClaveContenido,COUNT(*) AS MuestrasTiempo,
      SUM(CASE WHEN FuenteTemporal='nueva' THEN 1 ELSE 0 END) AS MuestrasTiempoNuevas,
      SUM(CASE WHEN FuenteTemporal='legacy' THEN 1 ELSE 0 END) AS MuestrasTiempoLegacy,
      CAST(AVG(CAST(TiempoMilisegundos AS DECIMAL(18,2))) AS DECIMAL(18,2)) AS TiempoPromedioMilisegundos,
      CAST(MAX(TiempoMilisegundos) AS DECIMAL(18,2)) AS TiempoMaximoMilisegundos,
      CAST(MAX(MedianaVariante) AS DECIMAL(18,2)) AS TiempoMedianaVarianteMilisegundos,
      CAST(MAX(MedianaGrupo) AS DECIMAL(18,2)) AS TiempoMedianaGrupoMilisegundos
    INTO #TiempoGrupoVariante
    FROM TiempoConMediana GROUP BY IdGrupoPregunta,ClaveContenido;

    SELECT IdGrupoPregunta,ClaveContenido,
      COUNT(*) AS PresentacionesOficiales,
      SUM(CASE WHEN PuntajeObtenido IS NOT NULL AND PuntajeMaximoSnapshot>0
        THEN 1 ELSE 0 END) AS MuestrasConfirmadas,
      SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END)
        AS PresentacionesExcluidasSinPuntaje,
      SUM(CASE WHEN PuntajeObtenido IS NOT NULL
        AND (PuntajeMaximoSnapshot IS NULL OR PuntajeMaximoSnapshot<=0) THEN 1 ELSE 0 END)
        AS PresentacionesExcluidasSinMaximoPositivo
    INTO #RendimientoOficialVariantes
    FROM #BaseRendimientoPreguntaOficial
    GROUP BY IdGrupoPregunta,ClaveContenido;

    SELECT IdGrupoPregunta,
      COUNT(*) AS PresentacionesOficiales,
      SUM(CASE WHEN PuntajeObtenido IS NOT NULL AND PuntajeMaximoSnapshot>0
        THEN 1 ELSE 0 END) AS MuestrasConfirmadas,
      SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END)
        AS PresentacionesExcluidasSinPuntaje,
      SUM(CASE WHEN PuntajeObtenido IS NOT NULL
        AND (PuntajeMaximoSnapshot IS NULL OR PuntajeMaximoSnapshot<=0) THEN 1 ELSE 0 END)
        AS PresentacionesExcluidasSinMaximoPositivo
    INTO #RendimientoOficialGrupos
    FROM #BaseRendimientoPreguntaOficial
    GROUP BY IdGrupoPregunta;

    SELECT B.IdGrupoPregunta,B.ClaveContenido,B.ContenidoHashSnapshot,
      MIN(B.IdPregunta) AS IdPregunta,MAX(CONVERT(NVARCHAR(4000),B.Enunciado)) AS Enunciado,
      MAX(B.TipoPregunta) AS Tipo,COUNT(*) AS Presentadas,
      SUM(CASE WHEN B.Respondida=1 THEN 1 ELSE 0 END) AS Respondidas,
      SUM(CASE WHEN B.Respondida=0 THEN 1 ELSE 0 END) AS Omitidas,
      SUM(CASE WHEN B.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS PendientesCorreccion,
      SUM(CASE WHEN B.PuntajeObtenido=B.PuntajeMaximoSnapshot AND B.PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END) AS Correctas,
      SUM(CASE WHEN B.PuntajeObtenido>0 AND B.PuntajeObtenido<B.PuntajeMaximoSnapshot THEN 1 ELSE 0 END) AS Parciales,
      SUM(CASE WHEN B.PuntajeObtenido=0 THEN 1 ELSE 0 END) AS Incorrectas,
      CAST(AVG(CASE WHEN B.PuntajeObtenido IS NOT NULL AND B.PuntajeMaximoSnapshot>0
        THEN B.PuntajeObtenido*100.0/B.PuntajeMaximoSnapshot END) AS DECIMAL(9,2)) AS PorcentajePuntajePromedio,
      CAST(CASE WHEN SUM(CASE WHEN B.PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END)>0
        THEN SUM(CASE WHEN B.PuntajeObtenido=B.PuntajeMaximoSnapshot THEN 1.0 ELSE 0 END)*100.0
          /SUM(CASE WHEN B.PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END)
        ELSE NULL END AS DECIMAL(9,2)) AS TasaAcierto,
      COALESCE(MAX(T.MuestrasTiempo),0) AS MuestrasTiempo,
      COALESCE(MAX(T.MuestrasTiempoNuevas),0) AS MuestrasTiempoNuevas,
      COALESCE(MAX(T.MuestrasTiempoLegacy),0) AS MuestrasTiempoLegacy,
      CAST(COALESCE(MAX(T.MuestrasTiempo),0)*1.0/COUNT(*) AS DECIMAL(9,4)) AS CoberturaTemporal,
      MAX(T.TiempoPromedioMilisegundos) AS TiempoPromedioMilisegundos,
      MAX(T.TiempoMedianaVarianteMilisegundos) AS TiempoMedianaMilisegundos,
      MAX(T.TiempoMaximoMilisegundos) AS TiempoMaximoMilisegundos,
      COALESCE(MAX(O.PresentacionesOficiales),0) AS PresentacionesOficiales,
      COALESCE(MAX(O.MuestrasConfirmadas),0) AS MuestrasConfirmadas,
      COALESCE(MAX(O.PresentacionesExcluidasSinPuntaje),0)
        AS PresentacionesExcluidasSinPuntaje,
      COALESCE(MAX(O.PresentacionesExcluidasSinMaximoPositivo),0)
        AS PresentacionesExcluidasSinMaximoPositivo
    INTO #ReporteVariantesGrupo
    FROM #BaseRendimientoPregunta B
    LEFT JOIN #TiempoGrupoVariante T ON T.IdGrupoPregunta=B.IdGrupoPregunta
      AND T.ClaveContenido=B.ClaveContenido
    LEFT JOIN #RendimientoOficialVariantes O ON O.IdGrupoPregunta=B.IdGrupoPregunta
      AND O.ClaveContenido=B.ClaveContenido
    GROUP BY B.IdGrupoPregunta,B.ClaveContenido,B.ContenidoHashSnapshot;

    SELECT B.IdGrupoPregunta,MAX(B.GrupoTitulo) AS Grupo,
      MIN(B.IdActividad) AS IdActividad,COUNT(DISTINCT B.ClaveContenido) AS CantidadVariantes,
      CAST(MAX(CASE WHEN B.IdBancoGrupoOrigen IS NOT NULL THEN 1 ELSE 0 END) AS bit) AS TieneProcedenciaBanco,
      COUNT(*) AS Presentadas,SUM(CASE WHEN B.Respondida=1 THEN 1 ELSE 0 END) AS Respondidas,
      SUM(CASE WHEN B.Respondida=0 THEN 1 ELSE 0 END) AS Omitidas,
      SUM(CASE WHEN B.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS PendientesCorreccion,
      SUM(CASE WHEN B.PuntajeObtenido=B.PuntajeMaximoSnapshot AND B.PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END) AS Correctas,
      SUM(CASE WHEN B.PuntajeObtenido>0 AND B.PuntajeObtenido<B.PuntajeMaximoSnapshot THEN 1 ELSE 0 END) AS Parciales,
      SUM(CASE WHEN B.PuntajeObtenido=0 THEN 1 ELSE 0 END) AS Incorrectas,
      SUM(CASE WHEN B.TieneJustificacion=1 THEN 1 ELSE 0 END) AS JustificacionesEntregadas,
      CAST(AVG(CASE WHEN B.PuntajeObtenido IS NOT NULL AND B.PuntajeMaximoSnapshot>0
        THEN B.PuntajeObtenido*100.0/B.PuntajeMaximoSnapshot END) AS DECIMAL(9,2)) AS PorcentajePuntajePromedio,
      CAST(CASE WHEN SUM(CASE WHEN B.PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END)>0
        THEN SUM(CASE WHEN B.PuntajeObtenido=B.PuntajeMaximoSnapshot THEN 1.0 ELSE 0 END)*100.0
          /SUM(CASE WHEN B.PuntajeObtenido IS NOT NULL THEN 1 ELSE 0 END)
        ELSE NULL END AS DECIMAL(9,2)) AS TasaAcierto,
      COUNT(T.IdIntentoPregunta) AS MuestrasTiempo,
      SUM(CASE WHEN T.FuenteTemporal='nueva' THEN 1 ELSE 0 END) AS MuestrasTiempoNuevas,
      SUM(CASE WHEN T.FuenteTemporal='legacy' THEN 1 ELSE 0 END) AS MuestrasTiempoLegacy,
      CAST(COUNT(T.IdIntentoPregunta)*1.0/COUNT(*) AS DECIMAL(9,4)) AS CoberturaTemporal,
      CAST(AVG(CAST(T.TiempoMilisegundos AS DECIMAL(18,2))) AS DECIMAL(18,2)) AS TiempoPromedioMilisegundos,
      MAX(TG.TiempoMedianaGrupoMilisegundos) AS TiempoMedianaMilisegundos,
      CAST(MAX(T.TiempoMilisegundos) AS DECIMAL(18,2)) AS TiempoMaximoMilisegundos,
      CAST(MAX(V.PorcentajePuntajePromedio)-MIN(V.PorcentajePuntajePromedio) AS DECIMAL(9,2))
        AS DiferenciaVariantesPuntosPorcentuales,
      COALESCE(MAX(O.PresentacionesOficiales),0) AS PresentacionesOficiales,
      COALESCE(MAX(O.MuestrasConfirmadas),0) AS MuestrasConfirmadas,
      COALESCE(MAX(O.PresentacionesExcluidasSinPuntaje),0)
        AS PresentacionesExcluidasSinPuntaje,
      COALESCE(MAX(O.PresentacionesExcluidasSinMaximoPositivo),0)
        AS PresentacionesExcluidasSinMaximoPositivo
    INTO #ReporteGrupos
    FROM #BaseRendimientoPregunta B
    LEFT JOIN #TiemposRendimientoPregunta T ON T.IdIntentoPregunta=B.IdIntentoPregunta
    LEFT JOIN #TiempoGrupoVariante TG ON TG.IdGrupoPregunta=B.IdGrupoPregunta
      AND TG.ClaveContenido=B.ClaveContenido
    LEFT JOIN #ReporteVariantesGrupo V ON V.IdGrupoPregunta=B.IdGrupoPregunta
      AND V.ClaveContenido=B.ClaveContenido
    LEFT JOIN #RendimientoOficialGrupos O ON O.IdGrupoPregunta=B.IdGrupoPregunta
    GROUP BY B.IdGrupoPregunta;

    ${kpisSql}
    SELECT * INTO #GruposPagina FROM #ReporteGrupos
    ORDER BY ${order} ${direction},IdGrupoPregunta ASC
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    SELECT * FROM #GruposPagina ORDER BY ${order} ${direction},IdGrupoPregunta ASC;
    SELECT COUNT(*) AS Total FROM #ReporteGrupos;
    SELECT V.* FROM #ReporteVariantesGrupo V
    JOIN #GruposPagina G ON G.IdGrupoPregunta=V.IdGrupoPregunta
    ORDER BY V.IdGrupoPregunta,V.PorcentajePuntajePromedio DESC,V.ClaveContenido;
  `);
  const [legacyKpiRows = [], officialKpiRows = [], groupRows = [], totalRows = [], variantRows = []]
    = result.recordsets ?? [];
  const variants = mapKeysToCamelCase(variantRows) as Array<Record<string, unknown>>;
  const items = (mapKeysToCamelCase(groupRows) as Array<Record<string, unknown>>).map(group => ({
    ...group,
    variantes: variants.filter(variant => variant.idGrupoPregunta === group.idGrupoPregunta),
  }));
  const total = Number(totalRows[0]?.Total ?? 0);
  return {
    criterios: criterios(filters),
    kpis: {
      ...mapKeysToCamelCase(legacyKpiRows[0] ?? {}),
      ...mapKeysToCamelCase(officialKpiRows[0] ?? {}),
    },
    items,
    pagination: pagination(filters.pagina, filters.limite, total),
  };
}

const optionOrdering: Record<RendimientoOpcionesQuery['ordenarPor'], string> = {
  posicion: 'Posicion',
  selecciones: 'Selecciones',
  porcentajeSeleccion: 'PorcentajeSeleccion',
};

export async function getRendimientoOpcionesReport(
  idPregunta: number,
  filters: RendimientoOpcionesQuery,
  idDocente: number | null,
) {
  const request = bindFilters(pool.request(), filters)
    .input('IdPreguntaObjetivo', sql.Int, idPregunta)
    .input('Offset', sql.Int, (filters.pagina - 1) * filters.limite)
    .input('Limit', sql.Int, filters.limite);
  if (idDocente !== null) request.input('IdDocente', sql.Int, idDocente);
  const order = optionOrdering[filters.ordenarPor];
  const direction = filters.ordenDireccion === 'asc' ? 'ASC' : 'DESC';
  const optionTieBreak = order === 'Posicion' ? '' : ',Posicion ASC';
  const legacyIdentityClause = `AND (
    IP.IdPregunta=@IdPreguntaObjetivo OR
    (PObjetivo.ContenidoHash IS NOT NULL AND IP.ContenidoHashSnapshot=PObjetivo.ContenidoHash)
  )`;
  const exactIdentity = Boolean(filters.claveContenido);
  const identityClause = exactIdentity ? '' : legacyIdentityClause;
  const exactIdentitySql = exactIdentity ? `
    SELECT
      CASE WHEN EXISTS (
        SELECT 1 FROM #BaseRendimientoPregunta
        WHERE IdPregunta=@IdPreguntaObjetivo AND ClaveContenido=@ClaveContenido
      ) THEN 1 ELSE 0 END AS AnchorValido;

    DELETE FROM #BaseRendimientoPregunta WHERE ClaveContenido<>@ClaveContenido;
    DELETE FROM #BaseRendimientoPreguntaOficial WHERE ClaveContenido<>@ClaveContenido;

    SELECT B.IdIntentoPregunta,
      HASHBYTES('SHA2_256',COALESCE(
        STRING_AGG(CONVERT(NVARCHAR(MAX),CONCAT(
          S.Posicion,NCHAR(31),S.TextoSnapshot,NCHAR(31),CONVERT(INT,S.EsCorrectaSnapshot)
        )),NCHAR(30)) WITHIN GROUP (ORDER BY S.Posicion),N'<sin_opciones>'
      )) AS Forma
    INTO #FormasOpciones
    FROM #BaseRendimientoPregunta B
    LEFT JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=B.IdIntentoPregunta
    GROUP BY B.IdIntentoPregunta;

    SELECT COUNT(DISTINCT Forma) AS CantidadFormas FROM #FormasOpciones;
  ` : '';

  const result = await request.query(`
    SET NOCOUNT ON;
    DECLARE @HashObjetivo CHAR(64);
    SELECT @HashObjetivo=ContenidoHash FROM dbo.Pregunta WHERE Id=@IdPreguntaObjetivo;

    ${baseSql(
      filters,
      idDocente,
      identityClause.replaceAll('PObjetivo.ContenidoHash', '@HashObjetivo'),
      false,
    )}
    ${exactIdentitySql}

    SELECT B.ClaveContenido,B.ContenidoHashSnapshot,S.Posicion,S.TextoSnapshot AS Texto,
      S.EsCorrectaSnapshot AS EsCorrecta,
      CAST(CASE WHEN S.EsCorrectaSnapshot=0 THEN 1 ELSE 0 END AS bit) AS EsDistractor,
      COUNT(*) AS Presentaciones,
      SUM(CASE WHEN RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END) AS Selecciones,
      CAST(CASE WHEN SUM(CASE WHEN B.Respondida=1 THEN 1 ELSE 0 END)>0
        THEN SUM(CASE WHEN RO.IdOpcion IS NOT NULL THEN 1.0 ELSE 0 END)*100.0
          /SUM(CASE WHEN B.Respondida=1 THEN 1 ELSE 0 END)
        ELSE NULL END AS DECIMAL(9,2)) AS PorcentajeSeleccion
    INTO #ReporteOpciones
    FROM #BaseRendimientoPregunta B
    JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=B.IdIntentoPregunta
    LEFT JOIN dbo.RespuestaOpcion RO ON RO.IdRespuesta=B.IdRespuesta AND RO.IdOpcion=S.IdOpcionOrigen
    GROUP BY B.ClaveContenido,B.ContenidoHashSnapshot,S.Posicion,S.TextoSnapshot,S.EsCorrectaSnapshot;

    SELECT COUNT(*) AS Presentadas,
      COALESCE(SUM(CASE WHEN Respondida=1 THEN 1 ELSE 0 END),0) AS Respondidas,
      COALESCE(SUM(CASE WHEN Respondida=0 THEN 1 ELSE 0 END),0) AS Omitidas,
      COALESCE(SUM(CASE WHEN TieneJustificacion=1 THEN 1 ELSE 0 END),0) AS JustificacionesEntregadas,
      (SELECT COUNT(*) FROM #BaseRendimientoPreguntaOficial) AS PresentacionesOficiales,
      (SELECT COUNT(*) FROM #BaseRendimientoPreguntaOficial
        WHERE PuntajeObtenido IS NOT NULL AND PuntajeMaximoSnapshot>0) AS MuestrasConfirmadas,
      (SELECT COUNT(*) FROM #BaseRendimientoPreguntaOficial
        WHERE PuntajeObtenido IS NULL) AS PresentacionesExcluidasSinPuntaje,
      (SELECT COUNT(*) FROM #BaseRendimientoPreguntaOficial
        WHERE PuntajeObtenido IS NOT NULL
          AND (PuntajeMaximoSnapshot IS NULL OR PuntajeMaximoSnapshot<=0))
        AS PresentacionesExcluidasSinMaximoPositivo,
      (SELECT COALESCE(SUM(Selecciones),0) FROM #ReporteOpciones) AS TotalSelecciones,
      (SELECT COALESCE(SUM(CASE WHEN EsDistractor=1 THEN Selecciones ELSE 0 END),0)
        FROM #ReporteOpciones) AS SeleccionesDistractores
    FROM #BaseRendimientoPregunta;
    SELECT * FROM #ReporteOpciones
    ORDER BY ${order} ${direction},ClaveContenido ASC${optionTieBreak}
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    SELECT COUNT(*) AS Total FROM #ReporteOpciones;
  `);
  const recordsets = result.recordsets ?? [];
  let offset = 0;
  if (exactIdentity) {
    const anchorRows = recordsets[offset++] ?? [];
    const shapeRows = recordsets[offset++] ?? [];
    if (Number(anchorRows[0]?.AnchorValido ?? 0) !== 1) {
      throw new ReportePreguntasError(
        'QUESTION_CONTENT_NOT_FOUND',
        'La pregunta y la identidad histórica no corresponden al alcance solicitado',
        404,
      );
    }
    if (Number(shapeRows[0]?.CantidadFormas ?? 0) > 1) {
      throw new ReportePreguntasError(
        'QUESTION_OPTION_EVIDENCE_INCONSISTENT',
        'Los snapshots de opciones de esta identidad histórica no son reconciliables',
        409,
      );
    }
  }
  const kpiRows = recordsets[offset++] ?? [];
  const itemRows = recordsets[offset++] ?? [];
  const totalRows = recordsets[offset] ?? [];
  const total = Number(totalRows[0]?.Total ?? 0);
  return {
    criterios: {
      ...criterios(filters),
      idPregunta,
      claveContenido: filters.claveContenido ?? null,
    },
    kpis: mapKeysToCamelCase(kpiRows[0] ?? {}),
    items: mapKeysToCamelCase(itemRows),
    pagination: pagination(filters.pagina, filters.limite, total),
  };
}
