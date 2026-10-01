import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);
const { validarDisponible, BancoError } = require('../src/services/banco-common.service');
const { validarIdsAnidados } = require('../src/services/evaluacion-access.service');
let app: any;
let docente: string;
let admin: string;
let alumno: string;
let parametros: Record<string, any>;
let pregunta: any;
let opciones: any[];
let grupo: any;
let miembros: any[];
let estadoActividad: string;
let revisionActividad: number;
let duenoActividad: number;
let intentos: boolean;
let fallo: string | undefined;
let opcionesCopiadas: any[];
let writes: string[];
let operacionesIdempotentes: Map<string, any>;
const base = '/api/banco-preguntas';
const input = { Titulo: 'Redes', Tipo: 'mc', Enunciado: '¿Qué es TCP?', Estado: 'disponible',
  Opciones: [{ Texto: 'Protocolo', EsCorrecta: true }, { Texto: 'Memoria', EsCorrecta: false }], Etiquetas: [] };
const seleccion = [{ Tipo: 'pregunta', IdPregunta: 10, RevisionEsperada: 1, TituloReferencia: 'Redes' }];

beforeAll(() => {
  process.env.JWT_SECRET = 'banco-test-secret-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'banco-refresh-secret-with-at-least-32-characters';
  process.env.AUTH_ALLOW_LEGACY_ACCESS_TOKENS = 'true';
  docente = jwt.sign({ id: 1, email: 'd@test.com', role: 'docente', idDocente: 7 }, process.env.JWT_SECRET);
  admin = jwt.sign({ id: 2, email: 'a@test.com', role: 'admin' }, process.env.JWT_SECRET);
  alumno = jwt.sign({ id: 3, email: 's@test.com', role: 'alumno', idAlumno: 8 }, process.env.JWT_SECRET);
  app = require('../src/app').app;
});
beforeEach(() => {
  parametros = {}; writes = []; opcionesCopiadas = []; fallo = undefined; operacionesIdempotentes = new Map();
  pregunta = { Id: 10, IdDocente: 7, Titulo: input.Titulo, Tipo: input.Tipo, Enunciado: input.Enunciado, Estado: 'disponible', Revision: 1 };
  opciones = input.Opciones.map((o,i) => ({ ...o, Id: i+1, Posicion: i+1 }));
  grupo = { Id: 20, IdDocente: 7, TituloReferencia: 'Grupo', Estado: 'disponible', Revision: 1 };
  miembros = [{ Id: 10, Revision: 1, Estado: 'disponible' }];
  estadoActividad = 'borrador'; revisionActividad = 1; duenoActividad = 7; intentos = false;
  mock.transactionRequest.query.mockReset();
  mock.transactionRequest.input.mockImplementation((k, _tipo, v) => { parametros[k] = v; return mock.transactionRequest; });
  mock.transactionRequest.query.mockImplementation(async (sql: string) => {
    if (fallo && sql.includes(fallo)) throw new Error('SQL password=secret tabla privada');
    const p = { ...parametros };
    const result = (rows: any[] = []) => ({ recordset: rows });
    if (/INSERT|UPDATE|DELETE/.test(sql) && !sql.startsWith('SELECT')) writes.push(sql);
    if (sql.includes('FROM dbo.Docente')) return result([{ Legajo: 7 }]);
    if (sql.includes('FROM dbo.Actividad WITH')) return result([{ Id: 5, Estado: estadoActividad, Revision: revisionActividad }]);
    if (sql.includes('FROM dbo.Publicacion p') && sql.includes('DocenteActivo')) return result([{ Id: 2, IdDocente: duenoActividad, DocenteActivo: true }]);
    if (sql.includes('FROM dbo.Intento')) return result(intentos ? [{ Id: 50 }] : []);
    if (sql.includes('FROM dbo.MateriaDivision md')) return result([{ Id: 1, IdDocente: duenoActividad, DocenteActivo: true }]);
    if (sql.startsWith('SELECT * FROM dbo.BancoPregunta')) return result(p.Id === pregunta.Id && p.Docente === pregunta.IdDocente ? [{ ...pregunta }] : []);
    if (sql.startsWith('SELECT * FROM dbo.BancoGrupo')) return result(p.Id === grupo.Id && p.Docente === grupo.IdDocente ? [{ ...grupo }] : []);
    if (sql.includes('FROM dbo.BancoOpcion')) return result(opciones.map(o => ({ ...o })));
    if (sql.startsWith('SELECT') && sql.includes('FROM dbo.BancoGrupoPregunta gp')) return result(miembros);
    if (sql.includes('SELECT COUNT(*) AS Total')) return result([{ Total: 1 }]);
    if (sql.includes('OFFSET @Offset')) return result([{ Id: 10, Titulo: 'Redes', Revision: 1 }]);
    if (sql.includes('SELECT Id FROM dbo.BancoEtiqueta')) return result([]);
    if (sql.includes('SELECT Id,TituloReferencia FROM dbo.GrupoPregunta')) return result([{ Id: 1, TituloReferencia: 'Original' }]);
    if (sql.includes('SELECT Id FROM dbo.Pregunta WHERE IdGrupoPregunta')) return result([{ Id: 1 }]);
    if (sql.includes('SELECT p.Id,p.Enunciado,p.Tipo,g.TituloReferencia')) return result([{ Id: p.Id, Enunciado: 'Original', Tipo: 'mc', TituloReferencia: 'Original' }]);
    if (sql.includes('SELECT Texto,EsCorrecta FROM dbo.Opcion')) return result(opciones);
    if (sql.includes('FROM dbo.OperacionIdempotente WITH')) {
      const stored = operacionesIdempotentes.get(`${p.Actor}|${p.Operacion}|${p.Clave}`);
      return result(stored ? [{ ...stored }] : []);
    }
    if (sql.startsWith('INSERT INTO dbo.OperacionIdempotente')) {
      const stored = { Id: operacionesIdempotentes.size + 900, RequestHash: p.Hash, Estado: 'en_progreso', ResultadoJson: null, StatusHttp: null };
      operacionesIdempotentes.set(`${p.Actor}|${p.Operacion}|${p.Clave}`, stored);
      return result([{ Id: stored.Id }]);
    }
    if (sql.startsWith('UPDATE dbo.OperacionIdempotente')) {
      for (const stored of operacionesIdempotentes.values()) if (stored.Id === p.Id) Object.assign(stored,
        { Estado: 'completada', ResultadoJson: p.Resultado, StatusHttp: p.Status });
      return result();
    }
    if (sql.startsWith('INSERT INTO dbo.Actividad')) return result([{ Id: 5, Revision: 1 }]);
    if (sql.startsWith('INSERT INTO dbo.Publicacion')) return result([{ Id: 2 }]);
    if (sql.startsWith('UPDATE dbo.Actividad SET Revision=Revision+1')) return result([{ Revision: 2 }]);
    if (sql.startsWith('INSERT INTO dbo.BancoPregunta')) {
      pregunta = { Id: 10, IdDocente: p.Docente, Titulo: p.Titulo, Tipo: p.Tipo, Enunciado: p.Enunciado, Estado: p.Estado, Revision: 1 };
      opciones = []; return result([{ Id: 10 }]);
    }
    if (sql.startsWith('UPDATE dbo.BancoPregunta')) {
      pregunta = { ...pregunta, Estado: p.Estado, Revision: pregunta.Revision + 1,
        ...(sql.includes('Titulo=@Titulo') ? { Titulo: p.Titulo, Tipo: p.Tipo, Enunciado: p.Enunciado } : {}) };
      return result();
    }
    if (sql.startsWith('DELETE FROM dbo.BancoOpcion')) { opciones = []; return result(); }
    if (sql.startsWith('INSERT INTO dbo.BancoOpcion')) { opciones.push({ Texto: p.Texto, EsCorrecta: p.Correcta, Posicion: p.Pos }); return result(); }
    if (sql.startsWith('UPDATE g SET Estado=')) { grupo.Estado = 'borrador'; return result([{ Id: 20, Revision: 2 }]); }
    if (sql.startsWith('INSERT INTO dbo.BancoGrupo(')) { grupo = { ...grupo, Estado: p.Estado }; return result([{ Id: 20 }]); }
    if (sql.startsWith('INSERT INTO dbo.GrupoPregunta')) return result([{ Id: 100 }]);
    if (sql.startsWith('INSERT INTO dbo.Pregunta')) return result([{ Id: 200 }]);
    if (sql.startsWith('INSERT INTO dbo.Opcion')) { opcionesCopiadas.push({ Texto: p.Texto, EsCorrecta: p.Correcta }); return result([{ Id: 300+opcionesCopiadas.length }]); }
    return result();
  });
  mock.transactionRequest.execute.mockReset().mockResolvedValue({ recordset: [{ IdActividad: 5 }] });
});
let idempotencySequence = 1;
function auth(req: any, token = docente) {
  const key = `00000000-0000-4000-8000-${String(idempotencySequence++).padStart(12, '0')}`;
  return req.set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key);
}
function ultimaTx() { return mock.pool.Transaction.mock.results.at(-1)!.value; }
function escriturasDominio() { return writes.filter(sql => !sql.includes('dbo.OperacionIdempotente')); }

describe('Privacidad y contratos HTTP del banco', () => {
  it('requiere autenticación', async () => expect((await request(app).get(`${base}/preguntas`)).status).toBe(401));
  it('rechaza alumnos', async () => expect((await auth(request(app).get(`${base}/preguntas`), alumno)).status).toBe(403));
  it('admin consulta con propietario explícito y recibe camelCase', async () => {
    const r = await auth(request(app).get(`${base}/preguntas/10?idDocente=7`), admin);
    expect(r.status).toBe(200); expect(r.body.data.idDocente).toBe(7); expect(r.body.data.opciones[0].esCorrecta).toBe(true);
  });
  it('admin debe elegir el banco', async () => expect((await auth(request(app).get(`${base}/preguntas`), admin)).status).toBe(400));
  it.each(['post','put','patch','delete'] as const)('admin no puede escribir mediante %s', async method => {
    const path = method === 'post' ? '/preguntas' : method === 'put' ? '/preguntas/10' : method === 'patch' ? '/preguntas/10/estado' : '/etiquetas/10';
    expect((await auth(request(app)[method](`${base}${path}`), admin).send(input)).status).toBe(403);
    expect(escriturasDominio()).toHaveLength(0);
  });
  it('no permite seleccionar otro propietario', async () => expect((await auth(request(app).get(`${base}/preguntas?idDocente=8`))).status).toBe(404));
  it('no expone detalle ajeno', async () => {
    pregunta.IdDocente = 8;
    expect((await auth(request(app).get(`${base}/preguntas/10`))).status).toBe(404);
  });
  it('rechaza un docente sin vinculación', async () => {
    const token = jwt.sign({ id: 9, email: 'x@test.com', role: 'docente' }, process.env.JWT_SECRET!);
    expect((await auth(request(app).get(`${base}/preguntas`), token)).status).toBe(403);
  });
  it('rechaza ID inválido y filtros inválidos', async () => {
    expect((await auth(request(app).get(`${base}/preguntas/no`))).status).toBe(400);
    expect((await auth(request(app).get(`${base}/preguntas?tamano=101`))).status).toBe(400);
  });
  it('pagina y parametriza texto sin devolver las opciones', async () => {
    const r = await auth(request(app).get(`${base}/preguntas?texto=TCP&pagina=2&tamano=10&etiqueta=3`));
    expect(r.status).toBe(200); expect(r.body.data).toMatchObject({ total: 1, pagina: 2, tamano: 10 });
    expect(r.body.data.items[0].opciones).toBeUndefined();
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Texto', expect.anything(), 'TCP');
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Offset', expect.anything(), 10);
  });
  it('rechaza propietario enviado en un body', async () => expect((await auth(request(app).post(`${base}/preguntas`)).send({ ...input, IdDocente: 8 })).status).toBe(400));
});

describe('Contenido y revisiones', () => {
  it('requiere Idempotency-Key UUID al crear', async () => {
    const r = await request(app).post(`${base}/preguntas`).set('Authorization', `Bearer ${docente}`).send(input);
    expect(r.status).toBe(400); expect(r.body.code).toBe('REQUEST_INVALID');
  });
  it('reproduce una creación con la misma clave y rechaza otro body', async () => {
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const primera = await auth(request(app).post(`${base}/preguntas`)).set('Idempotency-Key', key).send(input);
    const insertsAntes = escriturasDominio().filter(sql => sql.startsWith('INSERT INTO dbo.BancoPregunta')).length;
    const replay = await auth(request(app).post(`${base}/preguntas`)).set('Idempotency-Key', key).send(input);
    expect(primera.status).toBe(201); expect(replay.status).toBe(201); expect(replay.body.data.id).toBe(primera.body.data.id);
    expect(escriturasDominio().filter(sql => sql.startsWith('INSERT INTO dbo.BancoPregunta'))).toHaveLength(insertsAntes);
    const conflicto = await auth(request(app).post(`${base}/preguntas`)).set('Idempotency-Key', key)
      .send({ ...input, Titulo: 'Otro contenido' });
    expect(conflicto.status).toBe(409); expect(conflicto.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
  it('crea un grupo desde contenido en una sola transacción y devuelve ClaveCliente', async () => {
    const clave = '4e096ceb-51fd-49a1-8f80-c3760edaf021';
    const r = await auth(request(app).post(`${base}/grupos/desde-contenido`)).send({
      TituloReferencia: 'Grupo compuesto', Etiquetas: [], Preguntas: [
        { Origen: 'existente', IdPregunta: 10, RevisionEsperada: 1 },
        { Origen: 'nueva', ClaveCliente: clave, Pregunta: { Titulo: 'Nueva', Tipo: 'mc', Enunciado: '', Opciones: [], Etiquetas: [] } },
      ],
    });
    expect(r.status).toBe(201); expect(r.body.data.grupo).toMatchObject({ revision: 1, estado: 'borrador' });
    expect(r.body.data.preguntas[0]).toMatchObject({ claveCliente: clave, revision: 1 });
    const posiciones = writes.filter(sql => sql.startsWith('INSERT INTO dbo.BancoGrupoPregunta'));
    expect(posiciones).toHaveLength(2); expect(ultimaTx().commit).toHaveBeenCalled();
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Pos', expect.anything(), 1);
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Pos', expect.anything(), 2);
  });
  it('rechaza una revisión obsoleta en grupo desde contenido', async () => {
    pregunta.Revision = 2;
    const r = await auth(request(app).post(`${base}/grupos/desde-contenido`)).send({
      TituloReferencia: 'Grupo', Etiquetas: [],
      Preguntas: [{ Origen: 'existente', IdPregunta: 10, RevisionEsperada: 1 }],
    });
    expect(r.status).toBe(409); expect(r.body.code).toBe('BANK_REVISION_CONFLICT');
    expect(ultimaTx().rollback).toHaveBeenCalled();
  });
  it('revierte las preguntas nuevas si falla la creación del grupo compuesto', async () => {
    fallo = 'INSERT INTO dbo.BancoGrupo(';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await auth(request(app).post(`${base}/grupos/desde-contenido`)).send({
      TituloReferencia: 'Grupo', Etiquetas: [], Preguntas: [{ Origen: 'nueva',
        ClaveCliente: '4e096ceb-51fd-49a1-8f80-c3760edaf021',
        Pregunta: { Titulo: 'Nueva', Enunciado: '', Tipo: 'mc', Opciones: [], Etiquetas: [] } }],
    });
    expect(r.status).toBe(500); expect(ultimaTx().rollback).toHaveBeenCalled();
    expect(ultimaTx().commit).not.toHaveBeenCalled(); log.mockRestore();
  });
  it('guarda un borrador incompleto', async () => {
    const r = await auth(request(app).post(`${base}/preguntas`)).send({ Titulo: 'Por preparar', Tipo: 'mc' });
    expect(r.status).toBe(201); expect(r.body.data.estado).toBe('borrador'); expect(ultimaTx().commit).toHaveBeenCalled();
  });
  it('crea pregunta disponible con opciones', async () => {
    const r = await auth(request(app).post(`${base}/preguntas`)).send(input);
    expect(r.status).toBe(201); expect(r.body.data.opciones).toHaveLength(2);
  });
  it('rechaza claves de corrección ambiguas', async () => {
    const r = await auth(request(app).post(`${base}/preguntas`)).send({ ...input, Opciones: input.Opciones.map(o => ({ ...o, EsCorrecta: true })) });
    expect(r.status).toBe(400); expect(escriturasDominio()).toHaveLength(0); expect(ultimaTx().rollback).toHaveBeenCalled();
  });
  it('code solo se conserva como borrador', async () => {
    expect((await auth(request(app).post(`${base}/preguntas`)).send({ Titulo: 'Código', Tipo: 'code' })).status).toBe(201);
    expect((await auth(request(app).patch(`${base}/preguntas/10/estado`)).send({ Estado: 'disponible', RevisionEsperada: 1 })).status).toBe(400);
  });
  it('un conflicto de revisión no escribe', async () => {
    pregunta.Revision = 2;
    expect((await auth(request(app).put(`${base}/preguntas/10`)).send({ ...input, RevisionEsperada: 1 })).status).toBe(409);
    expect(escriturasDominio()).toHaveLength(0);
  });
  it('edita disponible y conserva su estado', async () => {
    const r = await auth(request(app).put(`${base}/preguntas/10`)).send({ ...input, Enunciado: 'Nuevo', RevisionEsperada: 1 });
    expect(r.status).toBe(200); expect(r.body.data).toMatchObject({ estado: 'disponible', revision: 2, enunciado: 'Nuevo' });
  });
  it('archivar una pregunta devuelve sus grupos a borrador', async () => {
    const r = await auth(request(app).patch(`${base}/preguntas/10/estado`)).send({ Estado: 'archivado', RevisionEsperada: 1 });
    expect(r.status).toBe(200); expect(r.body.data.gruposAfectados).toEqual([{ id: 20, revision: 2 }]);
  });
  it('no habilita grupos vacíos', async () => expect((await auth(request(app).post(`${base}/grupos`)).send({ TituloReferencia: 'Vacío', Estado: 'disponible' })).status).toBe(400));
  it('no acepta preguntas repetidas en grupos', async () => expect((await auth(request(app).post(`${base}/grupos`)).send({ TituloReferencia: 'Repetido', Preguntas: [10,10] })).status).toBe(400));
  it('rechaza una variante ajena', async () => expect((await auth(request(app).post(`${base}/grupos`)).send({ TituloReferencia: 'Ajeno', Preguntas: [99] })).status).toBe(404));
  it('no habilita un grupo con preguntas archivadas', async () => {
    pregunta.Estado = 'archivado';
    expect((await auth(request(app).post(`${base}/grupos`)).send({ TituloReferencia: 'Grupo', Estado: 'disponible', Preguntas: [10] })).status).toBe(400);
  });
  it('una etiqueta ajena cancela la escritura', async () => {
    expect((await auth(request(app).post(`${base}/preguntas`)).send({ ...input, Etiquetas: [90] })).status).toBe(404);
    expect(escriturasDominio()).toHaveLength(0);
  });
  it('permite reutilizar la pregunta en distintos grupos sin copiarla', async () => {
    for (const titulo of ['Grupo A','Grupo B']) {
      expect((await auth(request(app).post(`${base}/grupos`)).send({ TituloReferencia: titulo, Estado: 'disponible', Preguntas: [10] })).status).toBe(201);
    }
    expect(writes.filter(s => s.startsWith('INSERT INTO dbo.BancoGrupoPregunta'))).toHaveLength(2);
    expect(writes.some(s => s.startsWith('INSERT INTO dbo.BancoPregunta('))).toBe(false);
  });
  it('restaura una pregunta archivada a disponible validando contenido', async () => {
    pregunta.Estado = 'archivado';
    const r = await auth(request(app).patch(`${base}/preguntas/10/estado`)).send({ Estado: 'disponible', RevisionEsperada: 1 });
    expect(r.status).toBe(200); expect(r.body.data.estado).toBe('disponible');
  });
  it('no acepta cambios de composición con una revisión de grupo vieja', async () => {
    const r = await auth(request(app).put(`${base}/grupos/20`)).send({ TituloReferencia: 'Cambiar', Preguntas: [10], RevisionEsperada: 2 });
    expect(r.status).toBe(409); expect(escriturasDominio()).toHaveLength(0);
  });
  it('rechaza etiquetas duplicadas normalizadas', async () => {
    const original = mock.transactionRequest.query.getMockImplementation()!;
    mock.transactionRequest.query.mockImplementation(async s => s.includes('AND NombreNormalizado=')
      ? { recordset: [{ Id: 4 }] } : original(s));
    const r = await auth(request(app).post(`${base}/etiquetas`)).send({ Nombre: '  Redes  ' });
    expect(r.status).toBe(409); expect(escriturasDominio()).toHaveLength(0);
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Nombre', expect.anything(), 'Redes');
  });
  it('eliminar una etiqueta quita relaciones e incrementa revisiones sin borrar preguntas', async () => {
    const original = mock.transactionRequest.query.getMockImplementation()!;
    mock.transactionRequest.query.mockImplementation(async s => s.startsWith('SELECT Id FROM dbo.BancoEtiqueta')
      ? { recordset: [{ Id: 4 }] } : original(s));
    expect((await auth(request(app).delete(`${base}/etiquetas/4`))).status).toBe(200);
    expect(writes.some(s => s.includes('DELETE FROM dbo.BancoPreguntaEtiqueta'))).toBe(true);
    expect(writes.some(s => s.includes('DELETE FROM dbo.BancoGrupoEtiqueta'))).toBe(true);
    expect(writes.some(s => /DELETE FROM dbo.BancoPregunta\s/.test(s))).toBe(false);
  });
});

describe('Copias y protección del examen', () => {
  it('copia contenido y devuelve IDs nuevos con procedencia', async () => {
    const r = await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: seleccion });
    expect(r.status).toBe(201);
    expect(r.body.data.importaciones[0]).toMatchObject({ idGrupo: 100, preguntas: [{ idPregunta: 200, idBancoPregunta: 10, revisionBancoOrigen: 1 }] });
    expect(r.body.data.revision).toBe(2);
    expect(opcionesCopiadas).toEqual(input.Opciones);
    expect(pregunta.Revision).toBe(1); expect(ultimaTx().commit).toHaveBeenCalled();
  });
  it('copia un grupo completo', async () => {
    const r = await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: [
      { Tipo: 'grupo', IdGrupo: 20, RevisionEsperada: 1, Preguntas: [{ IdPregunta: 10, RevisionEsperada: 1 }] }] });
    expect(r.status).toBe(201); expect(r.body.data.importaciones[0].idBancoGrupo).toBe(20);
  });
  it('detecta cambio de una variante sin cambio del grupo', async () => {
    pregunta.Revision = 2;
    const r = await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: [
      { Tipo: 'grupo', IdGrupo: 20, RevisionEsperada: 1, Preguntas: [{ IdPregunta: 10, RevisionEsperada: 1 }] }] });
    expect(r.status).toBe(409); expect(escriturasDominio()).toHaveLength(0);
  });
  it('rechaza una selección duplicada antes de copiar', async () => {
    const r = await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: [...seleccion,...seleccion] });
    expect(r.status).toBe(400); expect(escriturasDominio()).toHaveLength(0);
  });
  it.each(['publicada','archivada'])('rechaza importaciones en %s', async estado => {
    estadoActividad = estado;
    expect((await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: seleccion })).status).toBe(400);
  });
  it('rechaza incluso borradores con intentos', async () => {
    intentos = true;
    expect((await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: seleccion })).status).toBe(409);
  });
  it('rechaza evaluación ajena', async () => {
    duenoActividad = 9;
    expect((await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: seleccion })).status).toBe(403);
  });
  it('admin no puede importar', async () => expect((await auth(request(app).post('/api/evaluaciones/5/importar-banco'), admin).send({ ImportacionesBanco: seleccion })).status).toBe(403));
  it('rollback ante error SQL sin exponer detalles', async () => {
    fallo = 'INSERT INTO dbo.Opcion';
    const spy = jest.spyOn(console,'error').mockImplementation(() => {});
    const r = await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: seleccion });
    expect(r.status).toBe(500); expect(JSON.stringify(r.body)).not.toContain('secret');
    expect(ultimaTx().rollback).toHaveBeenCalled(); expect(ultimaTx().commit).not.toHaveBeenCalled(); spy.mockRestore();
  });
  it('no permite volver publicada a borrador', async () => {
    estadoActividad = 'publicada';
    expect((await auth(request(app).put('/api/evaluaciones/5/estado')).send({ estado: 'borrador' })).status).toBe(400);
  });
  it('copiar desde una evaluación genera un borrador', async () => {
    const r = await auth(request(app).post(`${base}/desde-evaluacion`)).send({ IdActividad: 5, Preguntas: [1] });
    expect(r.status).toBe(201); expect(r.body.data.preguntas[0]).toEqual({ idPreguntaOrigen: 1, idBancoPregunta: 10 });
    expect(pregunta.Estado).toBe('borrador');
  });
  it('copiar un grupo desde evaluación conserva sus variantes como borradores', async () => {
    const r = await auth(request(app).post(`${base}/desde-evaluacion`)).send({ IdActividad: 5, Grupos: [1] });
    expect(r.status).toBe(201); expect(r.body.data.grupos[0].preguntas).toHaveLength(1); expect(grupo.Estado).toBe('borrador');
  });
  it('soporta importación durante creación completa', async () => {
    const r = await auth(request(app).post('/api/evaluaciones/guardar-completo')).send({ Titulo: 'Examen', Tipo: 'evaluacion',
      CantidadIntentosMaximos: 1, DuracionMinutos: 60, IdMateriaDivision: 1,
      FechaInicio: '2026-09-10T10:00:00Z', FechaFin: '2026-09-10T11:00:00Z', Estado: 'borrador', GruposPreguntas: [], ImportacionesBanco: seleccion });
    expect(r.status).toBe(201); expect(r.body.data.idActividad).toBe(5); expect(r.body.data.importaciones).toHaveLength(1);
  });
  it('soporta importación durante edición completa de un borrador', async () => {
    const r = await auth(request(app).put('/api/evaluaciones/5/modificar-completo')).send({ Titulo: 'Examen', Tipo: 'evaluacion',
      CantidadIntentosMaximos: 1, DuracionMinutos: 60, IdMateriaDivision: 1, IdPublicacion: 2,
      FechaInicio: '2026-09-10T10:00:00Z', FechaFin: '2026-09-10T11:00:00Z', RevisionEsperada: 1,
      GruposPreguntas: [], ImportacionesBanco: seleccion });
    expect(r.status).toBe(200); expect(r.body.data.importaciones).toHaveLength(1);
  });
  it('una copia ya creada no recibe futuras ediciones del banco', async () => {
    await auth(request(app).post('/api/evaluaciones/5/importar-banco')).send({ ImportacionesBanco: seleccion });
    const copia = opcionesCopiadas.map(o => ({ ...o }));
    writes = [];
    const r = await auth(request(app).put(`${base}/preguntas/10`)).send({ ...input, RevisionEsperada: 1,
      Opciones: [{ Texto: 'Cambiada', EsCorrecta: true }, input.Opciones[1]] });
    expect(r.status).toBe(200); expect(opcionesCopiadas).toEqual(copia);
    expect(writes.every(s => !/dbo\.(Pregunta|GrupoPregunta|Opcion)[ (]/.test(s))).toBe(true);
  });
  it('una publicación ajena cancela la edición completa', async () => {
    const r = await auth(request(app).put('/api/evaluaciones/5/modificar-completo')).send({ Titulo: 'Examen', Tipo: 'evaluacion',
      CantidadIntentosMaximos: 1, DuracionMinutos: 60, IdMateriaDivision: 1, IdPublicacion: 99,
      FechaInicio: '2026-09-10T10:00:00Z', FechaFin: '2026-09-10T11:00:00Z', RevisionEsperada: 1, GruposPreguntas: [] });
    expect(r.status).toBe(400); expect(writes).toHaveLength(0); expect(ultimaTx().rollback).toHaveBeenCalled();
  });
  it('estado inválido no modifica la evaluación', async () => {
    expect((await auth(request(app).put('/api/evaluaciones/5/estado')).send({ estado: 'inventado' })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });
  it('admin no puede copiar desde una evaluación hacia un banco', async () => {
    expect((await auth(request(app).post(`${base}/desde-evaluacion`), admin).send({ IdActividad: 5, Preguntas: [1] })).status).toBe(403);
  });
});

describe('Invariantes puras', () => {
  it.each([
    { Tipo: 'vf', Enunciado: 'x', Opciones: [{ Texto:'Sí',EsCorrecta:true },{ Texto:'No',EsCorrecta:false }] },
    { Tipo: 'abierta', Enunciado: 'x', Opciones: [{Texto:'x',EsCorrecta:true}] },
    { Tipo: 'code', Enunciado: 'x', Opciones: [] },
  ])('rechaza contenido no utilizable %s', p => expect(() => validarDisponible(p as any)).toThrow(BancoError));
  it('acepta verdadero/falso con única clave', () => expect(() => validarDisponible({ Tipo:'vf', Enunciado:'x',
    Opciones:[{Texto:'Verdadero',EsCorrecta:true},{Texto:'Falso',EsCorrecta:false}] })).not.toThrow());
  it('rechaza preguntas de otro grupo', () => expect(() => validarIdsAnidados([{Id:1,Variantes:[{Id:20}]}],[1],{1:[10]},{})).toThrow(BancoError));
  it('rechaza opciones de otra pregunta', () => expect(() => validarIdsAnidados([{Id:1,Variantes:[{Id:10,Opciones:[{Id:99}]}]}],[1],{1:[10]},{10:[30]})).toThrow(BancoError));
  it('rechaza IDs repetidos', () => expect(() => validarIdsAnidados([{Id:1,Variantes:[]},{Id:1,Variantes:[]}],[1],{},{})).toThrow(BancoError));
});
