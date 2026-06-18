import { Request, Response } from 'express';
import { pool } from '../config/db';
import * as sql from 'mssql';
import { mapKeysToCamelCase } from '../utils/camelCaseMapper';

export const guardarEvaluacionCompleta = async (req: Request, res: Response) => {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();

    const {
      Titulo, Descripcion, Tipo, CantidadIntentosMaximos, DuracionMinutos, RecursosPermitidos,
      IdMateriaDivision, FechaInicio, FechaFin, Estado, GruposPreguntas
    } = req.body;

    const estadoFinal = Estado || 'publicada';

    console.log('🟡 [crear-examen] payload recibido:', JSON.stringify({
      Titulo, Tipo, CantidadIntentosMaximos, DuracionMinutos,
      IdMateriaDivision, FechaInicio, FechaFin, Estado: estadoFinal,
      GruposCount: GruposPreguntas?.length,
      Grupos: GruposPreguntas?.map((g: any) => ({
        TituloReferencia: g.TituloReferencia,
        Variantes: g.Variantes?.map((v: any) => ({
          Enunciado: v.Enunciado?.substring(0, 60),
          Tipo: v.Tipo,
          OpcionesCount: v.Opciones?.length ?? 0,
        })),
      })),
    }, null, 2));

    const actResult = await transaction.request()
      .input('Titulo', sql.NVarChar, Titulo)
      .input('Descripcion', sql.NVarChar, Descripcion || null)
      .input('Tipo', sql.NVarChar, Tipo)
      .input('CantidadIntentosMaximos', sql.Int, CantidadIntentosMaximos)
      .input('DuracionMinutos', sql.Int, DuracionMinutos || null)
      .input('RecursosPermitidos', sql.NVarChar, RecursosPermitidos || null)
      .execute('SP_Actividad_Crear');

    const idActividad = actResult.recordset[0].IdActividad;

    // Si el Frontend pidió 'borrador', corregimos el estado que el SP dejó como 'publicada'
    if (estadoFinal !== 'publicada') {
      await transaction.request()
        .input('Id', sql.Int, idActividad)
        .input('Estado', sql.NVarChar, estadoFinal)
        .query('UPDATE Actividad SET Estado = @Estado WHERE Id = @Id');
    }

    await transaction.request()
      .input('IdActividad', sql.Int, idActividad)
      .input('IdMateriaDivision', sql.Int, IdMateriaDivision)
      .input('FechaInicio', sql.DateTime, new Date(FechaInicio))
      .input('FechaFin', sql.DateTime, new Date(FechaFin))
      .query(`INSERT INTO Publicacion (IdActividad, IdMateriaDivision, FechaInicio, FechaFin, Visible)
              VALUES (@IdActividad, @IdMateriaDivision, @FechaInicio, @FechaFin, 1)`);

    for (const grupo of GruposPreguntas) {
      const gResult = await transaction.request()
        .input('IdActividad', sql.Int, idActividad)
        .input('Titulo', sql.NVarChar, grupo.TituloReferencia)
        .query('INSERT INTO GrupoPregunta (IdActividad, TituloReferencia) VALUES (@IdActividad, @Titulo); SELECT SCOPE_IDENTITY() AS Id;');

      const idGrupo = gResult.recordset[0].Id;

      for (const variante of grupo.Variantes) {
        const pResult = await transaction.request()
          .input('IdGrupo', sql.Int, idGrupo)
          .input('Enunciado', sql.NVarChar, variante.Enunciado)
          .input('Tipo', sql.NVarChar, variante.Tipo)
          .query('INSERT INTO Pregunta (IdGrupoPregunta, Enunciado, Tipo) VALUES (@IdGrupo, @Enunciado, @Tipo); SELECT SCOPE_IDENTITY() AS Id;');

        const idPregunta = pResult.recordset[0].Id;

        if (variante.Opciones && (variante.Tipo === 'mc' || variante.Tipo === 'vf')) {
          for (const op of variante.Opciones) {
            await transaction.request()
              .input('IdPregunta', sql.Int, idPregunta)
              .input('Texto', sql.NVarChar, op.Texto)
              .input('EsCorrecta', sql.Bit, op.EsCorrecta)
              .query('INSERT INTO Opcion (IdPregunta, Texto, EsCorrecta) VALUES (@IdPregunta, @Texto, @EsCorrecta)');
          }
        }
      }
    }

    await transaction.commit();
    res.status(201).json({ success: true, data: { idActividad } });
  } catch (err: unknown) {
    if (transaction) await transaction.rollback();
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const modificarEvaluacionCompleta = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const checkResult = await pool.request()
      .input('Id', sql.Int, id)
      .query('SELECT Id, Estado FROM Actividad WHERE Id = @Id');

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Actividad no encontrada' });
    }

    if (checkResult.recordset[0].Estado !== 'borrador') {
      return res.status(400).json({
        success: false,
        message: 'No se puede modificar una evaluación que ya ha sido publicada o archivada.',
      });
    }

    const idActividad = parseInt(id, 10);
    const {
      Titulo, Descripcion, Tipo, CantidadIntentosMaximos, DuracionMinutos, RecursosPermitidos,
      IdMateriaDivision, FechaInicio, FechaFin, IdPublicacion, GruposPreguntas
    } = req.body;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 1. UPDATE Actividad
      await transaction.request()
        .input('Id', sql.Int, idActividad)
        .input('Titulo', sql.NVarChar, Titulo)
        .input('Descripcion', sql.NVarChar, Descripcion || null)
        .input('Tipo', sql.NVarChar, Tipo)
        .input('CantidadIntentosMaximos', sql.Int, CantidadIntentosMaximos)
        .input('DuracionMinutos', sql.Int, DuracionMinutos || null)
        .input('RecursosPermitidos', sql.NVarChar, RecursosPermitidos || null)
        .query(`UPDATE Actividad SET
          Titulo = @Titulo, Descripcion = @Descripcion, Tipo = @Tipo,
          CantidadIntentosMaximos = @CantidadIntentosMaximos,
          DuracionMinutos = @DuracionMinutos,
          RecursosPermitidos = @RecursosPermitidos
          WHERE Id = @Id`);

      // 2. UPDATE Publicacion
      await transaction.request()
        .input('Id', sql.Int, IdPublicacion)
        .input('IdMateriaDivision', sql.Int, IdMateriaDivision)
        .input('FechaInicio', sql.DateTime, new Date(FechaInicio))
        .input('FechaFin', sql.DateTime, new Date(FechaFin))
        .query(`UPDATE Publicacion SET
          IdMateriaDivision = @IdMateriaDivision,
          FechaInicio = @FechaInicio, FechaFin = @FechaFin
          WHERE Id = @Id`);

      // 3. Load existing structure from BD
      const existingGrupos = (await transaction.request()
        .input('IdActividad', sql.Int, idActividad)
        .query('SELECT Id FROM GrupoPregunta WHERE IdActividad = @IdActividad')
      ).recordset.map((r: any) => r.Id);

      const existingPreguntasByGrupo: Record<number, number[]> = {};
      for (const gId of existingGrupos) {
        existingPreguntasByGrupo[gId] = (await transaction.request()
          .input('IdGrupo', sql.Int, gId)
          .query('SELECT Id FROM Pregunta WHERE IdGrupoPregunta = @IdGrupo')
        ).recordset.map((r: any) => r.Id);
      }

      const existingOpcionesByPregunta: Record<number, number[]> = {};
      for (const gId of existingGrupos) {
        for (const pId of (existingPreguntasByGrupo[gId] || [])) {
          existingOpcionesByPregunta[pId] = (await transaction.request()
            .input('IdPregunta', sql.Int, pId)
            .query('SELECT Id FROM Opcion WHERE IdPregunta = @IdPregunta')
          ).recordset.map((r: any) => r.Id);
        }
      }

      // 4. DELETE removed grupos (bottom-up: opciones → preguntas → grupo)
      const payloadGrupoIds: number[] = GruposPreguntas
        .filter((g: any) => g.Id != null)
        .map((g: any) => g.Id);

      for (const gId of existingGrupos) {
        if (!payloadGrupoIds.includes(gId)) {
          for (const pId of (existingPreguntasByGrupo[gId] || [])) {
            await transaction.request()
              .input('IdPregunta', sql.Int, pId)
              .query('DELETE FROM Opcion WHERE IdPregunta = @IdPregunta');
          }
          await transaction.request()
            .input('IdGrupo', sql.Int, gId)
            .query('DELETE FROM Pregunta WHERE IdGrupoPregunta = @IdGrupo');
          await transaction.request()
            .input('Id', sql.Int, gId)
            .query('DELETE FROM GrupoPregunta WHERE Id = @Id');
        }
      }

      // 5. Process each Grupo (UPSERT + preguntas)
      for (const grupo of GruposPreguntas) {
        let idGrupo: number;

        if (grupo.Id != null) {
          await transaction.request()
            .input('Id', sql.Int, grupo.Id)
            .input('Titulo', sql.NVarChar, grupo.TituloReferencia)
            .query('UPDATE GrupoPregunta SET TituloReferencia = @Titulo WHERE Id = @Id');
          idGrupo = grupo.Id;
        } else {
          const gResult = await transaction.request()
            .input('IdActividad', sql.Int, idActividad)
            .input('Titulo', sql.NVarChar, grupo.TituloReferencia)
            .query('INSERT INTO GrupoPregunta (IdActividad, TituloReferencia) VALUES (@IdActividad, @Titulo); SELECT SCOPE_IDENTITY() AS Id;');
          idGrupo = gResult.recordset[0].Id;
        }

        // Determine which preguntas to delete within this grupo
        const payloadPreguntaIds: number[] = grupo.Variantes
          .filter((v: any) => v.Id != null)
          .map((v: any) => v.Id);

        for (const pId of (existingPreguntasByGrupo[grupo.Id] || [])) {
          if (!payloadPreguntaIds.includes(pId)) {
            await transaction.request()
              .input('IdPregunta', sql.Int, pId)
              .query('DELETE FROM Opcion WHERE IdPregunta = @IdPregunta');
            await transaction.request()
              .input('Id', sql.Int, pId)
              .query('DELETE FROM Pregunta WHERE Id = @Id');
          }
        }

        // Process each Variante (pregunta)
        for (const variante of grupo.Variantes) {
          let idPregunta: number;

          if (variante.Id != null) {
            await transaction.request()
              .input('Id', sql.Int, variante.Id)
              .input('Enunciado', sql.NVarChar, variante.Enunciado)
              .input('Tipo', sql.NVarChar, variante.Tipo)
              .query('UPDATE Pregunta SET Enunciado = @Enunciado, Tipo = @Tipo WHERE Id = @Id');
            idPregunta = variante.Id;
          } else {
            const pResult = await transaction.request()
              .input('IdGrupo', sql.Int, idGrupo)
              .input('Enunciado', sql.NVarChar, variante.Enunciado)
              .input('Tipo', sql.NVarChar, variante.Tipo)
              .query('INSERT INTO Pregunta (IdGrupoPregunta, Enunciado, Tipo) VALUES (@IdGrupo, @Enunciado, @Tipo); SELECT SCOPE_IDENTITY() AS Id;');
            idPregunta = pResult.recordset[0].Id;
          }

          // Handle Opciones
          if (variante.Opciones) {
            const payloadOpcionIds: number[] = variante.Opciones
              .filter((o: any) => o.Id != null)
              .map((o: any) => o.Id);

            if (variante.Id != null) {
              for (const oId of (existingOpcionesByPregunta[variante.Id] || [])) {
                if (!payloadOpcionIds.includes(oId)) {
                  await transaction.request()
                    .input('Id', sql.Int, oId)
                    .query('DELETE FROM Opcion WHERE Id = @Id');
                }
              }
            }

            for (const opcion of variante.Opciones) {
              if (opcion.Id != null) {
                await transaction.request()
                  .input('Id', sql.Int, opcion.Id)
                  .input('Texto', sql.NVarChar, opcion.Texto)
                  .input('EsCorrecta', sql.Bit, opcion.EsCorrecta)
                  .query('UPDATE Opcion SET Texto = @Texto, EsCorrecta = @EsCorrecta WHERE Id = @Id');
              } else {
                await transaction.request()
                  .input('IdPregunta', sql.Int, idPregunta)
                  .input('Texto', sql.NVarChar, opcion.Texto)
                  .input('EsCorrecta', sql.Bit, opcion.EsCorrecta)
                  .query('INSERT INTO Opcion (IdPregunta, Texto, EsCorrecta) VALUES (@IdPregunta, @Texto, @EsCorrecta)');
              }
            }
          }
        }
      }

      await transaction.commit();
      res.json({ success: true, message: 'Evaluación modificada correctamente' });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const obtenerExamenSorteado = async (req: Request, res: Response) => {
  try {
    const result = await pool.request()
      .input('IdIntento', sql.Int, req.params.idIntento)
      .execute('SP_Intento_ObtenerExamenDinamico');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const obtenerOpcionesPregunta = async (req: Request, res: Response) => {
  try {
    const result = await pool.request()
      .input('IdPregunta', sql.Int, req.params.idPregunta)
      .input('IdIntento', sql.Int, req.params.idIntento)
      .execute('SP_Pregunta_ObtenerOpciones');
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const actualizarEstadoEvaluacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    await pool.request()
      .input('Id', sql.Int, id)
      .input('Estado', sql.NVarChar, estado)
      .query('UPDATE Actividad SET Estado = @Estado WHERE Id = @Id');

    res.json({ success: true, message: 'Estado actualizado' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const obtenerPendientesPorAlumno = async (req: Request, res: Response) => {
  try {
    const { matricula } = req.params;
    const result = await pool.request()
      .input('Matricula', sql.Int, matricula)
      .query(`
        SELECT P.Id AS IdPublicacion, A.Titulo, A.Descripcion, A.DuracionMinutos,
               P.FechaInicio, P.FechaFin, A.RecursosPermitidos,
               A.CantidadIntentosMaximos,
               M.Nombre AS Materia, C.Nombre AS Carrera,
               D.Nombre + ' ' + D.Apellido AS Docente,
               ULT.Estado AS EstadoUltimoIntento,
               ISNULL(CNT.IntentosRealizados, 0) AS IntentosRealizados
        FROM Publicacion P
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Carrera C ON M.IdCarrera = C.Id
        LEFT JOIN Docente D ON MD.IdDocente = D.Legajo
        INNER JOIN InscripcionMateria IM ON IM.IdMateriaDivision = MD.Id
        OUTER APPLY (
            SELECT TOP 1 II.Estado
            FROM Intento II
            WHERE II.IdAlumno = IM.IdAlumno
              AND II.IdPublicacion = P.Id
            ORDER BY II.FechaInicio DESC
        ) ULT
        OUTER APPLY (
            SELECT COUNT(*) AS IntentosRealizados
            FROM Intento II
            WHERE II.IdAlumno = IM.IdAlumno
              AND II.IdPublicacion = P.Id
        ) CNT
        WHERE IM.IdAlumno = @Matricula
          AND A.Estado = 'publicada'
          AND P.Visible = 1
          AND SYSUTCDATETIME() BETWEEN P.FechaInicio AND P.FechaFin
        ORDER BY P.FechaFin ASC
      `);

    const data = result.recordset.map((row: any) => ({
      ...mapKeysToCamelCase(row),
      puedeReintentar: row.EstadoUltimoIntento !== 'en_progreso'
        && Number(row.IntentosRealizados) < Number(row.CantidadIntentosMaximos),
      enProgreso: row.EstadoUltimoIntento === 'en_progreso',
      intentosAgotados: Number(row.IntentosRealizados) >= Number(row.CantidadIntentosMaximos),
    }));

    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const obtenerPublicacionPorId = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.request()
      .input('Id', sql.Int, id)
      .query(`
        SELECT P.Id AS IdPublicacion, A.Titulo, A.Descripcion, A.DuracionMinutos,
               P.FechaInicio, P.FechaFin, A.RecursosPermitidos,
               M.Nombre AS Materia, C.Nombre AS Carrera,
               D.Nombre + ' ' + D.Apellido AS Docente,
               (SELECT COUNT(*) FROM GrupoPregunta WHERE IdActividad = A.Id) AS GruposCount
        FROM Publicacion P
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Carrera C ON M.IdCarrera = C.Id
        LEFT JOIN Docente D ON MD.IdDocente = D.Legajo
        WHERE P.Id = @Id
      `);

    if (result.recordset.length === 0) return res.status(404).json({ success: false, message: 'Publicación no encontrada' });
    res.json({ success: true, data: mapKeysToCamelCase(result.recordset[0]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getDetallePublicacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const headerResult = await pool.request()
      .input('Id', sql.Int, id)
      .query(`
        SELECT A.Id AS IdActividad, A.Titulo, A.Descripcion, A.Tipo, A.DuracionMinutos,
               A.CantidadIntentosMaximos, A.Estado, A.RecursosPermitidos,
               P.Id AS IdPublicacion, P.FechaInicio, P.FechaFin,
               M.Nombre AS Materia, Dv.Descripcion AS Division
        FROM Actividad A
        INNER JOIN Publicacion P ON P.IdActividad = A.Id
        INNER JOIN MateriaDivision MD ON P.IdMateriaDivision = MD.Id
        INNER JOIN Materia M ON MD.IdMateria = M.Id
        INNER JOIN Division Dv ON MD.IdDivision = Dv.Id
        WHERE P.Id = @Id
      `);

    if (headerResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Publicación no encontrada' });
    }

    const header = headerResult.recordset[0];

    const detalleResult = await pool.request()
      .input('IdActividad', sql.Int, header.IdActividad)
      .query(`
        SELECT GP.Id AS IdGrupo, GP.TituloReferencia,
               PR.Id AS IdPregunta, PR.Enunciado, PR.Tipo,
               O.Id AS IdOpcion, O.Texto, O.EsCorrecta
        FROM GrupoPregunta GP
        INNER JOIN Pregunta PR ON PR.IdGrupoPregunta = GP.Id
        LEFT JOIN Opcion O ON O.IdPregunta = PR.Id
        WHERE GP.IdActividad = @IdActividad
        ORDER BY GP.Id, PR.Id, O.Id
      `);

    const gruposMap: Record<number, any> = {};
    const preguntasMap: Record<number, any> = {};

    for (const row of detalleResult.recordset) {
      if (!gruposMap[row.IdGrupo]) {
        gruposMap[row.IdGrupo] = {
          idGrupo: row.IdGrupo,
          tituloReferencia: row.TituloReferencia,
          preguntas: [],
        };
      }

      if (row.IdPregunta && !preguntasMap[row.IdPregunta]) {
        preguntasMap[row.IdPregunta] = {
          idPregunta: row.IdPregunta,
          enunciado: row.Enunciado,
          tipo: row.Tipo,
          opciones: [],
        };
        gruposMap[row.IdGrupo].preguntas.push(preguntasMap[row.IdPregunta]);
      }

      if (row.IdOpcion != null && preguntasMap[row.IdPregunta]) {
        preguntasMap[row.IdPregunta].opciones.push({
          idOpcion: row.IdOpcion,
          texto: row.Texto,
          esCorrecta: row.EsCorrecta,
        });
      }
    }

    res.json({
      success: true,
      data: {
        ...mapKeysToCamelCase(header),
        grupos: Object.values(gruposMap),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};

export const getAlumnosByPublicacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.request()
      .input('IdPublicacion', sql.Int, id)
      .query(`
        SELECT AL.Matricula, AL.Nombre, AL.Apellido, AL.Correo,
               I.Id AS IdIntento, I.Estado AS EstadoIntento, I.NotaFinal, I.NotaAutomatica,
               I.FechaInicio AS FechaInicioIntento, I.FechaFin AS FechaFinIntento,
               I.NumeroIntento, A.CantidadIntentosMaximos
        FROM InscripcionMateria IM
        INNER JOIN Alumno AL ON IM.IdAlumno = AL.Matricula
        LEFT JOIN Intento I ON I.IdPublicacion = @IdPublicacion AND I.IdAlumno = AL.Matricula
        INNER JOIN Publicacion P ON P.Id = @IdPublicacion
        INNER JOIN Actividad A ON P.IdActividad = A.Id
        WHERE IM.IdMateriaDivision = P.IdMateriaDivision
        ORDER BY AL.Apellido, AL.Nombre
      `);

    const data = result.recordset.map((row: any) => ({
      ...mapKeysToCamelCase(row),
      intentosAgotados: row.NumeroIntento != null
        && Number(row.NumeroIntento) >= Number(row.CantidadIntentosMaximos),
    }));

    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ success: false, message });
  }
};
