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
