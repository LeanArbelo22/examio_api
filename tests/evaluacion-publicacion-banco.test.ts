import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
const guardarActividadCompletaEnBanco = jest.fn();
jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);
jest.mock('../src/services/evaluacion-bank-save.service', () => ({ guardarActividadCompletaEnBanco }));

let app: any;
let token: string;
const payload = {
  Titulo: 'Publicación final', Tipo: 'evaluacion', CantidadIntentosMaximos: 1, DuracionMinutos: 60,
  IdMateriaDivision: 1, FechaInicio: '2030-06-15T10:00:00Z', FechaFin: '2030-06-15T12:00:00Z',
  IdPublicacion: 5, RevisionEsperada: 1, GuardarTodoEnBanco: true,
  GruposPreguntas: [{ TituloReferencia: 'Redes', Variantes: [{ Enunciado: 'TCP', Tipo: 'mc',
    Opciones: [{ Texto: 'Sí', EsCorrecta: true }, { Texto: 'No', EsCorrecta: false }] }] }],
};

beforeAll(() => {
  process.env.JWT_SECRET = 'publicacion-test-secret-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'publicacion-refresh-secret-with-at-least-32-characters';
  process.env.AUTH_ALLOW_LEGACY_ACCESS_TOKENS = 'true';
  token = jwt.sign({ id: 1, email: 'd@test.com', role: 'docente', idDocente: 7 }, process.env.JWT_SECRET);
  app = require('../src/app').app;
});

function preparar() {
  const respuestas: any[] = [
    { recordset: [] }, { recordset: [{ Id: 900 }] },
    { recordset: [{ Id: 5, Estado: 'borrador', Revision: 1 }] },
    { recordset: [{ Id: 5, IdDocente: 7, DocenteActivo: true }] }, { recordset: [] },
    { recordset: [{ Id: 1, IdDocente: 7, DocenteActivo: true }] },
    { recordset: [] }, { recordset: [] }, { recordset: [] },
    { recordset: [{ Id: 10 }] }, { recordset: [{ Id: 20 }] }, { recordset: [] }, { recordset: [] }, { recordset: [] },
    { recordset: [{ Estado: 'borrador', CantidadIntentosMaximos: 1, DuracionMinutos: 60,
      FechaInicio: '2030-06-15T10:00:00Z', FechaFin: '2030-06-15T12:00:00Z' }] },
    { recordset: [{ Id: 10, TituloReferencia: 'Redes' }] },
    { recordset: [{ Id: 20, Enunciado: 'TCP', Tipo: 'mc' }] },
    { recordset: [{ Texto: 'Sí', EsCorrecta: true }, { Texto: 'No', EsCorrecta: false }] },
    { recordset: [{ Revision: 2 }] }, { recordset: [] },
  ];
  mock.transactionRequest.query.mockReset().mockImplementation(() => Promise.resolve(respuestas.shift() ?? { recordset: [] }));
  mock.transactionRequest.input.mockReset().mockReturnThis();
  return new mock.pool.Transaction();
}

beforeEach(() => { jest.clearAllMocks(); });

it('publica y devuelve mappings cuando GuardarTodoEnBanco es true', async () => {
  preparar();
  guardarActividadCompletaEnBanco.mockResolvedValue([{ IdGrupo: 10, IdBancoGrupo: 30, Preguntas: [{ IdPregunta: 20, IdBancoPregunta: 40 }] }]);
  const res = await request(app).post('/api/evaluaciones/5/publicar-completo')
    .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', '10000000-0000-4000-8000-000000000001').send(payload);
  expect(res.status).toBe(200); expect(res.body.data).toMatchObject({ estado: 'publicada', revision: 2,
    banco: [{ idGrupo: 10, idBancoGrupo: 30 }] });
  expect(guardarActividadCompletaEnBanco).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idDocente: 7 }), 5);
});

it('revierte evaluación y banco si falla el guardado en banco', async () => {
  const tx = preparar();
  guardarActividadCompletaEnBanco.mockRejectedValue(new Error('fallo de escritura simulado'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = await request(app).post('/api/evaluaciones/5/publicar-completo')
    .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', '10000000-0000-4000-8000-000000000002').send(payload);
  expect(res.status).toBe(500); expect(res.body).toEqual({ success: false, message: 'No se pudo completar la operación' });
  expect(mock.pool.Transaction.mock.results.at(-1)!.value.rollback).toHaveBeenCalled();
  expect(tx.commit).not.toHaveBeenCalled(); log.mockRestore();
});
