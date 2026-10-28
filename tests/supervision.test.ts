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

const eventoId = '30000000-0000-4000-8000-000000000601';
const sesionId = '30000000-0000-4000-8000-000000000602';
const inicioIntento = new Date(Date.now() - 120_000);
const inicioEvento = new Date(Date.now() - 30_000);
const finEvento = new Date(Date.now() - 10_000);

const alcance = () => ({
  Id: 15, IdAlumno: 30500, FechaInicio: inicioIntento, FechaFin: null,
  IdDocente: 10, DocenteActivo: true,
});

const contexto = (overrides: Record<string, unknown> = {}) => ({
  IdIntento: 15, IdPublicacion: 5, IdAlumno: 30500, EstadoIntento: 'en_progreso',
  IdDocente: 10, DocenteActivo: true, PantallaCompletaObligatoria: true,
  RevisionOrigen: 1, CodigoConfiguracion: 'temporal-v1', EstadoSupervision: 'normal',
  UltimaAccion: 'informar', UltimoEventoId: null, RevisionEstado: 1,
  TipoEvento: 'focus_lost', EstadoEvento: 'iniciado', ...overrides,
});

const evento = (overrides: Record<string, unknown> = {}) => ({
  Id: 50, EventoId: eventoId, IdIntento: 15, Tipo: 'focus_lost',
  IdIntentoPregunta: null, SesionClienteId: sesionId, SecuenciaCliente: 1,
  FechaInicioCliente: inicioEvento, FechaFinCliente: null, DuracionMilisegundos: null,
  Codigo: null, VersionContrato: 1, Estado: 'iniciado', ...overrides,
});

const inputEvento = (overrides: Record<string, unknown> = {}) => ({
  Tipo: 'focus_lost', SesionClienteId: sesionId, SecuenciaCliente: 1,
  FechaInicioCliente: inicioEvento.toISOString(), VersionContrato: 1, ...overrides,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  alumnoToken = jwt.sign(
    { id: 20, email: 'alumno@test.com', role: 'alumno', idAlumno: 30500, idDocente: null },
    process.env.JWT_SECRET,
  );
  otroAlumnoToken = jwt.sign(
    { id: 21, email: 'otro@test.com', role: 'alumno', idAlumno: 30501, idDocente: null },
    process.env.JWT_SECRET,
  );
  docenteToken = jwt.sign(
    { id: 10, email: 'docente@test.com', role: 'docente', idAlumno: null, idDocente: 10 },
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

describe('Etapa 6 - políticas de supervisión', () => {
  it('consulta y actualiza la política sin modificar snapshots existentes', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordsets: [[{
        IdPublicacion: 5, PantallaCompletaObligatoria: true,
        CodigoConfiguracion: 'temporal-v1', Revision: 1,
      }], [{
        Id: 1, Codigo: 'temporal-focus-1', TipoEvento: 'focus_lost',
        Metrica: 'cantidad', Umbral: 1, Prioridad: 100, Accion: 'anular_intento', Activa: true,
      }]] });

    const lectura = await auth(
      request(app).get('/api/evaluaciones/publicaciones/5/politica-supervision'), docenteToken,
    );
    expect(lectura.status).toBe(200);
    expect(lectura.body.data).toMatchObject({
      idPublicacion: 5, pantallaCompletaObligatoria: true, revision: 1,
    });

    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordset: [{ Revision: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ Tipo: 'focus_lost', EsIncidente: true }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordsets: [[{
        IdPublicacion: 5, PantallaCompletaObligatoria: false,
        CodigoConfiguracion: 'personalizada', Revision: 2,
      }], [{
        Id: 2, Codigo: 'aviso-foco', TipoEvento: 'focus_lost', Metrica: 'cantidad',
        Umbral: 2, Prioridad: 10, Accion: 'advertir', Activa: true,
      }]] });

    const escritura = await auth(request(app)
      .put('/api/evaluaciones/publicaciones/5/politica-supervision')
      .send({
        PantallaCompletaObligatoria: false,
        RevisionEsperada: 1,
        Reglas: [{
          Codigo: 'aviso-foco', TipoEvento: 'focus_lost', Metrica: 'cantidad',
          Umbral: 2, VentanaSegundos: null, Prioridad: 10, Accion: 'advertir', Activa: true,
        }],
      }), docenteToken);

    expect(escritura.status).toBe(200);
    expect(escritura.body.data).toMatchObject({ revision: 2, codigoConfiguracion: 'personalizada' });
    const sqlEjecutado = mock.transactionRequest.query.mock.calls.map(call => call[0]).join('\n');
    expect(sqlEjecutado).not.toContain('IntentoPoliticaSupervision SET');
    expect(sqlEjecutado).not.toContain('DELETE FROM dbo.IntentoReglaSupervision');
  });

  it('expone al alumno sólo el estado operativo y aísla intentos ajenos', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{
        Id: 15, IdAlumno: 30500, IdPublicacion: 5, Estado: 'en_progreso',
        IdDocente: 10, DocenteActivo: true,
      }] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 15, EstadoSupervision: 'bloqueado', RevisionEstado: 3,
        FechaActualizacion: new Date(), PantallaCompletaObligatoria: true,
      }] });
    const propio = await auth(request(app).get('/api/intentos/15/supervision'));
    expect(propio.status).toBe(200);
    expect(propio.body.data).toMatchObject({
      accion: 'bloquear_interfaz', interaccionBloqueada: true,
      intentoAnulado: false, pantallaCompletaObligatoria: true,
    });
    expect(propio.body.data).not.toHaveProperty('reglas');
    expect(propio.body.data).not.toHaveProperty('umbral');

    dbRequest.query.mockResolvedValueOnce({ recordset: [{
      Id: 15, IdAlumno: 30500, IdPublicacion: 5, Estado: 'en_progreso',
      IdDocente: 10, DocenteActivo: true,
    }] });
    const ajeno = await auth(request(app).get('/api/intentos/15/supervision'), otroAlumnoToken);
    expect(ajeno.status).toBe(403);
  });

  it('prioriza anular sobre advertir y aplica una única anulación con actor sistema', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [{
        Tipo: 'focus_lost', EsIntervalo: true, EsIncidente: true,
        RequierePregunta: false, AdmiteCierrePosterior: true,
      }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ InicioAnterior: null, InicioSiguiente: null }] })
      .mockResolvedValueOnce({ recordset: [evento()] })
      .mockResolvedValueOnce({ recordset: [contexto()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [
        { Id: 1, Accion: 'advertir', Prioridad: 999, Umbral: 1, ValorMetrica: 1 },
        { Id: 2, Accion: 'anular_intento', Prioridad: 1, Umbral: 1, ValorMetrica: 1 },
      ] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 15, IdAlumno: 30500, Estado: 'en_progreso',
      }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ Tipo: 'focus_lost', EsIncidente: true }] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 15, EventoId: eventoId, Estado: 'anulado', ActorTipo: 'sistema', Replay: false,
      }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 80, Accion: 'anular_intento' }] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 15, Estado: 'anulado', Revision: 2,
      }] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputEvento()));

    expect(res.status).toBe(200);
    expect(res.body.data.supervision).toEqual({
      accion: 'anular_intento', estado: 'anulado', interaccionBloqueada: true,
      intentoAnulado: true, decisionId: 80, replay: false,
    });
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('ActorTipo', expect.anything(), 'sistema');
    const reglasSql = mock.transactionRequest.query.mock.calls[7][0];
    expect(reglasSql).toContain('DATEDIFF_BIG(MILLISECOND,Inicio,Fin)');
    const anulacionSql = mock.transactionRequest.query.mock.calls[11][0];
    expect(anulacionSql).not.toMatch(/DELETE\s+FROM\s+dbo\.(Respuesta|RespuestaOpcion)/i);
  });

  it('un replay devuelve la decisión existente sin duplicar consecuencia', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [{
        Tipo: 'focus_lost', EsIntervalo: true, EsIncidente: true,
        RequierePregunta: false, AdmiteCierrePosterior: true,
      }] })
      .mockResolvedValueOnce({ recordset: [evento({
        Estado: 'completado', FechaFinCliente: finEvento, DuracionMilisegundos: 20_000,
      })] })
      .mockResolvedValueOnce({ recordset: [contexto({
        EstadoIntento: 'anulado', EstadoSupervision: 'anulado', UltimaAccion: 'anular_intento',
        UltimoEventoId: eventoId, EstadoEvento: 'completado',
      })] })
      .mockResolvedValueOnce({ recordset: [{ Id: 80, Accion: 'anular_intento' }] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputEvento({
        FechaFinCliente: finEvento.toISOString(), DuracionMilisegundos: 20_000,
      })));

    expect(res.status).toBe(200);
    expect(res.body.data.resultado).toBe('replay');
    expect(res.body.data.supervision).toMatchObject({ accion: 'anular_intento', replay: true });
    expect(mock.transactionRequest.query).toHaveBeenCalledTimes(5);
  });

  it('recuperarse del intervalo libera un bloqueo visual sin tocar respuestas', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [alcance()] })
      .mockResolvedValueOnce({ recordset: [{
        Tipo: 'fullscreen_exit', EsIntervalo: true, EsIncidente: true,
        RequierePregunta: false, AdmiteCierrePosterior: true,
      }] })
      .mockResolvedValueOnce({ recordset: [evento({ Tipo: 'fullscreen_exit' })] })
      .mockResolvedValueOnce({ recordset: [evento({
        Tipo: 'fullscreen_exit', Estado: 'completado', FechaFinCliente: finEvento,
        DuracionMilisegundos: 20_000,
      })] })
      .mockResolvedValueOnce({ recordset: [contexto({
        TipoEvento: 'fullscreen_exit', EstadoEvento: 'completado',
        EstadoSupervision: 'bloqueado', UltimaAccion: 'bloquear_interfaz', UltimoEventoId: eventoId,
      })] })
      .mockResolvedValueOnce({ recordset: [{ Id: 81, Accion: 'bloquear_interfaz' }] })
      .mockResolvedValueOnce({ recordset: [{
        Id: 3, Accion: 'bloquear_interfaz', Prioridad: 20, Umbral: 1, ValorMetrica: 1,
      }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 81, Accion: 'bloquear_interfaz' }] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 15, Estado: 'normal', Revision: 3 }] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/eventos/${eventoId}`)
      .send(inputEvento({
        Tipo: 'fullscreen_exit', FechaInicioCliente: undefined,
        FechaFinCliente: finEvento.toISOString(), DuracionMilisegundos: 20_000,
      })));

    expect(res.status).toBe(200);
    expect(res.body.data.supervision).toMatchObject({
      accion: 'informar', estado: 'normal', interaccionBloqueada: false,
    });
    const sql = mock.transactionRequest.query.mock.calls.map(call => call[0]).join('\n');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+dbo\.(Respuesta|RespuestaOpcion)/i);
  });

  it('permite desbloquear mediante override, pero nunca reabre un intento anulado', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        Id: 15, IdAlumno: 30500, IdPublicacion: 5, Estado: 'en_progreso',
        IdDocente: 10, DocenteActivo: true,
      }] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 15, Estado: 'bloqueado', UltimoEventoId: eventoId, Revision: 2,
      }] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 15, Estado: 'normal', UltimaAccion: 'informar', Revision: 3,
      }] })
      .mockResolvedValueOnce({ recordset: [] });

    const desbloqueo = await auth(request(app)
      .put('/api/intentos/15/supervision/override')
      .send({ Accion: 'desbloquear', Motivo: 'Falso positivo verificado', RevisionEsperada: 2 }),
    docenteToken);
    expect(desbloqueo.status).toBe(200);
    expect(desbloqueo.body.data).toMatchObject({ estado: 'normal', accionOverride: 'desbloquear' });

    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        Id: 15, IdAlumno: 30500, IdPublicacion: 5, Estado: 'en_progreso',
        IdDocente: 10, DocenteActivo: true,
      }] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 15, Estado: 'normal', UltimaAccion: 'informar', Revision: 3,
      }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 100 }] });
    const replay = await auth(request(app)
      .put('/api/intentos/15/supervision/override')
      .send({ Accion: 'desbloquear', Motivo: 'Falso positivo verificado', RevisionEsperada: 2 }),
    docenteToken);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ replay: true, revision: 3 });

    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        Id: 15, IdAlumno: 30500, IdPublicacion: 5, Estado: 'anulado',
        IdDocente: 10, DocenteActivo: true,
      }] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 15, Estado: 'anulado', Revision: 3 }] });
    const reapertura = await auth(request(app)
      .put('/api/intentos/15/supervision/override')
      .send({ Accion: 'desbloquear', Motivo: 'No corresponde', RevisionEsperada: 3 }),
    docenteToken);
    expect(reapertura.status).toBe(409);
    expect(reapertura.body.code).toBe('SUPERVISION_CANCELLED_IMMUTABLE');
  });

  it('un bloqueo visual no impide sincronizar respuestas pendientes', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        IdIntentoPregunta: 83, IdAlumno: 30500, Estado: 'en_progreso', Tipo: 'mc',
        ModoJustificacion: 'sin_justificacion', IdRespuesta: null,
        RtaTexto: null, Justificacion: null, Revision: 0,
      }] })
      .mockResolvedValueOnce({ recordset: [{ IdOpcion: 3 }] })
      .mockResolvedValueOnce({ recordset: [{ IdRespuesta: 90 }] });

    const res = await auth(request(app)
      .post('/api/intentos/guardar-respuesta')
      .send({ IdIntento: 15, IdPregunta: 10, IdOpcionNueva: 3 }));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ idRespuesta: 90, idsOpcionesSeleccionadas: [3] });
    const sql = mock.transactionRequest.query.mock.calls.map(call => call[0]).join('\n');
    expect(sql).not.toContain('EstadoSupervisionIntento');
  });
});
