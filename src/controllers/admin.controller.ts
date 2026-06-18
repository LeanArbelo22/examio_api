import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const getDashboardAnalitica = async (req: Request, res: Response) => {
  try {
    const idCarrera = req.query.idCarrera ? Number(req.query.idCarrera) : null;
    const idMateria = req.query.idMateria ? Number(req.query.idMateria) : null;
    const idMateriaDivision = req.query.idMateriaDivision ? Number(req.query.idMateriaDivision) : null;
    const legajoDocente = req.query.legajoDocente ? Number(req.query.legajoDocente) : null;
    const matriculaAlumno = req.query.matriculaAlumno ? Number(req.query.matriculaAlumno) : null;

    const intentosPromise = pool.request()
      .input('idCarrera', sql.Int, idCarrera)
      .input('idMateria', sql.Int, idMateria)
      .input('idMateriaDivision', sql.Int, idMateriaDivision)
      .input('legajoDocente', sql.Int, legajoDocente)
      .input('matriculaAlumno', sql.Int, matriculaAlumno)
      .query(`
        SELECT
          I.Id AS IdIntento,
          A.Matricula,
          A.Nombre + ' ' + A.Apellido AS NombreAlumno,
          AC.Titulo AS TituloEvaluacion,
          D.Descripcion AS ComisionMateria,
          I.FechaInicio,
          I.Estado,
          I.NotaFinal,
          (SELECT COUNT(*) FROM AlertaFraude AF WHERE AF.IdIntento = I.Id) AS TotalAlertas
        FROM Intento I
        INNER JOIN Alumno A ON I.IdAlumno = A.Matricula
        INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
        INNER JOIN Actividad AC ON P.IdActividad = AC.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Division D ON MD.IdDivision = D.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        LEFT JOIN Docente DO ON MD.IdDocente = DO.Legajo
        WHERE 1=1
          AND (@idCarrera IS NULL OR M.IdCarrera = @idCarrera)
          AND (@idMateria IS NULL OR M.Id = @idMateria)
          AND (@idMateriaDivision IS NULL OR MD.Id = @idMateriaDivision)
          AND (@legajoDocente IS NULL OR DO.Legajo = @legajoDocente)
          AND (@matriculaAlumno IS NULL OR A.Matricula = @matriculaAlumno)
        ORDER BY I.FechaInicio DESC
      `);

    const evaluacionesPromise = pool.request()
      .input('idCarrera', sql.Int, idCarrera)
      .input('idMateria', sql.Int, idMateria)
      .input('idMateriaDivision', sql.Int, idMateriaDivision)
      .input('legajoDocente', sql.Int, legajoDocente)
      .input('matriculaAlumno', sql.Int, matriculaAlumno)
      .query(`
        SELECT
          DO.Legajo AS LegajoDocente,
          DO.Nombre + ' ' + DO.Apellido AS NombreDocente,
          AC.Titulo AS TituloEvaluacion,
          M.Nombre AS NombreMateria,
          D.Descripcion AS NombreDivision,
          P.FechaInicio AS FechaPublicacion,
          AC.Estado,
          (SELECT COUNT(*) FROM InscripcionMateria IM WHERE IM.IdMateriaDivision = MD.Id) AS AlumnosInscriptos
        FROM Publicacion P
        INNER JOIN Actividad AC ON P.IdActividad = AC.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Division D ON MD.IdDivision = D.Id
        LEFT JOIN Docente DO ON MD.IdDocente = DO.Legajo
        WHERE 1=1
          AND (@idCarrera IS NULL OR M.IdCarrera = @idCarrera)
          AND (@idMateria IS NULL OR M.Id = @idMateria)
          AND (@idMateriaDivision IS NULL OR MD.Id = @idMateriaDivision)
          AND (@legajoDocente IS NULL OR DO.Legajo = @legajoDocente)
          AND (@matriculaAlumno IS NULL OR EXISTS (
            SELECT 1 FROM InscripcionMateria IM2 WHERE IM2.IdMateriaDivision = MD.Id AND IM2.IdAlumno = @matriculaAlumno
          ))
        ORDER BY P.FechaInicio DESC
      `);

    const [intentosResult, evaluacionesResult] = await Promise.all([intentosPromise, evaluacionesPromise]);

    const intentos = intentosResult.recordset;
    const evaluaciones = evaluacionesResult.recordset;

    const totalIntentos = intentos.length;
    const corregidos = intentos.filter((i: any) => i.Estado === 'entregado' && i.NotaFinal != null);
    const promedioGeneral = corregidos.length > 0
      ? corregidos.reduce((sum: number, i: any) => sum + Number(i.NotaFinal), 0) / corregidos.length
      : 0;
    const aprobados = corregidos.filter((i: any) => Number(i.NotaFinal) >= 4).length;
    const tasaAprobacion = corregidos.length > 0 ? (aprobados / corregidos.length) * 100 : 0;
    const totalAlertasFraude = intentos.reduce((sum: number, i: any) => sum + Number(i.TotalAlertas || 0), 0);

    res.json({
      success: true,
      data: {
        kpis: {
          totalIntentos,
          promedioGeneral: Math.round(promedioGeneral * 100) / 100,
          tasaAprobacion: Math.round(tasaAprobacion * 100) / 100,
          totalAlertasFraude,
        },
        intentos: mapKeysToCamelCase(intentos),
        evaluaciones: mapKeysToCamelCase(evaluaciones),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
