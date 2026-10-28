import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
const dbRequest = mock.pool.request();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let adminToken: string;
let docenteToken: string;
let otroDocenteToken: string;
let alumnoToken: string;

const eventoId = '40000000-0000-4000-8000-000000000701';
const idempotencyKey = '40000000-0000-4000-8000-000000000702';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  adminToken = jwt.sign(
    { id: 1, email: 'admin@test.com', role: 'admin', idDocente: null, idAlumno: null },
    process.env.JWT_SECRET,
  );
  docenteToken = jwt.sign(
    { id: 10, email: 'docente@test.com', role: 'docente', idDocente: 10, idAlumno: null },
    process.env.JWT_SECRET,
  );
  otroDocenteToken = jwt.sign(
    { id: 11, email: 'otro@test.com', role: 'docente', idDocente: 11, idAlumno: null },
    process.env.JWT_SECRET,
  );
  alumnoToken = jwt.sign(
    { id: 20, email: 'alumno@test.com', role: 'alumno', idAlumno: 30500, idDocente: null },
    process.env.JWT_SECRET,
  );
  app = require('../src/app').app;
});

beforeEach(() => {
  dbRequest.input.mockReset().mockReturnThis();
  dbRequest.query.mockReset().mockResolvedValue({ recordset: [] });
  mock.transactionRequest.input.mockReset().mockReturnThis();
  mock.transactionRequest.query.mockReset().mockResolvedValue({ recordset: [] });
});

afterEach(() => jest.clearAllMocks());

const auth = (builder: any, token = docenteToken) =>
  builder.set('Authorization', `Bearer ${token}`);

describe('Etapa 7 - visibilidad operativa de incidentes', () => {
  it('lista incidentes de la publicación con KPIs globales y navegación al intento', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({
        recordsets: [
          [{ TotalIncidentes: 21, AlumnosConIncidentes: 8, IntentosAnulados: 2, IncidentesSinRevisar: 5 }],
          [{
            IdIncidente: 70, EventoId: eventoId, IdIntento: 15, Tipo: 'focus_lost',
            IdAlumno: 30500, NumeroIntento: 2, EstadoIntento: 'anulado',
            Severidad: 'anular_intento', EstadoRevision: 'pendiente', Revision: 0,
          }],
          [{ Total: 21 }],
        ],
      });

    const res = await auth(request(app)
      .get('/api/evaluaciones/publicaciones/5/incidentes?pagina=2&limite=10'));

    expect(res.status).toBe(200);
    expect(res.body.data.resumen).toEqual({
      totalIncidentes: 21,
      alumnosConIncidentes: 8,
      intentosAnulados: 2,
      incidentesSinRevisar: 5,
    });
    expect(res.body.data.incidentes[0]).toMatchObject({
      idIntento: 15, eventoId, severidad: 'anular_intento', estadoRevision: 'pendiente', revision: 0,
    });
    expect(res.body.data.paginacion).toEqual({ pagina: 2, limite: 10, total: 21, totalPaginas: 3 });
    const sqlText = dbRequest.query.mock.calls[1][0];
    expect(sqlText).toContain('T.EsIncidente=1');
    expect(sqlText.indexOf('COUNT_BIG(*) AS TotalIncidentes')).toBeLessThan(sqlText.indexOf('OFFSET @Offset'));
  });

  it('aplica filtros de tipo, severidad y pendientes sin tratar eventos normales como incidentes', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordsets: [[{}], [], [{ Total: 0 }]] });

    const res = await auth(request(app).get(
      '/api/evaluaciones/publicaciones/5/incidentes?tipoIncidente=focus_lost&severidad=advertir&soloIncidentesSinRevisar=true',
    ));

    expect(res.status).toBe(200);
    expect(dbRequest.input).toHaveBeenCalledWith('TipoIncidente', expect.anything(), 'focus_lost');
    expect(dbRequest.input).toHaveBeenCalledWith('Severidad', expect.anything(), 'advertir');
    const sqlText = dbRequest.query.mock.calls[1][0];
    expect(sqlText).toContain("COALESCE(DS.Accion,'sin_clasificar')=@Severidad");
    expect(sqlText).toContain("COALESCE(R.Estado,'pendiente')='pendiente'");
  });

  it('aísla publicaciones entre docentes y rechaza alumnos', async () => {
    dbRequest.query.mockResolvedValueOnce({
      recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }],
    });
    const fuera = await auth(
      request(app).get('/api/evaluaciones/publicaciones/5/incidentes'), otroDocenteToken,
    );
    expect(fuera.status).toBe(403);

    const alumno = await auth(
      request(app).get('/api/evaluaciones/publicaciones/5/incidentes'), alumnoToken,
    );
    expect(alumno.status).toBe(403);
  });

  it('registra una revisión con revisión optimista e idempotencia persistente', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        IdIncidente: 70, IdIntento: 15, EventoId: eventoId, Tipo: 'focus_lost',
        EsIncidente: true, IdPublicacion: 5, IdDocente: 10, DocenteActivo: true,
      }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ Id: 900 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{
        Id: 80, IdIncidente: 70, Revision: 1, Estado: 'revisado', ActorId: 10,
        ActorRol: 'docente', Comentario: 'Verificado', FechaRevision: new Date(),
      }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}/revision`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ Estado: 'revisado', RevisionEsperada: 0, Comentario: 'Verificado' }));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      idIntento: 15, eventoId, estado: 'revisado', revision: 1, replay: false,
    });
    const sqlText = mock.transactionRequest.query.mock.calls.map(call => call[0]).join('\n');
    expect(sqlText).toContain('INSERT INTO dbo.RevisionIncidenteIntento');
    expect(sqlText).toContain('FROM dbo.OperacionIdempotente WITH (UPDLOCK,HOLDLOCK)');
  });

  it('impide que otro docente revise un incidente fuera de su comisión', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [{
      IdIncidente: 70, IdIntento: 15, EventoId: eventoId, Tipo: 'focus_lost',
      EsIncidente: true, IdPublicacion: 5, IdDocente: 10, DocenteActivo: true,
    }] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}/revision`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ Estado: 'revisado', RevisionEsperada: 0 }), otroDocenteToken);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INCIDENT_SCOPE_FORBIDDEN');
    expect(mock.transactionRequest.query).toHaveBeenCalledTimes(1);
  });

  it('reproduce una revisión sin insertar otra fila', async () => {
    const stored = {
      Id: 80, IdIncidente: 70, IdIntento: 15, EventoId: eventoId,
      Revision: 1, Estado: 'revisado', Replay: false,
    };
    // El hash debe coincidir con el payload canónico; se obtiene de la utilidad real.
    const { requestHash } = require('../src/services/idempotency.service');
    const payload = {
      IdIntento: 15, EventoId: eventoId, Estado: 'revisado',
      RevisionEsperada: 0, Comentario: 'Verificado',
    };
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        IdIncidente: 70, IdIntento: 15, EventoId: eventoId, Tipo: 'focus_lost',
        EsIncidente: true, IdPublicacion: 5, IdDocente: 10, DocenteActivo: true,
      }] })
      .mockResolvedValueOnce({ recordset: [{
        Id: 900, RequestHash: requestHash(payload), Estado: 'completada',
        ResultadoJson: JSON.stringify(stored), StatusHttp: 200,
      }] });

    const res = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}/revision`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ Estado: 'revisado', RevisionEsperada: 0, Comentario: 'Verificado' }));

    expect(res.status).toBe(200);
    expect(res.body.data.replay).toBe(true);
    expect(mock.transactionRequest.query).toHaveBeenCalledTimes(2);
  });

  it('rechaza conflictos de revisión, eventos operativos y claves inválidas', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        IdIncidente: 70, IdIntento: 15, EventoId: eventoId, Tipo: 'focus_lost',
        EsIncidente: true, IdPublicacion: 5, IdDocente: 10, DocenteActivo: true,
      }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ Id: 900 }] })
      .mockResolvedValueOnce({ recordset: [{ Revision: 2, Estado: 'revisado' }] });

    const conflict = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}/revision`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ Estado: 'descartado', RevisionEsperada: 1, Comentario: 'Falso positivo' }));
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('INCIDENT_REVISION_CONFLICT');

    mock.transactionRequest.query.mockReset().mockResolvedValueOnce({ recordset: [{
      IdIncidente: 71, IdIntento: 15, EventoId: eventoId, Tipo: 'page_reload',
      EsIncidente: false, IdPublicacion: 5, IdDocente: 10, DocenteActivo: true,
    }] });
    const normal = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}/revision`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ Estado: 'revisado', RevisionEsperada: 0 }));
    expect(normal.status).toBe(409);
    expect(normal.body.code).toBe('EVENT_NOT_INCIDENT');

    const invalidKey = await auth(request(app)
      .put(`/api/telemetria/intentos/15/incidentes/${eventoId}/revision`)
      .set('Idempotency-Key', 'invalida')
      .send({ Estado: 'revisado', RevisionEsperada: 0 }));
    expect(invalidKey.status).toBe(400);
    expect(invalidKey.body.code).toBe('REQUEST_INVALID');
  });
});
