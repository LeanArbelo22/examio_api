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
    institutional?: {
      global: Record<string, unknown>;
      carreras: Record<string, unknown>[];
      materias: Record<string, unknown>[];
      comisiones: Record<string, unknown>[];
      meses?: Record<string, unknown>[];
    };
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
        OficialIntentosValidosEntregados: 30,
        OficialResultadosConsiderados: 24,
        OficialResultadosPendientes: 6,
        OficialIntentosPendientesConfirmacion: 4,
        OficialIntentosConfirmadosSinNota: 2,
        OficialIntentosConPreguntasSinPuntaje: 3,
        OficialPreguntasSinPuntaje: 5,
        OficialAprobados: 18,
        OficialDesaprobados: 6,
        OficialSumaNotaBase10Milesimas: '168000',
        OficialCantidadNotasBase10: 24,
        OperativoIntentosEntregadosPendientes: 8,
        OperativoIntentosPendientesConfirmacion: 5,
        OperativoIntentosSinNotaFinal: 4,
        OperativoIntentosConPreguntasSinPuntaje: 3,
        OperativoPreguntasSinPuntaje: 6,
      }],
      overrides?.chart || [
        { Categoria: 'Aprobados', Cantidad: 156 },
        { Categoria: 'Desaprobados', Cantidad: 54 },
        { Categoria: 'Pendientes de corrección', Cantidad: 20 },
        { Categoria: 'En progreso', Cantidad: 15 },
        { Categoria: 'Vencidos', Cantidad: 5 },
        { Categoria: 'Anulados', Cantidad: 10 },
      ],
      ...(overrides?.institutional ? [
        [overrides.institutional.global],
        overrides.institutional.carreras,
        overrides.institutional.materias,
        overrides.institutional.comisiones,
        ...(overrides.institutional.meses ? [overrides.institutional.meses] : []),
      ] : []),
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
        OficialIntentosValidosEntregados: 30,
        OficialResultadosConsiderados: 24,
        OficialResultadosPendientes: 6,
        OficialIntentosPendientesConfirmacion: 4,
        OficialIntentosConfirmadosSinNota: 2,
        OficialIntentosConPreguntasSinPuntaje: 3,
        OficialPreguntasSinPuntaje: 5,
        OficialAprobados: 18,
        OficialDesaprobados: 6,
        OficialSumaNotaBase10Milesimas: '168000',
        OficialCantidadNotasBase10: 24,
        OperativoIntentosEntregadosPendientes: 8,
        OperativoIntentosPendientesConfirmacion: 5,
        OperativoIntentosSinNotaFinal: 4,
        OperativoIntentosConPreguntasSinPuntaje: 3,
        OperativoPreguntasSinPuntaje: 6,
      }],
      [{ Total: overrides?.total ?? 12 }],
    ],
    recordset: [],
  });

  const institucional = {
    global: {
      Publicaciones: 3,
      PublicacionesConResultadosPendientes: 2,
      PublicacionesConPendientesOperativos: 2,
      OficialIntentosValidosEntregados: 30,
      OficialResultadosConsiderados: 24,
      OficialResultadosPendientes: 6,
      OficialIntentosPendientesConfirmacion: 4,
      OficialIntentosConfirmadosSinNota: 2,
      OficialIntentosConPreguntasSinPuntaje: 3,
      OficialPreguntasSinPuntaje: 5,
      OficialAprobados: 18,
      OficialDesaprobados: 6,
      OficialSumaNotaBase10Milesimas: '168000',
      OficialCantidadNotasBase10: 24,
      OperativoIntentosEntregadosPendientes: 8,
      OperativoIntentosPendientesConfirmacion: 5,
      OperativoIntentosSinNotaFinal: 4,
      OperativoIntentosConPreguntasSinPuntaje: 3,
      OperativoPreguntasSinPuntaje: 6,
    },
    carreras: [{
      IdCarrera: 1,
      Carrera: 'Carrera Norte',
      Publicaciones: 2,
      PublicacionesConResultadosPendientes: 1,
      PublicacionesConPendientesOperativos: 1,
      OficialIntentosValidosEntregados: 20,
      OficialResultadosConsiderados: 16,
      OficialResultadosPendientes: 4,
      OficialIntentosPendientesConfirmacion: 3,
      OficialIntentosConfirmadosSinNota: 1,
      OficialIntentosConPreguntasSinPuntaje: 2,
      OficialPreguntasSinPuntaje: 3,
      OficialAprobados: 12,
      OficialDesaprobados: 4,
      OficialSumaNotaBase10Milesimas: '112000',
      OficialCantidadNotasBase10: 16,
      OperativoIntentosEntregadosPendientes: 5,
      OperativoIntentosPendientesConfirmacion: 3,
      OperativoIntentosSinNotaFinal: 2,
      OperativoIntentosConPreguntasSinPuntaje: 2,
      OperativoPreguntasSinPuntaje: 4,
    }, {
      IdCarrera: 2,
      Carrera: 'Carrera Sur',
      Publicaciones: 1,
      PublicacionesConResultadosPendientes: 1,
      PublicacionesConPendientesOperativos: 1,
      OficialIntentosValidosEntregados: 10,
      OficialResultadosConsiderados: 8,
      OficialResultadosPendientes: 2,
      OficialIntentosPendientesConfirmacion: 1,
      OficialIntentosConfirmadosSinNota: 1,
      OficialIntentosConPreguntasSinPuntaje: 1,
      OficialPreguntasSinPuntaje: 2,
      OficialAprobados: 6,
      OficialDesaprobados: 2,
      OficialSumaNotaBase10Milesimas: '56000',
      OficialCantidadNotasBase10: 8,
      OperativoIntentosEntregadosPendientes: 3,
      OperativoIntentosPendientesConfirmacion: 2,
      OperativoIntentosSinNotaFinal: 2,
      OperativoIntentosConPreguntasSinPuntaje: 1,
      OperativoPreguntasSinPuntaje: 2,
    }],
    materias: [{
      IdCarrera: 1,
      Carrera: 'Carrera Norte',
      IdMateria: 5,
      Materia: 'Bases de Datos',
      Publicaciones: 2,
      PublicacionesConResultadosPendientes: 1,
      PublicacionesConPendientesOperativos: 1,
      OficialIntentosValidosEntregados: 20,
      OficialResultadosConsiderados: 16,
      OficialResultadosPendientes: 4,
      OficialIntentosPendientesConfirmacion: 3,
      OficialIntentosConfirmadosSinNota: 1,
      OficialIntentosConPreguntasSinPuntaje: 2,
      OficialPreguntasSinPuntaje: 3,
      OficialAprobados: 12,
      OficialDesaprobados: 4,
      OficialSumaNotaBase10Milesimas: '112000',
      OficialCantidadNotasBase10: 16,
      OperativoIntentosEntregadosPendientes: 5,
      OperativoIntentosPendientesConfirmacion: 3,
      OperativoIntentosSinNotaFinal: 2,
      OperativoIntentosConPreguntasSinPuntaje: 2,
      OperativoPreguntasSinPuntaje: 4,
    }, {
      IdCarrera: 2,
      Carrera: 'Carrera Sur',
      IdMateria: 9,
      Materia: 'Bases de Datos',
      Publicaciones: 1,
      PublicacionesConResultadosPendientes: 1,
      PublicacionesConPendientesOperativos: 1,
      OficialIntentosValidosEntregados: 10,
      OficialResultadosConsiderados: 8,
      OficialResultadosPendientes: 2,
      OficialIntentosPendientesConfirmacion: 1,
      OficialIntentosConfirmadosSinNota: 1,
      OficialIntentosConPreguntasSinPuntaje: 1,
      OficialPreguntasSinPuntaje: 2,
      OficialAprobados: 6,
      OficialDesaprobados: 2,
      OficialSumaNotaBase10Milesimas: '56000',
      OficialCantidadNotasBase10: 8,
      OperativoIntentosEntregadosPendientes: 3,
      OperativoIntentosPendientesConfirmacion: 2,
      OperativoIntentosSinNotaFinal: 2,
      OperativoIntentosConPreguntasSinPuntaje: 1,
      OperativoPreguntasSinPuntaje: 2,
    }],
    comisiones: [{
      IdCarrera: 1,
      Carrera: 'Carrera Norte',
      IdMateria: 5,
      Materia: 'Bases de Datos',
      IdMateriaDivision: 12,
      Division: '2A',
      Publicaciones: 2,
      PublicacionesConResultadosPendientes: 1,
      PublicacionesConPendientesOperativos: 1,
      OficialIntentosValidosEntregados: 20,
      OficialResultadosConsiderados: 16,
      OficialResultadosPendientes: 4,
      OficialIntentosPendientesConfirmacion: 3,
      OficialIntentosConfirmadosSinNota: 1,
      OficialIntentosConPreguntasSinPuntaje: 2,
      OficialPreguntasSinPuntaje: 3,
      OficialAprobados: 12,
      OficialDesaprobados: 4,
      OficialSumaNotaBase10Milesimas: '112000',
      OficialCantidadNotasBase10: 16,
      OperativoIntentosEntregadosPendientes: 5,
      OperativoIntentosPendientesConfirmacion: 3,
      OperativoIntentosSinNotaFinal: 2,
      OperativoIntentosConPreguntasSinPuntaje: 2,
      OperativoPreguntasSinPuntaje: 4,
    }, {
      IdCarrera: 2,
      Carrera: 'Carrera Sur',
      IdMateria: 9,
      Materia: 'Bases de Datos',
      IdMateriaDivision: 23,
      Division: '3B',
      Publicaciones: 1,
      PublicacionesConResultadosPendientes: 1,
      PublicacionesConPendientesOperativos: 1,
      OficialIntentosValidosEntregados: 10,
      OficialResultadosConsiderados: 8,
      OficialResultadosPendientes: 2,
      OficialIntentosPendientesConfirmacion: 1,
      OficialIntentosConfirmadosSinNota: 1,
      OficialIntentosConPreguntasSinPuntaje: 1,
      OficialPreguntasSinPuntaje: 2,
      OficialAprobados: 6,
      OficialDesaprobados: 2,
      OficialSumaNotaBase10Milesimas: '56000',
      OficialCantidadNotasBase10: 8,
      OperativoIntentosEntregadosPendientes: 3,
      OperativoIntentosPendientesConfirmacion: 2,
      OperativoIntentosSinNotaFinal: 2,
      OperativoIntentosConPreguntasSinPuntaje: 1,
      OperativoPreguntasSinPuntaje: 2,
    }],
  };

  const aggregateFixture = (overrides: Record<string, unknown> = {}) => ({
    Publicaciones: 1,
    PublicacionesConResultadosPendientes: 0,
    PublicacionesConPendientesOperativos: 0,
    OficialIntentosValidosEntregados: 10,
    OficialResultadosConsiderados: 10,
    OficialResultadosPendientes: 0,
    OficialIntentosPendientesConfirmacion: 0,
    OficialIntentosConfirmadosSinNota: 0,
    OficialIntentosConPreguntasSinPuntaje: 0,
    OficialPreguntasSinPuntaje: 0,
    OficialAprobados: 5,
    OficialDesaprobados: 5,
    OficialSumaNotaBase10Milesimas: '50000',
    OficialCantidadNotasBase10: 10,
    OperativoIntentosEntregadosPendientes: 0,
    OperativoIntentosPendientesConfirmacion: 0,
    OperativoIntentosSinNotaFinal: 0,
    OperativoIntentosConPreguntasSinPuntaje: 0,
    OperativoPreguntasSinPuntaje: 0,
    ...overrides,
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
      resultadosOficiales: {
        intentosValidosEntregados: 30,
        resultadosConsiderados: 24,
        resultadosPendientes: 6,
        aprobados: 18,
        desaprobados: 6,
        porcentajeAprobacion: 75,
        porcentajeCoberturaConfirmada: 80,
      },
      pendientesOperativos: {
        intentosEntregadosPendientes: 8,
        intentosPendientesConfirmacion: 5,
        intentosSinNotaFinal: 4,
        intentosConPreguntasSinPuntaje: 3,
        preguntasSinPuntaje: 6,
      },
    });
    expect(res.body.data.kpis.resultadosOficiales)
      .toEqual(res.body.data.evaluaciones[0].resultadosOficiales);
    expect(res.body.data.kpis.resultadosOficiales.promedioNotaBase10).toBe(7);
    expect(res.body.data.kpis).not.toHaveProperty('oficialSumaNotaBase10Milesimas');
    expect(res.body.data.evaluaciones[0]).not.toHaveProperty('oficialSumaNotaBase10Milesimas');
    expect(res.body.data.paginacion).toEqual({ pagina: 1, limite: 20, total: 12, totalPaginas: 1 });
    expect(reqBuilder.input).toHaveBeenCalledWith('IdDocente', 'INT', 100542);
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText).toContain('MD.IdDocente = @IdDocente');
    expect(sqlText.indexOf('INTO #IntentosValidosOficiales'))
      .toBeLessThan(sqlText.indexOf('CorreccionConfirmada=1 AND O.NotaFinal IS NOT NULL'));
    expect(sqlText).toContain('IV.NotaFinal,PA.NotaAprobacion,PA.EscalaCalificacion');
    expect(sqlText).toContain('CONVERT(BIGINT,O.NotaFinal*10000/O.EscalaCalificacion)');
    expect(sqlText).toContain('OficialCantidadNotasBase10<>OficialResultadosConsiderados');
  });

  it('calcula el promedio oficial ponderado y normalizado sin promediar publicaciones', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      kpis: aggregateFixture({
        OficialIntentosValidosEntregados: 5,
        OficialResultadosConsiderados: 3,
        OficialResultadosPendientes: 2,
        OficialIntentosPendientesConfirmacion: 1,
        OficialIntentosConfirmadosSinNota: 1,
        OficialAprobados: 2,
        OficialDesaprobados: 1,
        OficialSumaNotaBase10Milesimas: '19000',
        OficialCantidadNotasBase10: 3,
      }),
      rows: [{
        IdPublicacion: 47,
        OficialIntentosValidosEntregados: 5,
        OficialResultadosConsiderados: 3,
        OficialIntentosPendientesConfirmacion: 1,
        OficialIntentosConfirmadosSinNota: 1,
        OficialAprobados: 2,
        OficialDesaprobados: 1,
        OficialSumaNotaBase10Milesimas: '19000',
        OficialCantidadNotasBase10: 3,
      }],
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpis.resultadosOficiales).toMatchObject({
      resultadosConsiderados: 3,
      resultadosPendientes: 2,
      aprobados: 2,
      desaprobados: 1,
      promedioNotaBase10: 6.33,
    });
    expect(res.body.data.evaluaciones[0].resultadosOficiales.promedioNotaBase10).toBe(6.33);
    expect(JSON.stringify(res.body)).not.toContain('SumaNotaBase10Milesimas');
    expect(JSON.stringify(res.body)).not.toContain('CantidadNotasBase10');
  });

  it('devuelve REPORT_INVALID_GRADING_SCALE sin exponer el error SQL', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockRejectedValueOnce({
      number: 51050,
      message: 'REPORT_INVALID_GRADING_SCALE: detalle interno',
    });

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      code: 'REPORT_INVALID_GRADING_SCALE',
      message: 'Existen resultados oficiales con una escala de calificación inválida',
    });
    expect(JSON.stringify(res.body)).not.toContain('detalle interno');
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

  it('devuelve el resumen institucional jerárquico sólo cuando lo solicita un administrador', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: institucional,
      rows: [{
        IdPublicacion: 47,
        IdActividad: 18,
        Titulo: 'Parcial SQL',
        IdCarrera: 1,
        Carrera: 'Carrera Norte',
        IdMateria: 5,
        Materia: 'Bases de Datos',
        IdMateriaDivision: 12,
        Division: '2A',
      }],
      total: 3,
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&pagina=1&limite=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios.incluirResumenInstitucional).toBe(true);
    expect(res.body.data.resumenInstitucional).toMatchObject({
      unidadEvaluacion: 'idPublicacion',
      dimensionTemporal: 'publicacion.fechaInicio',
      global: {
        publicaciones: 3,
        publicacionesConResultadosPendientes: 2,
        publicacionesConPendientesOperativos: 2,
        resultadosOficiales: {
          intentosValidosEntregados: 30,
          resultadosConsiderados: 24,
          resultadosPendientes: 6,
          aprobados: 18,
          desaprobados: 6,
          porcentajeAprobacion: 75,
          porcentajeCoberturaConfirmada: 80,
          promedioNotaBase10: 7,
        },
        pendientesOperativos: {
          intentosEntregadosPendientes: 8,
          intentosPendientesConfirmacion: 5,
          intentosSinNotaFinal: 4,
          intentosConPreguntasSinPuntaje: 3,
          preguntasSinPuntaje: 6,
        },
      },
    });
    expect(res.body.data.resumenInstitucional.materias).toHaveLength(2);
    expect(res.body.data.resumenInstitucional.materias[0]).toMatchObject({
      idCarrera: 1,
      carrera: 'Carrera Norte',
      idMateria: 5,
      materia: 'Bases de Datos',
      publicaciones: 2,
      resultadosOficiales: {
        resultadosConsiderados: 16,
        porcentajeAprobacion: 75,
        promedioNotaBase10: 7,
      },
      comisiones: [{
        idMateriaDivision: 12,
        idMateria: 5,
        idCarrera: 1,
        resultadosOficiales: { resultadosConsiderados: 16, promedioNotaBase10: 7 },
        pendientesOperativos: { intentosEntregadosPendientes: 5 },
      }],
    });
    expect(res.body.data.resumenInstitucional.materias[1]).toMatchObject({
      idCarrera: 2,
      idMateria: 9,
      materia: 'Bases de Datos',
      comisiones: [{ idMateriaDivision: 23 }],
    });
    expect(res.body.data.resumenInstitucional.carreras).toHaveLength(2);
    expect(res.body.data.resumenInstitucional.carreras[0]).toMatchObject({
      idCarrera: 1,
      carrera: 'Carrera Norte',
      materias: [{ idMateria: 5, comisiones: [{ idMateriaDivision: 12 }] }],
    });
    expect(res.body.data.resumenInstitucional.comparativas).toMatchObject({
      criteriosElegibilidad: {
        muestraMinima: 10,
        coberturaMinimaPorcentaje: 70,
        naturaleza: 'criterio_operativo_configurable',
      },
      carreras: {
        elegibles: [{
          idCarrera: 1,
          posicion: 1,
          resultadosOficiales: { promedioNotaBase10: 7 },
        }],
        evidenciaLimitada: [{
          idCarrera: 2,
          motivosNoElegibilidad: ['MUESTRA_INSUFICIENTE'],
        }],
        sinResultados: [],
      },
    });
    expect(Object.keys(res.body.data.resumenInstitucional.global.resultadosOficiales).sort())
      .toEqual(Object.keys(res.body.data.kpis.resultadosOficiales).sort());
    expect(Object.keys(res.body.data.resumenInstitucional.global.pendientesOperativos).sort())
      .toEqual(Object.keys(res.body.data.kpis.pendientesOperativos).sort());
    expect(res.body.data.evaluaciones[0]).toMatchObject({
      idCarrera: 1,
      carrera: 'Carrera Norte',
    });

    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText).toContain('INNER JOIN Carrera C ON C.Id = M.IdCarrera');
    expect(sqlText).toContain('GROUP BY IdCarrera,Carrera,IdMateria,Materia');
    expect(sqlText).toContain('GROUP BY IdCarrera,Carrera');
    expect(sqlText).toContain(
      'GROUP BY IdCarrera,Carrera,IdMateria,Materia,IdMateriaDivision,Division',
    );
    expect(sqlText.indexOf('AS PublicacionesConResultadosPendientes'))
      .toBeLessThan(sqlText.indexOf('OFFSET @Offset'));
    expect(sqlText).toContain('COALESCE(SUM(OficialResultadosConsiderados),0)');
  });

  it('clasifica comparativas completas y ordena antes del redondeo visible', async () => {
    const reqBuilder = mock.pool.request();
    const materias = [
      aggregateFixture({
        IdCarrera: 1, Carrera: 'Carrera Norte', IdMateria: 10, Materia: 'Materia A',
        OficialIntentosValidosEntregados: 20, OficialResultadosConsiderados: 20,
        OficialAprobados: 8, OficialDesaprobados: 12,
      }),
      aggregateFixture({
        IdCarrera: 1, Carrera: 'Carrera Norte', IdMateria: 11, Materia: 'Materia B',
        OficialIntentosValidosEntregados: 10, OficialResultadosConsiderados: 10,
        OficialAprobados: 4, OficialDesaprobados: 6,
      }),
      aggregateFixture({
        IdCarrera: 1, Carrera: 'Carrera Norte', IdMateria: 12, Materia: 'Materia C',
        OficialIntentosValidosEntregados: 3, OficialResultadosConsiderados: 2,
        OficialResultadosPendientes: 1, OficialAprobados: 1, OficialDesaprobados: 1,
      }),
      aggregateFixture({
        IdCarrera: 1, Carrera: 'Carrera Norte', IdMateria: 13, Materia: 'Materia D',
        OficialIntentosValidosEntregados: 5, OficialResultadosConsiderados: 0,
        OficialResultadosPendientes: 5, OficialAprobados: 0, OficialDesaprobados: 0,
      }),
    ];
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: {
        global: aggregateFixture(),
        carreras: [aggregateFixture({ IdCarrera: 1, Carrera: 'Carrera Norte' })],
        materias,
        comisiones: [],
      },
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&muestraMinimaRanking=2&coberturaMinimaRanking=66.67')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const comparison = res.body.data.resumenInstitucional.comparativas.materias;
    expect(comparison.elegibles.map((item: any) => [item.idMateria, item.posicion]))
      .toEqual([[10, 1], [11, 2]]);
    expect(comparison.evidenciaLimitada).toMatchObject([{
      idMateria: 12,
      resultadosOficiales: { porcentajeCoberturaConfirmada: 66.67 },
      motivosNoElegibilidad: ['COBERTURA_INSUFICIENTE'],
    }]);
    expect(comparison.sinResultados).toMatchObject([{
      idMateria: 13,
      motivosNoElegibilidad: ['SIN_RESULTADOS_CONFIRMADOS'],
    }]);
  });

  it('ordena el ranking descendente por proporción exacta y conserva los desempates', async () => {
    const reqBuilder = mock.pool.request();
    const materias = [
      aggregateFixture({
        IdCarrera: 1, Carrera: 'Carrera Norte', IdMateria: 10, Materia: 'Un tercio',
        OficialIntentosValidosEntregados: 3, OficialResultadosConsiderados: 3,
        OficialAprobados: 1, OficialDesaprobados: 2,
      }),
      aggregateFixture({
        IdCarrera: 1, Carrera: 'Carrera Norte', IdMateria: 11, Materia: 'Aproximación',
        OficialIntentosValidosEntregados: 10000, OficialResultadosConsiderados: 10000,
        OficialAprobados: 3333, OficialDesaprobados: 6667,
      }),
      aggregateFixture({
        IdCarrera: 1, Carrera: 'Carrera Norte', IdMateria: 12, Materia: 'Dos sextos',
        OficialIntentosValidosEntregados: 6, OficialResultadosConsiderados: 6,
        OficialAprobados: 2, OficialDesaprobados: 4,
      }),
    ];
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: {
        global: aggregateFixture(),
        carreras: [aggregateFixture({ IdCarrera: 1, Carrera: 'Carrera Norte' })],
        materias,
        comisiones: [],
      },
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&ordenRanking=aprobacion_desc&muestraMinimaRanking=1&coberturaMinimaRanking=0')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios.ordenRanking).toBe('aprobacion_desc');
    expect(res.body.data.resumenInstitucional.comparativas.ordenRanking)
      .toBe('aprobacion_desc');
    expect(res.body.data.resumenInstitucional.comparativas.materias.elegibles
      .map((item: any) => [item.idMateria, item.posicion]))
      .toEqual([[12, 1], [10, 2], [11, 3]]);
  });

  it('completa la serie mensual, distingue meses vacíos y marca períodos parciales', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: {
        ...institucional,
        meses: [aggregateFixture({
          Periodo: '2026-01',
          Publicaciones: 1,
          OficialIntentosValidosEntregados: 12,
          OficialResultadosConsiderados: 12,
          OficialAprobados: 0,
          OficialDesaprobados: 12,
        })],
      },
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&incluirSerieMensual=true&fechaDesde=2025-12-15T03:00:00.000Z&fechaHasta=2026-02-15T03:00:00.000Z')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resumenInstitucional.periodoEfectivo).toEqual({
      desde: '2025-12-15T03:00:00.000Z',
      hasta: '2026-02-15T03:00:00.000Z',
      zonaHoraria: 'America/Argentina/Buenos_Aires',
      mesesCalendarioIncluidos: 3,
    });
    expect(res.body.data.resumenInstitucional.serieMensual).toMatchObject([
      {
        periodo: '2025-12', periodoCompleto: false, publicaciones: 0,
        resultadosOficiales: { porcentajeAprobacion: null, porcentajeCoberturaConfirmada: null },
      },
      {
        periodo: '2026-01', periodoCompleto: true, publicaciones: 1,
        resultadosOficiales: {
          resultadosConsiderados: 12,
          aprobados: 0,
          porcentajeAprobacion: 0,
          porcentajeCoberturaConfirmada: 100,
        },
      },
      {
        periodo: '2026-02', periodoCompleto: false, publicaciones: 0,
        resultadosOficiales: { porcentajeAprobacion: null },
      },
    ]);
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText).toContain("AT TIME ZONE 'Argentina Standard Time'");
  });

  it('agrega una serie semestral desde la misma base mensual y conserva la invariante oficial', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: {
        ...institucional,
        meses: [
          aggregateFixture({
            Periodo: '2025-12', Publicaciones: 1,
            PublicacionesConResultadosPendientes: 1,
            OficialIntentosValidosEntregados: 10,
            OficialResultadosConsiderados: 8,
            OficialResultadosPendientes: 2,
            OficialIntentosPendientesConfirmacion: 1,
            OficialIntentosConfirmadosSinNota: 1,
            OficialAprobados: 4, OficialDesaprobados: 4,
            OficialSumaNotaBase10Milesimas: '52000',
            OficialCantidadNotasBase10: 8,
          }),
          aggregateFixture({
            Periodo: '2026-01', Publicaciones: 2,
            PublicacionesConResultadosPendientes: 1,
            OficialIntentosValidosEntregados: 20,
            OficialResultadosConsiderados: 17,
            OficialResultadosPendientes: 3,
            OficialIntentosPendientesConfirmacion: 2,
            OficialIntentosConfirmadosSinNota: 1,
            OficialAprobados: 0, OficialDesaprobados: 17,
            OficialSumaNotaBase10Milesimas: '68000',
            OficialCantidadNotasBase10: 17,
          }),
          aggregateFixture({
            Periodo: '2026-02', Publicaciones: 1,
            OficialIntentosValidosEntregados: 3,
            OficialResultadosConsiderados: 3,
            OficialResultadosPendientes: 0,
            OficialIntentosPendientesConfirmacion: 0,
            OficialIntentosConfirmadosSinNota: 0,
            OficialAprobados: 3, OficialDesaprobados: 0,
            OficialSumaNotaBase10Milesimas: '27000',
            OficialCantidadNotasBase10: 3,
          }),
          aggregateFixture({
            Periodo: '2026-07', Publicaciones: 3,
            PublicacionesConResultadosPendientes: 2,
            OficialIntentosValidosEntregados: 30,
            OficialResultadosConsiderados: 25,
            OficialResultadosPendientes: 5,
            OficialIntentosPendientesConfirmacion: 4,
            OficialIntentosConfirmadosSinNota: 1,
            OficialAprobados: 20, OficialDesaprobados: 5,
            OficialSumaNotaBase10Milesimas: '200000',
            OficialCantidadNotasBase10: 25,
          }),
        ],
      },
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&incluirSerieMensual=true&agrupacionSerie=semestral&fechaDesde=2025-11-15T03:00:00.000Z&fechaHasta=2026-08-15T02:59:59.999Z')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios.agrupacionSerie).toBe('semestral');
    expect(res.body.data.resumenInstitucional.serieMensual).toHaveLength(10);
    expect(res.body.data.resumenInstitucional.serieTemporal).toMatchObject({
      agrupacion: 'semestral',
      zonaHoraria: 'America/Argentina/Buenos_Aires',
      puntos: [
        {
          periodo: '2025-S2', periodoCompleto: false, publicaciones: 1,
          limitesCalendario: {
            desde: '2025-07-01T03:00:00.000Z',
            hastaExclusivo: '2026-01-01T03:00:00.000Z',
          },
          resultadosOficiales: { resultadosPendientes: 2, promedioNotaBase10: 6.5 },
        },
        {
          periodo: '2026-S1', periodoCompleto: true, publicaciones: 3,
          resultadosOficiales: {
            resultadosConsiderados: 20,
            porcentajeAprobacion: 15,
            resultadosPendientes: 3,
            promedioNotaBase10: 4.75,
          },
        },
        {
          periodo: '2026-S2', periodoCompleto: false, publicaciones: 3,
          resultadosOficiales: {
            porcentajeAprobacion: 80,
            resultadosPendientes: 5,
            promedioNotaBase10: 8,
          },
        },
      ],
    });
    for (const point of res.body.data.resumenInstitucional.serieTemporal.puntos) {
      const official = point.resultadosOficiales;
      expect(official.resultadosPendientes).toBe(
        official.intentosPendientesConfirmacion + official.intentosConfirmadosSinNota,
      );
    }
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0] as string;
    expect((sqlText.match(/AS Periodo,/g) || [])).toHaveLength(1);
  });

  it('genera la serie anual sin requerir la serie mensual legacy', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: { ...institucional, meses: [] },
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&agrupacionSerie=anual&fechaDesde=2025-11-01T03:00:00.000Z&fechaHasta=2026-10-01T02:59:59.999Z')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resumenInstitucional.serieMensual).toBeUndefined();
    expect(res.body.data.resumenInstitucional.serieTemporal.puntos.map((item: any) => item.periodo))
      .toEqual(['2025', '2026']);
    expect(res.body.data.resumenInstitucional.serieTemporal.puntos[0])
      .toMatchObject({
        periodoCompleto: false,
        publicaciones: 0,
        resultadosOficiales: {
          resultadosConsiderados: 0,
          porcentajeAprobacion: null,
          porcentajeCoberturaConfirmada: null,
        },
      });
  });

  it('expone serieTemporal mensual sin alterar ni exigir serieMensual', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: {
        ...institucional,
        meses: [aggregateFixture({
          Periodo: '2026-03', Publicaciones: 1,
          OficialIntentosValidosEntregados: 10,
          OficialResultadosConsiderados: 10,
          OficialAprobados: 0,
          OficialDesaprobados: 10,
          OficialSumaNotaBase10Milesimas: '0',
          OficialCantidadNotasBase10: 10,
        })],
      },
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&agrupacionSerie=mensual&fechaDesde=2026-03-01T03:00:00.000Z&fechaHasta=2026-05-01T02:59:59.999Z')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resumenInstitucional.serieMensual).toBeUndefined();
    expect(res.body.data.resumenInstitucional.serieTemporal.puntos[0]).toMatchObject({
      periodo: '2026-03',
      limitesCalendario: {
        desde: '2026-03-01T03:00:00.000Z',
        hastaExclusivo: '2026-04-01T03:00:00.000Z',
      },
      limitesEfectivos: {
        desde: '2026-03-01T03:00:00.000Z',
        hasta: '2026-04-01T02:59:59.999Z',
      },
      periodoCompleto: true,
      resultadosOficiales: { porcentajeAprobacion: 0, promedioNotaBase10: 0 },
    });
    expect(res.body.data.resumenInstitucional.serieTemporal.puntos[1]).toMatchObject({
      periodo: '2026-04',
      publicaciones: 0,
      resultadosOficiales: {
        resultadosConsiderados: 0,
        porcentajeAprobacion: null,
        promedioNotaBase10: null,
      },
    });
  });

  it('garantiza la invariante excluyente de resultados oficiales en todos los bloques', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      kpis: {
        OficialResultadosPendientes: 999,
        OficialIntentosPendientesConfirmacion: 7,
        OficialIntentosConfirmadosSinNota: 3,
      },
      institutional: institucional,
      rows: [{
        IdPublicacion: 47,
        OficialResultadosPendientes: 999,
        OficialIntentosPendientesConfirmacion: 2,
        OficialIntentosConfirmadosSinNota: 1,
      }],
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const officialBlocks = [
      res.body.data.kpis.resultadosOficiales,
      res.body.data.evaluaciones[0].resultadosOficiales,
      res.body.data.resumenInstitucional.global.resultadosOficiales,
      ...res.body.data.resumenInstitucional.carreras
        .map((item: any) => item.resultadosOficiales),
      ...res.body.data.resumenInstitucional.materias
        .map((item: any) => item.resultadosOficiales),
    ];
    for (const official of officialBlocks) {
      expect(official.resultadosPendientes).toBe(
        official.intentosPendientesConfirmacion + official.intentosConfirmadosSinNota,
      );
    }
    expect(res.body.data.kpis.resultadosOficiales.resultadosPendientes).toBe(10);
    expect(res.body.data.evaluaciones[0].resultadosOficiales.resultadosPendientes).toBe(3);
  });

  it('acepta exactamente 60 meses calendario y genera la colección completa', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: { ...institucional, meses: [] },
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&incluirSerieMensual=true&fechaDesde=2020-01-01T03:00:00.000Z&fechaHasta=2024-12-31T23:59:59.999Z')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resumenInstitucional.periodoEfectivo.mesesCalendarioIncluidos).toBe(60);
    expect(res.body.data.resumenInstitucional.serieMensual).toHaveLength(60);
    expect(res.body.data.resumenInstitucional.serieMensual[0].periodo).toBe('2020-01');
    expect(res.body.data.resumenInstitucional.serieMensual[59].periodo).toBe('2024-12');
  });

  it('limita el período efectivo y toda la consulta al instante actual', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: { ...institucional, meses: [] },
    }));

    const beforeRequest = Date.now();
    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&incluirSerieMensual=true&fechaDesde=2026-10-01T03:00:00.000Z&fechaHasta=2099-12-31T23:59:59.999Z')
      .set('Authorization', `Bearer ${adminToken}`);
    const afterRequest = Date.now();

    expect(res.status).toBe(200);
    const effectiveTo = Date.parse(res.body.data.resumenInstitucional.periodoEfectivo.hasta);
    expect(effectiveTo).toBeGreaterThanOrEqual(beforeRequest);
    expect(effectiveTo).toBeLessThanOrEqual(afterRequest);
    const boundDate = reqBuilder.input.mock.calls
      .find((call: unknown[]) => call[0] === 'FechaHasta')?.[2] as Date;
    expect(boundDate.getTime()).toBe(effectiveTo);
    const series = res.body.data.resumenInstitucional.serieMensual;
    expect(series[series.length - 1].periodoCompleto).toBe(false);
  });

  it.each([
    [
      'incluirResumenInstitucional=true&incluirSerieMensual=true',
      'REPORT_SERIES_PERIOD_REQUIRED',
    ],
    [
      'incluirResumenInstitucional=true&incluirSerieMensual=true&fechaDesde=invalida&fechaHasta=2026-01-01',
      'REPORT_SERIES_PERIOD_INVALID',
    ],
    [
      'incluirResumenInstitucional=true&incluirSerieMensual=true&fechaDesde=2020-01-01T03:00:00.000Z&fechaHasta=2025-01-01T03:00:00.000Z',
      'REPORT_SERIES_RANGE_TOO_LARGE',
    ],
    [
      'incluirSerieMensual=true&fechaDesde=2026-01-01&fechaHasta=2026-02-01',
      'REPORT_INSTITUTIONAL_OPTIONS_REQUIRE_SUMMARY',
    ],
    [
      'muestraMinimaRanking=10',
      'REPORT_INSTITUTIONAL_OPTIONS_REQUIRE_SUMMARY',
    ],
    [
      'incluirResumenInstitucional=true&agrupacionSerie=semanal&fechaDesde=2026-01-01&fechaHasta=2026-02-01',
      'REPORT_SERIES_GROUPING_INVALID',
    ],
    [
      'incluirResumenInstitucional=true&agrupacionSerie=anual&fechaDesde=2020-01-01T03:00:00.000Z&fechaHasta=2025-01-01T03:00:00.000Z',
      'REPORT_SERIES_RANGE_TOO_LARGE',
    ],
    [
      'incluirResumenInstitucional=true&ordenRanking=alfabetico',
      'REPORT_RANKING_ORDER_INVALID',
    ],
    [
      'agrupacionSerie=anual&fechaDesde=2026-01-01&fechaHasta=2026-02-01',
      'REPORT_INSTITUTIONAL_OPTIONS_REQUIRE_SUMMARY',
    ],
  ])('devuelve el error institucional estable para %s', async (query, code) => {
    const reqBuilder = mock.pool.request();
    const res = await request(app)
      .get(`/api/reportes/rendimiento-evaluaciones?${query}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
    expect(reqBuilder.query).not.toHaveBeenCalled();
  });

  it('rechaza filtros jerárquicos incompatibles antes de ejecutar el reporte', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{ Consistente: false }],
    });

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&idCarrera=1&idMateria=99')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REPORT_FILTERS_INCONSISTENT');
    expect(reqBuilder.query).toHaveBeenCalledTimes(1);
  });

  it('aplica un filtro de carrera coherente y lo conserva en los criterios', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Consistente: true }] })
      .mockResolvedValueOnce(reportRecordsets({ institutional: institucional }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&idCarrera=1&idMateria=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios.idCarrera).toBe(1);
    expect(reqBuilder.input).toHaveBeenCalledWith('IdCarrera', 'INT', 1);
    const reportSql = (reqBuilder.query as jest.Mock).mock.calls[1][0];
    expect(reportSql).toContain('AND C.Id = @IdCarrera');
  });

  it('rechaza el resumen institucional para docente sin ejecutar SQL', async () => {
    const reqBuilder = mock.pool.request();

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(reqBuilder.query).not.toHaveBeenCalled();
  });

  it('rechaza el resumen institucional para alumno mediante el RBAC existente', async () => {
    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('mantiene compatible la consulta docente cuando el resumen institucional es false', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets());

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=false')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resumenInstitucional).toBeUndefined();
    expect(res.body.data.criterios.incluirResumenInstitucional).toBe(false);
  });

  it('resuelve el intento válido antes de evaluar confirmación y conserva el gráfico legacy', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets());

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?idPublicacion=47')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.graficos.distribucionResultados).toEqual([
      { categoria: 'Aprobados', cantidad: 156 },
      { categoria: 'Desaprobados', cantidad: 54 },
      { categoria: 'Pendientes de corrección', cantidad: 20 },
      { categoria: 'En progreso', cantidad: 15 },
      { categoria: 'Vencidos', cantidad: 5 },
      { categoria: 'Anulados', cantidad: 10 },
    ]);
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    const seleccion = sqlText.indexOf('AS IdIntentoValido');
    const evaluacionConfirmacion = sqlText.indexOf(
      'O.CorreccionConfirmada=1 AND O.NotaFinal IS NOT NULL',
    );
    expect(seleccion).toBeGreaterThan(-1);
    expect(evaluacionConfirmacion).toBeGreaterThan(seleccion);
    expect(sqlText).not.toContain('CorreccionConfirmada=1\n        ORDER BY I2.FechaFin');
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
    'idCarrera=7',
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
    'idCarrera=0',
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
    'incluirResumenInstitucional=si',
    'incluirSerieMensual=si',
    'muestraMinimaRanking=0',
    'muestraMinimaRanking=1.5',
    'coberturaMinimaRanking=-1',
    'coberturaMinimaRanking=101',
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

  it('calcula el resumen institucional antes de paginar las publicaciones', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce(reportRecordsets({
        institutional: institucional,
        rows: [{ IdPublicacion: 47 }],
        total: 3,
      }))
      .mockResolvedValueOnce(reportRecordsets({
        institutional: institucional,
        rows: [{ IdPublicacion: 48 }],
        total: 3,
      }));

    const first = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&pagina=1&limite=1')
      .set('Authorization', `Bearer ${adminToken}`);
    const second = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&pagina=2&limite=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(first.body.data.evaluaciones).not.toEqual(second.body.data.evaluaciones);
    expect(first.body.data.resumenInstitucional).toEqual(second.body.data.resumenInstitucional);
    const sqlText = (reqBuilder.query as jest.Mock).mock.calls[0][0];
    expect(sqlText.indexOf('AS PublicacionesConPendientesOperativos'))
      .toBeLessThan(sqlText.indexOf('OFFSET @Offset'));
  });

  it('devuelve porcentajes institucionales null cuando no existe denominador', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce(reportRecordsets({
      institutional: {
        global: {
          Publicaciones: 0,
          PublicacionesConResultadosPendientes: 0,
          PublicacionesConPendientesOperativos: 0,
        },
        carreras: [],
        materias: [],
        comisiones: [],
      },
      rows: [],
      total: 0,
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resumenInstitucional.global.resultadosOficiales).toMatchObject({
      intentosValidosEntregados: 0,
      resultadosConsiderados: 0,
      resultadosPendientes: 0,
      porcentajeAprobacion: null,
      porcentajeCoberturaConfirmada: null,
    });
    expect(res.body.data.resumenInstitucional.materias).toEqual([]);
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
