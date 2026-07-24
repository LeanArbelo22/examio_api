import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';
import { createRefreshToken } from '../src/services/auth-token.service';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let adminToken: string;
let docenteToken: string;
let alumnoToken: string;
let invalidToken: string;
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  adminToken = jwt.sign({ id: 1, email: 'admin@test.com', role: 'admin' }, process.env.JWT_SECRET);
  docenteToken = jwt.sign({ id: 2, email: 'docente@test.com', role: 'docente' }, process.env.JWT_SECRET);
  alumnoToken = jwt.sign({ id: 3, email: 'alumno@test.com', role: 'alumno' }, process.env.JWT_SECRET);
  invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.malformed';
  app = require('../src/app').app;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('RBAC - Protección de rutas por rol', () => {

  describe('Rutas de administración exclusiva (solo admin)', () => {

    it('POST /api/docentes - admin puede crear docente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .post('/api/docentes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ Legajo: 101, Nombre: 'Admin', Apellido: 'Test', Correo: 'admin@test.com' });

      expect(res.status).toBe(201);
    });

    it('POST /api/docentes - docente recibe 403', async () => {
      const res = await request(app)
        .post('/api/docentes')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({ Legajo: 101, Nombre: 'Test', Apellido: 'User', Correo: 'test@test.com' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('No tiene permisos para realizar esta acción');
    });

    it('POST /api/docentes - alumno recibe 403', async () => {
      const res = await request(app)
        .post('/api/docentes')
        .set('Authorization', `Bearer ${alumnoToken}`)
        .send({ Legajo: 101, Nombre: 'Test', Apellido: 'User', Correo: 'test@test.com' });

      expect(res.status).toBe(403);
    });

    it('POST /api/divisiones - admin puede crear división', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .post('/api/divisiones')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ Descripcion: '1NMS' });

      expect(res.status).toBe(201);
    });

    it('POST /api/divisiones - docente recibe 403', async () => {
      const res = await request(app)
        .post('/api/divisiones')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({ Descripcion: '1NMS' });

      expect(res.status).toBe(403);
    });

    it('DELETE /api/docentes/:legajo - solo admin', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .delete('/api/docentes/100542')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('Rutas compartidas admin/docente', () => {

    it('GET /api/docentes - admin autorizado', async () => {
      (mock.pool.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .get('/api/docentes')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('GET /api/docentes - docente autorizado', async () => {
      (mock.pool.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .get('/api/docentes')
        .set('Authorization', `Bearer ${docenteToken}`);

      expect(res.status).toBe(200);
    });

    it('GET /api/docentes - alumno recibe 403', async () => {
      const res = await request(app)
        .get('/api/docentes')
        .set('Authorization', `Bearer ${alumnoToken}`);

      expect(res.status).toBe(403);
    });

    it('POST /api/evaluaciones/guardar-completo - docente autorizado', async () => {
      const tx = new mock.pool.Transaction();
      const txRequest = tx.request();
      (txRequest.execute as jest.Mock).mockResolvedValueOnce({ recordset: [{ IdActividad: 1 }] });
      (txRequest.query as jest.Mock)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ recordset: [{ Id: 1 }] })
        .mockResolvedValueOnce({ recordset: [{ Id: 1 }] })
        .mockResolvedValueOnce({});

      const res = await request(app)
        .post('/api/evaluaciones/guardar-completo')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({
          Titulo: 'Test',
          Tipo: 'evaluacion',
          CantidadIntentosMaximos: 2,
          DuracionMinutos: 60,
          IdMateriaDivision: 1,
          FechaInicio: '2026-06-15T10:00:00Z',
          FechaFin: '2026-06-15T12:00:00Z',
          GruposPreguntas: [],
        });

      expect(res.status).toBe(201);
    });

    it('POST /api/evaluaciones/guardar-completo - alumno recibe 403', async () => {
      const res = await request(app)
        .post('/api/evaluaciones/guardar-completo')
        .set('Authorization', `Bearer ${alumnoToken}`)
        .send({ Titulo: 'Test', Tipo: 'evaluacion', DuracionMinutos: 60, IdMateriaDivision: 1, FechaInicio: '2026-06-15T10:00:00Z', FechaFin: '2026-06-15T12:00:00Z', GruposPreguntas: [] });

      expect(res.status).toBe(403);
    });

    it('PUT /api/actas/:id/cerrar - docente autorizado', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.query as jest.Mock).mockResolvedValueOnce({});

      const res = await request(app)
        .put('/api/actas/1/cerrar')
        .set('Authorization', `Bearer ${docenteToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('Rutas de alumno', () => {

    it('POST /api/intentos/iniciar - alumno autorizado', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
        recordset: [{ IntentosRealizados: 0, CantidadIntentosMaximos: 3 }],
      });
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [{ Id: 99 }] });

      const res = await request(app)
        .post('/api/intentos/iniciar')
        .set('Authorization', `Bearer ${alumnoToken}`)
        .send({ IdAlumno: 30500, IdPublicacion: 5 });

      expect(res.status).toBe(200);
    });

    it('POST /api/intentos/iniciar - admin autorizado', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
        recordset: [{ IntentosRealizados: 0, CantidadIntentosMaximos: 3 }],
      });
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [{ Id: 99 }] });

      const res = await request(app)
        .post('/api/intentos/iniciar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ IdAlumno: 30500, IdPublicacion: 5 });

      expect(res.status).toBe(200);
    });

    it('POST /api/intentos/iniciar - alumno con intentos agotados recibe 403', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
        recordset: [{ IntentosRealizados: 3, CantidadIntentosMaximos: 3 }],
      });

      const res = await request(app)
        .post('/api/intentos/iniciar')
        .set('Authorization', `Bearer ${alumnoToken}`)
        .send({ IdAlumno: 30500, IdPublicacion: 5 });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('límite máximo de intentos');
    });

    it('POST /api/intentos/iniciar - docente recibe 403', async () => {
      const res = await request(app)
        .post('/api/intentos/iniciar')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({ IdAlumno: 30500, IdPublicacion: 5 });

      expect(res.status).toBe(403);
    });

    it('GET /api/alumnos/:matricula/materias - alumno autorizado (rol compartido)', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .get('/api/alumnos/30500/materias')
        .set('Authorization', `Bearer ${alumnoToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('Autenticación', () => {

    it('retorna 401 cuando no se envía token', async () => {
      const res = await request(app).get('/api/docentes');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCESS_TOKEN_MISSING');
    });

    it('retorna 401 cuando el token es inválido', async () => {
      const res = await request(app)
        .get('/api/docentes')
        .set('Authorization', `Bearer ${invalidToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCESS_TOKEN_INVALID');
    });

    it('retorna 401 cuando no se envía token en POST /api/docentes', async () => {
      const res = await request(app)
        .post('/api/docentes')
        .send({ Legajo: 101, Nombre: 'Test', Apellido: 'User', Correo: 'test@test.com' });

      expect(res.status).toBe(401);
    });

    it('diferencia access token vencido', async () => {
      const expiredToken = jwt.sign(
        { id: 1, email: 'admin@test.com', role: 'admin' },
        process.env.JWT_SECRET!,
        { expiresIn: -60 },
      );
      const res = await request(app)
        .get('/api/docentes')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCESS_TOKEN_EXPIRED');
    });

    it('rechaza algoritmo, issuer y audience incorrectos', async () => {
      const claims = {
        id: 1,
        email: 'admin@test.com',
        role: 'admin',
        tokenType: 'access',
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      };
      const invalidTokens = [
        jwt.sign(claims, process.env.JWT_SECRET!, { algorithm: 'HS384', issuer: 'examio-api', audience: 'examio-bff', expiresIn: '15m' }),
        jwt.sign(claims, process.env.JWT_SECRET!, { algorithm: 'HS256', issuer: 'otro-emisor', audience: 'examio-bff', expiresIn: '15m' }),
        jwt.sign(claims, process.env.JWT_SECRET!, { algorithm: 'HS256', issuer: 'examio-api', audience: 'otra-audiencia', expiresIn: '15m' }),
      ];

      for (const invalid of invalidTokens) {
        const res = await request(app)
          .get('/api/docentes')
          .set('Authorization', `Bearer ${invalid}`);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('ACCESS_TOKEN_INVALID');
      }
    });

    it('rechaza un refresh token opaco usado como access token', async () => {
      const refreshToken = createRefreshToken('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      const res = await request(app)
        .get('/api/docentes')
        .set('Authorization', `Bearer ${refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCESS_TOKEN_INVALID');
    });

    it('un 403 conserva código FORBIDDEN y no parece una expiración', async () => {
      const res = await request(app)
        .post('/api/docentes')
        .set('Authorization', `Bearer ${alumnoToken}`)
        .send({ Legajo: 101, Nombre: 'Test', Apellido: 'User', Correo: 'test@test.com' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.code).not.toContain('TOKEN');
    });
  });
});
