import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

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
    if (estado !== null && !['entregado', 'en_progreso', 'vencido'].includes(estado)) {
      return res.status(400).json({ success: false, message: 'estado debe ser entregado, en_progreso o vencido' });
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

    if (matricula !== null) {
      return await getRendimientoAlumno(res, matricula, idDocente, {
        idMateria, idMateriaDivision, idActividad, estado, fechaDesde, fechaHasta,
      });
    }

    return await getRendimientoListado(res, idDocente, {
      idMateria, idMateriaDivision, estado, fechaDesde, fechaHasta,
      promedioMin, promedioMax, ordenarPor, ordenDireccion, pagina, limite,
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

  const filterClause = buildFilterClause(idDocente, filters);

  const kpiQuery = `
    SELECT
      COUNT(*) AS TotalIntentos,
      COUNT(CASE WHEN I.NotaFinal IS NOT NULL THEN 1 END) AS TotalCorregidos,
      ISNULL(AVG(CAST(I.NotaFinal AS DECIMAL(10,2))), 0) AS PromedioGeneral,
      SUM(CASE WHEN I.NotaFinal >= 6 THEN 1 ELSE 0 END) AS Aprobados,
      SUM(CASE WHEN I.NotaFinal < 6 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END) AS Desaprobados
    FROM Intento I
    INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
    INNER JOIN Actividad A ON P.IdActividad = A.Id
    INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
    INNER JOIN Materia M ON MD.IdMateria = M.Id
    WHERE I.IdAlumno = @Matricula ${filterClause}
  `;

  const detailQuery = `
    SELECT
      A.Id AS IdActividad,
      A.Titulo,
      A.Tipo,
      M.Nombre AS Materia,
      Dv.Descripcion AS Division,
      I.Id AS IdIntento,
      I.NumeroIntento,
      I.NotaFinal,
      I.NotaAutomatica,
      I.Estado AS EstadoIntento,
      I.FechaInicio,
      I.FechaFin
    FROM Intento I
    INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
    INNER JOIN Actividad A ON P.IdActividad = A.Id
    INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
    INNER JOIN Materia M ON MD.IdMateria = M.Id
    INNER JOIN Division Dv ON MD.IdDivision = Dv.Id
    WHERE I.IdAlumno = @Matricula ${filterClause}
    ORDER BY A.Id, I.NumeroIntento
  `;

  const [kpiResult, detailResult] = await Promise.all([
    request.query(kpiQuery),
    request.query(detailQuery),
  ]);

  const kpis = mapKeysToCamelCase(kpiResult.recordset[0] || {}) as any;
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
        materia: row.Materia,
        division: row.Division,
        detalleIntentos: [],
      });
    }
    const entry = actividadMap.get(id);
    entry.detalleIntentos.push({
      numeroIntento: row.NumeroIntento,
      notaFinal: row.NotaFinal,
      notaAutomatica: row.NotaAutomatica,
      estado: row.EstadoIntento,
      fechaInicio: row.FechaInicio,
      fechaFin: row.FechaFin,
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
      ISNULL(AVG(CAST(I.NotaFinal AS DECIMAL(10,2))), 0) AS PromedioGeneral,
      CASE WHEN COUNT(CASE WHEN I.NotaFinal IS NOT NULL THEN 1 END) > 0
        THEN ROUND(
          CAST(SUM(CASE WHEN I.NotaFinal >= 6 THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(COUNT(CASE WHEN I.NotaFinal IS NOT NULL THEN 1 END), 0) * 100, 1)
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

  const havingClause = buildHavingClause(params);

  const listResult = await request.query(`
    SELECT
      A.Matricula,
      A.Nombre,
      A.Apellido,
      COUNT(I.Id) AS TotalIntentos,
      COUNT(CASE WHEN I.NotaFinal IS NOT NULL THEN 1 END) AS TotalCorregidos,
      ISNULL(AVG(CAST(I.NotaFinal AS DECIMAL(10,2))), 0) AS Promedio,
      SUM(CASE WHEN I.NotaFinal >= 6 THEN 1 ELSE 0 END) AS Aprobados,
      SUM(CASE WHEN I.NotaFinal < 6 AND I.NotaFinal IS NOT NULL THEN 1 ELSE 0 END) AS Desaprobados
    ${fromClause}
    GROUP BY A.Matricula, A.Nombre, A.Apellido
    ${havingClause}
    ORDER BY ${orderBy} ${dir}
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY
  `);

  const alumnos = listResult.recordset.map((row: any) => {
    const r = mapKeysToCamelCase(row) as any;
    r.porcentajeAprobacion = r.totalCorregidos > 0
      ? Math.round((r.aprobados / r.totalCorregidos) * 1000) / 10
      : 0;
    return r;
  });

  return res.json({
    success: true,
    data: {
      paginacion: {
        pagina: params.pagina,
        limite: params.limite,
        total,
        totalPaginas,
      },
      kpis: mapKeysToCamelCase(globalKpiResult.recordset[0] || {}),
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
  },
): string {
  const clauses: string[] = [];
  if (idDocente) clauses.push('AND MD.IdDocente = @IdDocente');
  if (filters.idMateria) clauses.push('AND M.Id = @IdMateria');
  if (filters.idMateriaDivision) clauses.push('AND MD.Id = @IdMateriaDivision');
  if (filters.idActividad) clauses.push('AND A.Id = @IdActividad');
  if (filters.estado) clauses.push('AND I.Estado = @Estado');
  if (filters.fechaDesde) clauses.push('AND I.FechaInicio >= @FechaDesde');
  if (filters.fechaHasta) clauses.push('AND I.FechaInicio <= @FechaHasta');
  return clauses.join(' ');
}

function buildHavingClause(params: {
  promedioMin: number | null;
  promedioMax: number | null;
}): string {
  const clauses: string[] = [];
  if (params.promedioMin !== null) {
    clauses.push(`AVG(CAST(I.NotaFinal AS DECIMAL(10,2))) >= ${params.promedioMin}`);
  }
  if (params.promedioMax !== null) {
    clauses.push(`AVG(CAST(I.NotaFinal AS DECIMAL(10,2))) <= ${params.promedioMax}`);
  }
  return clauses.length > 0 ? `HAVING ${clauses.join(' AND ')}` : '';
}
