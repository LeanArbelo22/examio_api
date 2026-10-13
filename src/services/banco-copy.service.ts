import { GrupoDesdeContenidoInput, ImportacionesBanco } from '../schemas/banco.schema';
import { ActorBanco, BancoError, DbBanco, consultar, propietario, validarDisponible, verificarRevision } from './banco-common.service';
import { bloquearBanco, detalleBanco, guardarGrupo, guardarPregunta } from './banco.service';
import { autorizarActividad } from './evaluacion-access.service';
import { actualizarContenidoHash } from './pregunta-content.service';

export async function copiarBanco(db: DbBanco, actor: ActorBanco, actividad: number, selecciones: ImportacionesBanco) {
  const docente = await propietario(db, actor, true);
  await bloquearBanco(db, docente);
  const vistos = new Set<number>();
  const preparados: { grupo?: any; titulo: string; preguntas: any[] }[] = [];
  for (const seleccion of selecciones) {
    let refs: { IdPregunta: number; RevisionEsperada: number }[];
    let grupo;
    let titulo: string;
    if (seleccion.Tipo === 'grupo') {
      grupo = await detalleBanco(db, 'grupos', seleccion.IdGrupo, docente);
      verificarRevision(grupo.Revision, seleccion.RevisionEsperada);
      if (grupo.Estado !== 'disponible') throw new BancoError(400, 'El grupo no está disponible', 'BANK_CONTENT_INVALID');
      if (grupo.Preguntas.length !== seleccion.Preguntas.length ||
          grupo.Preguntas.some((p: {Id:number}) => !seleccion.Preguntas.some(r => r.IdPregunta === p.Id)))
        throw new BancoError(409, 'La composición del grupo cambió', 'BANK_REVISION_CONFLICT');
      refs = grupo.Preguntas.map((p: {Id:number}) => seleccion.Preguntas.find(r => r.IdPregunta === p.Id)!);
      titulo = grupo.TituloReferencia;
    } else { refs = [seleccion]; titulo = seleccion.TituloReferencia; }
    const preguntas = [];
    for (const ref of refs) {
      if (vistos.has(ref.IdPregunta)) throw new BancoError(400, 'Una pregunta se seleccionó más de una vez', 'BANK_CONTENT_INVALID');
      vistos.add(ref.IdPregunta);
      const p = await detalleBanco(db, 'preguntas', ref.IdPregunta, docente);
      verificarRevision(p.Revision, ref.RevisionEsperada);
      if (p.Estado !== 'disponible') throw new BancoError(400, 'La pregunta no está disponible', 'BANK_CONTENT_INVALID');
      validarDisponible(p);
      preguntas.push(p);
    }
    preparados.push({ grupo, titulo, preguntas });
  }
  const resultado = [];
  for (const item of preparados) {
    const grupoId = (await consultar(db, `INSERT INTO dbo.GrupoPregunta
      (IdActividad,TituloReferencia,IdBancoGrupoOrigen,RevisionBancoOrigen,FechaIncorporacionBanco)
      OUTPUT inserted.Id VALUES(@Actividad,@Titulo,@Origen,@Revision,CASE WHEN @Origen IS NULL THEN NULL ELSE SYSUTCDATETIME() END)`,
      { Actividad: actividad, Titulo: item.titulo, Origen: item.grupo?.Id ?? null, Revision: item.grupo?.Revision ?? null })).recordset[0].Id;
    const preguntas = [];
    for (const p of item.preguntas) {
      const preguntaId = (await consultar(db, `INSERT INTO dbo.Pregunta
        (IdGrupoPregunta,Enunciado,Tipo,ModoJustificacion,EstrategiaCorreccion,TratamientoJustificacion,
         IdBancoPreguntaOrigen,RevisionBancoOrigen,FechaIncorporacionBanco)
        OUTPUT inserted.Id VALUES(@Grupo,@Enunciado,@Tipo,@Justificacion,@Estrategia,@Tratamiento,@Origen,@Revision,SYSUTCDATETIME())`,
        { Grupo: grupoId, Enunciado: p.Enunciado, Tipo: p.Tipo,
          Justificacion: p.ModoJustificacion ?? 'sin_justificacion', Estrategia: p.EstrategiaCorreccion ?? 'exacta',
          Tratamiento: p.TratamientoJustificacion ?? 'informativa', Origen: p.Id, Revision: p.Revision })).recordset[0].Id;
      const opciones = [];
      for (const op of p.Opciones) {
        const opcionId = (await consultar(db, `INSERT INTO dbo.Opcion(IdPregunta,Texto,EsCorrecta)
          OUTPUT inserted.Id VALUES(@Pregunta,@Texto,@Correcta)`, { Pregunta: preguntaId, Texto: op.Texto, Correcta: op.EsCorrecta })).recordset[0].Id;
        opciones.push({ IdOpcion: opcionId, IdBancoOpcion: op.Id });
      }
      await actualizarContenidoHash(db, 'evaluacion', preguntaId);
      preguntas.push({ IdPregunta: preguntaId, IdBancoPregunta: p.Id, RevisionBancoOrigen: p.Revision, Opciones: opciones });
    }
    resultado.push({ IdGrupo: grupoId, IdBancoGrupo: item.grupo?.Id ?? null, Preguntas: preguntas });
  }
  return resultado;
}

export async function desdeEvaluacion(db: DbBanco, actor: ActorBanco, input: {IdActividad:number; Preguntas:number[]; Grupos:number[]}) {
  await autorizarActividad(db, actor, input.IdActividad, false);
  const docente = await propietario(db, actor, true);
  await bloquearBanco(db, docente);
  const vistos = new Set<number>();
  const grupos = [];
  for (const id of input.Grupos) {
    const g = (await consultar(db, 'SELECT Id,TituloReferencia FROM dbo.GrupoPregunta WHERE Id=@Id AND IdActividad=@Actividad',
      { Id: id, Actividad: input.IdActividad })).recordset[0];
    if (!g) throw new BancoError(404, 'Grupo no encontrado en la evaluación');
    const preguntas = (await consultar(db, 'SELECT Id FROM dbo.Pregunta WHERE IdGrupoPregunta=@Id ORDER BY Id', { Id: id })).recordset;
    grupos.push({ origen: id, titulo: g.TituloReferencia, ids: preguntas.map((p: { Id: number }) => p.Id) });
  }
  const copiarPregunta = async (id: number) => {
    if (vistos.has(id)) throw new BancoError(400, 'Selección repetida de una pregunta', 'BANK_CONTENT_INVALID');
    vistos.add(id);
    const p = (await consultar(db, `SELECT p.Id,p.Enunciado,p.Tipo,p.ModoJustificacion,p.EstrategiaCorreccion,
      p.TratamientoJustificacion,g.TituloReferencia FROM dbo.Pregunta p
      JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta WHERE p.Id=@Id AND g.IdActividad=@Actividad`,
      { Id: id, Actividad: input.IdActividad })).recordset[0];
    if (!p) throw new BancoError(404, 'Pregunta no encontrada en la evaluación');
    const opciones = (await consultar(db, 'SELECT Texto,EsCorrecta FROM dbo.Opcion WHERE IdPregunta=@Id ORDER BY Id', { Id: id })).recordset;
    const copia = await guardarPregunta(db, docente, { Titulo: p.TituloReferencia, Enunciado: p.Enunciado, Tipo: p.Tipo,
      ModoJustificacion: p.ModoJustificacion ?? 'sin_justificacion', EstrategiaCorreccion: p.EstrategiaCorreccion ?? 'exacta',
      TratamientoJustificacion: p.TratamientoJustificacion ?? 'informativa',
      Estado: 'borrador', Opciones: opciones.map((o: { Texto: string; EsCorrecta: boolean }) => ({ Texto: o.Texto, EsCorrecta: o.EsCorrecta })), Etiquetas: [] });
    return { IdPreguntaOrigen: id, IdBancoPregunta: copia.Id };
  };
  const preguntas = [];
  for (const id of input.Preguntas) preguntas.push(await copiarPregunta(id));
  const gruposCreados = [];
  for (const grupo of grupos) {
    const copias = [];
    for (const id of grupo.ids) copias.push(await copiarPregunta(id));
    const copia = await guardarGrupo(db, docente, { TituloReferencia: grupo.titulo, Estado: 'borrador',
      Preguntas: copias.map(p => p.IdBancoPregunta), Etiquetas: [] });
    gruposCreados.push({ IdGrupoOrigen: grupo.origen, IdBancoGrupo: copia.Id, Preguntas: copias });
  }
  return { Preguntas: preguntas, Grupos: gruposCreados };
}

export async function grupoDesdeContenido(db: DbBanco, actor: ActorBanco, input: GrupoDesdeContenidoInput) {
  const docente = await propietario(db, actor, true);
  await bloquearBanco(db, docente);
  const preguntas: number[] = [];
  const nuevas: { ClaveCliente: string; Id: number; Revision: number }[] = [];

  for (const item of input.Preguntas) {
    if (item.Origen === 'existente') {
      const pregunta = await detalleBanco(db, 'preguntas', item.IdPregunta, docente);
      verificarRevision(pregunta.Revision, item.RevisionEsperada);
      preguntas.push(pregunta.Id);
      continue;
    }
    const creada = await guardarPregunta(db, docente, { ...item.Pregunta, Estado: 'borrador' });
    preguntas.push(creada.Id);
    nuevas.push({ ClaveCliente: item.ClaveCliente, Id: creada.Id, Revision: creada.Revision });
  }

  const grupo = await guardarGrupo(db, docente, {
    TituloReferencia: input.TituloReferencia,
    Estado: 'borrador',
    Preguntas: preguntas,
    Etiquetas: input.Etiquetas,
  });
  return { Grupo: { Id: grupo.Id, Revision: grupo.Revision, Estado: grupo.Estado }, Preguntas: nuevas };
}
