import * as sql from 'mssql';
import { pool } from '../config/db';
import { MisIntentosQuery } from '../schemas/intento.schema';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { isDateOnly } from '../utils/isoDate';

const orderingMap: Record<MisIntentosQuery['ordenarPor'], string> = {
  fecha: 'FechaInicio',
  materia: 'Materia',
  evaluacion: 'Titulo',
  nota: 'NotaFinal',
};

const fechaHastaSql = (value: string): { value: Date; exclusive: boolean } => {
  const date = new Date(value);
  if (!isDateOnly(value)) return { value: date, exclusive: false };
  date.setUTCDate(date.getUTCDate() + 1);
  return { value: date, exclusive: true };
};

export async function obtenerMisIntentos(idAlumno: number, filters: MisIntentosQuery) {
  const request = pool.request()
    .input('IdAlumno', sql.Int, idAlumno)
    .input('Offset', sql.Int, (filters.pagina - 1) * filters.limite)
    .input('Limite', sql.Int, filters.limite);

  const clauses: string[] = [];
  if (filters.idMateria) {
    request.input('IdMateria', sql.Int, filters.idMateria);
    clauses.push('B.IdMateria=@IdMateria');
  }
  if (filters.idMateriaDivision) {
    request.input('IdMateriaDivision', sql.Int, filters.idMateriaDivision);
    clauses.push('B.IdMateriaDivision=@IdMateriaDivision');
  }
  if (filters.fechaDesde) {
    request.input('FechaDesde', sql.DateTime2, new Date(filters.fechaDesde));
    clauses.push('B.FechaInicio>=@FechaDesde');
  }
  if (filters.fechaHasta) {
    const hasta = fechaHastaSql(filters.fechaHasta);
    request.input('FechaHasta', sql.DateTime2, hasta.value);
    clauses.push(`B.FechaInicio${hasta.exclusive ? '<' : '<='}@FechaHasta`);
  }
  if (filters.estado) {
    request.input('Estado', sql.NVarChar, filters.estado);
    clauses.push('B.Estado=@Estado');
  }
  if (filters.resultado) {
    const resultClauses = {
      aprobado: 'B.NotaFinal IS NOT NULL AND B.NotaFinal>=B.NotaAprobacion',
      desaprobado: 'B.NotaFinal IS NOT NULL AND B.NotaFinal<B.NotaAprobacion',
      pendiente: 'B.NotaFinal IS NULL',
    } as const;
    clauses.push(`(${resultClauses[filters.resultado]})`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = orderingMap[filters.ordenarPor];
  const direction = filters.ordenDireccion === 'asc' ? 'ASC' : 'DESC';

  const result = await request.query(`
    SET NOCOUNT ON;

    SELECT
      I.Id AS IdIntento,
      A.Id AS IdActividad,
      I.IdPublicacion,
      A.Titulo,
      A.Tipo,
      MD.IdMateria,
      M.Nombre AS Materia,
      MD.Id AS IdMateriaDivision,
      D.Descripcion AS Division,
      I.NumeroIntento,
      A.CantidadIntentosMaximos,
      I.Estado,
      I.FechaInicio,
      I.FechaFin,
      I.NotaAutomatica,
      I.NotaFinal,
      I.CorreccionConfirmada,
      CAST(CASE WHEN I.CorreccionConfirmada=1 THEN 0 ELSE 1 END AS bit) AS CorreccionPendiente,
      COALESCE(PR.Modo,'al_corregir') AS ModoRevision,
      PR.VentanaDesde AS RevisionVentanaDesde,PR.VentanaHasta AS RevisionVentanaHasta,
      PE.Estado AS EstadoPermisoRevision,PE.FechaDesde AS PermisoRevisionDesde,
      PE.FechaHasta AS PermisoRevisionHasta,
      A.EscalaCalificacion,
      A.NotaAprobacion,
      CASE WHEN I.NotaFinal IS NULL THEN 'pendiente'
           WHEN I.NotaFinal>=A.NotaAprobacion THEN 'aprobado'
           ELSE 'desaprobado' END AS Resultado,
      CASE WHEN I.Estado<>'entregado' THEN NULL
           WHEN ISNULL(C.PendientesCorreccion,0)>0 THEN 'pendiente'
           ELSE 'completa' END AS EstadoCorreccion,
      O.IdIntento AS IdIntentoOverride,
      ROW_NUMBER() OVER (
        PARTITION BY I.IdPublicacion
        ORDER BY CASE WHEN I.Estado='entregado' THEN 0 ELSE 1 END,
                 CASE WHEN I.Estado='entregado' THEN I.FechaFin END DESC,
                 CASE WHEN I.Estado='entregado' THEN I.NumeroIntento END DESC,
                 CASE WHEN I.Estado='entregado' THEN I.Id END DESC
      ) AS OrdenAutomatico
    INTO #IntentosBase
    FROM dbo.Intento I
    INNER JOIN dbo.Publicacion P ON P.Id=I.IdPublicacion
    INNER JOIN dbo.Actividad A ON A.Id=P.IdActividad
    INNER JOIN dbo.MateriaDivision MD ON MD.Id=P.IdMateriaDivision
    INNER JOIN dbo.Materia M ON M.Id=MD.IdMateria
    INNER JOIN dbo.Division D ON D.Id=MD.IdDivision
    LEFT JOIN dbo.IntentoValidoOverride O
      ON O.IdPublicacion=I.IdPublicacion AND O.IdAlumno=I.IdAlumno
    LEFT JOIN dbo.PoliticaRevisionPublicacion PR ON PR.IdPublicacion=I.IdPublicacion
    LEFT JOIN dbo.PermisoRevisionIntento PE ON PE.IdIntento=I.Id
    OUTER APPLY (
      SELECT SUM(CASE WHEN IP.PuntajeObtenido IS NULL THEN 1 ELSE 0 END) AS PendientesCorreccion
      FROM dbo.IntentoPregunta IP WHERE IP.IdIntento=I.Id
    ) C
    WHERE I.IdAlumno=@IdAlumno;

    SELECT
      B.IdIntento,B.IdActividad,B.IdPublicacion,B.Titulo,B.Tipo,B.IdMateria,B.Materia,
      B.IdMateriaDivision,B.Division,B.NumeroIntento,B.CantidadIntentosMaximos,B.Estado,
      B.FechaInicio,B.FechaFin,B.NotaAutomatica,B.NotaFinal,B.EscalaCalificacion,
      B.NotaAprobacion,B.Resultado,B.EstadoCorreccion,B.CorreccionPendiente,
      B.CorreccionConfirmada,
      CAST(CASE WHEN B.Estado='entregado' AND B.CorreccionConfirmada=1
        AND ISNULL(B.EstadoPermisoRevision,'')<>'revocado'
        AND (
          (B.EstadoPermisoRevision='activo'
            AND (B.PermisoRevisionDesde IS NULL OR B.PermisoRevisionDesde<=SYSUTCDATETIME())
            AND (B.PermisoRevisionHasta IS NULL OR B.PermisoRevisionHasta>=SYSUTCDATETIME()))
          OR
          ((B.EstadoPermisoRevision IS NULL OR B.EstadoPermisoRevision<>'activo'
              OR B.PermisoRevisionDesde>SYSUTCDATETIME()
              OR B.PermisoRevisionHasta<SYSUTCDATETIME())
            AND (B.IdIntentoOverride=B.IdIntento OR
              (B.IdIntentoOverride IS NULL AND B.OrdenAutomatico=1))
            AND (B.ModoRevision='al_corregir' OR
              (B.ModoRevision='ventana' AND B.RevisionVentanaDesde<=SYSUTCDATETIME()
                AND B.RevisionVentanaHasta>=SYSUTCDATETIME())))
        ) THEN 1 ELSE 0 END AS bit) AS RevisionDisponible,
      CAST(CASE WHEN B.Estado='entregado' AND (
        B.IdIntentoOverride=B.IdIntento OR
        (B.IdIntentoOverride IS NULL AND B.OrdenAutomatico=1)
      ) THEN 1 ELSE 0 END AS bit) AS EsIntentoValido,
      CASE WHEN B.Estado<>'entregado' THEN NULL
           WHEN B.IdIntentoOverride=B.IdIntento THEN 'manual'
           WHEN B.IdIntentoOverride IS NULL AND B.OrdenAutomatico=1 THEN 'automatica'
           ELSE NULL END AS SeleccionIntentoValido
    INTO #IntentosFiltrados
    FROM #IntentosBase B
    ${where};

    SELECT IdIntento,IdActividad,IdPublicacion,Titulo,Tipo,IdMateria,Materia,
      IdMateriaDivision,Division,NumeroIntento,CantidadIntentosMaximos,Estado,
      FechaInicio,FechaFin,NotaAutomatica,NotaFinal,EscalaCalificacion,NotaAprobacion,
      Resultado,EstadoCorreccion,CorreccionPendiente,CorreccionConfirmada,RevisionDisponible,
      EsIntentoValido,SeleccionIntentoValido
    FROM #IntentosFiltrados
    ORDER BY ${orderBy} ${direction},IdIntento DESC
    OFFSET @Offset ROWS FETCH NEXT @Limite ROWS ONLY;

    SELECT COUNT(*) AS TotalIntentos,
      COUNT(DISTINCT IdPublicacion) AS TotalEvaluaciones,
      COUNT(DISTINCT CASE WHEN EsIntentoValido=1 AND Resultado='aprobado'
        THEN IdPublicacion END) AS EvaluacionesAprobadas,
      COUNT(DISTINCT CASE WHEN EsIntentoValido=1 AND Resultado='desaprobado'
        THEN IdPublicacion END) AS EvaluacionesDesaprobadas,
      COUNT(DISTINCT CASE WHEN EsIntentoValido=1 AND Resultado='pendiente'
        THEN IdPublicacion END) AS EvaluacionesPendientes
    FROM #IntentosFiltrados;
  `);

  const [itemRows = [], summaryRows = []] = result.recordsets || [];
  const summary = mapKeysToCamelCase(summaryRows[0] || {
    TotalIntentos: 0,
    TotalEvaluaciones: 0,
    EvaluacionesAprobadas: 0,
    EvaluacionesDesaprobadas: 0,
    EvaluacionesPendientes: 0,
  }) as Record<string, unknown>;
  const total = Number(summary.totalIntentos || 0);

  return {
    items: mapKeysToCamelCase(itemRows),
    resumen: summary,
    paginacion: {
      pagina: filters.pagina,
      limite: filters.limite,
      total,
      totalPaginas: total === 0 ? 0 : Math.ceil(total / filters.limite),
    },
  };
}
