import { ActorBanco, BancoError, DbBanco, consultar, propietario } from './banco-common.service';
import { detalleBanco, guardarGrupo, guardarPregunta } from './banco.service';

function opcionesIguales(a: any[], b: any[]) {
  return a.length === b.length && a.every((op, i) => op.Texto === b[i].Texto && Boolean(op.EsCorrecta) === Boolean(b[i].EsCorrecta));
}

export async function guardarActividadCompletaEnBanco(db: DbBanco, actor: ActorBanco, idActividad: number) {
  const docente = await propietario(db, actor, true);
  const grupos = (await consultar(db, `SELECT Id,TituloReferencia,IdBancoGrupoOrigen
    FROM dbo.GrupoPregunta WHERE IdActividad=@Actividad ORDER BY Id`, { Actividad: idActividad })).recordset;
  const mappings = [];

  for (const grupo of grupos) {
    const preguntas = (await consultar(db, `SELECT Id,Enunciado,Tipo,IdBancoPreguntaOrigen
      FROM dbo.Pregunta WHERE IdGrupoPregunta=@Grupo ORDER BY Id`, { Grupo: grupo.Id })).recordset;
    const bancoPreguntas: { Id: number; Revision: number; Estado: string }[] = [];
    const preguntaMappings = [];

    for (const pregunta of preguntas) {
      const opciones = (await consultar(db, `SELECT Texto,EsCorrecta FROM dbo.Opcion
        WHERE IdPregunta=@Pregunta ORDER BY Id`, { Pregunta: pregunta.Id })).recordset;
      let bancoPregunta: any | undefined;
      const estadoPregunta = pregunta.Tipo === 'code' ? 'borrador' : 'disponible';
      if (pregunta.IdBancoPreguntaOrigen) {
        const actual = await detalleBanco(db, 'preguntas', pregunta.IdBancoPreguntaOrigen, docente);
        if (actual.Titulo === grupo.TituloReferencia && actual.Enunciado === pregunta.Enunciado &&
            actual.Tipo === pregunta.Tipo && actual.Estado === estadoPregunta && opcionesIguales(opciones, actual.Opciones))
          bancoPregunta = actual;
      }
      if (!bancoPregunta) {
        bancoPregunta = await guardarPregunta(db, docente, {
          Titulo: grupo.TituloReferencia,
          Enunciado: pregunta.Enunciado,
          Tipo: pregunta.Tipo,
          Estado: estadoPregunta,
          Opciones: opciones.map((o: any) => ({ Texto: o.Texto, EsCorrecta: Boolean(o.EsCorrecta) })),
          Etiquetas: [],
        });
      }
      await consultar(db, `UPDATE dbo.Pregunta SET IdBancoPreguntaOrigen=@Banco,RevisionBancoOrigen=@Revision,
        FechaIncorporacionBanco=SYSUTCDATETIME() WHERE Id=@Id`,
      { Id: pregunta.Id, Banco: bancoPregunta.Id, Revision: bancoPregunta.Revision });
      bancoPreguntas.push({ Id: bancoPregunta.Id, Revision: bancoPregunta.Revision, Estado: bancoPregunta.Estado });
      preguntaMappings.push({ IdPregunta: pregunta.Id, IdBancoPregunta: bancoPregunta.Id, RevisionBanco: bancoPregunta.Revision });
    }

    let bancoGrupo: any | undefined;
    const estadoGrupo = bancoPreguntas.every(p => p.Estado === 'disponible') ? 'disponible' : 'borrador';
    if (grupo.IdBancoGrupoOrigen) {
      const actual = await detalleBanco(db, 'grupos', grupo.IdBancoGrupoOrigen, docente);
      if (actual.TituloReferencia === grupo.TituloReferencia && actual.Estado === estadoGrupo &&
          actual.Preguntas.length === bancoPreguntas.length &&
          actual.Preguntas.every((p: any, i: number) => p.Id === bancoPreguntas[i].Id)) bancoGrupo = actual;
    }
    if (!bancoGrupo) {
      bancoGrupo = await guardarGrupo(db, docente, {
        TituloReferencia: grupo.TituloReferencia,
        Estado: estadoGrupo,
        Preguntas: bancoPreguntas.map(p => p.Id), Etiquetas: [],
      });
    }
    await consultar(db, `UPDATE dbo.GrupoPregunta SET IdBancoGrupoOrigen=@Banco,RevisionBancoOrigen=@Revision,
      FechaIncorporacionBanco=SYSUTCDATETIME() WHERE Id=@Id`,
    { Id: grupo.Id, Banco: bancoGrupo.Id, Revision: bancoGrupo.Revision });
    mappings.push({ IdGrupo: grupo.Id, IdBancoGrupo: bancoGrupo.Id, RevisionBanco: bancoGrupo.Revision, Preguntas: preguntaMappings });
  }
  if (!mappings.length) throw new BancoError(400, 'La evaluación no contiene grupos publicables', 'DRAFT_NOT_PUBLISHABLE');
  return mappings;
}
