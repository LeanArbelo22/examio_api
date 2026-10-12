import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
const dbRequest = mock.pool.request();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let docenteToken: string;
let alumnoToken: string;
let otroAlumnoToken: string;

const publicacionAutorizada = { Id: 5, IdActividad: 8, IdMateriaDivision: 9, IdDocente: 10, DocenteActivo: true };
const intento = (overrides: Record<string, unknown> = {}) => ({
  IdIntento: 1,
  IdPublicacion: 5,
  IdAlumno: 30500,
  NumeroIntento: 1,
  Estado: 'entregado',
  FechaInicio: new Date('2026-10-01T10:00:00Z'),
  FechaFin: new Date('2026-10-01T11:00:00Z'),
  NotaFinal: 7,
  EscalaCalificacion: 10,
  NotaAprobacion: 4,
  EstadoCorreccion: 'completa',
  PreguntasPendientesCorreccion: 0,
  ...overrides,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  docenteToken = jwt.sign(
    { id: 1, email: 'docente@test.com', role: 'docente', idDocente: 10, idAlumno: null },
    process.env.JWT_SECRET,
  );
  alumnoToken = jwt.sign(
    { id: 2, email: 'alumno@test.com', role: 'alumno', idAlumno: 30500, idDocente: null },
    process.env.JWT_SECRET,
  );
  otroAlumnoToken = jwt.sign(
    { id: 3, email: 'otro@test.com', role: 'alumno', idAlumno: 30501, idDocente: null },
    process.env.JWT_SECRET,
  );
  app = require('../src/app').app;
});

beforeEach(() => {
  dbRequest.query.mockReset().mockResolvedValue({ recordset: [] });
  dbRequest.input.mockReset().mockReturnThis();
  mock.transactionRequest.query.mockReset().mockResolvedValue({ recordset: [] });
  mock.transactionRequest.input.mockReset().mockReturnThis();
});

afterEach(() => jest.clearAllMocks());

describe('GET /api/evaluaciones/publicaciones/:idPublicacion/alumnos/:matricula/intentos', () => {
  it('marca como válido el último intento entregado con orden determinístico', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({
        recordset: [
          intento(),
          intento({ IdIntento: 2, NumeroIntento: 2, FechaFin: new Date('2026-10-02T11:00:00Z') }),
          intento({ IdIntento: 3, NumeroIntento: 3, Estado: 'en_progreso', FechaFin: null, NotaFinal: null }),
          intento({ IdIntento: 4, NumeroIntento: 4, Estado: 'vencido', FechaFin: new Date('2026-10-03T11:00:00Z') }),
          intento({ IdIntento: 5, NumeroIntento: 5, Estado: 'anulado', FechaFin: new Date('2026-10-04T11:00:00Z') }),
        ],
      })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/evaluaciones/publicaciones/5/alumnos/30500/intentos')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.data.find((item: any) => item.idIntento === 2)).toMatchObject({
      esIntentoValido: true,
      seleccionIntentoValido: 'automatica',
    });
    expect(res.body.data.filter((item: any) => item.esIntentoValido)).toHaveLength(1);
  });

  it('desempata por número de intento y luego por ID cuando FechaFin coincide', async () => {
    const mismaFecha = new Date('2026-10-02T11:00:00Z');
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({
        recordset: [
          intento({ IdIntento: 7, NumeroIntento: 2, FechaFin: mismaFecha }),
          intento({ IdIntento: 8, NumeroIntento: 3, FechaFin: mismaFecha }),
          intento({ IdIntento: 9, NumeroIntento: 3, FechaFin: mismaFecha }),
        ],
      })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/evaluaciones/publicaciones/5/alumnos/30500/intentos')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.find((item: any) => item.idIntento === 9)).toMatchObject({
      esIntentoValido: true,
      seleccionIntentoValido: 'automatica',
    });
  });

  it('mantiene el override manual aunque exista un intento entregado posterior', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({
        recordset: [
          intento(),
          intento({ IdIntento: 2, NumeroIntento: 2, FechaFin: new Date('2026-10-02T11:00:00Z') }),
        ],
      })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1 }] });

    const res = await request(app)
      .get('/api/evaluaciones/publicaciones/5/alumnos/30500/intentos')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.find((item: any) => item.idIntento === 1)).toMatchObject({
      esIntentoValido: true,
      seleccionIntentoValido: 'manual',
    });
    expect(res.body.data.find((item: any) => item.idIntento === 2).esIntentoValido).toBe(false);
  });

  it('permite al alumno consultar únicamente sus propios intentos sin exponer respuestas', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 5 }] })
      .mockResolvedValueOnce({ recordset: [intento()] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/evaluaciones/publicaciones/5/alumnos/30500/intentos')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].esIntentoValido).toBe(true);
    expect(res.body.data[0].respuestas).toBeUndefined();
    expect(res.body.data[0].opciones).toBeUndefined();
  });

  it('rechaza que un alumno consulte otra matrícula', async () => {
    const res = await request(app)
      .get('/api/evaluaciones/publicaciones/5/alumnos/30500/intentos')
      .set('Authorization', `Bearer ${otroAlumnoToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_SCOPE_FORBIDDEN');
  });

  it('detecta un override incoherente en lugar de elegir silenciosamente otro intento', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({ recordset: [intento()] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 999 }] });

    const res = await request(app)
      .get('/api/evaluaciones/publicaciones/5/alumnos/30500/intentos')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ATTEMPT_SELECTION_INVALID');
  });
});

describe('PUT /api/evaluaciones/publicaciones/:idPublicacion/alumnos/:matricula/intento-valido', () => {
  it('crea y audita un override manual dentro de una transacción', async () => {
    const fecha = new Date('2026-10-11T15:00:00Z');
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'entregado' }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ recordset: [{ FechaSeleccion: fecha }] });

    const res = await request(app)
      .put('/api/evaluaciones/publicaciones/5/alumnos/30500/intento-valido')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ IdIntento: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      idPublicacion: 5,
      idAlumno: 30500,
      idIntento: 1,
      esIntentoValido: true,
      seleccionIntentoValido: 'manual',
    });
    const sql = mock.transactionRequest.query.mock.calls.map(call => call[0]);
    expect(sql.some(text => text.includes('INSERT INTO dbo.IntentoValidoOverride'))).toBe(true);
    expect(sql.some(text => text.includes('HistorialIntentoValidoOverride'))).toBe(true);
    expect(mock.pool.Transaction.mock.results.at(-1)?.value.commit).toHaveBeenCalled();
  });

  it('es idempotente si el mismo intento ya estaba seleccionado', async () => {
    const fecha = new Date('2026-10-11T15:00:00Z');
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'entregado' }] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1, FechaSeleccion: fecha }] });

    const res = await request(app)
      .put('/api/evaluaciones/publicaciones/5/alumnos/30500/intento-valido')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ IdIntento: 1 });

    expect(res.status).toBe(200);
    expect(mock.transactionRequest.query).toHaveBeenCalledTimes(3);
    expect(mock.transactionRequest.query.mock.calls.some(call => call[0].includes('HistorialIntentoValidoOverride'))).toBe(false);
  });

  it('rechaza un intento no entregado o ajeno a la combinación indicada', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({ recordset: [{ Id: 3, Estado: 'en_progreso' }] });

    const res = await request(app)
      .put('/api/evaluaciones/publicaciones/5/alumnos/30500/intento-valido')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ IdIntento: 3 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ATTEMPT_SELECTION_INVALID');
    expect(mock.pool.Transaction.mock.results.at(-1)?.value.rollback).toHaveBeenCalled();
  });

  it('aísla publicaciones de otros docentes', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({
      recordset: [{ ...publicacionAutorizada, IdDocente: 99 }],
    });

    const res = await request(app)
      .put('/api/evaluaciones/publicaciones/5/alumnos/30500/intento-valido')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ IdIntento: 1 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_SCOPE_FORBIDDEN');
  });
});

describe('DELETE /api/evaluaciones/publicaciones/:idPublicacion/alumnos/:matricula/intento-valido', () => {
  it('elimina y audita el override, restaurando el último entregado', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1 }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ recordset: [{ Id: 2 }] });

    const res = await request(app)
      .delete('/api/evaluaciones/publicaciones/5/alumnos/30500/intento-valido')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      idIntento: 2,
      esIntentoValido: true,
      seleccionIntentoValido: 'automatica',
    });
    const sql = mock.transactionRequest.query.mock.calls.map(call => call[0]);
    expect(sql.some(text => text.includes('DELETE FROM dbo.IntentoValidoOverride'))).toBe(true);
    expect(sql.some(text => text.includes("'eliminado'"))).toBe(true);
  });

  it('es idempotente sin override y devuelve null si no hay entregados', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [publicacionAutorizada] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .delete('/api/evaluaciones/publicaciones/5/alumnos/30500/intento-valido')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      idIntento: null,
      esIntentoValido: false,
      seleccionIntentoValido: null,
    });
    expect(mock.transactionRequest.query.mock.calls.some(call => call[0].includes('HistorialIntentoValidoOverride'))).toBe(false);
  });
});
