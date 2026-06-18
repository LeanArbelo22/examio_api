import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const iniciarExamen = async (req: Request, res: Response) => {
  try {
    const { IdPublicacion, IdAlumno } = req.body;

    // ── Candado de seguridad: verificar límite de intentos ──
    const check = await pool.request()
      .input('IdPublicacion', sql.Int, IdPublicacion)
      .input('IdAlumno', sql.Int, IdAlumno)
      .query(`
        SELECT ISNULL(CNT.IntentosRealizados, 0) AS IntentosRealizados,
               A.CantidadIntentosMaximos
        FROM Publicacion P
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        OUTER APPLY (
            SELECT COUNT(*) AS IntentosRealizados
            FROM Intento II
            WHERE II.IdPublicacion = @IdPublicacion
              AND II.IdAlumno = @IdAlumno
        ) CNT
        WHERE P.Id = @IdPublicacion
      `);

    const row = check.recordset[0];
    if (row && Number(row.IntentosRealizados) >= Number(row.CantidadIntentosMaximos)) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: Has alcanzado el límite máximo de intentos permitidos para esta evaluación.',
      });
    }

    const result = await pool.request()
      .input('IdPublicacion', sql.Int, IdPublicacion)
      .input('IdAlumno', sql.Int, IdAlumno)
      .execute('SP_Intento_IniciarExamen');

    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const guardarRespuesta = async (req: Request, res: Response) => {
  try {
    const { IdIntento, IdPregunta, IdOpcionNueva, RtaTexto } = req.body;

    if (IdOpcionNueva != null) {
      await pool.request()
        .input('IdIntento', sql.Int, IdIntento)
        .input('IdPregunta', sql.Int, IdPregunta)
        .input('IdOpcionNueva', sql.Int, IdOpcionNueva)
        .execute('SP_Respuesta_GuardarOpcion');

      res.json({ success: true, message: 'Respuesta guardada y auditada correctamente.' });
    } else {
      const existing = await pool.request()
        .input('IdIntento', sql.Int, IdIntento)
        .input('IdPregunta', sql.Int, IdPregunta)
        .query('SELECT Id FROM Respuesta WHERE IdIntento = @IdIntento AND IdPregunta = @IdPregunta');

      if (existing.recordset.length === 0) {
        await pool.request()
          .input('IdIntento', sql.Int, IdIntento)
          .input('IdPregunta', sql.Int, IdPregunta)
          .input('RtaTexto', sql.NVarChar, RtaTexto || null)
          .query('INSERT INTO Respuesta (IdIntento, IdPregunta, RtaTexto) VALUES (@IdIntento, @IdPregunta, @RtaTexto)');
      } else {
        await pool.request()
          .input('IdIntento', sql.Int, IdIntento)
          .input('IdPregunta', sql.Int, IdPregunta)
          .input('RtaTexto', sql.NVarChar, RtaTexto || null)
          .query('UPDATE Respuesta SET RtaTexto = @RtaTexto WHERE IdIntento = @IdIntento AND IdPregunta = @IdPregunta');
      }

      res.json({ success: true, message: 'Respuesta de texto guardada correctamente.' });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const finalizarExamen = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    console.log('🔍 [finalizarExamen] id:', id, '| body:', req.body);
    const result = await pool.request()
      .input('IdIntento', sql.Int, id)
      .execute('SP_Intento_FinalizarExamen');

    console.log('🔍 [finalizarExamen] SP result:', JSON.stringify(result.recordset, null, 2));
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.log('🔍 [finalizarExamen] ERROR:', message);
    res.status(500).json({ success: false, message });
  }
};

export const getHistorialPorAlumno = async (req: Request, res: Response) => {
  try {
    const { idAlumno } = req.params;
    const result = await pool.request()
      .input('IdAlumno', sql.Int, idAlumno)
      .query('SELECT * FROM Intento WHERE IdAlumno = @IdAlumno ORDER BY FechaInicio DESC');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getIntentosDetallados = async (req: Request, res: Response) => {
  try {
    const { idAlumno } = req.params;
    const result = await pool.request()
      .input('IdAlumno', sql.Int, idAlumno)
      .query(`
        SELECT I.Id AS IdIntento, I.IdAlumno, I.IdPublicacion, I.Estado,
               I.NotaFinal, I.NotaAutomatica, I.FechaInicio, I.FechaFin,
               I.NumeroIntento,
               A.Titulo AS TituloEvaluacion, A.Tipo AS TipoEvaluacion,
               A.DuracionMinutos,
               M.Nombre AS Materia, DV.Descripcion AS Division
        FROM Intento I
        INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Division DV ON MD.IdDivision = DV.Id
        WHERE I.IdAlumno = @IdAlumno
        ORDER BY I.FechaInicio DESC
      `);
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getHistorialCorregido = async (req: Request, res: Response) => {
  try {
    const { idAlumno } = req.params;
    const result = await pool.request()
      .input('IdAlumno', sql.Int, idAlumno)
      .query(`
        SELECT I.Id AS IdIntento,
               A.Titulo AS TituloEvaluacion,
               M.Nombre AS Materia,
               DV.Descripcion AS Division,
               I.FechaFin,
               I.NotaFinal,
               I.NumeroIntento
        FROM Intento I
        INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Division DV ON MD.IdDivision = DV.Id
        WHERE I.IdAlumno = @IdAlumno
          AND I.NotaFinal IS NOT NULL
          AND I.Estado = 'entregado'
        ORDER BY I.FechaFin DESC
      `);
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getIntentoCompleto = async (req: Request, res: Response) => {
  try {
    const { idIntento } = req.params;

    const headerResult = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .query(`
        SELECT I.Id AS IdIntento, I.IdAlumno, I.IdPublicacion, I.Estado,
               I.NotaFinal, I.NotaAutomatica, I.FechaInicio, I.FechaFin,
               I.NumeroIntento,
               AL.Nombre, AL.Apellido, AL.Correo,
               A.Titulo AS TituloEvaluacion, A.Tipo AS TipoEvaluacion,
               A.DuracionMinutos
        FROM Intento I
        INNER JOIN Alumno AL ON I.IdAlumno = AL.Matricula
        INNER JOIN Publicacion P ON I.IdPublicacion = P.Id
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        WHERE I.Id = @IdIntento
      `);

    if (headerResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Intento no encontrado' });
    }

    const intento = headerResult.recordset[0];

    if ((req as any).user.role === 'alumno' && intento.IdAlumno !== (req as any).user.idAlumno) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. No tienes permisos para ver la radiografía de este intento.',
      });
    }

    const preguntasResult = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .query(`
        SELECT PR.Id AS IdPregunta, PR.Enunciado, PR.Tipo,
               GP.TituloReferencia AS GrupoConceptualmente,
               O.Id AS IdOpcion, O.Texto AS OpcionTexto, O.EsCorrecta,
               R.Id AS IdRespuesta, R.RtaTexto, R.EsCorrecta AS RespuestaEsCorrecta, R.ComentariosDocente,
               CASE WHEN RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END AS FueSeleccionada
        FROM IntentoPregunta IP
        INNER JOIN Pregunta PR ON IP.IdPregunta = PR.Id
        INNER JOIN GrupoPregunta GP ON PR.IdGrupoPregunta = GP.Id
        LEFT JOIN Opcion O ON O.IdPregunta = PR.Id
        LEFT JOIN Respuesta R ON R.IdIntento = IP.IdIntento AND R.IdPregunta = PR.Id
        LEFT JOIN RespuestaOpcion RO ON R.Id = RO.IdRespuesta AND RO.IdOpcion = O.Id
        WHERE IP.IdIntento = @IdIntento
        ORDER BY GP.Id, PR.Id, O.Id
      `);

    const preguntasMap: Record<number, any> = {};

    for (const row of preguntasResult.recordset) {
      if (!preguntasMap[row.IdPregunta]) {
        preguntasMap[row.IdPregunta] = {
          idPregunta: row.IdPregunta,
          enunciado: row.Enunciado,
          tipo: row.Tipo,
          grupoConceptualmente: row.GrupoConceptualmente,
          respuesta: null,
          opciones: [],
        };
      }

      if (row.IdOpcion != null) {
        preguntasMap[row.IdPregunta].opciones.push({
          idOpcion: row.IdOpcion,
          texto: row.OpcionTexto,
          esCorrecta: row.EsCorrecta,
          fueSeleccionada: row.FueSeleccionada === 1,
        });
      }

      if (row.IdRespuesta != null && !preguntasMap[row.IdPregunta].respuesta) {
        preguntasMap[row.IdPregunta].respuesta = {
          idRespuesta: row.IdRespuesta,
          rtaTexto: row.RtaTexto,
          esCorrecta: row.RespuestaEsCorrecta,
          comentariosDocente: row.ComentariosDocente,
        };
      }
    }

    res.json({
      success: true,
      data: {
        ...mapKeysToCamelCase(headerResult.recordset[0]),
        preguntas: Object.values(preguntasMap),
      },
    });
  } catch (error: any) {
    console.error("=== EXAMIO BACKEND CRASH [getIntentoCompleto] ===");
    console.error("Mensaje:", error?.message ?? error);
    console.error("Stack:", error?.stack ?? "(no stack)");
    res.status(500).json({ success: false, message: error?.message ?? 'Error desconocido' });
  }
};

export const calificarIntento = async (req: Request, res: Response) => {
  try {
    const { idIntento } = req.params;
    const { notaFinal } = req.body;

    const check = await pool.request()
      .input('Id', sql.Int, idIntento)
      .query('SELECT Id, Estado FROM Intento WHERE Id = @Id');

    if (check.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Intento no encontrado' });
    }

    if (check.recordset[0].Estado === 'en_progreso') {
      return res.status(400).json({
        success: false,
        message: 'No se puede calificar un examen que aún está en progreso.',
      });
    }

    await pool.request()
      .input('Id', sql.Int, idIntento)
      .input('NotaFinal', sql.Decimal(4, 2), notaFinal)
      .query('UPDATE Intento SET NotaFinal = @NotaFinal WHERE Id = @Id');

    res.json({ success: true, message: 'Nota asignada correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const corregirRespuesta = async (req: Request, res: Response) => {
  try {
    const { idIntento, idPregunta } = req.params;
    const { esCorrecta, comentariosDocente } = req.body;

    const intento = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .query('SELECT Estado FROM Intento WHERE Id = @IdIntento');

    if (intento.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Intento no encontrado' });
    }

    if (intento.recordset[0].Estado === 'en_progreso') {
      return res.status(400).json({ success: false, message: 'No se puede corregir un examen en progreso' });
    }

    const result = await pool.request()
      .input('IdIntento', sql.Int, idIntento)
      .input('IdPregunta', sql.Int, idPregunta)
      .input('EsCorrecta', sql.Bit, esCorrecta ?? null)
      .input('ComentariosDocente', sql.NVarChar, comentariosDocente ?? null)
      .query(`
        UPDATE Respuesta 
        SET EsCorrecta = @EsCorrecta, ComentariosDocente = @ComentariosDocente
        WHERE IdIntento = @IdIntento AND IdPregunta = @IdPregunta
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Respuesta no encontrada' });
    }

    res.json({ success: true, message: 'Respuesta corregida correctamente' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
