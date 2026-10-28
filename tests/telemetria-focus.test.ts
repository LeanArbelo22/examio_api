import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
const dbRequest = mock.pool.request();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let alumnoToken: string;
let otroAlumnoToken: string;
let docenteToken: string;
let otroDocenteToken: string;
let adminToken: string;

const eventoId = '550e8400-e29b-41d4-a716-446655440000';
const ahora = Date.now();
const fechaInicioIntento = new Date(ahora - 60_000);
const fechaInicioEvento = new Date(ahora - 30_000);
const fechaFinEvento = new Date(ahora - 6_500);

const alcance = (overrides: Record<string, unknown> = {}) => ({
  Id: 15,
  IdAlumno: 30500,
  FechaInicio: fechaInicioIntento,
  FechaFin: null,
  IdDocente: 10,
  DocenteActivo: true,
  ...overrides,
});

const incidente = (overrides: Record<string, unknown> = {}) => ({
  Id: 1,
  EventoId: eventoId,
  IdIntento: 15,
  Tipo: 'focus_lost',
  FechaInicioCliente: fechaInicioEvento,
  FechaFinCliente: null,
  DuracionMilisegundos: null,
  FechaRecepcionInicio: new Date(),
  FechaRecepcionFin: null,
  Estado: 'iniciado',
  ...overrides,
});

const inicioBody = () => ({
  Tipo: 'focus_lost',
  FechaInicioCliente: fechaInicioEvento.toISOString(),
});

const completoBody = () => ({
  ...inicioBody(),
  FechaFinCliente: fechaFinEvento.toISOString(),
  DuracionMilisegundos: fechaFinEvento.getTime() - fechaInicioEvento.getTime(),
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  alumnoToken = jwt.sign(
    { id: 1, email: 'alumno@test.com', role: 'alumno', idAlumno: 30500, idDocente: null },
    process.env.JWT_SECRET,
  );
  otroAlumnoToken = jwt.sign(
    { id: 2, email: 'otro@test.com', role: 'alumno', idAlumno: 30501, idDocente: null },
    process.env.JWT_SECRET,
  );
  docenteToken = jwt.sign(
    { id: 3, email: 'docente@test.com', role: 'docente', idAlumno: null, idDocente: 10 },
    process.env.JWT_SECRET,
  );
  otroDocenteToken = jwt.sign(
    { id: 4, email: 'otro-docente@test.com', role: 'docente', idAlumno: null, idDocente: 11 },
    process.env.JWT_SECRET,
  );
  adminToken = jwt.sign(
    { id: 5, email: 'admin@test.com', role: 'admin', idAlumno: null, idDocente: null },
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

const auth = (builder: any, token = alumnoToken) =>
  builder.set('Authorization', `Bearer ${token}`);

describe('Etapa 6 - incidentes de pérdida de foco', () => {
  it('registra el inicio sin anular ni finalizar el intento', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [incidente()] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send(inicioBody()));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      eventoId,
      idIntento: 15,
      tipo: 'focus_lost',
      estado: 'iniciado',
    });
    const sqlText = mock.transactionRequest.query.mock.calls.map(call => call[0]).join('\n');
    expect(sqlText).toContain('INSERT INTO dbo.IncidenteIntento');
    expect(sqlText).not.toMatch(/UPDATE\s+dbo\.Intento\b/);
    expect(sqlText).not.toContain('AlertaFraude');
    expect(mock.pool.Transaction.mock.results.at(-1)?.value.commit).toHaveBeenCalled();
  });

  it('acepta salida de pantalla completa en el contrato previo a telemetría general', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [incidente({ Tipo: 'fullscreen_exit' })] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send({ ...inicioBody(), Tipo: 'fullscreen_exit' }));

    expect(res.status).toBe(200);
    expect(res.body.data.tipo).toBe('fullscreen_exit');
    expect(mock.transactionRequest.input).toHaveBeenCalledWith(
      'Tipo', expect.anything(), 'fullscreen_exit',
    );
  });

  it('permite completar el evento en una llamada posterior', async () => {
    const terminado = incidente({
      FechaFinCliente: fechaFinEvento,
      DuracionMilisegundos: completoBody().DuracionMilisegundos,
      FechaRecepcionFin: new Date(),
      Estado: 'completado',
    });
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [incidente()] })
      .mockResolvedValueOnce({ recordset: [terminado] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send({
        Tipo: 'focus_lost',
        FechaFinCliente: fechaFinEvento.toISOString(),
        DuracionMilisegundos: completoBody().DuracionMilisegundos,
      }));

    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('completado');
    expect(mock.transactionRequest.query.mock.calls[2][0]).toContain("Estado='completado'");
  });

  it('acepta inicio y finalización juntos', async () => {
    const terminado = incidente({
      FechaFinCliente: fechaFinEvento,
      DuracionMilisegundos: completoBody().DuracionMilisegundos,
      FechaRecepcionFin: new Date(),
      Estado: 'completado',
    });
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [terminado] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send(completoBody()));

    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('completado');
    expect(mock.transactionRequest.input).toHaveBeenCalledWith(
      'DuracionMilisegundos',
      expect.anything(),
      completoBody().DuracionMilisegundos,
    );
  });

  it('es idempotente al repetir un evento ya completado', async () => {
    const terminado = incidente({
      FechaFinCliente: fechaFinEvento,
      DuracionMilisegundos: completoBody().DuracionMilisegundos,
      FechaRecepcionFin: new Date(),
      Estado: 'completado',
    });
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [terminado] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send(completoBody()));

    expect(res.status).toBe(200);
    expect(mock.transactionRequest.query).toHaveBeenCalledTimes(3);
  });

  it('rechaza reutilizar EventoId con datos incompatibles y revierte', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [incidente({
        FechaFinCliente: fechaFinEvento,
        DuracionMilisegundos: 23_500,
        Estado: 'completado',
      })] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send({ ...completoBody(), DuracionMilisegundos: 24_000 }));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FOCUS_EVENT_CONFLICT');
    expect(mock.pool.Transaction.mock.results.at(-1)?.value.rollback).toHaveBeenCalled();
  });

  it('valida titularidad del alumno sin aceptar identidad desde el body', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [alcance()] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send({ ...inicioBody(), IdAlumno: 30500 }), otroAlumnoToken);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
    expect(mock.transactionRequest.query).not.toHaveBeenCalled();

    const sinIdentidadExtra = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send(inicioBody()), otroAlumnoToken);
    expect(sinIdentidadExtra.status).toBe(403);
    expect(sinIdentidadExtra.body.code).toBe('FOCUS_EVENT_SCOPE_FORBIDDEN');
  });

  it('rechaza duraciones inconsistentes y sincronización fuera de siete días', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [] });
    const duracionInvalida = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send({ ...completoBody(), DuracionMilisegundos: 1 }));
    expect(duracionInvalida.status).toBe(400);
    expect(duracionInvalida.body.code).toBe('FOCUS_EVENT_INVALID');

    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance({ FechaFin: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })] })
      .mockResolvedValueOnce({ recordset: [] });
    const vencida = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send(inicioBody()));
    expect(vencida.status).toBe(409);
    expect(vencida.body.code).toBe('FOCUS_EVENT_SYNC_WINDOW_EXPIRED');
  });

  it('devuelve resumen agregado en segundos para docente propietario', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [{
        CantidadPerdidasFoco: 4,
        SegundosTotalesFuera: 95,
        PromedioSegundosFuera: 23.75,
        MaximoSegundosFuera: 41,
      }] });

    const res = await auth(request(app).get('/api/telemetria/intentos/15/resumen'), docenteToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      cantidadPerdidasFoco: 4,
      segundosTotalesFuera: 95,
      promedioSegundosFuera: 23.75,
      maximoSegundosFuera: 41,
    });
    expect(dbRequest.query.mock.calls[1][0]).toContain("Tipo='focus_lost'");
  });

  it('lista incidentes ordenados y sin respuestas ni contenido sensible', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [incidente()] });

    const res = await auth(request(app).get('/api/telemetria/intentos/15/incidentes'), adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ eventoId, idIntento: 15, tipo: 'focus_lost' });
    expect(res.body.data[0]).not.toHaveProperty('respuesta');
    expect(res.body.data[0]).not.toHaveProperty('token');
    expect(dbRequest.query.mock.calls[1][0]).toContain('ORDER BY FechaInicioCliente ASC,Id ASC');
  });

  it('impide lectura a docente ajeno y escritura a docente por RBAC', async () => {
    dbRequest.query.mockResolvedValueOnce({ recordset: [alcance()] });
    const lectura = await auth(request(app).get('/api/telemetria/intentos/15/resumen'), otroDocenteToken);
    expect(lectura.status).toBe(403);
    expect(lectura.body.code).toBe('FOCUS_EVENT_SCOPE_FORBIDDEN');

    const escritura = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send(inicioBody()), docenteToken);
    expect(escritura.status).toBe(403);
    expect(escritura.body.code).toBe('FORBIDDEN');
  });

  it('rechaza UUID, intento y payload inválidos antes de consultar SQL', async () => {
    const badUuid = await auth(request(app)
      .put('/api/telemetria/intentos/15/incidentes/no-es-uuid')
      .send(inicioBody()));
    expect(badUuid.status).toBe(400);

    const badIntento = await auth(request(app)
      .put(`/api/telemetria/intentos/0/incidentes/${eventoId}`)
      .send(inicioBody()));
    expect(badIntento.status).toBe(400);

    const badBody = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}`)
      .send({ Tipo: 'focus_lost', DuracionMilisegundos: 1000 }));
    expect(badBody.status).toBe(400);
    expect(dbRequest.query).not.toHaveBeenCalled();
    expect(mock.transactionRequest.query).not.toHaveBeenCalled();
  });
});
