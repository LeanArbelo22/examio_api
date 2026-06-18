import request from 'supertest';
import { createMockPool } from './mocks/db';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);
jest.mock('bcryptjs', () => ({ compare: jest.fn() }));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(), verify: jest.fn() }));

import bcrypt from 'bcryptjs';

let app: any;
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key';
  app = require('../src/index').app;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/login', () => {
  it('retorna 200 + token + user en camelCase cuando credenciales son válidas', async () => {
    const mockUser = {
      Id: 1,
      Email: 'lfernandez@cervantes.edu.ar',
      Rol: 'docente',
      PasswordHash: '$2a$10$hashedvalue',
      NombreCompleto: 'Laura Fernandez',
      IdentificadorInstitucional: 100542,
    };

    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [mockUser] });
    bcrypt.compare.mockResolvedValueOnce(true);
    jest.mocked(require('jsonwebtoken').sign).mockReturnValue('jwt-token-test');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ Email: 'lfernandez@cervantes.edu.ar', Password: 'Cervantes2026' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBe('jwt-token-test');
    expect(res.body.data.user).toEqual({
      id: 1,
      email: 'lfernandez@cervantes.edu.ar',
      role: 'docente',
      name: 'Laura Fernandez',
      identificadorInstitucional: 100542,
    });
    expect(bcrypt.compare).toHaveBeenCalledWith('Cervantes2026', '$2a$10$hashedvalue');
  });

  it('retorna 401 cuando la contraseña es incorrecta', async () => {
    const mockUser = {
      Id: 1,
      Email: 'lfernandez@cervantes.edu.ar',
      Rol: 'docente',
      PasswordHash: '$2a$10$hashedvalue',
      NombreCompleto: 'Laura Fernandez',
      IdentificadorInstitucional: 100542,
    };

    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [mockUser] });
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ Email: 'lfernandez@cervantes.edu.ar', Password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Credenciales inválidas.');
  });

  it('retorna 401 cuando el usuario no existe', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ Email: 'noexiste@test.com', Password: 'anything' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Credenciales inválidas.');
  });

  it('retorna 500 cuando ocurre un error interno en findUserByEmail', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ Email: 'lfernandez@cervantes.edu.ar', Password: 'Cervantes2026' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('DB connection lost');
  });
});
