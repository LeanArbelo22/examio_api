import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let adminToken: string;
let docenteToken: string;
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  adminToken = jwt.sign({ id: 1, email: 'admin@test.com', role: 'admin' }, process.env.JWT_SECRET);
  docenteToken = jwt.sign({ id: 2, email: 'docente@test.com', role: 'docente' }, process.env.JWT_SECRET);
  app = require('../src/app').app;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Actas', () => {
  describe('GET /api/actas', () => {
    it('retorna 200 con array de actas en camelCase', async () => {
      (mock.pool.query as jest.Mock).mockResolvedValueOnce({
        recordset: [
          { Id: 1, IdMateriaDivision: 5, Libro: 'LIBRO-A', Folio: 'FOLIO-001', Estado: 'abierta' },
        ],
      });

      const res = await request(app)
        .get('/api/actas')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toEqual({
        id: 1,
        idMateriaDivision: 5,
        libro: 'LIBRO-A',
        folio: 'FOLIO-001',
        estado: 'abierta',
      });
    });

    it('retorna 401 sin token de autenticación', async () => {
      const res = await request(app).get('/api/actas');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/actas/:id', () => {
    it('retorna 200 con acta y sus detalles en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      const reqBuilderDetalle = mock.pool.request();

      (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Id: 1, IdMateriaDivision: 5, Libro: 'LIBRO-A', Folio: 'FOLIO-001', Estado: 'abierta' }],
      });
      (reqBuilderDetalle.query as jest.Mock).mockResolvedValueOnce({
        recordset: [
          { Id: 10, IdActa: 1, IdAlumno: 30500, NotaCursada: 7.5, NotaFinalExamen: 8, CondicionFinal: 'regular' },
        ],
      });

      const res = await request(app)
        .get('/api/actas/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.estado).toBe('abierta');
      expect(res.body.data.detalles).toHaveLength(1);
    });

    it('retorna 404 cuando el acta no existe', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .get('/api/actas/999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Acta no encontrada');
    });
  });

  describe('POST /api/actas/crear-cierre', () => {
    it('retorna 201 al crear acta exitosamente', async () => {
      const tx = new mock.pool.Transaction();
      const txRequest = tx.request();
      (txRequest.query as jest.Mock).mockResolvedValueOnce({ recordset: [{ idActa: 42 }] });

      const res = await request(app)
        .post('/api/actas/crear-cierre')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({ IdMateriaDivision: 5, Libro: 'LIBRO-A', Folio: 'FOLIO-001' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ idActa: 42 });
    });

    it('retorna 400 cuando Libro supera max(20)', async () => {
      const res = await request(app)
        .post('/api/actas/crear-cierre')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({ IdMateriaDivision: 5, Libro: 'A'.repeat(21), Folio: 'FOLIO-001' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Datos inválidos');
    });

    it('retorna 400 cuando falta IdMateriaDivision', async () => {
      const res = await request(app)
        .post('/api/actas/crear-cierre')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({ Libro: 'LIBRO-A', Folio: 'FOLIO-001' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/actas/cargar-detalle', () => {
    it('retorna 201 al cargar detalle exitosamente', async () => {
      const tx = new mock.pool.Transaction();
      const txRequest = tx.request();
      (txRequest.query as jest.Mock).mockResolvedValueOnce({});

      const res = await request(app)
        .post('/api/actas/cargar-detalle')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({
          IdActa: 1,
          IdAlumno: 30500,
          NotaCursada: 7.5,
          NotaFinalExamen: 8.5,
          CondicionFinal: 'regular',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Detalle cargado');
    });

    it('retorna 201 cuando NotaFinalExamen es null', async () => {
      const tx = new mock.pool.Transaction();
      const txRequest = tx.request();
      (txRequest.query as jest.Mock).mockResolvedValueOnce({});

      const res = await request(app)
        .post('/api/actas/cargar-detalle')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({
          IdActa: 1,
          IdAlumno: 30500,
          NotaCursada: 7.5,
          NotaFinalExamen: null,
          CondicionFinal: 'promocionado',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('retorna 400 cuando NotaCursada supera max(10)', async () => {
      const res = await request(app)
        .post('/api/actas/cargar-detalle')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({
          IdActa: 1,
          IdAlumno: 30500,
          NotaCursada: 11,
          CondicionFinal: 'regular',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('retorna 400 cuando NotaCursada tiene más de 2 decimales', async () => {
      const res = await request(app)
        .post('/api/actas/cargar-detalle')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({
          IdActa: 1,
          IdAlumno: 30500,
          NotaCursada: 7.543,
          CondicionFinal: 'regular',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });

    it('retorna 400 cuando CondicionFinal no está en el enum', async () => {
      const res = await request(app)
        .post('/api/actas/cargar-detalle')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({
          IdActa: 1,
          IdAlumno: 30500,
          NotaCursada: 7.5,
          CondicionFinal: 'invalido',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('retorna 400 cuando falta IdActa', async () => {
      const res = await request(app)
        .post('/api/actas/cargar-detalle')
        .set('Authorization', `Bearer ${docenteToken}`)
        .send({
          IdAlumno: 30500,
          NotaCursada: 7.5,
          CondicionFinal: 'regular',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PUT /api/actas/:id/cerrar', () => {
    it('retorna 200 al cerrar acta exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.query as jest.Mock).mockResolvedValueOnce({});

      const res = await request(app)
        .put('/api/actas/1/cerrar')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Acta cerrada exitosamente');
    });

    it('retorna 401 sin token', async () => {
      const res = await request(app).put('/api/actas/1/cerrar');

      expect(res.status).toBe(401);
    });
  });
});
