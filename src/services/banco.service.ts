import { z } from 'zod';
import { ListaBancoSchema, PreguntaBancoInput, GrupoBancoInput } from '../schemas/banco.schema';
import { BancoError, DbBanco, consultar, validarDisponible, verificarRevision } from './banco-common.service';

export type RecursoBanco = 'preguntas' | 'grupos';
const tablas = { preguntas: 'BancoPregunta', grupos: 'BancoGrupo' } as const;
export async function bloquearBanco(db: DbBanco, docente: number) {
  // Un único orden de bloqueo para todas las escrituras/copies del banco.
  await consultar(db, 'SELECT Legajo FROM dbo.Docente WITH (UPDLOCK,HOLDLOCK) WHERE Legajo=@Docente', { Docente: docente });
}
export async function detalleBanco(db: DbBanco, recurso: RecursoBanco, id: number, docente: number) {
  const row = (await consultar(db, `SELECT * FROM dbo.${tablas[recurso]} WHERE Id=@Id AND IdDocente=@Docente`, { Id: id, Docente: docente })).recordset[0];
  if (!row) throw new BancoError(404, 'Recurso no encontrado');
  if (recurso === 'preguntas') {
    row.Opciones = (await consultar(db, 'SELECT Id,Texto,EsCorrecta,Posicion FROM dbo.BancoOpcion WHERE IdPregunta=@Id ORDER BY Posicion', { Id: id })).recordset;
  } else {
    row.Preguntas = (await consultar(db, `SELECT p.Id,p.Titulo,p.Tipo,p.Estado,p.Revision,gp.Posicion
      FROM dbo.BancoGrupoPregunta gp JOIN dbo.BancoPregunta p ON p.Id=gp.IdPregunta
      WHERE gp.IdGrupo=@Id ORDER BY gp.Posicion`, { Id: id })).recordset;
  }
  const singular = recurso === 'preguntas' ? 'Pregunta' : 'Grupo';
  row.Etiquetas = (await consultar(db, `SELECT e.Id,e.Nombre FROM dbo.Banco${singular}Etiqueta r
    JOIN dbo.BancoEtiqueta e ON e.Id=r.IdEtiqueta WHERE r.Id${singular}=@Id ORDER BY e.Nombre,e.Id`, { Id: id })).recordset;
  return row;
}
export async function listarBanco(db: DbBanco, recurso: RecursoBanco, docente: number, q: z.infer<typeof ListaBancoSchema>) {
  const titulo = recurso === 'preguntas' ? 'Titulo' : 'TituloReferencia';
  const singular = recurso === 'preguntas' ? 'Pregunta' : 'Grupo';
  const parametros = { Docente: docente, Texto: q.texto ?? null, Estado: q.estado ?? null,
    Tipo: q.tipo ?? null, Etiqueta: q.etiqueta ?? null, Offset: (q.pagina - 1) * q.tamano, Tamano: q.tamano };
  const where = `b.IdDocente=@Docente
    AND ((@Estado IS NULL AND b.Estado<>'archivado') OR b.Estado=@Estado)
    AND (@Texto IS NULL OR CHARINDEX(@Texto,b.${titulo})>0 ${recurso === 'preguntas' ? 'OR CHARINDEX(@Texto,b.Enunciado)>0' : ''})
    ${recurso === 'preguntas' ? 'AND (@Tipo IS NULL OR b.Tipo=@Tipo)' : ''}
    AND (@Etiqueta IS NULL OR EXISTS(SELECT 1 FROM dbo.Banco${singular}Etiqueta e WHERE e.Id${singular}=b.Id AND e.IdEtiqueta=@Etiqueta))`;
  const total = (await consultar(db, `SELECT COUNT(*) AS Total FROM dbo.${tablas[recurso]} b WHERE ${where}`, parametros)).recordset[0].Total;
  const items = (await consultar(db, `SELECT b.Id,b.IdDocente,b.${titulo},b.Estado,b.Revision,b.FechaCreacion,b.FechaActualizacion
    ${recurso === 'preguntas' ? ',b.Tipo,LEFT(b.Enunciado,250) AS Resumen' : ''}
    FROM dbo.${tablas[recurso]} b WHERE ${where} ORDER BY b.FechaActualizacion DESC,b.Id DESC
    OFFSET @Offset ROWS FETCH NEXT @Tamano ROWS ONLY`, parametros)).recordset;
  return { Items: items, Total: total, Pagina: q.pagina, Tamano: q.tamano };
}
async function comprobarEtiquetas(db: DbBanco, docente: number, ids: number[]) {
  for (const id of [...ids].sort((a,b) => a-b)) {
    if (!(await consultar(db, 'SELECT Id FROM dbo.BancoEtiqueta WHERE Id=@Id AND IdDocente=@Docente', { Id: id, Docente: docente })).recordset.length)
      throw new BancoError(404, 'Etiqueta no encontrada');
  }
}
async function guardarEtiquetas(db: DbBanco, recurso: RecursoBanco, id: number, docente: number, etiquetas: number[]) {
  const singular = recurso === 'preguntas' ? 'Pregunta' : 'Grupo';
  await consultar(db, `DELETE FROM dbo.Banco${singular}Etiqueta WHERE Id${singular}=@Id`, { Id: id });
  for (const etiqueta of etiquetas) await consultar(db, `INSERT INTO dbo.Banco${singular}Etiqueta(Id${singular},IdEtiqueta,IdDocente)
    VALUES(@Id,@Etiqueta,@Docente)`, { Id: id, Etiqueta: etiqueta, Docente: docente });
}
async function retirarGrupos(db: DbBanco, idPregunta: number) {
  return (await consultar(db, `UPDATE g SET Estado='borrador',Revision=Revision+1,FechaActualizacion=SYSUTCDATETIME()
    OUTPUT inserted.Id,inserted.Revision
    FROM dbo.BancoGrupo g WHERE g.Estado='disponible' AND EXISTS
    (SELECT 1 FROM dbo.BancoGrupoPregunta gp WHERE gp.IdGrupo=g.Id AND gp.IdPregunta=@Id)`, { Id: idPregunta })).recordset;
}
export async function guardarPregunta(db: DbBanco, docente: number, input: PreguntaBancoInput, id?: number, revision?: number) {
  await bloquearBanco(db, docente);
  if (id) verificarRevision((await detalleBanco(db, 'preguntas', id, docente)).Revision, revision!);
  if (input.Estado === 'disponible') validarDisponible(input);
  await comprobarEtiquetas(db, docente, input.Etiquetas);
  const args = { Docente: docente, Titulo: input.Titulo, Enunciado: input.Enunciado, Tipo: input.Tipo, Estado: input.Estado };
  if (id) {
    await consultar(db, `UPDATE dbo.BancoPregunta SET Titulo=@Titulo,Enunciado=@Enunciado,Tipo=@Tipo,Estado=@Estado,
      Revision=Revision+1,FechaActualizacion=SYSUTCDATETIME() WHERE Id=@Id AND IdDocente=@Docente AND Revision=@Revision`, { ...args, Id: id, Revision: revision! });
    await consultar(db, 'DELETE FROM dbo.BancoOpcion WHERE IdPregunta=@Id', { Id: id });
  } else {
    id = (await consultar(db, `INSERT INTO dbo.BancoPregunta(IdDocente,Titulo,Enunciado,Tipo,Estado)
      OUTPUT inserted.Id VALUES(@Docente,@Titulo,@Enunciado,@Tipo,@Estado)`, args)).recordset[0].Id;
  }
  for (const [pos, op] of input.Opciones.entries()) await consultar(db,
    'INSERT INTO dbo.BancoOpcion(IdPregunta,Texto,EsCorrecta,Posicion) VALUES(@Id,@Texto,@Correcta,@Pos)',
    { Id: id!, Texto: op.Texto, Correcta: op.EsCorrecta, Pos: pos+1 });
  await guardarEtiquetas(db, 'preguntas', id!, docente, input.Etiquetas);
  const afectados = input.Estado !== 'disponible' ? await retirarGrupos(db, id!) : [];
  return { ...(await detalleBanco(db, 'preguntas', id!, docente)), GruposAfectados: afectados };
}
async function comprobarPreguntas(db: DbBanco, docente: number, ids: number[], disponible: boolean) {
  if (disponible && !ids.length) throw new BancoError(400, 'Un grupo disponible requiere variantes', 'BANK_CONTENT_INVALID');
  for (const id of [...ids].sort((a,b) => a-b)) {
    const p = await detalleBanco(db, 'preguntas', id, docente);
    if (disponible) {
      if (p.Estado !== 'disponible') throw new BancoError(400, 'Todas las variantes deben estar disponibles', 'BANK_CONTENT_INVALID');
      validarDisponible(p);
    }
  }
}
export async function guardarGrupo(db: DbBanco, docente: number, input: GrupoBancoInput, id?: number, revision?: number) {
  await bloquearBanco(db, docente);
  if (id) verificarRevision((await detalleBanco(db, 'grupos', id, docente)).Revision, revision!);
  await comprobarPreguntas(db, docente, input.Preguntas, input.Estado === 'disponible');
  await comprobarEtiquetas(db, docente, input.Etiquetas);
  const args = { Docente: docente, Titulo: input.TituloReferencia, Estado: input.Estado };
  if (id) {
    await consultar(db, `UPDATE dbo.BancoGrupo SET TituloReferencia=@Titulo,Estado=@Estado,Revision=Revision+1,
      FechaActualizacion=SYSUTCDATETIME() WHERE Id=@Id AND IdDocente=@Docente AND Revision=@Revision`, { ...args, Id: id, Revision: revision! });
    await consultar(db, 'DELETE FROM dbo.BancoGrupoPregunta WHERE IdGrupo=@Id', { Id: id });
  } else id = (await consultar(db, `INSERT INTO dbo.BancoGrupo(IdDocente,TituloReferencia,Estado)
    OUTPUT inserted.Id VALUES(@Docente,@Titulo,@Estado)`, args)).recordset[0].Id;
  for (const [pos, pregunta] of input.Preguntas.entries()) await consultar(db,
    'INSERT INTO dbo.BancoGrupoPregunta(IdGrupo,IdPregunta,IdDocente,Posicion) VALUES(@Id,@Pregunta,@Docente,@Pos)',
    { Id: id!, Pregunta: pregunta, Docente: docente, Pos: pos+1 });
  await guardarEtiquetas(db, 'grupos', id!, docente, input.Etiquetas);
  return detalleBanco(db, 'grupos', id!, docente);
}
export async function cambiarEstadoBanco(db: DbBanco, recurso: RecursoBanco, docente: number, id: number, estado: string, revision: number) {
  await bloquearBanco(db, docente);
  const row = await detalleBanco(db, recurso, id, docente);
  verificarRevision(row.Revision, revision);
  if (estado === 'disponible') {
    if (recurso === 'preguntas') validarDisponible(row);
    else await comprobarPreguntas(db, docente, row.Preguntas.map((p: { Id: number }) => p.Id), true);
  }
  await consultar(db, `UPDATE dbo.${tablas[recurso]} SET Estado=@Estado,Revision=Revision+1,
    FechaActualizacion=SYSUTCDATETIME() WHERE Id=@Id AND IdDocente=@Docente AND Revision=@Revision`,
    { Id: id, Docente: docente, Estado: estado, Revision: revision });
  const afectados = recurso === 'preguntas' && estado !== 'disponible' ? await retirarGrupos(db, id) : [];
  return { ...(await detalleBanco(db, recurso, id, docente)), GruposAfectados: afectados };
}
export async function listarEtiquetas(db: DbBanco, docente: number) {
  return (await consultar(db, 'SELECT Id,Nombre,FechaCreacion,FechaActualizacion FROM dbo.BancoEtiqueta WHERE IdDocente=@Docente ORDER BY Nombre,Id', { Docente: docente })).recordset;
}
export async function guardarEtiqueta(db: DbBanco, docente: number, nombre: string, id?: number) {
  await bloquearBanco(db, docente);
  if (id && !(await consultar(db, 'SELECT Id FROM dbo.BancoEtiqueta WHERE Id=@Id AND IdDocente=@Docente', { Id: id, Docente: docente })).recordset.length)
    throw new BancoError(404, 'Etiqueta no encontrada');
  if ((await consultar(db, `SELECT Id FROM dbo.BancoEtiqueta WHERE IdDocente=@Docente
    AND NombreNormalizado=LOWER(LTRIM(RTRIM(@Nombre))) COLLATE Latin1_General_100_CI_AS AND (@Id IS NULL OR Id<>@Id)`,
    { Docente: docente, Nombre: nombre, Id: id ?? null })).recordset.length) throw new BancoError(409, 'La etiqueta ya existe');
  return (await consultar(db, id ? `UPDATE dbo.BancoEtiqueta SET Nombre=@Nombre,FechaActualizacion=SYSUTCDATETIME()
    OUTPUT inserted.Id,inserted.Nombre WHERE Id=@Id AND IdDocente=@Docente` :
    `INSERT INTO dbo.BancoEtiqueta(IdDocente,Nombre) OUTPUT inserted.Id,inserted.Nombre VALUES(@Docente,@Nombre)`,
    { Id: id ?? null, Docente: docente, Nombre: nombre })).recordset[0];
}
export async function eliminarEtiqueta(db: DbBanco, docente: number, id: number) {
  await bloquearBanco(db, docente);
  if (!(await consultar(db, 'SELECT Id FROM dbo.BancoEtiqueta WHERE Id=@Id AND IdDocente=@Docente', { Id: id, Docente: docente })).recordset.length)
    throw new BancoError(404, 'Etiqueta no encontrada');
  for (const tipo of ['Pregunta','Grupo']) {
    await consultar(db, `UPDATE b SET Revision=Revision+1,FechaActualizacion=SYSUTCDATETIME() FROM dbo.Banco${tipo} b
      WHERE EXISTS(SELECT 1 FROM dbo.Banco${tipo}Etiqueta r WHERE r.Id${tipo}=b.Id AND r.IdEtiqueta=@Id);
      DELETE FROM dbo.Banco${tipo}Etiqueta WHERE IdEtiqueta=@Id`, { Id: id });
  }
  await consultar(db, 'DELETE FROM dbo.BancoEtiqueta WHERE Id=@Id AND IdDocente=@Docente', { Id: id, Docente: docente });
  return { Id: id };
}
