import request from 'supertest';
import { createMockPool } from './mocks/db';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);
jest.mock('bcryptjs', () => ({ compare: jest.fn() }));
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { resetAuthRateLimitsForTests } from '../src/middlewares/auth-rate-limit.middleware';

let app: any;
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  app = require('../src/app').app;
});

afterEach(() => {
  jest.clearAllMocks();
  resetAuthRateLimitsForTests();
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
      IdAlumno: null,
      IdDocente: 100542,
      Activo: true,
      VinculacionActiva: true,
    };

    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [mockUser] });
    bcrypt.compare.mockResolvedValueOnce(true);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ Email: 'lfernandez@cervantes.edu.ar', Password: 'Cervantes2026' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBe(res.body.data.accessToken);
    expect(res.body.data.refreshToken).toMatch(/^ert1\./);
    expect(res.body.data.accessTokenExpiresAt).toEqual(expect.any(String));
    expect(res.body.data.refreshTokenExpiresAt).toEqual(expect.any(String));
    const decoded = jwt.verify(res.body.data.accessToken, process.env.JWT_SECRET!, {
      algorithms: ['HS256'],
      issuer: 'examio-api',
      audience: 'examio-bff',
    }) as jwt.JwtPayload;
    expect(decoded.tokenType).toBe('access');
    expect(decoded.iat).toEqual(expect.any(Number));
    expect(decoded.exp).toEqual(expect.any(Number));
    expect(res.body.data.user).toEqual({
      id: 1,
      email: 'lfernandez@cervantes.edu.ar',
      role: 'docente',
      name: 'Laura Fernandez',
      identificadorInstitucional: 100542,
      idAlumno: null,
      idDocente: 100542,
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
      IdAlumno: null,
      IdDocente: 100542,
      Activo: true,
      VinculacionActiva: true,
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
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
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
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('retorna 503 estable sin filtrar el error interno de base', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ Email: 'lfernandez@cervantes.edu.ar', Password: 'Cervantes2026' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('AUTH_INFRASTRUCTURE_ERROR');
    expect(res.body.message).not.toContain('DB connection lost');
  });

  it('retorna 400 cuando el payload es inválido', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ Email: 'correo-inválido' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
  });

  it('retorna USER_INACTIVE solo después de validar una contraseña correcta', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{
        Id: 1,
        Email: 'inactivo@test.com',
        Rol: 'alumno',
        PasswordHash: '$2a$10$hashedvalue',
        IdAlumno: 30500,
        IdDocente: null,
        Activo: false,
        VinculacionActiva: true,
      }],
    });
    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ Email: 'inactivo@test.com', Password: 'correcta' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('USER_INACTIVE');
  });

  it('no registra contraseña plana ni hash', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{
        Id: 1,
        Email: 'alumno@test.com',
        Rol: 'alumno',
        PasswordHash: '$2a$10$hash-sensible',
        IdAlumno: 30500,
        IdDocente: null,
        Activo: true,
        VinculacionActiva: true,
      }],
    });
    bcrypt.compare.mockResolvedValueOnce(false);

    await request(app)
      .post('/api/auth/login')
      .send({ Email: 'alumno@test.com', Password: 'password-sensible' });

    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('password-sensible');
    expect(logged).not.toContain('$2a$10$hash-sensible');
    logSpy.mockRestore();
  });

  it('aplica rate limit local por IP y email sin exponer credenciales', async () => {
    process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '2';
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValue({ recordset: [] });

    await request(app).post('/api/auth/login').send({ Email: 'rate@test.com', Password: 'x' });
    await request(app).post('/api/auth/login').send({ Email: 'rate@test.com', Password: 'x' });
    const limited = await request(app).post('/api/auth/login').send({ Email: 'rate@test.com', Password: 'x' });

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(JSON.stringify(limited.body)).not.toContain('rate@test.com');
    process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';
  });
});
