import { ActorBanco, BancoError, DbBanco, consultar } from './banco-common.service';

export async function autorizarComision(db: DbBanco, actor: ActorBanco, id: number) {
  const row = (await consultar(db, `SELECT md.Id,md.IdDocente,d.Estado AS DocenteActivo FROM dbo.MateriaDivision md
    LEFT JOIN dbo.Docente d ON d.Legajo=md.IdDocente WHERE md.Id=@Id`, { Id: id })).recordset[0];
  if (!row) throw new BancoError(404, 'Comisión no encontrada');
  if (actor.role !== 'admin' && (actor.role !== 'docente' || !actor.idDocente || row.IdDocente !== actor.idDocente || !row.DocenteActivo))
    throw new BancoError(403, 'La comisión no pertenece al docente');
}
export async function autorizarPublicacion(db: DbBanco, actor: ActorBanco, id: number, bloquear: boolean) {
  const lock = bloquear ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  const row = (await consultar(db, `SELECT p.Id,p.IdActividad,p.IdMateriaDivision,
    md.IdDocente,d.Estado AS DocenteActivo FROM dbo.Publicacion p ${lock}
    JOIN dbo.MateriaDivision md ON md.Id=p.IdMateriaDivision
    LEFT JOIN dbo.Docente d ON d.Legajo=md.IdDocente WHERE p.Id=@Id`, { Id: id })).recordset[0];
  if (!row) throw new BancoError(404, 'Publicación no encontrada');
  if (actor.role !== 'admin' && (actor.role !== 'docente' || !actor.idDocente ||
      row.IdDocente !== actor.idDocente || !row.DocenteActivo)) {
    throw new BancoError(403, 'La publicación no pertenece al docente', 'ATTEMPT_SCOPE_FORBIDDEN');
  }
  return row;
}
export async function autorizarActividad(db: DbBanco, actor: ActorBanco, id: number, editable: boolean) {
  const row = (await consultar(db, `SELECT Id,Estado,Revision,EscalaCalificacion,NotaAprobacion,ModoPuntaje,
    MostrarPuntajePorPregunta,CorreccionAutomaticaCerradas
    FROM dbo.Actividad WITH (UPDLOCK,HOLDLOCK) WHERE Id=@Id`, { Id: id })).recordset[0];
  if (!row) throw new BancoError(404, 'Actividad no encontrada');
  const pubs = (await consultar(db, `SELECT p.Id,md.IdDocente,d.Estado AS DocenteActivo FROM dbo.Publicacion p
    JOIN dbo.MateriaDivision md ON md.Id=p.IdMateriaDivision LEFT JOIN dbo.Docente d ON d.Legajo=md.IdDocente
    WHERE p.IdActividad=@Id`, { Id: id })).recordset;
  if (actor.role !== 'admin' && (actor.role !== 'docente' || !actor.idDocente || !pubs.length ||
      pubs.some((p: {IdDocente: number | null; DocenteActivo: boolean}) => p.IdDocente !== actor.idDocente || !p.DocenteActivo)))
    throw new BancoError(403, 'La evaluación no pertenece al docente');
  if (editable) {
    if (row.Estado !== 'borrador') throw new BancoError(400, 'No se puede modificar una evaluación que ya ha sido publicada o archivada.', 'EVALUATION_ALREADY_PUBLISHED');
    if ((await consultar(db, `SELECT TOP 1 i.Id FROM dbo.Intento i JOIN dbo.Publicacion p ON p.Id=i.IdPublicacion
      WHERE p.IdActividad=@Id`, { Id: id })).recordset.length)
      throw new BancoError(409, 'La evaluación tiene intentos y su estructura es inmutable', 'EVALUATION_HAS_ATTEMPTS');
  }
  return { ...row, Publicaciones: pubs };
}
export async function incrementarRevisionActividad(db: DbBanco, idActividad: number): Promise<number> {
  const row = (await consultar(db, `UPDATE dbo.Actividad SET Revision=Revision+1
    OUTPUT inserted.Revision WHERE Id=@Id`, { Id: idActividad })).recordset[0];
  if (!row) throw new BancoError(404, 'Actividad no encontrada');
  return row.Revision;
}
export function validarIdsAnidados(grupos: any[], existentes: number[], preguntas: Record<number,number[]>, opciones: Record<number,number[]>) {
  const vistos = [new Set<number>(),new Set<number>(),new Set<number>()] as const;
  function revisar(id: number | undefined, permitidos: number[], nivel: 0 | 1 | 2) {
    if (id === undefined) return;
    if (vistos[nivel].has(id) || !permitidos.includes(id)) throw new BancoError(400, 'IDs anidados repetidos o ajenos a la evaluación');
    vistos[nivel].add(id);
  }
  for (const g of grupos) {
    revisar(g.Id, existentes, 0);
    for (const p of g.Variantes) {
      revisar(p.Id, preguntas[g.Id] ?? [], 1);
      for (const o of p.Opciones ?? []) revisar(o.Id, opciones[p.Id] ?? [], 2);
    }
  }
}
