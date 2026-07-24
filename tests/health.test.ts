import request from 'supertest';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
const mockQuery = mock.pool.request().query as jest.Mock;

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  app = require('../src/app').app;
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ recordset: [{ IsReachable: 1 }] });
});

describe('GET /api/health', () => {
  it('retorna 200 cuando la API y SQL Server están disponibles', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        service: 'examio-api',
        environment: 'test',
        database: 'reachable',
      },
    });
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1 AS IsReachable');
  });

  it('retorna 503 con estado degradado cuando SQL Server no responde', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection timeout'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      data: {
        service: 'examio-api',
        environment: 'test',
        database: 'unreachable',
      },
      message: 'Service temporarily unavailable',
    });
  });

  it('es público y no requiere JWT', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('expone la identidad estable exacta examio-api', async () => {
    const res = await request(app).get('/api/health');

    expect(res.body.data.service).toBe('examio-api');
  });

  it('no expone secretos ni configuración sensible', async () => {
    const res = await request(app).get('/api/health');
    const payload = JSON.stringify(res.body).toLowerCase();

    expect(payload).not.toContain('password');
    expect(payload).not.toContain('jwt');
    expect(payload).not.toContain('secret');
    expect(payload).not.toContain('connectionstring');
    expect(payload).not.toContain('db_server');
    expect(payload).not.toContain('db_user');
  });
});
