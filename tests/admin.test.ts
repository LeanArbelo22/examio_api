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
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key';
  adminToken = jwt.sign({ id: 1, email: 'admin@test.com', role: 'admin' }, process.env.JWT_SECRET);
  docenteToken = jwt.sign({ id: 2, email: 'docente@test.com', role: 'docente' }, process.env.JWT_SECRET);
  alumnoToken = jwt.sign({ id: 3, email: 'alumno@test.com', role: 'alumno' }, process.env.JWT_SECRET);
  app = require('../src/index').app;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/admin/dashboard/analitica', () => {
  it('retorna 401 sin token de autenticación', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard/analitica');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('retorna 403 con rol alumno', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard/analitica')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('retorna 403 con rol docente', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard/analitica')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('retorna 200 con estructura completa (kpis + intentos + evaluaciones)', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({
        recordset: [
          {
            IdIntento: 1, Matricula: 30500,
            NombreAlumno: 'Julieta Acosta',
            TituloEvaluacion: 'Parcial I', ComisionMateria: '1NMS',
            FechaInicio: new Date('2026-06-15T10:00:00Z'),
            Estado: 'entregado', NotaFinal: 8.00, TotalAlertas: 0,
          },
          {
            IdIntento: 2, Matricula: 30501,
            NombreAlumno: 'Juan Perez',
            TituloEvaluacion: 'Parcial I', ComisionMateria: '1NMS',
            FechaInicio: new Date('2026-06-15T11:00:00Z'),
            Estado: 'entregado', NotaFinal: 3.50, TotalAlertas: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [
          {
            LegajoDocente: 100542, NombreDocente: 'Laura Fernandez',
            TituloEvaluacion: 'Parcial I', NombreMateria: 'Bases de Datos I',
            NombreDivision: '1NMS',
            FechaPublicacion: new Date('2026-06-10T08:00:00Z'),
            Estado: 'publicada', AlumnosInscriptos: 25,
          },
        ],
      });

    const res = await request(app)
      .get('/api/admin/dashboard/analitica')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.kpis).toBeDefined();
    expect(res.body.data.kpis.totalIntentos).toBe(2);
    expect(res.body.data.kpis.promedioGeneral).toBe(5.75);
    expect(res.body.data.kpis.tasaAprobacion).toBe(50);
    expect(res.body.data.kpis.totalAlertasFraude).toBe(1);
    expect(res.body.data.intentos).toHaveLength(2);
    expect(res.body.data.evaluaciones).toHaveLength(1);
  });

  it('retorna 200 con query params aplicados correctamente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/admin/dashboard/analitica?idCarrera=1&matriculaAlumno=30500')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.kpis.totalIntentos).toBe(0);
    expect(res.body.data.kpis.promedioGeneral).toBe(0);
    expect(res.body.data.kpis.tasaAprobacion).toBe(0);
    expect(res.body.data.kpis.totalAlertasFraude).toBe(0);
    expect(res.body.data.intentos).toHaveLength(0);
    expect(res.body.data.evaluaciones).toHaveLength(0);

    expect(mock.pool.request().input).toHaveBeenCalledWith('idCarrera', 'INT', 1);
    expect(mock.pool.request().input).toHaveBeenCalledWith('matriculaAlumno', 'INT', 30500);
  });
});
