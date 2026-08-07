import * as sql from 'mssql';
import { pool } from '../config/db';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { RendimientoEvaluacionesQuery } from '../schemas/reportes.schema';

const NOTA_MINIMA_APROBACION = 6;

const identifierFilters = [
  ['idMateria', 'MD.IdMateria = @IdMateria'],
  ['idMateriaDivision', 'MD.Id = @IdMateriaDivision'],
  ['idActividad', 'A.Id = @IdActividad'],
  ['idPublicacion', 'P.Id = @IdPublicacion'],
] as const;

const bindFilters = (request: sql.Request, filters: RendimientoEvaluacionesQuery): sql.Request => {
  if (filters.idMateria) request.input('IdMateria', sql.Int, filters.idMateria);
  if (filters.idMateriaDivision) request.input('IdMateriaDivision', sql.Int, filters.idMateriaDivision);
  if (filters.idActividad) request.input('IdActividad', sql.Int, filters.idActividad);
  if (filters.idPublicacion) request.input('IdPublicacion', sql.Int, filters.idPublicacion);
  if (filters.estado) request.input('Estado', sql.NVarChar, filters.estado);
  if (filters.fechaDesde) request.input('FechaDesde', sql.DateTime2, new Date(filters.fechaDesde));
  if (filters.fechaHasta) request.input('FechaHasta', sql.DateTime2, new Date(filters.fechaHasta));
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
    WHERE A.Tipo = 'evaluacion'
      AND MD.IdDocente = @IdDocente
      ${identifierWhere(filters)}
  `);
  return result.recordset.length > 0;
};

const orderingMap: Record<RendimientoEvaluacionesQuery['ordenarPor'], string> = {
  evaluacion: 'Titulo',
  fecha: 'FechaInicio',
  promedio: 'PromedioIntentosCalificados',
  entregados: 'Entregados',
  aprobacion: 'PorcentajeAprobacionIntentos',
  pendientesCorreccion: 'IntentosPendientesCorreccion',
};

export const getRendimientoEvaluacionesReport = async (
  filters: RendimientoEvaluacionesQuery,
  idDocente: number | null,
) => {
  const request = bindFilters(pool.request(), filters)
    .input('NotaMinimaAprobacion', sql.Decimal(4, 2), NOTA_MINIMA_APROBACION)
    .input('Offset', sql.Int, (filters.pagina - 1) * filters.limite)
    .input('Limit', sql.Int, filters.limite);
  if (idDocente !== null) request.input('IdDocente', sql.Int, idDocente);

  const scopeClause = idDocente !== null ? 'AND MD.IdDocente = @IdDocente' : '';
  const stateClause = filters.estado ? 'AND A.Estado = @Estado' : '';
  const dateFromClause = filters.fechaDesde ? 'AND P.FechaInicio >= @FechaDesde' : '';
  const dateToClause = filters.fechaHasta ? 'AND P.FechaInicio <= @FechaHasta' : '';
  const orderBy = orderingMap[filters.ordenarPor];
  const direction = filters.ordenDireccion === 'asc' ? 'ASC' : 'DESC';

  const result = await request.query(`
    SET NOCOUNT ON;

    SELECT
      P.Id AS IdPublicacion,
      A.Id AS IdActividad,
      A.Titulo,
      MD.IdMateria,
      M.Nombre AS Materia,
      MD.Id AS IdMateriaDivision,
      D.Descripcion AS Division,
      P.FechaInicio,
      P.FechaFin,
      A.Estado
    INTO #PublicacionesAlcanzadas
    FROM Publicacion P
    INNER JOIN Actividad A ON A.Id = P.IdActividad
    INNER JOIN MateriaDivision MD ON MD.Id = P.IdMateriaDivision
    INNER JOIN Materia M ON M.Id = MD.IdMateria
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

    SELECT
      PA.IdPublicacion,
      COUNT(I.Id) AS IntentosTotales,
      COUNT(DISTINCT I.IdAlumno) AS AlumnosQueIniciaron,
      SUM(CASE WHEN I.Estado = 'entregado' THEN 1 ELSE 0 END) AS Entregados,
      SUM(CASE WHEN I.Estado = 'en_progreso' THEN 1 ELSE 0 END) AS EnProgreso,
      SUM(CASE WHEN I.Estado = 'vencido' THEN 1 ELSE 0 END) AS Vencidos,
      SUM(CASE WHEN I.Estado = 'anulado' THEN 1 ELSE 0 END) AS Anulados,
      SUM(CASE WHEN I.Estado = 'entregado' AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END) AS IntentosCalificados,
      SUM(CASE WHEN I.Estado = 'entregado' AND I.NotaFinal IS NULL THEN 1 ELSE 0 END) AS IntentosPendientesCorreccion,
      SUM(CASE WHEN I.Estado = 'entregado' AND I.NotaFinal >= @NotaMinimaAprobacion THEN 1 ELSE 0 END) AS IntentosAprobados,
      SUM(CASE WHEN I.Estado = 'entregado' AND I.NotaFinal < @NotaMinimaAprobacion THEN 1 ELSE 0 END) AS IntentosDesaprobados,
      SUM(CASE WHEN I.Estado = 'entregado' AND I.NotaFinal IS NOT NULL THEN CAST(I.NotaFinal AS DECIMAL(18,4)) ELSE 0 END) AS SumaNotasCalificadas
    INTO #Intentos
    FROM #PublicacionesAlcanzadas PA
    LEFT JOIN Intento I ON I.IdPublicacion = PA.IdPublicacion
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
      COALESCE(IT.IntentosCalificados, 0) AS IntentosCalificados,
      COALESCE(IT.IntentosPendientesCorreccion, 0) AS IntentosPendientesCorreccion,
      COALESCE(IT.IntentosAprobados, 0) AS IntentosAprobados,
      COALESCE(IT.IntentosDesaprobados, 0) AS IntentosDesaprobados,
      COALESCE(IT.SumaNotasCalificadas, 0) AS SumaNotasCalificadas,
      CASE WHEN COALESCE(IT.IntentosCalificados, 0) > 0
        THEN ROUND(IT.SumaNotasCalificadas / IT.IntentosCalificados, 2)
        ELSE NULL
      END AS PromedioIntentosCalificados,
      CASE WHEN COALESCE(IT.IntentosCalificados, 0) > 0
        THEN ROUND(CAST(IT.IntentosAprobados AS FLOAT) / IT.IntentosCalificados * 100, 1)
        ELSE NULL
      END AS PorcentajeAprobacionIntentos
    INTO #ReporteEvaluaciones
    FROM #PublicacionesAlcanzadas PA
    LEFT JOIN #Padrones PD ON PD.IdPublicacion = PA.IdPublicacion
    LEFT JOIN #Intentos IT ON IT.IdPublicacion = PA.IdPublicacion;

    SELECT
      COUNT(*) AS TotalEvaluaciones,
      COALESCE(SUM(AlumnosAlcanzados), 0) AS TotalAlumnosAlcanzados,
      (
        SELECT COUNT(DISTINCT IM.IdAlumno)
        FROM #PublicacionesAlcanzadas PU
        INNER JOIN InscripcionMateria IM ON IM.IdMateriaDivision = PU.IdMateriaDivision
      ) AS TotalAlumnosUnicos,
      COALESCE(SUM(IntentosTotales), 0) AS TotalIntentos,
      COALESCE(SUM(Entregados), 0) AS TotalEntregados,
      COALESCE(SUM(EnProgreso), 0) AS TotalEnProgreso,
      COALESCE(SUM(Vencidos), 0) AS TotalVencidos,
      COALESCE(SUM(Anulados), 0) AS TotalAnulados,
      COALESCE(SUM(IntentosCalificados), 0) AS TotalIntentosCalificados,
      COALESCE(SUM(IntentosPendientesCorreccion), 0) AS IntentosPendientesCorreccion,
      CASE WHEN COALESCE(SUM(IntentosCalificados), 0) > 0
        THEN ROUND(SUM(SumaNotasCalificadas) / SUM(IntentosCalificados), 2)
        ELSE NULL
      END AS PromedioIntentosCalificados,
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

    SELECT
      IdPublicacion,
      IdActividad,
      Titulo,
      IdMateria,
      Materia,
      IdMateriaDivision,
      Division,
      FechaInicio,
      FechaFin,
      Estado,
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
      IntentosCalificados,
      IntentosPendientesCorreccion,
      PromedioIntentosCalificados,
      IntentosAprobados,
      IntentosDesaprobados,
      PorcentajeAprobacionIntentos
    FROM #ReporteEvaluaciones
    ORDER BY ${orderBy} ${direction}, IdPublicacion ASC
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;

    SELECT COUNT(*) AS Total FROM #ReporteEvaluaciones;
  `);

  const [kpiRows = [], chartRows = [], evaluationRows = [], totalRows = []] = result.recordsets || [];
  const total = Number(totalRows[0]?.Total || 0);
  const kpis = mapKeysToCamelCase(kpiRows[0] || {});
  const distribucionResultados = mapKeysToCamelCase(chartRows);
  const evaluaciones = mapKeysToCamelCase(evaluationRows);

  return {
    kpis,
    graficos: { distribucionResultados },
    evaluaciones,
    paginacion: {
      pagina: filters.pagina,
      limite: filters.limite,
      total,
      totalPaginas: total === 0 ? 0 : Math.ceil(total / filters.limite),
    },
  };
};
