import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let adminToken: string;
let docenteToken: string;
let alumnoToken: string;
let invalidToken: string;

const matriculaValida = 30500;
const matriculaFueraDeAlcance = 99999;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  adminToken = jwt.sign(
    { id: 1, email: 'admin@test.com', role: 'admin', idDocente: null },
    process.env.JWT_SECRET,
  );
  docenteToken = jwt.sign(
    { id: 2, email: 'docente@test.com', role: 'docente', idDocente: 100542 },
    process.env.JWT_SECRET,
  );
  alumnoToken = jwt.sign(
    { id: 3, email: 'alumno@test.com', role: 'alumno' },
    process.env.JWT_SECRET,
  );
  invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.malformed';
  app = require('../src/app').app;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/reportes/rendimiento - Auth / RBAC', () => {
  it('retorna 401 sin token de autenticacion', async () => {
    const res = await request(app).get('/api/reportes/rendimiento');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('retorna 401 con token invalido', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento')
      .set('Authorization', `Bearer ${invalidToken}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('retorna 403 con rol alumno', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento')
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/reportes/rendimiento - Mode 1: con matricula (admin)', () => {
  it('retorna 200 con kpis, alumno y actividades', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({
        recordset: [{ Matricula: matriculaValida, Nombre: 'Julieta', Apellido: 'Acosta' }],
      })
      .mockResolvedValueOnce({
        recordset: [{
          TotalIntentos: 5, TotalCorregidos: 4,
          PromedioGeneral: 7.25, Aprobados: 3, Desaprobados: 1,
        }],
      })
      .mockResolvedValueOnce({
        recordset: [
          {
            IdActividad: 1, Titulo: 'Parcial I', Tipo: 'evaluacion',
            Materia: 'Matematica', Division: 'A',
            IdIntento: 1, NumeroIntento: 1, NotaFinal: 7.5, NotaAutomatica: null,
            EstadoIntento: 'entregado',
            FechaInicio: new Date('2026-06-15T10:00:00Z'),
            FechaFin: new Date('2026-06-15T11:30:00Z'),
          },
          {
            IdActividad: 1, Titulo: 'Parcial I', Tipo: 'evaluacion',
            Materia: 'Matematica', Division: 'A',
            IdIntento: 2, NumeroIntento: 2, NotaFinal: 8.5, NotaAutomatica: null,
            EstadoIntento: 'entregado',
            FechaInicio: new Date('2026-06-20T10:00:00Z'),
            FechaFin: new Date('2026-06-20T11:00:00Z'),
          },
        ],
      });

    const res = await request(app)
      .get(`/api/reportes/rendimiento?matricula=${matriculaValida}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.alumno.matricula).toBe(matriculaValida);
    expect(res.body.data.alumno.nombre).toBe('Julieta');
    expect(res.body.data.kpis.totalIntentos).toBe(5);
    expect(res.body.data.kpis.totalCorregidos).toBe(4);
    expect(res.body.data.kpis.promedioGeneral).toBe(7.25);
    expect(res.body.data.kpis.aprobados).toBe(3);
    expect(res.body.data.kpis.desaprobados).toBe(1);
    expect(res.body.data.kpis.porcentajeAprobacion).toBe(75.0);
    expect(res.body.data.actividades).toHaveLength(1);
    expect(res.body.data.actividades[0].intentos).toBe(2);
    expect(res.body.data.actividades[0].notaMaxima).toBe(8.5);
    expect(res.body.data.actividades[0].notaPromedio).toBe(8.0);
    expect(res.body.data.actividades[0].mejorIntento.numeroIntento).toBe(2);
    expect(res.body.data.actividades[0].mejorIntento.notaFinal).toBe(8.5);
    expect(res.body.data.actividades[0].detalleIntentos).toBeUndefined();
  });

  it('retorna 404 si alumno no existe', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get(`/api/reportes/rendimiento?matricula=99999`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('no encontrado');
  });
});

describe('GET /api/reportes/rendimiento - Mode 1: con matricula (docente)', () => {
  it('retorna 200 cuando el alumno pertenece al alcance del docente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Matricula: matriculaValida, Nombre: 'Juan', Apellido: 'Perez' }] })
      .mockResolvedValueOnce({ recordset: [{ '': '' }] })
      .mockResolvedValueOnce({
        recordset: [{ TotalIntentos: 2, TotalCorregidos: 2, PromedioGeneral: 7.0, Aprobados: 1, Desaprobados: 1 }],
      })
      .mockResolvedValueOnce({
        recordset: [{
          IdActividad: 2, Titulo: 'TP 1', Tipo: 'tp',
          Materia: 'Lengua', Division: 'B',
          IdIntento: 3, NumeroIntento: 1, NotaFinal: 7.0, NotaAutomatica: null,
          EstadoIntento: 'entregado',
          FechaInicio: new Date('2026-05-01T08:00:00Z'),
          FechaFin: new Date('2026-05-01T09:00:00Z'),
        }],
      });

    const res = await request(app)
      .get(`/api/reportes/rendimiento?matricula=${matriculaValida}`)
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.actividades).toHaveLength(1);
  });

  it('retorna 404 si el alumno no esta en el alcance del docente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Matricula: matriculaFueraDeAlcance, Nombre: 'Otro', Apellido: 'Alumno' }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get(`/api/reportes/rendimiento?matricula=${matriculaFueraDeAlcance}`)
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('alcance');
  });
});

describe('GET /api/reportes/rendimiento - Mode 2: listado paginado', () => {
  it('retorna 200 con paginacion y kpis globales (docente)', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Total: 10 }] })
      .mockResolvedValueOnce({
        recordset: [{ TotalAlumnos: 10, ConIntentos: 7, TotalIntentos: 25, PromedioGeneral: 6.5, TasaAprobacion: 70.0 }],
      })
      .mockResolvedValueOnce({
        recordset: [
          { Matricula: 30500, Nombre: 'Julieta', Apellido: 'Acosta', TotalIntentos: 5, TotalCorregidos: 4, Promedio: 7.25, Aprobados: 3, Desaprobados: 1 },
          { Matricula: 30501, Nombre: 'Juan', Apellido: 'Perez', TotalIntentos: 3, TotalCorregidos: 2, Promedio: 5.5, Aprobados: 1, Desaprobados: 1 },
        ],
      });

    const res = await request(app)
      .get('/api/reportes/rendimiento')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.paginacion).toBeDefined();
    expect(res.body.data.paginacion.total).toBe(10);
    expect(res.body.data.paginacion.pagina).toBe(1);
    expect(res.body.data.kpis.totalAlumnos).toBe(10);
    expect(res.body.data.alumnos).toHaveLength(2);
    expect(res.body.data.alumnos[0].matricula).toBe(30500);
    expect(res.body.data.alumnos[0].porcentajeAprobacion).toBe(75.0);
  });

  it('retorna 200 con paginacion explicita', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Total: 25 }] })
      .mockResolvedValueOnce({
        recordset: [{ TotalAlumnos: 25, ConIntentos: 20, TotalIntentos: 60, PromedioGeneral: 6.8, TasaAprobacion: 65.0 }],
      })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/reportes/rendimiento?pagina=2&limite=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.paginacion.pagina).toBe(2);
    expect(res.body.data.paginacion.limite).toBe(10);
    expect(res.body.data.paginacion.total).toBe(25);
    expect(res.body.data.paginacion.totalPaginas).toBe(3);
  });

  it('retorna 200 con filtro por materia', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Total: 3 }] })
      .mockResolvedValueOnce({
        recordset: [{ TotalAlumnos: 3, ConIntentos: 3, TotalIntentos: 8, PromedioGeneral: 7.0, TasaAprobacion: 66.7 }],
      })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/reportes/rendimiento?idMateria=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mock.pool.request().input).toHaveBeenCalledWith('IdMateria', 'INT', 1);
  });

  it('retorna 200 con ordenamiento por promedio descendente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Total: 5 }] })
      .mockResolvedValueOnce({
        recordset: [{ TotalAlumnos: 5, ConIntentos: 4, TotalIntentos: 12, PromedioGeneral: 6.0, TasaAprobacion: 50.0 }],
      })
      .mockResolvedValueOnce({
        recordset: [
          { Matricula: 30500, Nombre: 'Ana', Apellido: 'Lopez', TotalIntentos: 4, TotalCorregidos: 3, Promedio: 8.5, Aprobados: 3, Desaprobados: 0 },
          { Matricula: 30501, Nombre: 'Luis', Apellido: 'Molina', TotalIntentos: 2, TotalCorregidos: 2, Promedio: 4.0, Aprobados: 0, Desaprobados: 2 },
        ],
      });

    const res = await request(app)
      .get('/api/reportes/rendimiento?ordenarPor=promedio&ordenDireccion=desc')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.alumnos[0].promedio).toBe(8.5);
    expect(res.body.data.alumnos[1].promedio).toBe(4.0);
  });
});

describe('GET /api/reportes/rendimiento - validacion de parametros', () => {
  it('retorna 400 si fechaDesde > fechaHasta', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento?fechaDesde=2026-07-01&fechaHasta=2026-06-01')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('fechaDesde');
  });

  it('retorna 400 si promedioMin > promedioMax', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento?promedioMin=8&promedioMax=4')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('promedioMin');
  });

  it('retorna 400 si ordenarPor es invalido', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento?ordenarPor=nota')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ordenarPor');
  });

  it('retorna 400 si limite > 100', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento?limite=200')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('limite');
  });

  it('retorna 400 si limite < 1', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento?limite=0')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('limite');
  });

  it('retorna 400 si pagina es invalida', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento?pagina=0')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('pagina');
  });

  it('retorna 400 si matricula no es numerica', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento?matricula=abc')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('matricula');
  });

  it('retorna 400 si estado es invalido', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento?estado=inexistente')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('estado');
  });
});

describe('GET /api/reportes/rendimiento-evaluaciones', () => {
  const reportRecordsets = (overrides?: {
    kpis?: Record<string, unknown>;
    chart?: Record<string, unknown>[];
    rows?: Record<string, unknown>[];
    total?: number;
  }) => ({
    recordsets: [
      [overrides?.kpis || {
        TotalEvaluaciones: 12,
        TotalAlumnosAlcanzados: 280,
        TotalAlumnosUnicos: 145,
        TotalIntentos: 260,
        TotalEntregados: 230,
        TotalEnProgreso: 15,
        TotalVencidos: 5,
        TotalAnulados: 10,
        IntentosAnulados: 10,
        AlumnosConIncidentes: 8,
        TotalIncidentes: 21,
        IncidentesSinRevisar: 5,
        TotalIntentosCalificados: 210,
        IntentosPendientesCorreccion: 20,
        PromedioIntentosCalificados: 7.15,
        TasaAprobacionIntentos: 74.3,
      }],
      overrides?.chart || [
        { Categoria: 'Aprobados', Cantidad: 156 },
        { Categoria: 'Desaprobados', Cantidad: 54 },
        { Categoria: 'Pendientes de corrección', Cantidad: 20 },
        { Categoria: 'En progreso', Cantidad: 15 },
        { Categoria: 'Vencidos', Cantidad: 5 },
        { Categoria: 'Anulados', Cantidad: 10 },
      ],
      overrides?.rows || [{
        IdPublicacion: 47,
        IdActividad: 18,
        Titulo: 'Parcial SQL',
        IdMateria: 5,
        Materia: 'Bases de Datos',
        IdMateriaDivision: 12,
        Division: '2A',
        FechaInicio: new Date('2026-08-01T12:00:00Z'),
        FechaFin: new Date('2026-08-01T14:00:00Z'),
        Estado: 'publicada',
        AlumnosAlcanzados: 30,
        AlumnosQueIniciaron: 28,
        SinIniciar: 2,
        IntentosTotales: 30,
        Entregados: 27,
        EnProgreso: 1,
        Vencidos: 1,
        Anulados: 1,
        IntentosAnulados: 1,
        AlumnosConIncidentes: 4,
        TotalIncidentes: 7,
        IncidentesSinRevisar: 2,
        IntentosCalificados: 24,
        IntentosPendientesCorreccion: 3,
        PromedioIntentosCalificados: 7.15,
        IntentosAprobados: 18,
        IntentosDesaprobados: 6,
        PorcentajeAprobacionIntentos: 75,
      }],
      [{ Total: overrides?.total ?? 12 }],
    ],
    recordset: [],
  });

  beforeEach(() => {
    (mock.pool.request().query as jest.Mock).mockReset();
  });

  it('limita al docente por el idDocente autenticado y devuelve el contrato completo', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets());

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpis.totalEvaluaciones).toBe(12);
    expect(res.body.data.graficos.distribucionResultados).toHaveLength(6);
    expect(res.body.data.evaluaciones[0]).toMatchObject({
      idPublicacion: 47,
      idActividad: 18,
      intentosCalificados: 24,
      intentosPendientesCorreccion: 3,
      porcentajeAprobacionIntentos: 75,
      intentosAnulados: 1,
      alumnosConIncidentes: 4,
      totalIncidentes: 7,
      incidentesSinRevisar: 2,
    });
    expect(res.body.data.paginacion).toEqual({ pagina: 1, limite: 20, total: 12, totalPaginas: 1 });
    expect(reqBuilder.input).toHaveBeenCalledWith('IdDocente', 'INT', 100542);
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText).toContain('MD.IdDocente = @IdDocente');
  });

  it('permite al administrador consultar el alcance institucional sin filtro docente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets());

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(reqBuilder.input).not.toHaveBeenCalledWith('IdDocente', expect.anything(), expect.anything());
  });

  it('rechaza al rol alumno y conserva los códigos RBAC vigentes', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('rechaza una solicitud sin autenticación', async () => {
    const res = await request(app).get('/api/reportes/rendimiento-evaluaciones');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCESS_TOKEN_MISSING');
  });

  it.each([
    'idMateria=5',
    'idMateriaDivision=12',
    'idActividad=18',
    'idPublicacion=47',
  ])('rechaza para docente un filtro explícito fuera de alcance: %s', async (query) => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get(`/api/reportes/rendimiento-evaluaciones?${query}`)
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(reqBuilder.query).toHaveBeenCalledTimes(1);
  });

  it('aplica filtros combinados con semántica AND y parámetros SQL', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Permitido: 1 }] })
      .mockResolvedValueOnce(reportRecordsets());

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?idMateria=5&idMateriaDivision=12&idActividad=18&idPublicacion=47&estado=publicada&fechaDesde=2026-08-01&fechaHasta=2026-08-31&pagina=2&limite=5')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(reqBuilder.input).toHaveBeenCalledWith('IdMateria', 'INT', 5);
    expect(reqBuilder.input).toHaveBeenCalledWith('IdMateriaDivision', 'INT', 12);
    expect(reqBuilder.input).toHaveBeenCalledWith('IdActividad', 'INT', 18);
    expect(reqBuilder.input).toHaveBeenCalledWith('IdPublicacion', 'INT', 47);
    expect(reqBuilder.input).toHaveBeenCalledWith('Estado', 'NVARCHAR', 'publicada');
    expect(res.body.data.paginacion.pagina).toBe(2);
  });

  it('agrega filtros operativos y excluye eventos que no son incidentes', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets());

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?conIncidentes=true&tipoIncidente=focus_lost&severidad=anular_intento&soloIncidentesSinRevisar=true')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios).toMatchObject({
      conIncidentes: true,
      tipoIncidente: 'focus_lost',
      severidad: 'anular_intento',
      soloIncidentesSinRevisar: true,
    });
    expect(reqBuilder.input).toHaveBeenCalledWith('TipoIncidente', expect.anything(), 'focus_lost');
    expect(reqBuilder.input).toHaveBeenCalledWith('Severidad', expect.anything(), 'anular_intento');
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText).toContain('TE.EsIncidente=1');
    expect(sqlText).toContain('DELETE FROM #ReporteEvaluaciones WHERE TotalIncidentes=0');
    expect(sqlText.indexOf('AS TotalIncidentes')).toBeLessThan(sqlText.indexOf('OFFSET @Offset'));
  });

  it.each([
    'idMateria=0',
    'idMateriaDivision=abc',
    'idActividad=1.5',
    'idPublicacion=-2',
    'estado=inexistente',
    'pagina=0',
    'pagina=1.5',
    'limite=0',
    'limite=101',
    'ordenarPor=nota',
    'ordenDireccion=lateral',
    'fechaDesde=no-es-fecha',
    'fechaDesde=2026-02-31',
    'conIncidentes=si',
    'severidad=critica',
    'conIncidentes=false&tipoIncidente=focus_lost',
    'filtroDesconocido=1',
  ])('devuelve REQUEST_INVALID para query inválida: %s', async (query) => {
    const res = await request(app)
      .get(`/api/reportes/rendimiento-evaluaciones?${query}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
    expect(res.body.errors).toBeDefined();
  });

  it('rechaza fechas invertidas', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?fechaDesde=2026-08-31&fechaHasta=2026-08-01')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
  });

  it.each([
    ['evaluacion', 'Titulo'],
    ['fecha', 'FechaInicio'],
    ['promedio', 'PromedioIntentosCalificados'],
    ['entregados', 'Entregados'],
    ['aprobacion', 'PorcentajeAprobacionIntentos'],
    ['pendientesCorreccion', 'IntentosPendientesCorreccion'],
  ])('aplica ordenamiento %s con desempate estable', async (order, sqlColumn) => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets());

    const res = await request(app)
      .get(`/api/reportes/rendimiento-evaluaciones?ordenarPor=${order}&ordenDireccion=asc`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText).toContain(`ORDER BY ${sqlColumn} ASC, IdPublicacion ASC`);
  });

  it('devuelve 200, arrays vacíos y valores nulos sin denominador', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      kpis: {
        TotalEvaluaciones: 0,
        TotalAlumnosAlcanzados: 0,
        TotalAlumnosUnicos: 0,
        TotalIntentos: 0,
        TotalEntregados: 0,
        TotalEnProgreso: 0,
        TotalVencidos: 0,
        TotalAnulados: 0,
        TotalIntentosCalificados: 0,
        IntentosPendientesCorreccion: 0,
        PromedioIntentosCalificados: null,
        TasaAprobacionIntentos: null,
      },
      chart: [],
      rows: [],
      total: 0,
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.evaluaciones).toEqual([]);
    expect(res.body.data.graficos.distribucionResultados).toEqual([]);
    expect(res.body.data.kpis.promedioIntentosCalificados).toBeNull();
    expect(res.body.data.kpis.tasaAprobacionIntentos).toBeNull();
    expect(res.body.data.paginacion.totalPaginas).toBe(0);
  });

  it('calcula KPIs y gráficos antes de paginar y no los altera al cambiar de página', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce(reportRecordsets({ rows: [{ IdPublicacion: 47 }], total: 25 }))
      .mockResolvedValueOnce(reportRecordsets({ rows: [{ IdPublicacion: 48 }], total: 25 }));

    const first = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?pagina=1&limite=1')
      .set('Authorization', `Bearer ${adminToken}`);
    const second = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?pagina=2&limite=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(first.body.data.evaluaciones).not.toEqual(second.body.data.evaluaciones);
    expect(first.body.data.kpis).toEqual(second.body.data.kpis);
    expect(first.body.data.graficos).toEqual(second.body.data.graficos);
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText.indexOf('FROM #ReporteEvaluaciones;')).toBeLessThan(sqlText.indexOf('OFFSET @Offset'));
  });

  it('clasifica estados y corrección pendiente sin consolidar intentos múltiples', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets());

    await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${adminToken}`);

    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText).toContain("I.Estado = 'entregado' AND I.NotaFinal IS NULL");
    expect(sqlText).toMatch(/I\.Estado = 'entregado'\s+AND I\.NotaFinal IS NOT NULL/);
    expect(sqlText).toContain("I.Estado = 'en_progreso'");
    expect(sqlText).toContain("I.Estado = 'vencido'");
    expect(sqlText).toContain("I.Estado = 'anulado'");
    expect(sqlText).toContain('COUNT(I.Id) AS IntentosTotales');
    expect(sqlText).toContain('COUNT(DISTINCT I.IdAlumno) AS AlumnosQueIniciaron');
  });

  it('evita duplicaciones separando padrón e intentos antes de agregarlos', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets());

    await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${adminToken}`);

    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText).toContain('INTO #Padrones');
    expect(sqlText).toContain('INTO #Intentos');
    expect(sqlText).toContain('LEFT JOIN #Padrones');
    expect(sqlText).toContain('LEFT JOIN #Intentos');
  });

  it('no expone SQL ni stack ante errores internos', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockRejectedValueOnce(new Error('Invalid object name dbo.Secreto'));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: 'No se pudo obtener el rendimiento por evaluación',
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(res.body)).not.toContain('dbo.Secreto');
  });
});
