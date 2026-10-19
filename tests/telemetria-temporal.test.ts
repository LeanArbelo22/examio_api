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

const eventoId = '00000000-0000-4000-8000-000000000501';
const sesionId = '00000000-0000-4000-8000-000000000601';
const ahora = Date.now();
const inicioIntento = new Date(ahora - 10 * 60_000);
const inicioEvento = new Date(ahora - 60_000);
const finEvento = new Date(ahora - 30_000);

const alcance = (overrides: Record<string, unknown> = {}) => ({
  Id: 15, IdAlumno: 30500, FechaInicio: inicioIntento, FechaFin: null,
  IdDocente: 10, DocenteActivo: true, ...overrides,
});

const tipoIntervalo = (overrides: Record<string, unknown> = {}) => ({
  Tipo: 'focus_lost', EsIntervalo: true, EsIncidente: true,
  RequierePregunta: false, AdmiteCierrePosterior: true, ...overrides,
});

const inputIntervalo = (overrides: Record<string, unknown> = {}) => ({
  Tipo: 'focus_lost', SesionClienteId: sesionId, SecuenciaCliente: 1,
  FechaInicioCliente: inicioEvento.toISOString(), VersionContrato: 1, ...overrides,
});

const persistido = (overrides: Record<string, unknown> = {}) => ({
  Id: 50, EventoId: eventoId, IdIntento: 15, Tipo: 'focus_lost',
  IdIntentoPregunta: null, SesionClienteId: sesionId, SecuenciaCliente: 1,
  FechaInicioCliente: inicioEvento, FechaFinCliente: null, DuracionMilisegundos: null,
  Codigo: null, VersionContrato: 1, Estado: 'iniciado', FechaRecepcionInicio: new Date(),
  FechaRecepcionFin: null, ...overrides,
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

describe('Etapa 3 - telemetría temporal confiable', () => {
  it('abre un intervalo con identidad de sesión y secuencia', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ InicioAnterior: null, InicioSiguiente: null }] })
      .mockResolvedValueOnce({ recordset: [persistido()] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputIntervalo()));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      eventoId, sesionClienteId: sesionId, secuenciaCliente: 1,
      estado: 'iniciado', resultado: 'creado',
    });
    const insert = mock.transactionRequest.query.mock.calls[4][0];
    expect(insert).toContain('INSERT INTO dbo.IncidenteIntento');
    expect(insert).toContain('FechaRecepcionFin');
    expect(insert).not.toMatch(/UPDATE\s+dbo\.Intento\b/);
  });

  it('cierra el intervalo posteriormente y tolera hasta dos segundos de diferencia', async () => {
    const duracion = finEvento.getTime() - inicioEvento.getTime() + 1500;
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo()] })
      .mockResolvedValueOnce({ recordset: [persistido({ Codigo: 'offline' })] })
      .mockResolvedValueOnce({ recordset: [persistido({
        FechaFinCliente: finEvento, DuracionMilisegundos: duracion,
        Codigo: 'offline', Estado: 'completado', FechaRecepcionFin: new Date(),
      })] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputIntervalo({
        FechaInicioCliente: undefined,
        FechaFinCliente: finEvento.toISOString(),
        DuracionMilisegundos: duracion,
      })));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ estado: 'completado', resultado: 'actualizado' });
    expect(mock.transactionRequest.query.mock.calls[3][0]).toContain("Estado='completado'");
  });

  it('normaliza los eventos puntuales con duración cero', async () => {
    const punto = inputIntervalo({ Tipo: 'page_reload' });
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo({
        Tipo: 'page_reload', EsIntervalo: false, EsIncidente: false, AdmiteCierrePosterior: false,
      })] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ InicioAnterior: null, InicioSiguiente: null }] })
      .mockResolvedValueOnce({ recordset: [persistido({
        Tipo: 'page_reload', FechaFinCliente: inicioEvento,
        DuracionMilisegundos: 0, Estado: 'completado',
      })] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(punto));

    expect(res.status).toBe(200);
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('DuracionMilisegundos', expect.anything(), 0);
    expect(res.body.data.estado).toBe('completado');
  });

  it('registra question_active sólo para una pregunta perteneciente al intento', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo({
        Tipo: 'question_active', EsIncidente: false, RequierePregunta: true,
      })] })
      .mockResolvedValueOnce({ recordset: [{ Id: 83 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ InicioAnterior: null, InicioSiguiente: null }] })
      .mockResolvedValueOnce({ recordset: [persistido({ Tipo: 'question_active', IdIntentoPregunta: 83 })] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputIntervalo({ Tipo: 'question_active', IdIntentoPregunta: 83 })));

    expect(res.status).toBe(200);
    expect(mock.transactionRequest.query.mock.calls[2][0]).toContain('dbo.IntentoPregunta');
  });

  it('devuelve replay para el mismo UUID y conflicto para contenido incompatible', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo()] })
      .mockResolvedValueOnce({ recordset: [persistido()] });

    const replay = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputIntervalo()));
    expect(replay.status).toBe(200);
    expect(replay.body.data.resultado).toBe('replay');

    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo()] })
      .mockResolvedValueOnce({ recordset: [persistido()] });
    const conflicto = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputIntervalo({ Codigo: 'OTRO' })));
    expect(conflicto.status).toBe(409);
    expect(conflicto.body.code).toBe('TELEMETRY_EVENT_CONFLICT');
  });

  it('rechaza reutilizar una secuencia para otro EventoId y valida el orden temporal', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo()] })
      .mockResolvedValueOnce({ recordset: [persistido()] });
    const secuencia = await auth(request(app)
      .put('/api/telemetria/intentos/15/eventos/00000000-0000-4000-8000-000000000502')
      .send(inputIntervalo()));
    expect(secuencia.status).toBe(409);
    expect(secuencia.body.code).toBe('TELEMETRY_SEQUENCE_CONFLICT');

    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{
        InicioAnterior: new Date(inicioEvento.getTime() + 5_000), InicioSiguiente: null,
      }] });
    const orden = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputIntervalo()));
    expect(orden.status).toBe(409);
    expect(orden.body.code).toBe('TELEMETRY_ORDER_CONFLICT');
  });

  it('sincroniza dentro de los siete días posteriores al cierre', async () => {
    const fechaFinIntento = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const fechaEventoCerrado = new Date(fechaFinIntento.getTime() - 5_000);
    const fechaInicioIntento = new Date(fechaFinIntento.getTime() - 10 * 60_000);
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance({
        FechaInicio: fechaInicioIntento,
        FechaFin: fechaFinIntento,
      })] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo({
        Tipo: 'attempt_finished', EsIntervalo: false, EsIncidente: false, AdmiteCierrePosterior: false,
      })] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ InicioAnterior: null, InicioSiguiente: null }] })
      .mockResolvedValueOnce({ recordset: [persistido({
        Tipo: 'attempt_finished', FechaInicioCliente: fechaEventoCerrado,
        FechaFinCliente: fechaEventoCerrado, DuracionMilisegundos: 0, Estado: 'completado',
      })] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputIntervalo({ Tipo: 'attempt_finished', FechaInicioCliente: fechaEventoCerrado.toISOString() })));
    expect(res.status).toBe(200);
    expect(res.body.data.ventanaSincronizacionHasta).toBeDefined();
  });

  it('procesa el lote por elemento sin revertir los válidos', async () => {
    const segundoEvento = '00000000-0000-4000-8000-000000000503';
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ InicioAnterior: null, InicioSiguiente: null }] })
      .mockResolvedValueOnce({ recordset: [persistido()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [tipoIntervalo()] })
      .mockResolvedValueOnce({ recordset: [persistido({ EventoId: eventoId, SecuenciaCliente: 2 })] });

    const res = await auth(request(app)
      .post('/api/telemetria/intentos/15/eventos/lote')
      .send({ Eventos: [
        { EventoId: eventoId, ...inputIntervalo() },
        { EventoId: segundoEvento, ...inputIntervalo({ SecuenciaCliente: 2 }) },
        { EventoId: 'no-es-uuid', Token: 'no-debe-aceptarse' },
      ] }));

    expect(res.status).toBe(200);
    expect(res.body.data.resultados.map((item: any) => item.resultado)).toEqual([
      'creado', 'conflicto', 'rechazado',
    ]);
    expect(mock.pool.Transaction.mock.results[0]?.value.commit).toHaveBeenCalled();
  });

  it('limita cada lote a 500 eventos', async () => {
    const res = await auth(request(app)
      .post('/api/telemetria/intentos/15/eventos/lote')
      .send({ Eventos: Array.from({ length: 501 }, () => ({})) }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
    expect(mock.pool.Transaction).not.toHaveBeenCalled();
  });

  it('lista con paginación y une intervalos antes de sumar, con fallback legacy por pregunta', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordsets: [
        [[persistido({ Estado: 'completado', FechaFinCliente: finEvento, DuracionMilisegundos: 30_000 })][0]],
        [{ Total: 3, IntervalosAbiertos: 1 }],
        [{ Tipo: 'question_active', DuracionMilisegundos: 45_000 }],
        [
          { IdIntentoPregunta: 83, IdPregunta: 10, DuracionMilisegundos: 45_000, Fuente: 'nueva' },
          { IdIntentoPregunta: 84, IdPregunta: 11, DuracionMilisegundos: 12_000, Fuente: 'legacy' },
        ],
      ] });

    const res = await auth(
      request(app).get('/api/telemetria/intentos/15/eventos?pagina=1&limite=20'),
      docenteToken,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.paginacion).toEqual({ pagina: 1, limite: 20, total: 3, totalPaginas: 1 });
    expect(res.body.data.resumen.tiemposPorPregunta).toEqual([
      { idIntentoPregunta: 83, idPregunta: 10, duracionMilisegundos: 45000, fuente: 'nueva' },
      { idIntentoPregunta: 84, idPregunta: 11, duracionMilisegundos: 12000, fuente: 'legacy' },
    ]);
    const sqlText = dbRequest.query.mock.calls[1][0];
    expect(sqlText).toContain('MAX(E.FechaFinCliente) OVER');
    expect(sqlText).toContain('DATEDIFF_BIG(MILLISECOND,Inicio,Fin)');
    expect(sqlText).toContain('dbo.MetricasNavegacion');
  });

  it('aplica RBAC y no acepta campos sensibles ni límites mayores a 100', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [alcance()] });
    const ajeno = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputIntervalo()), otroAlumnoToken);
    expect(ajeno.status).toBe(403);

    const sensible = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send({ ...inputIntervalo(), Token: 'secreto', Respuesta: 'A' }));
    expect(sensible.status).toBe(400);
    expect(sensible.body.code).toBe('REQUEST_INVALID');

    dbRequest.query.mockResolvedValueOnce({ recordset: [alcance()] });
    const docenteAjeno = await auth(
      request(app).get('/api/telemetria/intentos/15/eventos'), otroDocenteToken,
    );
    expect(docenteAjeno.status).toBe(403);

    const limite = await auth(
      request(app).get('/api/telemetria/intentos/15/eventos?limite=101'), docenteToken,
    );
    expect(limite.status).toBe(400);
  });
});
