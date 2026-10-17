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
let alumnoToken: string;

const uuid = '10000000-0000-4000-8000-000000000501';
const sessionId = '20000000-0000-4000-8000-000000000501';
const now = new Date('2026-10-18T12:00:00.000Z');

const scope = (overrides: Record<string, unknown> = {}) => ({
  IdIntento: 7,
  IdAlumno: 2,
  IdPublicacion: 5,
  EstadoIntento: 'entregado',
  CorreccionConfirmada: true,
  IdIntentoValido: 7,
  Modo: 'al_corregir',
  AccesoPolitica: 'libre',
  VentanaDesde: null,
  VentanaHasta: null,
  RevisionPolitica: 1,
  IdPermiso: null,
  EstadoPermiso: null,
  AccesoPermiso: null,
  PermisoDesde: null,
  PermisoHasta: null,
  FechaServidor: now,
  ...overrides,
});

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
  alumnoToken = jwt.sign(
    { id: 20, email: 'alumno@test.com', role: 'alumno', idDocente: null, idAlumno: 2 },
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

describe('Etapa 5 - políticas de revisión', () => {
  it('consulta la política explícita dentro del alcance docente', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordset: [{
        IdPublicacion: 5, Modo: 'ventana', Acceso: 'unico',
        VentanaDesde: new Date('2026-10-18T11:00:00Z'),
        VentanaHasta: new Date('2026-10-18T13:00:00Z'), Revision: 3,
      }] });

    const res = await request(app)
      .get('/api/evaluaciones/publicaciones/5/politica-revision')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ idPublicacion: 5, modo: 'ventana', acceso: 'unico', revision: 3 });
    expect(dbRequest.query.mock.calls[0][0]).toContain('md.IdDocente');
  });

  it('actualiza la política con revisión optimista y auditoría', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordset: [{
        IdPublicacion: 5, Modo: 'al_corregir', Acceso: 'libre',
        VentanaDesde: null, VentanaHasta: null, Revision: 1,
      }] })
      .mockResolvedValueOnce({ recordset: [{
        IdPublicacion: 5, Modo: 'manual', Acceso: 'unico', Revision: 2,
      }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/evaluaciones/publicaciones/5/politica-revision')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ Modo: 'manual', Acceso: 'unico', RevisionEsperada: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ modo: 'manual', acceso: 'unico', revision: 2, replay: false });
    expect(mock.transactionRequest.query.mock.calls[2][0]).toContain('Revision=Revision+1');
    expect(mock.transactionRequest.query.mock.calls[3][0]).toContain('AuditoriaRevisionIntento');
  });

  it.each([
    { Modo: 'ventana', Acceso: 'libre', RevisionEsperada: 1 },
    { Modo: 'manual', Acceso: 'libre', VentanaDesde: '2026-10-18T10:00:00Z', RevisionEsperada: 1 },
    { Modo: 'ventana', Acceso: 'libre', VentanaDesde: '2026-10-19T10:00:00Z', VentanaHasta: '2026-10-18T10:00:00Z', RevisionEsperada: 1 },
  ])('rechaza una configuración de ventana incoherente', async body => {
    const res = await request(app)
      .put('/api/evaluaciones/publicaciones/5/politica-revision')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
    expect(mock.transactionRequest.query).not.toHaveBeenCalled();
  });

  it('impide al alumno configurar políticas', async () => {
    const res = await request(app)
      .put('/api/evaluaciones/publicaciones/5/politica-revision')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ Modo: 'nunca', Acceso: 'libre', RevisionEsperada: 1 });
    expect(res.status).toBe(403);
  });
});

describe('precedencia de disponibilidad', () => {
  const evaluar = (value: Record<string, unknown>) =>
    require('../src/services/revision-examen.service').evaluarScopeRevision(scope(value));

  it('deniega primero corrección pendiente y después revocación individual', () => {
    expect(evaluar({ CorreccionConfirmada: false, EstadoPermiso: 'activo' }).Motivo)
      .toBe('CORRECTION_NOT_CONFIRMED');
    expect(evaluar({ EstadoPermiso: 'revocado' }).Motivo).toBe('INDIVIDUAL_PERMISSION_REVOKED');
  });

  it('un permiso activo habilita un intento aunque ya no sea el válido', () => {
    const result = evaluar({
      IdIntentoValido: 8, IdPermiso: 4, EstadoPermiso: 'activo', AccesoPermiso: 'unico',
    });
    expect(result).toMatchObject({
      RevisionDisponible: true, Origen: 'individual', Acceso: 'unico', EsIntentoValido: false,
    });
  });

  it('un permiso fuera de vigencia vuelve a la política general sin bloquearla', () => {
    const result = evaluar({
      IdPermiso: 4,
      EstadoPermiso: 'activo',
      AccesoPermiso: 'unico',
      PermisoDesde: new Date('2026-10-17T10:00:00Z'),
      PermisoHasta: new Date('2026-10-17T11:00:00Z'),
    });
    expect(result).toMatchObject({
      RevisionDisponible: true, Origen: 'general', Acceso: 'libre', EsIntentoValido: true,
    });
  });

  it('la política general sólo habilita el intento válido y respeta su ventana', () => {
    expect(evaluar({ IdIntentoValido: 8 }).Motivo).toBe('NOT_CURRENT_VALID_ATTEMPT');
    expect(evaluar({ Modo: 'manual' }).Motivo).toBe('POLICY_MANUAL');
    expect(evaluar({ Modo: 'ventana', VentanaDesde: new Date('2026-10-18T13:00:00Z'),
      VentanaHasta: new Date('2026-10-18T14:00:00Z') }).Motivo).toBe('POLICY_WINDOW_NOT_STARTED');
    expect(evaluar({ Modo: 'ventana', VentanaDesde: new Date('2026-10-18T11:00:00Z'),
      VentanaHasta: new Date('2026-10-18T13:00:00Z') })).toMatchObject({
      RevisionDisponible: true, Origen: 'general',
    });
  });

  it('expone la evaluación de disponibilidad al alumno titular', async () => {
    dbRequest.query.mockResolvedValueOnce({ recordset: [scope()] });
    const res = await request(app)
      .get('/api/intentos/7/revision-disponible')
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      revisionDisponible: true, motivo: 'POLICY_ALLOWED', acceso: 'libre', esIntentoValido: true,
    });
  });
});

describe('permisos individuales y auditoría', () => {
  it('otorga un permiso versionado y auditable', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{ IdPublicacion: 5 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{
        Id: 3, IdIntento: 7, Estado: 'activo', Acceso: 'unico', Revision: 1,
      }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/intentos/7/permiso-revision')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ Acceso: 'unico', Motivo: 'Solicitud del alumno', RevisionEsperada: 0 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ idIntento: 7, estado: 'activo', acceso: 'unico', revision: 1 });
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Accion', 'NVARCHAR', 'permiso_otorgado');
  });

  it('revoca incluso sin concesión previa e invalida sesiones activas', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{ IdPublicacion: 5 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ Acceso: 'libre' }] })
      .mockResolvedValueOnce({ recordset: [{
        Id: 3, IdIntento: 7, Estado: 'revocado', Acceso: 'libre', Revision: 1,
      }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .delete('/api/intentos/7/permiso-revision')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ estado: 'revocado', replay: false });
    expect(mock.transactionRequest.query.mock.calls[5][0]).toContain("Estado='revocada'");
  });

  it('lista auditoría filtrada y paginada', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({
        recordsets: [[{
          Id: 9, IdPublicacion: 5, IdIntento: 7, ActorRol: 'docente',
          Accion: 'permiso_otorgado', Detalle: '{"acceso":"unico"}', Fecha: now,
        }], [{ Total: 1 }]],
        recordset: [],
      });

    const res = await request(app)
      .get('/api/evaluaciones/publicaciones/5/auditoria-revision?idIntento=7&accion=permiso_otorgado')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toMatchObject({
      idIntento: 7, accion: 'permiso_otorgado', detalle: { acceso: 'unico' },
    });
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 });
  });
});

describe('sesiones de revisión', () => {
  it('emite una sesión de cinco minutos con Idempotency-Key', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scope({ AccesoPolitica: 'unico' })] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ Id: 40 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{
        IdSesion: sessionId, IdIntento: 7, Acceso: 'unico',
        FechaEmision: now, FechaExpiracion: new Date('2026-10-18T12:05:00Z'),
      }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/revisiones/intentos/7/sesiones')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .set('Idempotency-Key', uuid);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ idIntento: 7, acceso: 'unico', reutilizada: false });
    const insert = mock.transactionRequest.query.mock.calls[4][0];
    expect(insert).toContain('DATEADD(MINUTE,5,SYSUTCDATETIME())');
    expect(insert).toContain('RevisionPoliticaSnapshot');
  });

  it('reutiliza la sesión única activa ante otra emisión concurrente', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scope({ AccesoPolitica: 'unico' })] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ Id: 41 }] })
      .mockResolvedValueOnce({ recordset: [{
        Id: sessionId, IdIntento: 7, AccesoSnapshot: 'unico',
        FechaEmision: now, FechaExpiracion: new Date('2026-10-18T12:05:00Z'),
      }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/revisiones/intentos/7/sesiones')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .set('Idempotency-Key', uuid);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ idSesion: sessionId, reutilizada: true });
    expect(mock.transactionRequest.query.mock.calls.some(call => call[0].includes('INSERT INTO dbo.SesionRevisionIntento\n'))).toBe(false);
  });

  it('consume una sesión única y devuelve contenido construido desde snapshots', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        Id: sessionId, IdIntento: 7, IdUsuario: 20, IdAlumno: 2, IdPublicacion: 5,
        CorreccionConfirmada: true, FechaServidor: now,
        FechaExpiracion: new Date('2026-10-18T12:05:00Z'),
        AccesoSnapshot: 'unico', Estado: 'emitida', EstadoPermisoActual: null, CantidadConsumos: 0,
      }] })
      .mockResolvedValueOnce({ recordset: [{ Id: sessionId }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 7, IdPublicacion: 5, Estado: 'entregado', TituloEvaluacion: 'Parcial',
        NotaFinal: 8, CorreccionConfirmada: true,
      }] })
      .mockResolvedValueOnce({ recordset: [
        { IdIntentoPregunta: 70, IdPregunta: 10, Enunciado: 'Pregunta snapshot', Tipo: 'mc',
          Grupo: 'Grupo 1', PuntajeMaximoSnapshot: 2, PuntajeObtenido: 2,
          IdRespuesta: 4, IdOpcion: 100, OpcionTexto: 'Correcta', EsCorrecta: true,
          FueSeleccionada: true },
        { IdIntentoPregunta: 70, IdPregunta: 10, Enunciado: 'Pregunta snapshot', Tipo: 'mc',
          Grupo: 'Grupo 1', PuntajeMaximoSnapshot: 2, PuntajeObtenido: 2,
          IdRespuesta: 4, IdOpcion: 101, OpcionTexto: 'Distractor', EsCorrecta: false,
          FueSeleccionada: false },
      ] });

    const res = await request(app)
      .get(`/api/revisiones/sesiones/${sessionId}/contenido`)
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.contenido).toMatchObject({ idIntento: 7, tituloEvaluacion: 'Parcial' });
    expect(res.body.data.contenido.preguntas[0].opciones).toEqual([
      { idOpcion: 100, texto: 'Correcta', esCorrecta: true, fueSeleccionada: true },
      { idOpcion: 101, texto: 'Distractor', esCorrecta: false, fueSeleccionada: false },
    ]);
    expect(mock.transactionRequest.query.mock.calls[5][0]).toContain('IntentoPreguntaOpcionSnapshot');
  });

  it('rechaza un segundo consumo de acceso único', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [{
      Id: sessionId, IdIntento: 7, IdUsuario: 20, IdAlumno: 2, IdPublicacion: 5,
      CorreccionConfirmada: true, FechaServidor: now,
      FechaExpiracion: new Date('2026-10-18T12:05:00Z'),
      AccesoSnapshot: 'unico', Estado: 'consumida', EstadoPermisoActual: null, CantidadConsumos: 1,
    }] });

    const res = await request(app)
      .get(`/api/revisiones/sesiones/${sessionId}/contenido`)
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REVIEW_SESSION_CONSUMED');
  });

  it('persiste la expiración antes de devolver el conflicto', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{
        Id: sessionId, IdIntento: 7, IdUsuario: 20, IdAlumno: 2, IdPublicacion: 5,
        CorreccionConfirmada: true, FechaServidor: now,
        FechaExpiracion: new Date('2026-10-18T11:59:00Z'),
        AccesoSnapshot: 'libre', Estado: 'emitida', EstadoPermisoActual: null, CantidadConsumos: 0,
      }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get(`/api/revisiones/sesiones/${sessionId}/contenido`)
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REVIEW_SESSION_EXPIRED');
    expect(mock.transactionRequest.query.mock.calls[1][0]).toContain("Estado='expirada'");
  });

  it('exige Idempotency-Key y limita sesiones a alumnos', async () => {
    const sinClave = await request(app)
      .post('/api/revisiones/intentos/7/sesiones')
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(sinClave.status).toBe(400);

    const docente = await request(app)
      .post('/api/revisiones/intentos/7/sesiones')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', uuid);
    expect(docente.status).toBe(403);
  });
});
