import * as sql from 'mssql';
import { pool } from '../config/db';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { RendimientoEvaluacionesQuery } from '../schemas/reportes.schema';

const identifierFilters = [
  ['idCarrera', 'C.Id = @IdCarrera'],
  ['idMateria', 'MD.IdMateria = @IdMateria'],
  ['idMateriaDivision', 'MD.Id = @IdMateriaDivision'],
  ['idActividad', 'A.Id = @IdActividad'],
  ['idPublicacion', 'P.Id = @IdPublicacion'],
] as const;

const bindFilters = (request: sql.Request, filters: RendimientoEvaluacionesQuery): sql.Request => {
  if (filters.idCarrera) request.input('IdCarrera', sql.Int, filters.idCarrera);
  if (filters.idMateria) request.input('IdMateria', sql.Int, filters.idMateria);
  if (filters.idMateriaDivision) request.input('IdMateriaDivision', sql.Int, filters.idMateriaDivision);
  if (filters.idActividad) request.input('IdActividad', sql.Int, filters.idActividad);
  if (filters.idPublicacion) request.input('IdPublicacion', sql.Int, filters.idPublicacion);
  if (filters.estado) request.input('Estado', sql.NVarChar, filters.estado);
  if (filters.fechaDesde) request.input('FechaDesde', sql.DateTime2, new Date(filters.fechaDesde));
  if (filters.fechaHasta) request.input('FechaHasta', sql.DateTime2, new Date(filters.fechaHasta));
  if (filters.tipoIncidente) request.input('TipoIncidente', sql.VarChar(30), filters.tipoIncidente);
  if (filters.severidad) request.input('Severidad', sql.VarChar(30), filters.severidad);
  return request;
};

const identifierWhere = (filters: RendimientoEvaluacionesQuery): string =>
  identifierFilters
    .filter(([key]) => filters[key] !== undefined)
    .map(([, clause]) => `AND ${clause}`)
    .join(' ');

export const isEvaluationReportScopeAllowed = async (
  idDocente: number,
  filters: RendimientoEvaluacionesQuery,
): Promise<boolean> => {
  if (!identifierFilters.some(([key]) => filters[key] !== undefined)) return true;

  const request = bindFilters(pool.request(), filters)
    .input('IdDocente', sql.Int, idDocente);
  const result = await request.query(`
    SELECT TOP 1 1 AS Permitido
    FROM Publicacion P
    INNER JOIN Actividad A ON A.Id = P.IdActividad
    INNER JOIN MateriaDivision MD ON MD.Id = P.IdMateriaDivision
    INNER JOIN Materia M ON M.Id = MD.IdMateria
    INNER JOIN Carrera C ON C.Id = M.IdCarrera
    WHERE A.Tipo = 'evaluacion'
      AND MD.IdDocente = @IdDocente
      ${identifierWhere(filters)}
  `);
  return result.recordset.length > 0;
};

const hierarchyKeys = [
  'idCarrera', 'idMateria', 'idMateriaDivision', 'idActividad', 'idPublicacion',
] as const;

export const areEvaluationReportFiltersConsistent = async (
  filters: RendimientoEvaluacionesQuery,
): Promise<boolean> => {
  if (hierarchyKeys.filter(key => filters[key] !== undefined).length < 2) return true;

  const request = pool.request()
    .input('IdCarrera', sql.Int, filters.idCarrera ?? null)
    .input('IdMateria', sql.Int, filters.idMateria ?? null)
    .input('IdMateriaDivision', sql.Int, filters.idMateriaDivision ?? null)
    .input('IdActividad', sql.Int, filters.idActividad ?? null)
    .input('IdPublicacion', sql.Int, filters.idPublicacion ?? null);
  const result = await request.query(`
    SELECT CAST(CASE WHEN
      (@IdCarrera IS NULL OR @IdMateria IS NULL OR EXISTS (
        SELECT 1 FROM Materia M
        WHERE M.Id=@IdMateria AND M.IdCarrera=@IdCarrera
      ))
      AND (@IdMateriaDivision IS NULL OR EXISTS (
        SELECT 1
        FROM MateriaDivision MD
        INNER JOIN Materia M ON M.Id=MD.IdMateria
        WHERE MD.Id=@IdMateriaDivision
          AND (@IdMateria IS NULL OR MD.IdMateria=@IdMateria)
          AND (@IdCarrera IS NULL OR M.IdCarrera=@IdCarrera)
      ))
      AND (@IdActividad IS NULL OR NOT EXISTS (
        SELECT 1
        FROM (VALUES (@IdCarrera),(@IdMateria),(@IdMateriaDivision)) F(Id)
        WHERE F.Id IS NOT NULL
      ) OR EXISTS (
        SELECT 1
        FROM Publicacion P
        INNER JOIN MateriaDivision MD ON MD.Id=P.IdMateriaDivision
        INNER JOIN Materia M ON M.Id=MD.IdMateria
        WHERE P.IdActividad=@IdActividad
          AND (@IdMateriaDivision IS NULL OR MD.Id=@IdMateriaDivision)
          AND (@IdMateria IS NULL OR M.Id=@IdMateria)
          AND (@IdCarrera IS NULL OR M.IdCarrera=@IdCarrera)
      ))
      AND (@IdPublicacion IS NULL OR EXISTS (
        SELECT 1
        FROM Publicacion P
        INNER JOIN MateriaDivision MD ON MD.Id=P.IdMateriaDivision
        INNER JOIN Materia M ON M.Id=MD.IdMateria
        WHERE P.Id=@IdPublicacion
          AND (@IdActividad IS NULL OR P.IdActividad=@IdActividad)
          AND (@IdMateriaDivision IS NULL OR MD.Id=@IdMateriaDivision)
          AND (@IdMateria IS NULL OR M.Id=@IdMateria)
          AND (@IdCarrera IS NULL OR M.IdCarrera=@IdCarrera)
      ))
      THEN 1 ELSE 0 END AS bit) AS Consistente;
  `);
  return Boolean(result.recordset[0]?.Consistente);
};

export type ReportSeriesPeriod = {
  desde: Date;
  hasta: Date;
  ahora: Date;
  mesesCalendarioIncluidos: number;
};

const orderingMap: Record<RendimientoEvaluacionesQuery['ordenarPor'], string> = {
  evaluacion: 'Titulo',
  fecha: 'FechaInicio',
  promedio: 'PromedioIntentosCalificados',
  entregados: 'Entregados',
  aprobacion: 'PorcentajeAprobacionIntentos',
  pendientesCorreccion: 'IntentosPendientesCorreccion',
};

const numberValue = (value: unknown): number => Number(value ?? 0);

const porcentaje = (numerador: number, denominador: number): number | null =>
  denominador === 0 ? null : Math.round((numerador * 10000) / denominador) / 100;

const extraerBloquesDocentes = (source: Record<string, unknown>) => {
  const intentosValidosEntregados = numberValue(source.oficialIntentosValidosEntregados);
  const resultadosConsiderados = numberValue(source.oficialResultadosConsiderados);
  const resultadosOficiales = {
    intentosValidosEntregados,
    resultadosConsiderados,
    resultadosPendientes: numberValue(source.oficialResultadosPendientes),
    intentosPendientesConfirmacion: numberValue(source.oficialIntentosPendientesConfirmacion),
    intentosConfirmadosSinNota: numberValue(source.oficialIntentosConfirmadosSinNota),
    intentosConPreguntasSinPuntaje: numberValue(source.oficialIntentosConPreguntasSinPuntaje),
    preguntasSinPuntaje: numberValue(source.oficialPreguntasSinPuntaje),
    aprobados: numberValue(source.oficialAprobados),
    desaprobados: numberValue(source.oficialDesaprobados),
    porcentajeAprobacion: porcentaje(
      numberValue(source.oficialAprobados),
      resultadosConsiderados,
    ),
    porcentajeCoberturaConfirmada: porcentaje(
      resultadosConsiderados,
      intentosValidosEntregados,
    ),
  };
  const pendientesOperativos = {
    intentosEntregadosPendientes: numberValue(source.operativoIntentosEntregadosPendientes),
    intentosPendientesConfirmacion: numberValue(source.operativoIntentosPendientesConfirmacion),
    intentosSinNotaFinal: numberValue(source.operativoIntentosSinNotaFinal),
    intentosConPreguntasSinPuntaje: numberValue(source.operativoIntentosConPreguntasSinPuntaje),
    preguntasSinPuntaje: numberValue(source.operativoPreguntasSinPuntaje),
  };
  const clean = Object.fromEntries(Object.entries(source).filter(([key]) =>
    !key.startsWith('oficial') && !key.startsWith('operativo')));
  return { ...clean, resultadosOficiales, pendientesOperativos };
};

type AggregateItem = ReturnType<typeof extraerBloquesDocentes>;
type ComparisonDimension = 'carreras' | 'materias' | 'comisiones';

const stableId = (item: AggregateItem, dimension: ComparisonDimension): number => {
  if (dimension === 'carreras') return numberValue(item.idCarrera);
  if (dimension === 'materias') return numberValue(item.idMateria);
  return numberValue(item.idMateriaDivision);
};

const displayName = (item: AggregateItem, dimension: ComparisonDimension): string => {
  if (dimension === 'carreras') return String(item.carrera ?? '');
  if (dimension === 'materias') return String(item.materia ?? '');
  return String(item.division ?? '');
};

const approvalRatio = (item: AggregateItem): number => {
  const considered = item.resultadosOficiales.resultadosConsiderados;
  return considered === 0 ? Number.POSITIVE_INFINITY
    : item.resultadosOficiales.aprobados / considered;
};

const buildComparison = (
  items: AggregateItem[],
  dimension: ComparisonDimension,
  minimumSample: number,
  minimumCoverage: number,
) => {
  const eligible: AggregateItem[] = [];
  const limited: Array<AggregateItem & { motivosNoElegibilidad: string[] }> = [];
  const withoutResults: Array<AggregateItem & { motivosNoElegibilidad: string[] }> = [];

  items.forEach(item => {
    const official = item.resultadosOficiales;
    if (official.resultadosConsiderados === 0) {
      withoutResults.push({ ...item, motivosNoElegibilidad: ['SIN_RESULTADOS_CONFIRMADOS'] });
      return;
    }

    const enoughSample = official.resultadosConsiderados >= minimumSample;
    const enoughCoverage = official.intentosValidosEntregados > 0 &&
      official.resultadosConsiderados * 100 >= minimumCoverage * official.intentosValidosEntregados;
    if (enoughSample && enoughCoverage) {
      eligible.push(item);
      return;
    }

    const reasons: string[] = [];
    if (!enoughSample) reasons.push('MUESTRA_INSUFICIENTE');
    if (!enoughCoverage) reasons.push('COBERTURA_INSUFICIENTE');
    limited.push({ ...item, motivosNoElegibilidad: reasons });
  });

  eligible.sort((left, right) =>
    approvalRatio(left) - approvalRatio(right) ||
    right.resultadosOficiales.resultadosConsiderados -
      left.resultadosOficiales.resultadosConsiderados ||
    stableId(left, dimension) - stableId(right, dimension));
  limited.sort((left, right) =>
    right.resultadosOficiales.resultadosConsiderados -
      left.resultadosOficiales.resultadosConsiderados ||
    (right.resultadosOficiales.porcentajeCoberturaConfirmada ?? -1) -
      (left.resultadosOficiales.porcentajeCoberturaConfirmada ?? -1) ||
    stableId(left, dimension) - stableId(right, dimension));
  withoutResults.sort((left, right) =>
    displayName(left, dimension).localeCompare(displayName(right, dimension), 'es') ||
    stableId(left, dimension) - stableId(right, dimension));

  return {
    elegibles: eligible.map((item, index) => ({ ...item, posicion: index + 1 })),
    evidenciaLimitada: limited,
    sinResultados: withoutResults,
  };
};

const REPORT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const monthParts = (value: Date): { year: number; month: number } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(value);
  return {
    year: Number(parts.find(part => part.type === 'year')?.value),
    month: Number(parts.find(part => part.type === 'month')?.value),
  };
};

const monthLabels = (period: ReportSeriesPeriod): string[] => {
  const start = monthParts(period.desde);
  return Array.from({ length: period.mesesCalendarioIncluidos }, (_, index) => {
    const date = new Date(Date.UTC(start.year, start.month - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};

const timeZoneOffsetMs = (value: Date): number => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(candidate => candidate.type === type)?.value);
  const representedAsUtc = Date.UTC(
    part('year'), part('month') - 1, part('day'),
    part('hour'), part('minute'), part('second'),
  );
  return representedAsUtc - value.getTime();
};

const localMonthBoundaryUtc = (year: number, zeroBasedMonth: number): number => {
  const nominalUtc = Date.UTC(year, zeroBasedMonth, 1);
  let candidate = nominalUtc - timeZoneOffsetMs(new Date(nominalUtc));
  candidate = nominalUtc - timeZoneOffsetMs(new Date(candidate));
  return candidate;
};

const isFullMonth = (label: string, period: ReportSeriesPeriod): boolean => {
  const [year, month] = label.split('-').map(Number);
  const startUtc = localMonthBoundaryUtc(year, month - 1);
  const nextUtc = localMonthBoundaryUtc(year, month);
  return period.desde.getTime() <= startUtc &&
    period.hasta.getTime() >= nextUtc - 1 &&
    period.ahora.getTime() >= nextUtc;
};

const buildMonthlySeries = (
  rows: Array<Record<string, unknown>>,
  period: ReportSeriesPeriod,
) => {
  const byPeriod = new Map(
    (mapKeysToCamelCase(rows) as Array<Record<string, unknown>>)
      .map(row => [String(row.periodo), row] as const),
  );
  return monthLabels(period).map(periodLabel => {
    const source = byPeriod.get(periodLabel) || {};
    const aggregate = extraerBloquesDocentes(source);
    return {
      periodo: periodLabel,
      periodoCompleto: isFullMonth(periodLabel, period),
      publicaciones: numberValue(aggregate.publicaciones),
      publicacionesConResultadosPendientes:
        numberValue(aggregate.publicacionesConResultadosPendientes),
      resultadosOficiales: aggregate.resultadosOficiales,
    };
  });
};

export const getRendimientoEvaluacionesReport = async (
  filters: RendimientoEvaluacionesQuery,
  idDocente: number | null,
  seriesPeriod?: ReportSeriesPeriod,
) => {
  const request = bindFilters(pool.request(), filters)
    .input('Offset', sql.Int, (filters.pagina - 1) * filters.limite)
    .input('Limit', sql.Int, filters.limite);
  if (idDocente !== null) request.input('IdDocente', sql.Int, idDocente);

  const scopeClause = idDocente !== null ? 'AND MD.IdDocente = @IdDocente' : '';
  const stateClause = filters.estado ? 'AND A.Estado = @Estado' : '';
  const dateFromClause = filters.fechaDesde ? 'AND P.FechaInicio >= @FechaDesde' : '';
  const dateToClause = filters.fechaHasta ? 'AND P.FechaInicio <= @FechaHasta' : '';
  const orderBy = orderingMap[filters.ordenarPor];
  const direction = filters.ordenDireccion === 'asc' ? 'ASC' : 'DESC';
  const validSelectionJoins = filters.alcanceIntentos === 'validos' ? `
    LEFT JOIN IntentoValidoOverride IVO
      ON IVO.IdPublicacion=I.IdPublicacion AND IVO.IdAlumno=I.IdAlumno
    OUTER APPLY (
      SELECT COALESCE(IVO.IdIntento,(
        SELECT TOP 1 IV.Id FROM Intento IV
        WHERE IV.IdPublicacion=I.IdPublicacion AND IV.IdAlumno=I.IdAlumno
          AND IV.Estado='entregado'
        ORDER BY IV.FechaFin DESC,IV.NumeroIntento DESC,IV.Id DESC
      )) AS IdIntentoValido
    ) IVS` : '';
  const academicScope = filters.alcanceIntentos === 'validos'
    ? 'AND I.Id=IVS.IdIntentoValido'
    : '';
  const pendingFilter = filters.conPendientesCorreccion === true
    ? 'DELETE FROM #ReporteEvaluaciones WHERE IntentosPendientesCorreccion=0;'
    : filters.conPendientesCorreccion === false
      ? 'DELETE FROM #ReporteEvaluaciones WHERE IntentosPendientesCorreccion>0;'
      : '';
  const incidentTypeClause = filters.tipoIncidente ? 'AND E.Tipo=@TipoIncidente' : '';
  const incidentSeverityClause = filters.severidad
    ? "AND COALESCE(DS.Accion,'sin_clasificar')=@Severidad"
    : '';
  const unreviewedClause = filters.soloIncidentesSinRevisar === true
    ? "AND COALESCE(RI.Estado,'pendiente')='pendiente'"
    : '';
  const incidentFilterActive = Boolean(
    filters.tipoIncidente || filters.severidad || filters.soloIncidentesSinRevisar === true,
  );
  const incidentPublicationFilter = filters.conIncidentes === true || incidentFilterActive
    ? 'DELETE FROM #ReporteEvaluaciones WHERE TotalIncidentes=0;'
    : filters.conIncidentes === false
      ? 'DELETE FROM #ReporteEvaluaciones WHERE TotalIncidentes>0;'
      : '';
  const monthlyInstitutionalSql = filters.incluirSerieMensual === true ? `
    SELECT
      CONVERT(char(7),CAST(
        FechaInicio AT TIME ZONE 'UTC' AT TIME ZONE 'Argentina Standard Time'
        AS datetime2
      ),120) AS Periodo,
      COUNT(*) AS Publicaciones,
      COALESCE(SUM(CASE WHEN OficialResultadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConResultadosPendientes,
      COALESCE(SUM(OficialIntentosValidosEntregados),0) AS OficialIntentosValidosEntregados,
      COALESCE(SUM(OficialResultadosConsiderados),0) AS OficialResultadosConsiderados,
      COALESCE(SUM(OficialResultadosPendientes),0) AS OficialResultadosPendientes,
      COALESCE(SUM(OficialIntentosPendientesConfirmacion),0)
        AS OficialIntentosPendientesConfirmacion,
      COALESCE(SUM(OficialIntentosConfirmadosSinNota),0) AS OficialIntentosConfirmadosSinNota,
      COALESCE(SUM(OficialIntentosConPreguntasSinPuntaje),0)
        AS OficialIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OficialPreguntasSinPuntaje),0) AS OficialPreguntasSinPuntaje,
      COALESCE(SUM(OficialAprobados),0) AS OficialAprobados,
      COALESCE(SUM(OficialDesaprobados),0) AS OficialDesaprobados
    FROM #ReporteEvaluaciones
    GROUP BY CONVERT(char(7),CAST(
      FechaInicio AT TIME ZONE 'UTC' AT TIME ZONE 'Argentina Standard Time'
      AS datetime2
    ),120)
    ORDER BY Periodo;
  ` : '';
  const institutionalSql = filters.incluirResumenInstitucional === true ? `
    SELECT
      COUNT(*) AS Publicaciones,
      COALESCE(SUM(CASE WHEN OficialResultadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConResultadosPendientes,
      COALESCE(SUM(CASE WHEN OperativoIntentosEntregadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConPendientesOperativos,
      COALESCE(SUM(OficialIntentosValidosEntregados),0) AS OficialIntentosValidosEntregados,
      COALESCE(SUM(OficialResultadosConsiderados),0) AS OficialResultadosConsiderados,
      COALESCE(SUM(OficialResultadosPendientes),0) AS OficialResultadosPendientes,
      COALESCE(SUM(OficialIntentosPendientesConfirmacion),0)
        AS OficialIntentosPendientesConfirmacion,
      COALESCE(SUM(OficialIntentosConfirmadosSinNota),0) AS OficialIntentosConfirmadosSinNota,
      COALESCE(SUM(OficialIntentosConPreguntasSinPuntaje),0)
        AS OficialIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OficialPreguntasSinPuntaje),0) AS OficialPreguntasSinPuntaje,
      COALESCE(SUM(OficialAprobados),0) AS OficialAprobados,
      COALESCE(SUM(OficialDesaprobados),0) AS OficialDesaprobados,
      COALESCE(SUM(OperativoIntentosEntregadosPendientes),0)
        AS OperativoIntentosEntregadosPendientes,
      COALESCE(SUM(OperativoIntentosPendientesConfirmacion),0)
        AS OperativoIntentosPendientesConfirmacion,
      COALESCE(SUM(OperativoIntentosSinNotaFinal),0) AS OperativoIntentosSinNotaFinal,
      COALESCE(SUM(OperativoIntentosConPreguntasSinPuntaje),0)
        AS OperativoIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OperativoPreguntasSinPuntaje),0) AS OperativoPreguntasSinPuntaje
    FROM #ReporteEvaluaciones;

    SELECT
      IdCarrera,Carrera,
      COUNT(*) AS Publicaciones,
      COALESCE(SUM(CASE WHEN OficialResultadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConResultadosPendientes,
      COALESCE(SUM(CASE WHEN OperativoIntentosEntregadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConPendientesOperativos,
      COALESCE(SUM(OficialIntentosValidosEntregados),0) AS OficialIntentosValidosEntregados,
      COALESCE(SUM(OficialResultadosConsiderados),0) AS OficialResultadosConsiderados,
      COALESCE(SUM(OficialResultadosPendientes),0) AS OficialResultadosPendientes,
      COALESCE(SUM(OficialIntentosPendientesConfirmacion),0)
        AS OficialIntentosPendientesConfirmacion,
      COALESCE(SUM(OficialIntentosConfirmadosSinNota),0) AS OficialIntentosConfirmadosSinNota,
      COALESCE(SUM(OficialIntentosConPreguntasSinPuntaje),0)
        AS OficialIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OficialPreguntasSinPuntaje),0) AS OficialPreguntasSinPuntaje,
      COALESCE(SUM(OficialAprobados),0) AS OficialAprobados,
      COALESCE(SUM(OficialDesaprobados),0) AS OficialDesaprobados,
      COALESCE(SUM(OperativoIntentosEntregadosPendientes),0)
        AS OperativoIntentosEntregadosPendientes,
      COALESCE(SUM(OperativoIntentosPendientesConfirmacion),0)
        AS OperativoIntentosPendientesConfirmacion,
      COALESCE(SUM(OperativoIntentosSinNotaFinal),0) AS OperativoIntentosSinNotaFinal,
      COALESCE(SUM(OperativoIntentosConPreguntasSinPuntaje),0)
        AS OperativoIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OperativoPreguntasSinPuntaje),0) AS OperativoPreguntasSinPuntaje
    FROM #ReporteEvaluaciones
    GROUP BY IdCarrera,Carrera
    ORDER BY Carrera,IdCarrera;

    SELECT
      IdCarrera,Carrera,IdMateria,Materia,
      COUNT(*) AS Publicaciones,
      COALESCE(SUM(CASE WHEN OficialResultadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConResultadosPendientes,
      COALESCE(SUM(CASE WHEN OperativoIntentosEntregadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConPendientesOperativos,
      COALESCE(SUM(OficialIntentosValidosEntregados),0) AS OficialIntentosValidosEntregados,
      COALESCE(SUM(OficialResultadosConsiderados),0) AS OficialResultadosConsiderados,
      COALESCE(SUM(OficialResultadosPendientes),0) AS OficialResultadosPendientes,
      COALESCE(SUM(OficialIntentosPendientesConfirmacion),0)
        AS OficialIntentosPendientesConfirmacion,
      COALESCE(SUM(OficialIntentosConfirmadosSinNota),0) AS OficialIntentosConfirmadosSinNota,
      COALESCE(SUM(OficialIntentosConPreguntasSinPuntaje),0)
        AS OficialIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OficialPreguntasSinPuntaje),0) AS OficialPreguntasSinPuntaje,
      COALESCE(SUM(OficialAprobados),0) AS OficialAprobados,
      COALESCE(SUM(OficialDesaprobados),0) AS OficialDesaprobados,
      COALESCE(SUM(OperativoIntentosEntregadosPendientes),0)
        AS OperativoIntentosEntregadosPendientes,
      COALESCE(SUM(OperativoIntentosPendientesConfirmacion),0)
        AS OperativoIntentosPendientesConfirmacion,
      COALESCE(SUM(OperativoIntentosSinNotaFinal),0) AS OperativoIntentosSinNotaFinal,
      COALESCE(SUM(OperativoIntentosConPreguntasSinPuntaje),0)
        AS OperativoIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OperativoPreguntasSinPuntaje),0) AS OperativoPreguntasSinPuntaje
    FROM #ReporteEvaluaciones
    GROUP BY IdCarrera,Carrera,IdMateria,Materia
    ORDER BY Carrera,Materia,IdMateria;

    SELECT
      IdCarrera,Carrera,IdMateria,Materia,IdMateriaDivision,Division,
      COUNT(*) AS Publicaciones,
      COALESCE(SUM(CASE WHEN OficialResultadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConResultadosPendientes,
      COALESCE(SUM(CASE WHEN OperativoIntentosEntregadosPendientes>0 THEN 1 ELSE 0 END),0)
        AS PublicacionesConPendientesOperativos,
      COALESCE(SUM(OficialIntentosValidosEntregados),0) AS OficialIntentosValidosEntregados,
      COALESCE(SUM(OficialResultadosConsiderados),0) AS OficialResultadosConsiderados,
      COALESCE(SUM(OficialResultadosPendientes),0) AS OficialResultadosPendientes,
      COALESCE(SUM(OficialIntentosPendientesConfirmacion),0)
        AS OficialIntentosPendientesConfirmacion,
      COALESCE(SUM(OficialIntentosConfirmadosSinNota),0) AS OficialIntentosConfirmadosSinNota,
      COALESCE(SUM(OficialIntentosConPreguntasSinPuntaje),0)
        AS OficialIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OficialPreguntasSinPuntaje),0) AS OficialPreguntasSinPuntaje,
      COALESCE(SUM(OficialAprobados),0) AS OficialAprobados,
      COALESCE(SUM(OficialDesaprobados),0) AS OficialDesaprobados,
      COALESCE(SUM(OperativoIntentosEntregadosPendientes),0)
        AS OperativoIntentosEntregadosPendientes,
      COALESCE(SUM(OperativoIntentosPendientesConfirmacion),0)
        AS OperativoIntentosPendientesConfirmacion,
      COALESCE(SUM(OperativoIntentosSinNotaFinal),0) AS OperativoIntentosSinNotaFinal,
      COALESCE(SUM(OperativoIntentosConPreguntasSinPuntaje),0)
        AS OperativoIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OperativoPreguntasSinPuntaje),0) AS OperativoPreguntasSinPuntaje
    FROM #ReporteEvaluaciones
    GROUP BY IdCarrera,Carrera,IdMateria,Materia,IdMateriaDivision,Division
    ORDER BY Carrera,Materia,IdMateria,Division,IdMateriaDivision;

    ${monthlyInstitutionalSql}
  ` : '';

  const result = await request.query(`
    SET NOCOUNT ON;

    SELECT
      P.Id AS IdPublicacion,
      A.Id AS IdActividad,
      A.Titulo,
      MD.IdMateria,
      M.Nombre AS Materia,
      C.Id AS IdCarrera,
      C.Nombre AS Carrera,
      MD.Id AS IdMateriaDivision,
      D.Descripcion AS Division,
      P.FechaInicio,
      P.FechaFin,
      A.Estado,
      A.EscalaCalificacion,
      A.NotaAprobacion
    INTO #PublicacionesAlcanzadas
    FROM Publicacion P
    INNER JOIN Actividad A ON A.Id = P.IdActividad
    INNER JOIN MateriaDivision MD ON MD.Id = P.IdMateriaDivision
    INNER JOIN Materia M ON M.Id = MD.IdMateria
    INNER JOIN Carrera C ON C.Id = M.IdCarrera
    INNER JOIN Division D ON D.Id = MD.IdDivision
    WHERE A.Tipo = 'evaluacion'
      ${scopeClause}
      ${identifierWhere(filters)}
      ${stateClause}
      ${dateFromClause}
      ${dateToClause};

    SELECT
      PA.IdPublicacion,
      COUNT(IM.IdAlumno) AS AlumnosAlcanzados
    INTO #Padrones
    FROM #PublicacionesAlcanzadas PA
    LEFT JOIN InscripcionMateria IM ON IM.IdMateriaDivision = PA.IdMateriaDivision
    GROUP BY PA.IdPublicacion;

    SELECT I.Id AS IdIntento,
      SUM(CASE WHEN IP.Id IS NOT NULL AND IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END)
        AS PreguntasSinPuntaje
    INTO #PreguntasPendientesIntento
    FROM Intento I
    LEFT JOIN IntentoPregunta IP ON IP.IdIntento=I.Id
    JOIN #PublicacionesAlcanzadas PA ON PA.IdPublicacion=I.IdPublicacion
    WHERE I.Estado='entregado'
    GROUP BY I.Id;

    SELECT X.IdPublicacion,X.IdAlumno,IV.Id AS IdIntento,IV.CorreccionConfirmada,
      IV.NotaFinal,PA.NotaAprobacion,COALESCE(PPI.PreguntasSinPuntaje,0) AS PreguntasSinPuntaje
    INTO #IntentosValidosOficiales
    FROM (
      SELECT DISTINCT I.IdPublicacion,I.IdAlumno
      FROM Intento I
      JOIN #PublicacionesAlcanzadas PA0 ON PA0.IdPublicacion=I.IdPublicacion
    ) X
    JOIN #PublicacionesAlcanzadas PA ON PA.IdPublicacion=X.IdPublicacion
    LEFT JOIN IntentoValidoOverride IVO
      ON IVO.IdPublicacion=X.IdPublicacion AND IVO.IdAlumno=X.IdAlumno
    OUTER APPLY (
      SELECT COALESCE(IVO.IdIntento,(
        SELECT TOP (1) I2.Id FROM Intento I2
        WHERE I2.IdPublicacion=X.IdPublicacion AND I2.IdAlumno=X.IdAlumno
          AND I2.Estado='entregado'
        ORDER BY I2.FechaFin DESC,I2.NumeroIntento DESC,I2.Id DESC
      )) AS IdIntentoValido
    ) S
    JOIN Intento IV ON IV.Id=S.IdIntentoValido AND IV.IdPublicacion=X.IdPublicacion
      AND IV.IdAlumno=X.IdAlumno AND IV.Estado='entregado'
    LEFT JOIN #PreguntasPendientesIntento PPI ON PPI.IdIntento=IV.Id;

    SELECT PA.IdPublicacion,
      COUNT(O.IdIntento) AS OficialIntentosValidosEntregados,
      SUM(CASE WHEN O.CorreccionConfirmada=1 AND O.NotaFinal IS NOT NULL THEN 1 ELSE 0 END)
        AS OficialResultadosConsiderados,
      SUM(CASE WHEN O.IdIntento IS NOT NULL
        AND (O.CorreccionConfirmada=0 OR O.NotaFinal IS NULL) THEN 1 ELSE 0 END)
        AS OficialResultadosPendientes,
      SUM(CASE WHEN O.CorreccionConfirmada=0 THEN 1 ELSE 0 END)
        AS OficialIntentosPendientesConfirmacion,
      SUM(CASE WHEN O.CorreccionConfirmada=1 AND O.NotaFinal IS NULL THEN 1 ELSE 0 END)
        AS OficialIntentosConfirmadosSinNota,
      SUM(CASE WHEN O.PreguntasSinPuntaje>0 THEN 1 ELSE 0 END)
        AS OficialIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(O.PreguntasSinPuntaje),0) AS OficialPreguntasSinPuntaje,
      SUM(CASE WHEN O.CorreccionConfirmada=1 AND O.NotaFinal IS NOT NULL
        AND O.NotaFinal>=O.NotaAprobacion THEN 1 ELSE 0 END) AS OficialAprobados,
      SUM(CASE WHEN O.CorreccionConfirmada=1 AND O.NotaFinal IS NOT NULL
        AND O.NotaFinal<O.NotaAprobacion THEN 1 ELSE 0 END) AS OficialDesaprobados
    INTO #ResultadosOficiales
    FROM #PublicacionesAlcanzadas PA
    LEFT JOIN #IntentosValidosOficiales O ON O.IdPublicacion=PA.IdPublicacion
    GROUP BY PA.IdPublicacion;

    SELECT PA.IdPublicacion,
      COUNT(DISTINCT CASE WHEN I.Estado='entregado' AND (
        I.CorreccionConfirmada=0 OR I.NotaFinal IS NULL OR COALESCE(PPI.PreguntasSinPuntaje,0)>0
      ) THEN I.Id END) AS OperativoIntentosEntregadosPendientes,
      COUNT(DISTINCT CASE WHEN I.Estado='entregado' AND I.CorreccionConfirmada=0
        THEN I.Id END) AS OperativoIntentosPendientesConfirmacion,
      COUNT(DISTINCT CASE WHEN I.Estado='entregado' AND I.NotaFinal IS NULL
        THEN I.Id END) AS OperativoIntentosSinNotaFinal,
      COUNT(DISTINCT CASE WHEN I.Estado='entregado' AND COALESCE(PPI.PreguntasSinPuntaje,0)>0
        THEN I.Id END) AS OperativoIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(CASE WHEN I.Estado='entregado' THEN PPI.PreguntasSinPuntaje ELSE 0 END),0)
        AS OperativoPreguntasSinPuntaje
    INTO #PendientesOperativos
    FROM #PublicacionesAlcanzadas PA
    LEFT JOIN Intento I ON I.IdPublicacion=PA.IdPublicacion
    LEFT JOIN #PreguntasPendientesIntento PPI ON PPI.IdIntento=I.Id
    GROUP BY PA.IdPublicacion;

    SELECT PA.IdPublicacion,E.Id AS IdIncidente,E.IdIntento,I.IdAlumno,I.Estado AS EstadoIntento,
      COALESCE(RI.Estado,'pendiente') AS EstadoRevision
    INTO #IncidentesFiltrados
    FROM #PublicacionesAlcanzadas PA
    JOIN Intento I ON I.IdPublicacion=PA.IdPublicacion
    JOIN IncidenteIntento E ON E.IdIntento=I.Id
    JOIN TipoEventoTelemetria TE ON TE.Tipo=E.Tipo AND TE.EsIncidente=1
    LEFT JOIN DecisionSupervisionIntento DS
      ON DS.IdIntento=E.IdIntento AND DS.EventoId=E.EventoId
    OUTER APPLY (
      SELECT TOP (1) R.Estado
      FROM RevisionIncidenteIntento R
      WHERE R.IdIncidente=E.Id
      ORDER BY R.Revision DESC
    ) RI
    WHERE 1=1 ${incidentTypeClause} ${incidentSeverityClause} ${unreviewedClause};

    SELECT IdPublicacion,COUNT_BIG(*) AS TotalIncidentes,
      COUNT(DISTINCT IdAlumno) AS AlumnosConIncidentes,
      SUM(CASE WHEN EstadoRevision='pendiente' THEN 1 ELSE 0 END) AS IncidentesSinRevisar
    INTO #Incidentes
    FROM #IncidentesFiltrados
    GROUP BY IdPublicacion;

    SELECT
      PA.IdPublicacion,
      COUNT(I.Id) AS IntentosTotales,
      COUNT(DISTINCT I.IdAlumno) AS AlumnosQueIniciaron,
      SUM(CASE WHEN I.Estado = 'entregado' THEN 1 ELSE 0 END) AS Entregados,
      SUM(CASE WHEN I.Estado = 'en_progreso' THEN 1 ELSE 0 END) AS EnProgreso,
      SUM(CASE WHEN I.Estado = 'vencido' THEN 1 ELSE 0 END) AS Vencidos,
      SUM(CASE WHEN I.Estado = 'anulado' THEN 1 ELSE 0 END) AS Anulados,
      SUM(CASE WHEN I.Estado = 'entregado' ${academicScope} THEN 1 ELSE 0 END) AS IntentosAlcanceAcademico,
      SUM(CASE WHEN I.Estado = 'entregado' ${academicScope} AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END) AS IntentosCalificados,
      SUM(CASE WHEN I.Estado = 'entregado' AND I.NotaFinal IS NULL THEN 1 ELSE 0 END) AS IntentosPendientesCorreccion,
      SUM(CASE WHEN I.Estado = 'entregado' ${academicScope} AND I.NotaFinal >= PA.NotaAprobacion THEN 1 ELSE 0 END) AS IntentosAprobados,
      SUM(CASE WHEN I.Estado = 'entregado' ${academicScope} AND I.NotaFinal < PA.NotaAprobacion THEN 1 ELSE 0 END) AS IntentosDesaprobados,
      SUM(CASE WHEN I.Estado = 'entregado' ${academicScope} AND I.NotaFinal IS NOT NULL
        THEN CAST(I.NotaFinal AS DECIMAL(18,4)) ELSE 0 END) AS SumaNotasCalificadas,
      SUM(CASE WHEN I.Estado = 'entregado' ${academicScope} AND I.NotaFinal IS NOT NULL
        THEN CAST(I.NotaFinal*10.0/NULLIF(PA.EscalaCalificacion,0) AS DECIMAL(18,4)) ELSE 0 END)
        AS SumaNotasNormalizadasBase10
    INTO #Intentos
    FROM #PublicacionesAlcanzadas PA
    LEFT JOIN Intento I ON I.IdPublicacion = PA.IdPublicacion
    ${validSelectionJoins}
    GROUP BY PA.IdPublicacion;

    SELECT
      PA.*,
      COALESCE(PD.AlumnosAlcanzados, 0) AS AlumnosAlcanzados,
      COALESCE(IT.AlumnosQueIniciaron, 0) AS AlumnosQueIniciaron,
      COALESCE(IT.IntentosTotales, 0) AS IntentosTotales,
      COALESCE(IT.Entregados, 0) AS Entregados,
      COALESCE(IT.EnProgreso, 0) AS EnProgreso,
      COALESCE(IT.Vencidos, 0) AS Vencidos,
      COALESCE(IT.Anulados, 0) AS Anulados,
      COALESCE(IT.Anulados, 0) AS IntentosAnulados,
      COALESCE(INC.AlumnosConIncidentes, 0) AS AlumnosConIncidentes,
      COALESCE(INC.TotalIncidentes, 0) AS TotalIncidentes,
      COALESCE(INC.IncidentesSinRevisar, 0) AS IncidentesSinRevisar,
      COALESCE(IT.IntentosAlcanceAcademico, 0) AS IntentosAlcanceAcademico,
      COALESCE(IT.IntentosCalificados, 0) AS IntentosCalificados,
      COALESCE(IT.IntentosPendientesCorreccion, 0) AS IntentosPendientesCorreccion,
      COALESCE(IT.IntentosAprobados, 0) AS IntentosAprobados,
      COALESCE(IT.IntentosDesaprobados, 0) AS IntentosDesaprobados,
      COALESCE(IT.SumaNotasCalificadas, 0) AS SumaNotasCalificadas,
      COALESCE(IT.SumaNotasNormalizadasBase10, 0) AS SumaNotasNormalizadasBase10,
      COALESCE(RO.OficialIntentosValidosEntregados,0) AS OficialIntentosValidosEntregados,
      COALESCE(RO.OficialResultadosConsiderados,0) AS OficialResultadosConsiderados,
      COALESCE(RO.OficialResultadosPendientes,0) AS OficialResultadosPendientes,
      COALESCE(RO.OficialIntentosPendientesConfirmacion,0)
        AS OficialIntentosPendientesConfirmacion,
      COALESCE(RO.OficialIntentosConfirmadosSinNota,0) AS OficialIntentosConfirmadosSinNota,
      COALESCE(RO.OficialIntentosConPreguntasSinPuntaje,0)
        AS OficialIntentosConPreguntasSinPuntaje,
      COALESCE(RO.OficialPreguntasSinPuntaje,0) AS OficialPreguntasSinPuntaje,
      COALESCE(RO.OficialAprobados,0) AS OficialAprobados,
      COALESCE(RO.OficialDesaprobados,0) AS OficialDesaprobados,
      COALESCE(PO.OperativoIntentosEntregadosPendientes,0)
        AS OperativoIntentosEntregadosPendientes,
      COALESCE(PO.OperativoIntentosPendientesConfirmacion,0)
        AS OperativoIntentosPendientesConfirmacion,
      COALESCE(PO.OperativoIntentosSinNotaFinal,0) AS OperativoIntentosSinNotaFinal,
      COALESCE(PO.OperativoIntentosConPreguntasSinPuntaje,0)
        AS OperativoIntentosConPreguntasSinPuntaje,
      COALESCE(PO.OperativoPreguntasSinPuntaje,0) AS OperativoPreguntasSinPuntaje,
      CASE WHEN COALESCE(IT.IntentosCalificados, 0) > 0
        THEN ROUND(IT.SumaNotasCalificadas / IT.IntentosCalificados, 2)
        ELSE NULL
      END AS PromedioIntentosCalificados,
      CASE WHEN COALESCE(IT.IntentosCalificados, 0) > 0
        THEN ROUND(IT.SumaNotasNormalizadasBase10 / IT.IntentosCalificados, 2)
        ELSE NULL
      END AS PromedioIntentosCalificadosBase10,
      CASE WHEN COALESCE(IT.IntentosCalificados, 0) > 0
        THEN ROUND(CAST(IT.IntentosAprobados AS FLOAT) / IT.IntentosCalificados * 100, 1)
        ELSE NULL
      END AS PorcentajeAprobacionIntentos
    INTO #ReporteEvaluaciones
    FROM #PublicacionesAlcanzadas PA
    LEFT JOIN #Padrones PD ON PD.IdPublicacion = PA.IdPublicacion
    LEFT JOIN #Intentos IT ON IT.IdPublicacion = PA.IdPublicacion
    LEFT JOIN #Incidentes INC ON INC.IdPublicacion = PA.IdPublicacion
    LEFT JOIN #ResultadosOficiales RO ON RO.IdPublicacion=PA.IdPublicacion
    LEFT JOIN #PendientesOperativos PO ON PO.IdPublicacion=PA.IdPublicacion;

    ${pendingFilter}
    ${incidentPublicationFilter}

    SELECT
      COUNT(*) AS TotalEvaluaciones,
      COALESCE(SUM(AlumnosAlcanzados), 0) AS TotalAlumnosAlcanzados,
      (
        SELECT COUNT(DISTINCT IM.IdAlumno)
        FROM #ReporteEvaluaciones RE
        INNER JOIN InscripcionMateria IM ON IM.IdMateriaDivision = RE.IdMateriaDivision
      ) AS TotalAlumnosUnicos,
      COALESCE(SUM(IntentosTotales), 0) AS TotalIntentos,
      COALESCE(SUM(Entregados), 0) AS TotalEntregados,
      COALESCE(SUM(EnProgreso), 0) AS TotalEnProgreso,
      COALESCE(SUM(Vencidos), 0) AS TotalVencidos,
      COALESCE(SUM(Anulados), 0) AS TotalAnulados,
      COALESCE(SUM(IntentosAnulados), 0) AS IntentosAnulados,
      COALESCE(SUM(AlumnosConIncidentes), 0) AS AlumnosConIncidentes,
      COALESCE(SUM(TotalIncidentes), 0) AS TotalIncidentes,
      COALESCE(SUM(IncidentesSinRevisar), 0) AS IncidentesSinRevisar,
      COALESCE(SUM(IntentosAlcanceAcademico), 0) AS TotalIntentosAlcanceAcademico,
      COALESCE(SUM(IntentosCalificados), 0) AS TotalIntentosCalificados,
      COALESCE(SUM(IntentosPendientesCorreccion), 0) AS IntentosPendientesCorreccion,
      COALESCE(SUM(OficialIntentosValidosEntregados),0) AS OficialIntentosValidosEntregados,
      COALESCE(SUM(OficialResultadosConsiderados),0) AS OficialResultadosConsiderados,
      COALESCE(SUM(OficialResultadosPendientes),0) AS OficialResultadosPendientes,
      COALESCE(SUM(OficialIntentosPendientesConfirmacion),0)
        AS OficialIntentosPendientesConfirmacion,
      COALESCE(SUM(OficialIntentosConfirmadosSinNota),0) AS OficialIntentosConfirmadosSinNota,
      COALESCE(SUM(OficialIntentosConPreguntasSinPuntaje),0)
        AS OficialIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OficialPreguntasSinPuntaje),0) AS OficialPreguntasSinPuntaje,
      COALESCE(SUM(OficialAprobados),0) AS OficialAprobados,
      COALESCE(SUM(OficialDesaprobados),0) AS OficialDesaprobados,
      COALESCE(SUM(OperativoIntentosEntregadosPendientes),0)
        AS OperativoIntentosEntregadosPendientes,
      COALESCE(SUM(OperativoIntentosPendientesConfirmacion),0)
        AS OperativoIntentosPendientesConfirmacion,
      COALESCE(SUM(OperativoIntentosSinNotaFinal),0) AS OperativoIntentosSinNotaFinal,
      COALESCE(SUM(OperativoIntentosConPreguntasSinPuntaje),0)
        AS OperativoIntentosConPreguntasSinPuntaje,
      COALESCE(SUM(OperativoPreguntasSinPuntaje),0) AS OperativoPreguntasSinPuntaje,
      CASE WHEN COALESCE(SUM(IntentosCalificados), 0) > 0
        THEN ROUND(SUM(SumaNotasNormalizadasBase10) / SUM(IntentosCalificados), 2)
        ELSE NULL
      END AS PromedioIntentosCalificados,
      CASE WHEN COALESCE(SUM(IntentosCalificados), 0) > 0
        THEN ROUND(SUM(SumaNotasNormalizadasBase10) / SUM(IntentosCalificados), 2)
        ELSE NULL
      END AS PromedioIntentosCalificadosBase10,
      CASE WHEN COALESCE(SUM(IntentosCalificados), 0) > 0
        THEN ROUND(CAST(SUM(IntentosAprobados) AS FLOAT) / SUM(IntentosCalificados) * 100, 1)
        ELSE NULL
      END AS TasaAprobacionIntentos
    FROM #ReporteEvaluaciones;

    SELECT Categoria, Cantidad
    FROM (
      SELECT 1 AS Orden, 'Aprobados' AS Categoria, COALESCE(SUM(IntentosAprobados), 0) AS Cantidad FROM #ReporteEvaluaciones
      UNION ALL SELECT 2, 'Desaprobados', COALESCE(SUM(IntentosDesaprobados), 0) FROM #ReporteEvaluaciones
      UNION ALL SELECT 3, 'Pendientes de corrección', COALESCE(SUM(IntentosPendientesCorreccion), 0) FROM #ReporteEvaluaciones
      UNION ALL SELECT 4, 'En progreso', COALESCE(SUM(EnProgreso), 0) FROM #ReporteEvaluaciones
      UNION ALL SELECT 5, 'Vencidos', COALESCE(SUM(Vencidos), 0) FROM #ReporteEvaluaciones
      UNION ALL SELECT 6, 'Anulados', COALESCE(SUM(Anulados), 0) FROM #ReporteEvaluaciones
    ) Distribucion
    WHERE EXISTS (SELECT 1 FROM #ReporteEvaluaciones)
    ORDER BY Orden;

    ${institutionalSql}

    SELECT
      IdPublicacion,
      IdActividad,
      Titulo,
      IdMateria,
      Materia,
      IdCarrera,
      Carrera,
      IdMateriaDivision,
      Division,
      FechaInicio,
      FechaFin,
      Estado,
      EscalaCalificacion,
      NotaAprobacion,
      AlumnosAlcanzados,
      AlumnosQueIniciaron,
      CASE WHEN AlumnosAlcanzados > AlumnosQueIniciaron
        THEN AlumnosAlcanzados - AlumnosQueIniciaron
        ELSE 0
      END AS SinIniciar,
      IntentosTotales,
      Entregados,
      EnProgreso,
      Vencidos,
      Anulados,
      IntentosAnulados,
      AlumnosConIncidentes,
      TotalIncidentes,
      IncidentesSinRevisar,
      IntentosAlcanceAcademico,
      IntentosCalificados,
      IntentosPendientesCorreccion,
      PromedioIntentosCalificados,
      PromedioIntentosCalificadosBase10,
      IntentosAprobados,
      IntentosDesaprobados,
      PorcentajeAprobacionIntentos,
      OficialIntentosValidosEntregados,
      OficialResultadosConsiderados,
      OficialResultadosPendientes,
      OficialIntentosPendientesConfirmacion,
      OficialIntentosConfirmadosSinNota,
      OficialIntentosConPreguntasSinPuntaje,
      OficialPreguntasSinPuntaje,
      OficialAprobados,
      OficialDesaprobados,
      OperativoIntentosEntregadosPendientes,
      OperativoIntentosPendientesConfirmacion,
      OperativoIntentosSinNotaFinal,
      OperativoIntentosConPreguntasSinPuntaje,
      OperativoPreguntasSinPuntaje
    FROM #ReporteEvaluaciones
    ORDER BY ${orderBy} ${direction}, IdPublicacion ASC
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;

    SELECT COUNT(*) AS Total FROM #ReporteEvaluaciones;
  `);

  const recordsets = result.recordsets || [];
  const kpiRows = recordsets[0] || [];
  const chartRows = recordsets[1] || [];
  let evaluationIndex = 2;
  let resumenInstitucional: Record<string, unknown> | undefined;
  if (filters.incluirResumenInstitucional === true) {
    const globalRows = recordsets[2] || [];
    const carreraRows = recordsets[3] || [];
    const materiaRows = recordsets[4] || [];
    const comisionRows = recordsets[5] || [];
    const monthlyRows = filters.incluirSerieMensual === true ? recordsets[6] || [] : [];
    evaluationIndex = filters.incluirSerieMensual === true ? 7 : 6;
    const comisiones = (mapKeysToCamelCase(comisionRows) as Array<Record<string, unknown>>)
      .map(extraerBloquesDocentes);
    const materias = (mapKeysToCamelCase(materiaRows) as Array<Record<string, unknown>>)
      .map(extraerBloquesDocentes)
      .map(materia => ({
        ...materia,
        comisiones: comisiones.filter(comision =>
          Number(comision.idCarrera) === Number(materia.idCarrera) &&
          Number(comision.idMateria) === Number(materia.idMateria)),
      }));
    const carrerasBase = (mapKeysToCamelCase(carreraRows) as Array<Record<string, unknown>>)
      .map(extraerBloquesDocentes);
    const carreras = carrerasBase.map(carrera => ({
      ...carrera,
      materias: materias.filter(materia =>
        Number(materia.idCarrera) === Number(carrera.idCarrera)),
    }));
    const minimumSample = filters.muestraMinimaRanking ?? 10;
    const minimumCoverage = filters.coberturaMinimaRanking ?? 70;
    resumenInstitucional = {
      unidadEvaluacion: 'idPublicacion',
      dimensionTemporal: 'publicacion.fechaInicio',
      global: extraerBloquesDocentes(
        mapKeysToCamelCase(globalRows[0] || {}) as Record<string, unknown>,
      ),
      materias,
      carreras,
      comparativas: {
        criteriosElegibilidad: {
          muestraMinima: minimumSample,
          coberturaMinimaPorcentaje: minimumCoverage,
          naturaleza: 'criterio_operativo_configurable',
        },
        carreras: buildComparison(carrerasBase, 'carreras', minimumSample, minimumCoverage),
        materias: buildComparison(materias.map(({ comisiones: _comisiones, ...materia }) => materia),
          'materias', minimumSample, minimumCoverage),
        comisiones: buildComparison(comisiones, 'comisiones', minimumSample, minimumCoverage),
      },
      ...(filters.incluirSerieMensual === true && seriesPeriod ? {
        periodoEfectivo: {
          desde: seriesPeriod.desde.toISOString(),
          hasta: seriesPeriod.hasta.toISOString(),
          zonaHoraria: REPORT_TIME_ZONE,
          mesesCalendarioIncluidos: seriesPeriod.mesesCalendarioIncluidos,
        },
        serieMensual: buildMonthlySeries(monthlyRows, seriesPeriod),
      } : {}),
    };
  }
  const evaluationRows = recordsets[evaluationIndex] || [];
  const totalRows = recordsets[evaluationIndex + 1] || [];
  const total = Number(totalRows[0]?.Total || 0);
  const kpis = extraerBloquesDocentes(
    mapKeysToCamelCase(kpiRows[0] || {}) as Record<string, unknown>,
  );
  const distribucionResultados = mapKeysToCamelCase(chartRows);
  const evaluaciones = (mapKeysToCamelCase(evaluationRows) as Array<Record<string, unknown>>)
    .map(extraerBloquesDocentes);

  return {
    criterios: {
      alcanceIntentos: filters.alcanceIntentos,
      escalaPromedio: 10,
      conPendientesCorreccion: filters.conPendientesCorreccion ?? null,
      conIncidentes: filters.conIncidentes ?? null,
      tipoIncidente: filters.tipoIncidente ?? null,
      severidad: filters.severidad ?? null,
      soloIncidentesSinRevisar: filters.soloIncidentesSinRevisar ?? null,
      ...(filters.idCarrera !== undefined ? { idCarrera: filters.idCarrera } : {}),
      ...(filters.incluirResumenInstitucional !== undefined
        ? { incluirResumenInstitucional: filters.incluirResumenInstitucional }
        : {}),
      ...(filters.incluirSerieMensual !== undefined
        ? { incluirSerieMensual: filters.incluirSerieMensual }
        : {}),
      ...(filters.incluirResumenInstitucional === true ? {
        muestraMinimaRanking: filters.muestraMinimaRanking ?? 10,
        coberturaMinimaRanking: filters.coberturaMinimaRanking ?? 70,
      } : {}),
    },
    kpis,
    graficos: { distribucionResultados },
    evaluaciones,
    ...(resumenInstitucional ? { resumenInstitucional } : {}),
    paginacion: {
      pagina: filters.pagina,
      limite: filters.limite,
      total,
      totalPaginas: total === 0 ? 0 : Math.ceil(total / filters.limite),
    },
  };
};
