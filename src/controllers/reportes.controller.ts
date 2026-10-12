import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';
import { RendimientoEvaluacionesQuerySchema } from '../schemas/reportes.schema';
import {
  getRendimientoEvaluacionesReport,
  isEvaluationReportScopeAllowed,
} from '../services/reportes-evaluaciones.service';

const INTENTO_VALIDO_APPLY = `
  LEFT JOIN IntentoValidoOverride IVO
    ON IVO.IdPublicacion=I.IdPublicacion AND IVO.IdAlumno=I.IdAlumno
  OUTER APPLY (
    SELECT COALESCE(IVO.IdIntento,(
      SELECT TOP 1 IV.Id FROM Intento IV
      WHERE IV.IdPublicacion=I.IdPublicacion AND IV.IdAlumno=I.IdAlumno
        AND IV.Estado='entregado'
      ORDER BY IV.FechaFin DESC,IV.NumeroIntento DESC,IV.Id DESC
    )) AS IdIntentoValido
  ) IVS`;

const alcanceAcademico = (alcance: string): string => alcance === 'validos'
  ? "I.Id IS NOT NULL AND I.Estado='entregado' AND I.Id=IVS.IdIntentoValido"
  : "I.Id IS NOT NULL AND I.Estado='entregado'";

export const getRendimientoEvaluaciones = async (req: Request, res: Response) => {
  const parsed = RendimientoEvaluacionesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Filtros inválidos',
      code: 'REQUEST_INVALID',
      errors: parsed.error.issues,
    });
  }

  try {
    const user = (req as any).user;
    const idDocente = user.role === 'docente' ? Number(user.idDocente) : null;
    if (user.role === 'docente' && (!Number.isInteger(idDocente) || idDocente <= 0)) {
      return res.status(403).json({
        success: false,
        message: 'No tiene alcance docente válido',
        code: 'REPORT_SCOPE_FORBIDDEN',
      });
    }

    if (idDocente !== null) {
      const allowed = await isEvaluationReportScopeAllowed(idDocente, parsed.data);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'Los filtros solicitados están fuera de su alcance',
          code: 'REPORT_SCOPE_FORBIDDEN',
        });
      }
    }

    const data = await getRendimientoEvaluacionesReport(parsed.data, idDocente);
    return res.json({ success: true, data });
  } catch {
    return res.status(500).json({
      success: false,
      message: 'No se pudo obtener el rendimiento por evaluación',
      code: 'INTERNAL_ERROR',
    });
  }
};

export const getRendimiento = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const esDocente = user.role === 'docente';

    if (esDocente && !user.idDocente) {
      return res.status(403).json({ success: false, message: 'Docente no identificado en el token' });
    }

    const idDocente = esDocente ? user.idDocente : null;

    const matricula = req.query.matricula ? Number(req.query.matricula) : null;
    const idMateria = req.query.idMateria ? Number(req.query.idMateria) : null;
    const idMateriaDivision = req.query.idMateriaDivision ? Number(req.query.idMateriaDivision) : null;
    const idActividad = req.query.idActividad ? Number(req.query.idActividad) : null;
    const estado = typeof req.query.estado === 'string' ? req.query.estado : null;
    const fechaDesde = typeof req.query.fechaDesde === 'string' ? req.query.fechaDesde : null;
    const fechaHasta = typeof req.query.fechaHasta === 'string' ? req.query.fechaHasta : null;
    const promedioMin = req.query.promedioMin ? Number(req.query.promedioMin) : null;
    const promedioMax = req.query.promedioMax ? Number(req.query.promedioMax) : null;
    const ordenarPor = typeof req.query.ordenarPor === 'string' ? req.query.ordenarPor : 'alumno';
    const ordenDireccion = typeof req.query.ordenDireccion === 'string' ? req.query.ordenDireccion : 'asc';
    const pagina = req.query.pagina ? Number(req.query.pagina) : 1;
    const limite = req.query.limite ? Number(req.query.limite) : 20;
    const alcanceIntentos = typeof req.query.alcanceIntentos === 'string'
      ? req.query.alcanceIntentos
      : 'todos';

    if (matricula !== null && (isNaN(matricula) || matricula <= 0)) {
      return res.status(400).json({ success: false, message: 'matricula debe ser un número positivo' });
    }
    if (idMateria !== null && (isNaN(idMateria) || idMateria <= 0)) {
      return res.status(400).json({ success: false, message: 'idMateria debe ser un número positivo' });
    }
    if (idMateriaDivision !== null && (isNaN(idMateriaDivision) || idMateriaDivision <= 0)) {
      return res.status(400).json({ success: false, message: 'idMateriaDivision debe ser un número positivo' });
    }
    if (idActividad !== null && (isNaN(idActividad) || idActividad <= 0)) {
      return res.status(400).json({ success: false, message: 'idActividad debe ser un número positivo' });
    }
    if (estado !== null && !['entregado', 'en_progreso', 'vencido', 'anulado'].includes(estado)) {
      return res.status(400).json({ success: false, message: 'estado debe ser entregado, en_progreso, vencido o anulado' });
    }
    if (fechaDesde && fechaHasta && new Date(fechaDesde) > new Date(fechaHasta)) {
      return res.status(400).json({ success: false, message: 'fechaDesde no puede ser mayor que fechaHasta' });
    }
    if (promedioMin !== null && promedioMax !== null && promedioMin > promedioMax) {
      return res.status(400).json({ success: false, message: 'promedioMin no puede ser mayor que promedioMax' });
    }
    if (isNaN(pagina) || pagina < 1) {
      return res.status(400).json({ success: false, message: 'pagina debe ser un número mayor o igual a 1' });
    }
    if (isNaN(limite) || limite < 1 || limite > 100) {
      return res.status(400).json({ success: false, message: 'limite debe estar entre 1 y 100' });
    }
    if (!['alumno', 'promedio', 'aprobados', 'intentos'].includes(ordenarPor)) {
      return res.status(400).json({ success: false, message: 'ordenarPor debe ser alumno, promedio, aprobados o intentos' });
    }
    if (!['asc', 'desc'].includes(ordenDireccion)) {
      return res.status(400).json({ success: false, message: 'ordenDireccion debe ser asc o desc' });
    }
    if (!['todos', 'validos'].includes(alcanceIntentos)) {
      return res.status(400).json({ success: false, message: 'alcanceIntentos debe ser todos o validos' });
    }

    if (matricula !== null) {
      return await getRendimientoAlumno(res, matricula, idDocente, {
        idMateria, idMateriaDivision, idActividad, estado, fechaDesde, fechaHasta, alcanceIntentos,
      });
    }

    return await getRendimientoListado(res, idDocente, {
      idMateria, idMateriaDivision, estado, fechaDesde, fechaHasta,
      promedioMin, promedioMax, ordenarPor, ordenDireccion, pagina, limite, alcanceIntentos,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

async function getRendimientoAlumno(
  res: Response,
  matricula: number,
  idDocente: number | null,
  filters: {
    idMateria: number | null;
    idMateriaDivision: number | null;
    idActividad: number | null;
    estado: string | null;
    fechaDesde: string | null;
    fechaHasta: string | null;
    alcanceIntentos: string;
  },
) {
  const alumnoResult = await pool.request()
    .input('Matricula', sql.Int, matricula)
    .query('SELECT Matricula, Nombre, Apellido FROM Alumno WHERE Matricula = @Matricula');

  if (alumnoResult.recordset.length === 0) {
    return res.status(404).json({ success: false, message: 'Alumno no encontrado' });
  }

  if (idDocente) {
    const scopeResult = await pool.request()
      .input('Matricula', sql.Int, matricula)
      .input('IdDocente', sql.Int, idDocente)
      .query(`
        SELECT 1 FROM InscripcionMateria IM
        INNER JOIN MateriaDivision MD ON IM.IdMateriaDivision = MD.Id
        WHERE IM.IdAlumno = @Matricula AND MD.IdDocente = @IdDocente
      `);

    if (scopeResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Alumno no encontrado en su alcance' });
    }
  }

  const alumno = mapKeysToCamelCase(alumnoResult.recordset[0]);

  const request = pool.request()
    .input('Matricula', sql.Int, matricula);

  if (idDocente) request.input('IdDocente', sql.Int, idDocente);
  if (filters.idMateria) request.input('IdMateria', sql.Int, filters.idMateria);
  if (filters.idMateriaDivision) request.input('IdMateriaDivision', sql.Int, filters.idMateriaDivision);
  if (filters.idActividad) request.input('IdActividad', sql.Int, filters.idActividad);
  if (filters.estado) request.input('Estado', sql.NVarChar, filters.estado);
  if (filters.fechaDesde) request.input('FechaDesde', sql.DateTime, new Date(filters.fechaDesde));
  if (filters.fechaHasta) request.input('FechaHasta', sql.DateTime, new Date(filters.fechaHasta));

  const filterClause = buildFilterClause(idDocente, filters, false);
  const detailFilterClause = buildFilterClause(idDocente, filters, true);
  const academicCondition = alcanceAcademico(filters.alcanceIntentos);

  const kpiQuery = `
    SELECT
      COUNT(*) AS TotalIntentos,
      COUNT(CASE WHEN ${academicCondition} THEN 1 END) AS IntentosAlcanceAcademico,
      COUNT(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL THEN 1 END) AS TotalCorregidos,
      ISNULL(AVG(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL
        THEN CAST(I.NotaFinal*10.0/NULLIF(A.EscalaCalificacion,0) AS DECIMAL(10,4)) END),0) AS PromedioGeneral,
      SUM(CASE WHEN ${academicCondition} AND I.NotaFinal>=A.NotaAprobacion THEN 1 ELSE 0 END) AS Aprobados,
      SUM(CASE WHEN ${academicCondition} AND I.NotaFinal<A.NotaAprobacion THEN 1 ELSE 0 END) AS Desaprobados
    FROM Intento I
    INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
    INNER JOIN Actividad A ON P.IdActividad = A.Id
    INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
    INNER JOIN Materia M ON MD.IdMateria = M.Id
    ${INTENTO_VALIDO_APPLY}
    WHERE I.IdAlumno = @Matricula ${filterClause}
  `;

  const detailQuery = `
    SELECT
      A.Id AS IdActividad,
      I.IdPublicacion,
      A.Titulo,
      A.Tipo,
      A.EscalaCalificacion,
      A.NotaAprobacion,
      M.Nombre AS Materia,
      Dv.Descripcion AS Division,
      I.Id AS IdIntento,
      I.NumeroIntento,
      I.NotaFinal,
      I.NotaAutomatica,
      I.Estado AS EstadoIntento,
      I.FechaInicio,
      I.FechaFin,
      CAST(CASE WHEN I.Estado='entregado' AND I.Id=IVS.IdIntentoValido THEN 1 ELSE 0 END AS bit) AS EsIntentoValido,
      CASE WHEN I.Estado='entregado' AND I.Id=IVS.IdIntentoValido
        THEN CASE WHEN IVO.IdIntento IS NULL THEN 'automatica' ELSE 'manual' END
        ELSE NULL END AS SeleccionIntentoValido
    FROM Intento I
    INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
    INNER JOIN Actividad A ON P.IdActividad = A.Id
    INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
    INNER JOIN Materia M ON MD.IdMateria = M.Id
    INNER JOIN Division Dv ON MD.IdDivision = Dv.Id
    ${INTENTO_VALIDO_APPLY}
    WHERE I.IdAlumno = @Matricula ${detailFilterClause}
    ORDER BY A.Id, I.NumeroIntento
  `;

  const [kpiResult, detailResult] = await Promise.all([
    request.query(kpiQuery),
    request.query(detailQuery),
  ]);

  const kpis = mapKeysToCamelCase(kpiResult.recordset[0] || {}) as any;
  kpis.escalaPromedio = 10;
  kpis.alcanceIntentos = filters.alcanceIntentos;
  kpis.porcentajeAprobacion = kpis.totalCorregidos > 0
    ? Math.round((kpis.aprobados / kpis.totalCorregidos) * 1000) / 10
    : 0;

  const detalleRows = detailResult.recordset;
  const actividadMap = new Map<number, any>();

  for (const row of detalleRows) {
    const id = row.IdActividad;
    if (!actividadMap.has(id)) {
      actividadMap.set(id, {
        idActividad: id,
        titulo: row.Titulo,
        tipo: row.Tipo,
        escalaCalificacion: row.EscalaCalificacion,
        notaAprobacion: row.NotaAprobacion,
        materia: row.Materia,
        division: row.Division,
        detalleIntentos: [],
      });
    }
    const entry = actividadMap.get(id);
    entry.detalleIntentos.push({
      numeroIntento: row.NumeroIntento,
      idIntento: row.IdIntento,
      idPublicacion: row.IdPublicacion,
      notaFinal: row.NotaFinal,
      notaAutomatica: row.NotaAutomatica,
      estado: row.EstadoIntento,
      fechaInicio: row.FechaInicio,
      fechaFin: row.FechaFin,
      esIntentoValido: Boolean(row.EsIntentoValido),
      seleccionIntentoValido: row.SeleccionIntentoValido,
    });
  }

  const actividades = mapKeysToCamelCase(Array.from(actividadMap.values())).map((act: any) => {
    const notas = act.detalleIntentos
      .filter((i: any) => i.notaFinal !== null && i.notaFinal !== undefined)
      .map((i: any) => Number(i.notaFinal));

    act.intentos = act.detalleIntentos.length;
    act.notaMaxima = notas.length > 0 ? Math.max(...notas) : null;
    act.notaPromedio = notas.length > 0
      ? Math.round((notas.reduce((a: number, b: number) => a + b, 0) / notas.length) * 100) / 100
      : null;

    const mejor = act.detalleIntentos
      .filter((i: any) => i.notaFinal !== null && i.notaFinal !== undefined)
      .sort((a: any, b: any) => Number(b.notaFinal) - Number(a.notaFinal))[0];
    act.mejorIntento = mejor ? {
      numeroIntento: mejor.numeroIntento,
      notaFinal: mejor.notaFinal,
      notaAutomatica: mejor.notaAutomatica,
      fechaFin: mejor.fechaFin,
      esIntentoValido: mejor.esIntentoValido,
      seleccionIntentoValido: mejor.seleccionIntentoValido,
    } : null;

    delete act.detalleIntentos;
    return act;
  });

  return res.json({
    success: true,
    data: { alumno, kpis, actividades },
  });
}

async function getRendimientoListado(
  res: Response,
  idDocente: number | null,
  params: {
    idMateria: number | null;
    idMateriaDivision: number | null;
    estado: string | null;
    fechaDesde: string | null;
    fechaHasta: string | null;
    promedioMin: number | null;
    promedioMax: number | null;
    ordenarPor: string;
    ordenDireccion: string;
    pagina: number;
    limite: number;
    alcanceIntentos: string;
  },
) {
  const request = pool.request();
  if (idDocente) request.input('IdDocente', sql.Int, idDocente);
  if (params.idMateria) request.input('IdMateria', sql.Int, params.idMateria);
  if (params.idMateriaDivision) request.input('IdMateriaDivision', sql.Int, params.idMateriaDivision);
  if (params.estado) request.input('Estado', sql.NVarChar, params.estado);
  if (params.fechaDesde) request.input('FechaDesde', sql.DateTime, new Date(params.fechaDesde));
  if (params.fechaHasta) request.input('FechaHasta', sql.DateTime, new Date(params.fechaHasta));

  request.input('Offset', sql.Int, (params.pagina - 1) * params.limite);
  request.input('Limit', sql.Int, params.limite);

  const scopeWhere = idDocente ? 'AND MD.IdDocente = @IdDocente' : '';
  const materiaWhere = params.idMateria ? 'AND MD.IdMateria = @IdMateria' : '';
  const divisionWhere = params.idMateriaDivision ? 'AND MD.Id = @IdMateriaDivision' : '';
  const academicCondition = alcanceAcademico(params.alcanceIntentos);

  let intentoJoinExtra = '';
  if (params.estado) intentoJoinExtra += ' AND I.Estado = @Estado';
  if (params.fechaDesde) intentoJoinExtra += ' AND I.FechaInicio >= @FechaDesde';
  if (params.fechaHasta) intentoJoinExtra += ' AND I.FechaInicio <= @FechaHasta';

  const fromClause = `
    FROM Alumno A
    INNER JOIN InscripcionMateria IM ON A.Matricula = IM.IdAlumno
    INNER JOIN MateriaDivision MD ON IM.IdMateriaDivision = MD.Id
    LEFT JOIN Publicacion P ON P.IdMateriaDivision = MD.Id
    LEFT JOIN Intento I ON I.IdPublicacion = P.Id AND I.IdAlumno = A.Matricula${intentoJoinExtra}
    LEFT JOIN Actividad AC ON AC.Id=P.IdActividad
    ${INTENTO_VALIDO_APPLY}
    WHERE 1=1 ${scopeWhere} ${materiaWhere} ${divisionWhere}
  `;

  const countResult = await request.query(`
    SELECT COUNT(DISTINCT A.Matricula) AS Total ${fromClause}
  `);

  const total = countResult.recordset[0]?.Total || 0;
  const totalPaginas = Math.max(1, Math.ceil(total / params.limite));

  const globalKpiResult = await request.query(`
    SELECT
      COUNT(DISTINCT A.Matricula) AS TotalAlumnos,
      COUNT(DISTINCT CASE WHEN I.Id IS NOT NULL THEN A.Matricula END) AS ConIntentos,
      COUNT(I.Id) AS TotalIntentos,
      COUNT(CASE WHEN ${academicCondition} THEN 1 END) AS IntentosAlcanceAcademico,
      ISNULL(AVG(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL
        THEN CAST(I.NotaFinal*10.0/NULLIF(AC.EscalaCalificacion,0) AS DECIMAL(10,4)) END),0) AS PromedioGeneral,
      CASE WHEN COUNT(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL THEN 1 END) > 0
        THEN ROUND(
          CAST(SUM(CASE WHEN ${academicCondition} AND I.NotaFinal>=AC.NotaAprobacion THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(COUNT(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL THEN 1 END),0)*100,1)
        ELSE 0
      END AS TasaAprobacion
    ${fromClause}
  `);

  const orderingMap: Record<string, string> = {
    alumno: 'A.Nombre, A.Apellido',
    promedio: 'Promedio',
    aprobados: 'Aprobados',
    intentos: 'TotalIntentos',
  };
  const orderBy = orderingMap[params.ordenarPor] || 'A.Nombre, A.Apellido';
  const dir = params.ordenDireccion === 'desc' ? 'DESC' : 'ASC';

  const havingClause = buildHavingClause(params, academicCondition);

  const listResult = await request.query(`
    SELECT
      A.Matricula,
      A.Nombre,
      A.Apellido,
      COUNT(I.Id) AS TotalIntentos,
      COUNT(CASE WHEN ${academicCondition} THEN 1 END) AS IntentosAlcanceAcademico,
      COUNT(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL THEN 1 END) AS TotalCorregidos,
      ISNULL(AVG(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL
        THEN CAST(I.NotaFinal*10.0/NULLIF(AC.EscalaCalificacion,0) AS DECIMAL(10,4)) END),0) AS Promedio,
      SUM(CASE WHEN ${academicCondition} AND I.NotaFinal>=AC.NotaAprobacion THEN 1 ELSE 0 END) AS Aprobados,
      SUM(CASE WHEN ${academicCondition} AND I.NotaFinal<AC.NotaAprobacion THEN 1 ELSE 0 END) AS Desaprobados
    ${fromClause}
    GROUP BY A.Matricula, A.Nombre, A.Apellido
    ${havingClause}
    ORDER BY ${orderBy} ${dir}
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY
  `);

  const alumnos = listResult.recordset.map((row: any) => {
    const r = mapKeysToCamelCase(row) as any;
    r.escalaPromedio = 10;
    r.alcanceIntentos = params.alcanceIntentos;
    r.porcentajeAprobacion = r.totalCorregidos > 0
      ? Math.round((r.aprobados / r.totalCorregidos) * 1000) / 10
      : 0;
    return r;
  });
  const kpis = mapKeysToCamelCase(globalKpiResult.recordset[0] || {}) as any;
  kpis.escalaPromedio = 10;
  kpis.alcanceIntentos = params.alcanceIntentos;

  return res.json({
    success: true,
    data: {
      paginacion: {
        pagina: params.pagina,
        limite: params.limite,
        total,
        totalPaginas,
      },
      kpis,
      alumnos,
    },
  });
}

function buildFilterClause(
  idDocente: number | null,
  filters: {
    idMateria: number | null;
    idMateriaDivision: number | null;
    idActividad: number | null;
    estado: string | null;
    fechaDesde: string | null;
    fechaHasta: string | null;
    alcanceIntentos: string;
  },
  aplicarAlcance: boolean,
): string {
  const clauses: string[] = [];
  if (idDocente) clauses.push('AND MD.IdDocente = @IdDocente');
  if (filters.idMateria) clauses.push('AND M.Id = @IdMateria');
  if (filters.idMateriaDivision) clauses.push('AND MD.Id = @IdMateriaDivision');
  if (filters.idActividad) clauses.push('AND A.Id = @IdActividad');
  if (filters.estado) clauses.push('AND I.Estado = @Estado');
  if (filters.fechaDesde) clauses.push('AND I.FechaInicio >= @FechaDesde');
  if (filters.fechaHasta) clauses.push('AND I.FechaInicio <= @FechaHasta');
  if (aplicarAlcance && filters.alcanceIntentos === 'validos') {
    clauses.push("AND I.Estado='entregado' AND I.Id=IVS.IdIntentoValido");
  }
  return clauses.join(' ');
}

function buildHavingClause(params: {
  promedioMin: number | null;
  promedioMax: number | null;
}, academicCondition: string): string {
  const clauses: string[] = [];
  if (params.promedioMin !== null) {
    clauses.push(`AVG(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL THEN
      CAST(I.NotaFinal*10.0/NULLIF(AC.EscalaCalificacion,0) AS DECIMAL(10,4)) END) >= ${params.promedioMin}`);
  }
  if (params.promedioMax !== null) {
    clauses.push(`AVG(CASE WHEN ${academicCondition} AND I.NotaFinal IS NOT NULL THEN
      CAST(I.NotaFinal*10.0/NULLIF(AC.EscalaCalificacion,0) AS DECIMAL(10,4)) END) <= ${params.promedioMax}`);
  }
  return clauses.length > 0 ? `HAVING ${clauses.join(' AND ')}` : '';
}
