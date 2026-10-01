import { ActividadInput, ActividadUpdateInput, PublicarActividadInput } from '../schemas/evaluacion.schema';
import { ActorBanco, BancoError, DbBanco, consultar } from './banco-common.service';
import { copiarBanco } from './banco-copy.service';
import { detalleBanco } from './banco.service';
import { autorizarActividad, autorizarComision, validarIdsAnidados } from './evaluacion-access.service';
import { guardarActividadCompletaEnBanco } from './evaluacion-bank-save.service';

async function referenciaBanco(db: DbBanco, actor: ActorBanco, recurso: 'preguntas'|'grupos', referencia: any) {
  if (!referencia) return undefined;
  if (actor.role !== 'docente' || !actor.idDocente) throw new BancoError(403, 'Solo el docente propietario puede referenciar su banco', 'FORBIDDEN');
  const item = await detalleBanco(db, recurso, recurso === 'preguntas' ? referencia.IdPregunta : referencia.IdGrupo, actor.idDocente);
  if (item.Revision !== referencia.RevisionEsperada)
    throw new BancoError(409, 'La referencia del banco cambió', 'BANK_REVISION_CONFLICT');
  return item;
}

async function insertarEstructura(db: DbBanco, actor: ActorBanco, actividad: number, grupos: any[]) {
  for (const grupo of grupos) {
    const refGrupo = await referenciaBanco(db, actor, 'grupos', grupo.ReferenciaBanco);
    const row = (await consultar(db, `INSERT INTO dbo.GrupoPregunta
      (IdActividad,TituloReferencia,IdBancoGrupoOrigen,RevisionBancoOrigen,FechaIncorporacionBanco)
      OUTPUT inserted.Id VALUES(@Actividad,@Titulo,@Banco,@Revision,
      CASE WHEN @Banco IS NULL THEN NULL ELSE SYSUTCDATETIME() END)`,
    { Actividad: actividad, Titulo: grupo.TituloReferencia, Banco: refGrupo?.Id ?? null, Revision: refGrupo?.Revision ?? null })).recordset[0];
    for (const pregunta of grupo.Variantes) {
      const refPregunta = await referenciaBanco(db, actor, 'preguntas', pregunta.ReferenciaBanco);
      const p = (await consultar(db, `INSERT INTO dbo.Pregunta
        (IdGrupoPregunta,Enunciado,Tipo,IdBancoPreguntaOrigen,RevisionBancoOrigen,FechaIncorporacionBanco)
        OUTPUT inserted.Id VALUES(@Grupo,@Enunciado,@Tipo,@Banco,@Revision,
        CASE WHEN @Banco IS NULL THEN NULL ELSE SYSUTCDATETIME() END)`,
      { Grupo: row.Id, Enunciado: pregunta.Enunciado, Tipo: pregunta.Tipo,
        Banco: refPregunta?.Id ?? null, Revision: refPregunta?.Revision ?? null })).recordset[0];
      for (const opcion of pregunta.Opciones ?? []) await consultar(db,
        'INSERT INTO dbo.Opcion(IdPregunta,Texto,EsCorrecta) VALUES(@Pregunta,@Texto,@Correcta)',
        { Pregunta: p.Id, Texto: opcion.Texto, Correcta: opcion.EsCorrecta });
    }
  }
}

async function estructuraExistente(db: DbBanco, actividad: number) {
  const gruposRows = (await consultar(db, `SELECT Id,IdBancoGrupoOrigen,RevisionBancoOrigen FROM dbo.GrupoPregunta
    WHERE IdActividad=@Actividad ORDER BY Id`, { Actividad: actividad })).recordset;
  const grupos = gruposRows.map((r: any) => r.Id);
  const preguntas: Record<number, number[]> = {}; const opciones: Record<number, number[]> = {};
  const origenGrupo: Record<number, any> = {}; const origenPregunta: Record<number, any> = {};
  for (const g of gruposRows) {
    origenGrupo[g.Id] = g;
    const ps = (await consultar(db, `SELECT Id,IdBancoPreguntaOrigen,RevisionBancoOrigen FROM dbo.Pregunta
      WHERE IdGrupoPregunta=@Grupo ORDER BY Id`, { Grupo: g.Id })).recordset;
    preguntas[g.Id] = ps.map((p: any) => p.Id);
    for (const p of ps) {
      origenPregunta[p.Id] = p;
      opciones[p.Id] = (await consultar(db, 'SELECT Id FROM dbo.Opcion WHERE IdPregunta=@Pregunta ORDER BY Id',
        { Pregunta: p.Id })).recordset.map((o: any) => o.Id);
    }
  }
  return { grupos, preguntas, opciones, origenGrupo, origenPregunta };
}

async function reemplazarEstructura(db: DbBanco, actor: ActorBanco, actividad: number, grupos: any[]) {
  const actual = await estructuraExistente(db, actividad);
  validarIdsAnidados(grupos, actual.grupos, actual.preguntas, actual.opciones);

  for (const grupo of grupos) {
    const origenGrupo = grupo.Id ? actual.origenGrupo[grupo.Id] : undefined;
    if (origenGrupo?.IdBancoGrupoOrigen && grupo.ReferenciaBanco &&
        origenGrupo.IdBancoGrupoOrigen !== grupo.ReferenciaBanco.IdGrupo)
      throw new BancoError(400, 'No se puede reemplazar el origen de banco de un grupo', 'BANK_CONTENT_INVALID');
    for (const pregunta of grupo.Variantes) {
      const origenPregunta = pregunta.Id ? actual.origenPregunta[pregunta.Id] : undefined;
      if (origenPregunta?.IdBancoPreguntaOrigen && pregunta.ReferenciaBanco &&
          origenPregunta.IdBancoPreguntaOrigen !== pregunta.ReferenciaBanco.IdPregunta)
        throw new BancoError(400, 'No se puede reemplazar el origen de banco de una pregunta', 'BANK_CONTENT_INVALID');
    }
  }

  const gruposRecibidos = new Set(grupos.flatMap((g: any) => g.Id ? [g.Id] : []));
  for (const idGrupo of actual.grupos.filter(id => !gruposRecibidos.has(id))) {
    await consultar(db, `DELETE o FROM dbo.Opcion o JOIN dbo.Pregunta p ON p.Id=o.IdPregunta WHERE p.IdGrupoPregunta=@Grupo;
      DELETE FROM dbo.Pregunta WHERE IdGrupoPregunta=@Grupo;
      DELETE FROM dbo.GrupoPregunta WHERE Id=@Grupo`, { Grupo: idGrupo });
  }

  for (const grupo of grupos) {
    let idGrupo: number;
    if (grupo.Id) {
      idGrupo = grupo.Id;
      const referencia = grupo.ReferenciaBanco
        ? await referenciaBanco(db, actor, 'grupos', grupo.ReferenciaBanco) : undefined;
      await consultar(db, `UPDATE dbo.GrupoPregunta SET TituloReferencia=@Titulo,
        IdBancoGrupoOrigen=COALESCE(IdBancoGrupoOrigen,@Banco),
        RevisionBancoOrigen=CASE WHEN IdBancoGrupoOrigen IS NULL THEN @Revision ELSE RevisionBancoOrigen END,
        FechaIncorporacionBanco=CASE WHEN IdBancoGrupoOrigen IS NULL AND @Banco IS NOT NULL THEN SYSUTCDATETIME() ELSE FechaIncorporacionBanco END
        WHERE Id=@Id`, { Id: idGrupo, Titulo: grupo.TituloReferencia,
        Banco: referencia?.Id ?? null, Revision: referencia?.Revision ?? null });
    } else {
      const referencia = await referenciaBanco(db, actor, 'grupos', grupo.ReferenciaBanco);
      idGrupo = (await consultar(db, `INSERT INTO dbo.GrupoPregunta
        (IdActividad,TituloReferencia,IdBancoGrupoOrigen,RevisionBancoOrigen,FechaIncorporacionBanco)
        OUTPUT inserted.Id VALUES(@Actividad,@Titulo,@Banco,@Revision,
        CASE WHEN @Banco IS NULL THEN NULL ELSE SYSUTCDATETIME() END)`,
      { Actividad: actividad, Titulo: grupo.TituloReferencia, Banco: referencia?.Id ?? null,
        Revision: referencia?.Revision ?? null })).recordset[0].Id;
    }

    const preguntasRecibidas = new Set(grupo.Variantes.flatMap((p: any) => p.Id ? [p.Id] : []));
    for (const idPregunta of (actual.preguntas[grupo.Id] ?? []).filter(id => !preguntasRecibidas.has(id))) {
      await consultar(db, 'DELETE FROM dbo.Opcion WHERE IdPregunta=@Pregunta; DELETE FROM dbo.Pregunta WHERE Id=@Pregunta',
        { Pregunta: idPregunta });
    }

    for (const pregunta of grupo.Variantes) {
      let idPregunta: number;
      if (pregunta.Id) {
        idPregunta = pregunta.Id;
        const referencia = pregunta.ReferenciaBanco
          ? await referenciaBanco(db, actor, 'preguntas', pregunta.ReferenciaBanco) : undefined;
        await consultar(db, `UPDATE dbo.Pregunta SET Enunciado=@Enunciado,Tipo=@Tipo,
          IdBancoPreguntaOrigen=COALESCE(IdBancoPreguntaOrigen,@Banco),
          RevisionBancoOrigen=CASE WHEN IdBancoPreguntaOrigen IS NULL THEN @Revision ELSE RevisionBancoOrigen END,
          FechaIncorporacionBanco=CASE WHEN IdBancoPreguntaOrigen IS NULL AND @Banco IS NOT NULL THEN SYSUTCDATETIME() ELSE FechaIncorporacionBanco END
          WHERE Id=@Id`, { Id: idPregunta, Enunciado: pregunta.Enunciado, Tipo: pregunta.Tipo,
          Banco: referencia?.Id ?? null, Revision: referencia?.Revision ?? null });
      } else {
        const referencia = await referenciaBanco(db, actor, 'preguntas', pregunta.ReferenciaBanco);
        idPregunta = (await consultar(db, `INSERT INTO dbo.Pregunta
          (IdGrupoPregunta,Enunciado,Tipo,IdBancoPreguntaOrigen,RevisionBancoOrigen,FechaIncorporacionBanco)
          OUTPUT inserted.Id VALUES(@Grupo,@Enunciado,@Tipo,@Banco,@Revision,
          CASE WHEN @Banco IS NULL THEN NULL ELSE SYSUTCDATETIME() END)`,
        { Grupo: idGrupo, Enunciado: pregunta.Enunciado, Tipo: pregunta.Tipo,
          Banco: referencia?.Id ?? null, Revision: referencia?.Revision ?? null })).recordset[0].Id;
      }

      const opcionesRecibidas = new Set((pregunta.Opciones ?? []).flatMap((o: any) => o.Id ? [o.Id] : []));
      for (const idOpcion of (actual.opciones[pregunta.Id] ?? []).filter(id => !opcionesRecibidas.has(id)))
        await consultar(db, 'DELETE FROM dbo.Opcion WHERE Id=@Id', { Id: idOpcion });
      for (const opcion of pregunta.Opciones ?? []) {
        if (opcion.Id) await consultar(db, 'UPDATE dbo.Opcion SET Texto=@Texto,EsCorrecta=@Correcta WHERE Id=@Id',
          { Id: opcion.Id, Texto: opcion.Texto, Correcta: opcion.EsCorrecta });
        else await consultar(db, 'INSERT INTO dbo.Opcion(IdPregunta,Texto,EsCorrecta) VALUES(@Pregunta,@Texto,@Correcta)',
          { Pregunta: idPregunta, Texto: opcion.Texto, Correcta: opcion.EsCorrecta });
      }
    }
  }
}

async function actualizarCabecera(db: DbBanco, actividad: number, input: any) {
  await consultar(db, `UPDATE dbo.Actividad SET Titulo=@Titulo,Descripcion=@Descripcion,Tipo=@Tipo,
    CantidadIntentosMaximos=@Intentos,DuracionMinutos=@Duracion,RecursosPermitidos=@Recursos WHERE Id=@Id`,
  { Id: actividad, Titulo: input.Titulo, Descripcion: input.Descripcion ?? null, Tipo: input.Tipo,
    Intentos: input.CantidadIntentosMaximos, Duracion: input.DuracionMinutos, Recursos: input.RecursosPermitidos ?? null });
  await consultar(db, `UPDATE dbo.Publicacion SET IdMateriaDivision=@Comision,
    FechaInicio=CAST(@Inicio AS datetime),FechaFin=CAST(@Fin AS datetime) WHERE Id=@Publicacion AND IdActividad=@Actividad`,
  { Publicacion: input.IdPublicacion, Actividad: actividad, Comision: input.IdMateriaDivision,
    Inicio: input.FechaInicio, Fin: input.FechaFin });
}

export async function validarActividadPublicable(db: DbBanco, actividad: number) {
  const header = (await consultar(db, `SELECT A.Estado,A.CantidadIntentosMaximos,A.DuracionMinutos,P.FechaInicio,P.FechaFin
    FROM dbo.Actividad A JOIN dbo.Publicacion P ON P.IdActividad=A.Id WHERE A.Id=@Id`, { Id: actividad })).recordset[0];
  if (!header || header.Estado !== 'borrador')
    throw new BancoError(400, 'La evaluación ya no está en borrador', 'EVALUATION_ALREADY_PUBLISHED');
  if (header.CantidadIntentosMaximos < 1 || header.CantidadIntentosMaximos > 10 ||
      (header.DuracionMinutos !== null && header.DuracionMinutos <= 0) ||
      new Date(header.FechaFin) <= new Date(header.FechaInicio) || new Date(header.FechaFin) <= new Date())
    throw new BancoError(400, 'La configuración del borrador no es publicable', 'DRAFT_NOT_PUBLISHABLE');
  const grupos = (await consultar(db, 'SELECT Id,TituloReferencia FROM dbo.GrupoPregunta WHERE IdActividad=@Id ORDER BY Id', { Id: actividad })).recordset;
  if (!grupos.length) throw new BancoError(400, 'La evaluación requiere al menos un grupo', 'DRAFT_NOT_PUBLISHABLE');
  for (const grupo of grupos) {
    if (!grupo.TituloReferencia?.trim()) throw new BancoError(400, 'Los grupos requieren título', 'DRAFT_NOT_PUBLISHABLE');
    const preguntas = (await consultar(db, 'SELECT Id,Enunciado,Tipo FROM dbo.Pregunta WHERE IdGrupoPregunta=@Id ORDER BY Id', { Id: grupo.Id })).recordset;
    if (!preguntas.length) throw new BancoError(400, 'Cada grupo requiere al menos una variante', 'DRAFT_NOT_PUBLISHABLE');
    for (const pregunta of preguntas) {
      if (!pregunta.Enunciado?.trim()) throw new BancoError(400, 'Las preguntas requieren enunciado', 'DRAFT_NOT_PUBLISHABLE');
      const opciones = (await consultar(db, 'SELECT Texto,EsCorrecta FROM dbo.Opcion WHERE IdPregunta=@Id ORDER BY Id', { Id: pregunta.Id })).recordset;
      const correctas = opciones.filter((o: any) => Boolean(o.EsCorrecta)).length;
      if (pregunta.Tipo === 'mc' && (opciones.length < 2 || opciones.some((o: any) => !o.Texto?.trim()) || correctas !== 1))
        throw new BancoError(400, 'Pregunta mc incompleta', 'DRAFT_NOT_PUBLISHABLE');
      if (pregunta.Tipo === 'vf') {
        const textos = opciones.map((o: any) => o.Texto.trim().toLowerCase());
        if (opciones.length !== 2 || !textos.includes('verdadero') || !textos.includes('falso') || correctas !== 1)
          throw new BancoError(400, 'Pregunta vf incompleta', 'DRAFT_NOT_PUBLISHABLE');
      }
      if ((pregunta.Tipo === 'abierta' || pregunta.Tipo === 'code') && opciones.length)
        throw new BancoError(400, 'Pregunta manual con opciones', 'DRAFT_NOT_PUBLISHABLE');
    }
  }
}

export async function crearEvaluacion(db: DbBanco, actor: ActorBanco, input: ActividadInput) {
  await autorizarComision(db, actor, input.IdMateriaDivision);
  if (input.GuardarTodoEnBanco && actor.role !== 'docente')
    throw new BancoError(403, 'Un administrador no puede escribir en un banco docente', 'FORBIDDEN');
  const actividad = (await consultar(db, `INSERT INTO dbo.Actividad
    (Titulo,Descripcion,Tipo,CantidadIntentosMaximos,DuracionMinutos,Estado,RecursosPermitidos,Revision)
    OUTPUT inserted.Id,inserted.Revision VALUES(@Titulo,@Descripcion,@Tipo,@Intentos,@Duracion,'borrador',@Recursos,1)`,
  { Titulo: input.Titulo, Descripcion: input.Descripcion ?? null, Tipo: input.Tipo,
    Intentos: input.CantidadIntentosMaximos, Duracion: input.DuracionMinutos, Recursos: input.RecursosPermitidos ?? null })).recordset[0];
  const publicacion = (await consultar(db, `INSERT INTO dbo.Publicacion(IdActividad,IdMateriaDivision,FechaInicio,FechaFin,Visible)
    OUTPUT inserted.Id VALUES(@Actividad,@Comision,CAST(@Inicio AS datetime),CAST(@Fin AS datetime),1)`,
  { Actividad: actividad.Id, Comision: input.IdMateriaDivision, Inicio: input.FechaInicio, Fin: input.FechaFin })).recordset[0];
  await insertarEstructura(db, actor, actividad.Id, input.GruposPreguntas);
  const importaciones = input.ImportacionesBanco ? await copiarBanco(db, actor, actividad.Id, input.ImportacionesBanco) : [];
  let banco: any[] = [];
  let revision = actividad.Revision;
  if (input.Estado === 'publicada') {
    await validarActividadPublicable(db, actividad.Id);
    if (input.GuardarTodoEnBanco) banco = await guardarActividadCompletaEnBanco(db, actor, actividad.Id);
    const publicada = (await consultar(db, `UPDATE dbo.Actividad SET Estado='publicada',Revision=Revision+1
      OUTPUT inserted.Revision WHERE Id=@Id AND Estado='borrador'`, { Id: actividad.Id })).recordset[0];
    revision = publicada.Revision;
  }
  return { IdActividad: actividad.Id, IdPublicacion: publicacion.Id, Estado: input.Estado,
    Revision: revision, Importaciones: importaciones, Banco: banco };
}

async function verificarBorrador(db: DbBanco, actor: ActorBanco, actividad: number, revision: number, publicacion: number, comision: number) {
  const actual = await autorizarActividad(db, actor, actividad, true);
  if (actual.Revision !== revision)
    throw new BancoError(409, 'El borrador cambió; recargar antes de continuar', 'DRAFT_REVISION_CONFLICT');
  if (!actual.Publicaciones.some((p: any) => p.Id === publicacion))
    throw new BancoError(400, 'La publicación no pertenece a la actividad', 'REQUEST_INVALID');
  await autorizarComision(db, actor, comision);
}

export async function modificarBorrador(db: DbBanco, actor: ActorBanco, actividad: number, input: ActividadUpdateInput) {
  await verificarBorrador(db, actor, actividad, input.RevisionEsperada, input.IdPublicacion, input.IdMateriaDivision);
  await actualizarCabecera(db, actividad, input);
  await reemplazarEstructura(db, actor, actividad, input.GruposPreguntas);
  const importaciones = input.ImportacionesBanco ? await copiarBanco(db, actor, actividad, input.ImportacionesBanco) : [];
  const updated = (await consultar(db, `UPDATE dbo.Actividad SET Revision=Revision+1
    OUTPUT inserted.Revision WHERE Id=@Id AND Revision=@Revision`, { Id: actividad, Revision: input.RevisionEsperada })).recordset[0];
  if (!updated) throw new BancoError(409, 'El borrador cambió; recargar antes de continuar', 'DRAFT_REVISION_CONFLICT');
  return { IdActividad: actividad, IdPublicacion: input.IdPublicacion, Estado: 'borrador', Revision: updated.Revision, Importaciones: importaciones };
}

export async function publicarBorrador(db: DbBanco, actor: ActorBanco, actividad: number, input: PublicarActividadInput) {
  await verificarBorrador(db, actor, actividad, input.RevisionEsperada, input.IdPublicacion, input.IdMateriaDivision);
  if (input.GuardarTodoEnBanco && actor.role !== 'docente')
    throw new BancoError(403, 'Un administrador no puede escribir en un banco docente', 'FORBIDDEN');
  await actualizarCabecera(db, actividad, input);
  await reemplazarEstructura(db, actor, actividad, input.GruposPreguntas);
  const importaciones = input.ImportacionesBanco ? await copiarBanco(db, actor, actividad, input.ImportacionesBanco) : [];
  await validarActividadPublicable(db, actividad);
  const banco = input.GuardarTodoEnBanco ? await guardarActividadCompletaEnBanco(db, actor, actividad) : [];
  const updated = (await consultar(db, `UPDATE dbo.Actividad SET Estado='publicada',Revision=Revision+1
    OUTPUT inserted.Revision WHERE Id=@Id AND Estado='borrador' AND Revision=@Revision`,
  { Id: actividad, Revision: input.RevisionEsperada })).recordset[0];
  if (!updated) throw new BancoError(409, 'El borrador cambió; recargar antes de continuar', 'DRAFT_REVISION_CONFLICT');
  return { IdActividad: actividad, IdPublicacion: input.IdPublicacion, Estado: 'publicada',
    Revision: updated.Revision, Importaciones: importaciones, Banco: banco };
}
