import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
const dbRequest = mock.pool.request();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let alumnoToken: string;
let docenteToken: string;
let alumnoSinAsociacionToken: string;

const item = (overrides: Record<string, unknown> = {}) => ({
  IdIntento: 15,
  IdActividad: 8,
  IdPublicacion: 12,
  Titulo: 'Parcial SQL',
  Tipo: 'evaluacion',
  IdMateria: 4,
  Materia: 'Bases de Datos',
  IdMateriaDivision: 9,
  Division: '2A',
  NumeroIntento: 2,
  CantidadIntentosMaximos: 3,
  Estado: 'entregado',
  FechaInicio: new Date('2026-10-01T10:00:00.000Z'),
  FechaFin: new Date('2026-10-01T11:00:00.000Z'),
  NotaAutomatica: 65,
  NotaFinal: 72,
  EscalaCalificacion: 100,
  NotaAprobacion: 40,
  Resultado: 'aprobado',
  EstadoCorreccion: 'completa',
  CorreccionConfirmada: true,
  CorreccionPendiente: false,
  RevisionDisponible: true,
  EsIntentoValido: true,
  SeleccionIntentoValido: 'automatica',
  ...overrides,
});

const summary = (overrides: Record<string, unknown> = {}) => ({
  TotalIntentos: 12,
  TotalEvaluaciones: 7,
  EvaluacionesAprobadas: 4,
  EvaluacionesDesaprobadas: 2,
  EvaluacionesPendientes: 1,
  ...overrides,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  alumnoToken = jwt.sign(
    { id: 2, email: 'alumno@test.com', role: 'alumno', idAlumno: 30500, idDocente: null },
    process.env.JWT_SECRET,
  );
  docenteToken = jwt.sign(
    { id: 1, email: 'docente@test.com', role: 'docente', idAlumno: null, idDocente: 10 },
    process.env.JWT_SECRET,
  );
  alumnoSinAsociacionToken = jwt.sign(
    { id: 3, email: 'sin-alumno@test.com', role: 'alumno', idAlumno: null, idDocente: null },
    process.env.JWT_SECRET,
  );
  app = require('../src/app').app;
});

beforeEach(() => {
  dbRequest.query.mockReset().mockResolvedValue({ recordsets: [[], [summary({ TotalIntentos: 0, TotalEvaluaciones: 0 })]] });
  dbRequest.input.mockReset().mockReturnThis();
});

afterEach(() => jest.clearAllMocks());

describe('GET /api/intentos/mios', () => {
  it('usa la identidad del JWT y devuelve items, resumen global y paginación', async () => {
    dbRequest.query.mockResolvedValueOnce({ recordsets: [[item()], [summary()]] });

    const res = await request(app)
      .get('/api/intentos/mios?pagina=2&limite=5')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(dbRequest.input).toHaveBeenCalledWith('IdAlumno', expect.anything(), 30500);
    expect(res.body.data.items[0]).toMatchObject({
      idIntento: 15,
      escalaCalificacion: 100,
      notaAprobacion: 40,
      resultado: 'aprobado',
      esIntentoValido: true,
      seleccionIntentoValido: 'automatica',
      correccionConfirmada: true,
      correccionPendiente: false,
      revisionDisponible: true,
    });
    expect(res.body.data.resumen).toEqual({
      totalIntentos: 12,
      totalEvaluaciones: 7,
      evaluacionesAprobadas: 4,
      evaluacionesDesaprobadas: 2,
      evaluacionesPendientes: 1,
    });
    expect(res.body.data.paginacion).toEqual({ pagina: 2, limite: 5, total: 12, totalPaginas: 3 });
  });

  it('combina todos los filtros con AND y usa el umbral de cada actividad', async () => {
    dbRequest.query.mockResolvedValueOnce({ recordsets: [[item()], [summary()]] });
    const res = await request(app)
      .get('/api/intentos/mios?idMateria=4&idMateriaDivision=9&fechaDesde=2026-10-01&fechaHasta=2026-10-31&estado=entregado&resultado=aprobado')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('B.IdMateria=@IdMateria AND B.IdMateriaDivision=@IdMateriaDivision');
    expect(sqlText).toContain('B.FechaInicio>=@FechaDesde AND B.FechaInicio<@FechaHasta');
    expect(sqlText).toContain('B.Estado=@Estado AND (B.NotaFinal IS NOT NULL AND B.NotaFinal>=B.NotaAprobacion)');
    expect(sqlText).not.toMatch(/NotaFinal\s*>=\s*[46](?:\.0+)?\b/);
  });

  it('mantiene fechaHasta timestamp inclusiva y acepta fecha simple como día completo', async () => {
    await request(app)
      .get('/api/intentos/mios?fechaHasta=2026-10-31T18:30:00Z')
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(dbRequest.query.mock.calls[0][0]).toContain('B.FechaInicio<=@FechaHasta');

    dbRequest.query.mockClear();
    await request(app)
      .get('/api/intentos/mios?fechaHasta=2026-10-31')
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(dbRequest.query.mock.calls[0][0]).toContain('B.FechaInicio<@FechaHasta');
    expect(dbRequest.input).toHaveBeenCalledWith(
      'FechaHasta',
      expect.anything(),
      new Date('2026-11-01T00:00:00.000Z'),
    );
  });

  it('ordena de forma segura y agrega desempate estable por ID', async () => {
    const res = await request(app)
      .get('/api/intentos/mios?ordenarPor=nota&ordenDireccion=asc')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(dbRequest.query.mock.calls[0][0]).toContain('ORDER BY NotaFinal ASC,IdIntento DESC');
  });

  it('calcula la selección válida antes de aplicar filtros y respeta override manual', async () => {
    const res = await request(app)
      .get('/api/intentos/mios?estado=entregado')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('LEFT JOIN dbo.IntentoValidoOverride');
    expect(sqlText).toContain('LEFT JOIN dbo.PoliticaRevisionPublicacion');
    expect(sqlText).toContain('LEFT JOIN dbo.PermisoRevisionIntento');
    expect(sqlText).toContain("ISNULL(B.EstadoPermisoRevision,'')<>'revocado'");
    expect(sqlText).toContain("CASE WHEN I.Estado='entregado' THEN I.FechaFin END DESC");
    expect(sqlText).toContain("WHEN B.IdIntentoOverride=B.IdIntento THEN 'manual'");
    expect(sqlText.indexOf('INTO #IntentosBase')).toBeLessThan(sqlText.indexOf('B.Estado=@Estado'));
  });

  it('no expone respuestas, opciones ni contenido completo', async () => {
    dbRequest.query.mockResolvedValueOnce({ recordsets: [[item()], [summary()]] });
    const res = await request(app)
      .get('/api/intentos/mios')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0].respuestas).toBeUndefined();
    expect(res.body.data.items[0].opciones).toBeUndefined();
    expect(res.body.data.items[0].preguntas).toBeUndefined();
    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).not.toContain('dbo.Respuesta ');
    expect(sqlText).not.toContain('dbo.Opcion ');
  });

  it.each([
    'fechaDesde=2026-02-31',
    'fechaDesde=2026-11-01&fechaHasta=2026-10-01',
    'estado=publicada',
    'resultado=promocionado',
    'pagina=0',
    'limite=101',
    'ordenarPor=alumno',
    'ordenDireccion=lateral',
    'matricula=30501',
  ])('rechaza filtros inválidos: %s', async query => {
    const res = await request(app)
      .get(`/api/intentos/mios?${query}`)
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
    expect(dbRequest.query).not.toHaveBeenCalled();
  });

  it('devuelve una página vacía con totales en cero', async () => {
    dbRequest.query.mockResolvedValueOnce({
      recordsets: [[], [summary({
        TotalIntentos: 0,
        TotalEvaluaciones: 0,
        EvaluacionesAprobadas: 0,
        EvaluacionesDesaprobadas: 0,
        EvaluacionesPendientes: 0,
      })]],
    });
    const res = await request(app)
      .get('/api/intentos/mios')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.paginacion).toEqual({ pagina: 1, limite: 20, total: 0, totalPaginas: 0 });
  });

  it('rechaza otros roles y alumnos sin asociación institucional', async () => {
    const docente = await request(app)
      .get('/api/intentos/mios')
      .set('Authorization', `Bearer ${docenteToken}`);
    expect(docente.status).toBe(403);

    const sinAsociacion = await request(app)
      .get('/api/intentos/mios')
      .set('Authorization', `Bearer ${alumnoSinAsociacionToken}`);
    expect(sinAsociacion.status).toBe(403);
    expect(sinAsociacion.body.code).toBe('ATTEMPT_SCOPE_FORBIDDEN');
  });

  it('requiere JWT', async () => {
    const res = await request(app).get('/api/intentos/mios');
    expect(res.status).toBe(401);
  });
});
