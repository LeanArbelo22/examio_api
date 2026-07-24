import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

import { createRefreshToken } from '../src/services/auth-token.service';
import { resetAuthRateLimitsForTests } from '../src/middlewares/auth-rate-limit.middleware';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REPLACEMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER_KEY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let app: any;
let txRequest: any;

const activeRow = (overrides: Record<string, unknown> = {}) => ({
  TokenId: TOKEN_ID,
  IdSesion: SESSION_ID,
  TokenExpiraEn: new Date(Date.now() + 3_600_000),
  FechaConsumo: null,
  ReemplazadoPor: null,
  IdempotencyKey: null,
  SessionExpiraEn: new Date(Date.now() + 3_600_000),
  SessionRevocadaEn: null,
  SessionMotivoRevocacion: null,
  Id: 7,
  Email: 'alumno@examio.test',
  Rol: 'alumno',
  PasswordHash: 'not-returned',
  IdAlumno: 30500,
  IdDocente: null,
  Activo: true,
  VinculacionActiva: true,
  ...overrides,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS = '900';
  process.env.AUTH_SESSION_TTL_SECONDS = '43200';
  process.env.AUTH_REFRESH_REUSE_GRACE_SECONDS = '10';
  app = require('../src/app').app;
  txRequest = new mock.pool.Transaction().request();
});

beforeEach(() => {
  jest.clearAllMocks();
  resetAuthRateLimitsForTests();
  txRequest.query.mockReset().mockResolvedValue({ recordset: [] });
  txRequest.input.mockClear();
});

const refresh = (key = KEY) => request(app)
  .post('/api/auth/refresh')
  .set('Idempotency-Key', key)
  .send({ RefreshToken: createRefreshToken(TOKEN_ID) });

describe('POST /api/auth/refresh', () => {
  it('rota el token una sola vez y conserva el máximo absoluto', async () => {
    const absoluteExpiry = new Date(Date.now() + 3_600_000);
    txRequest.query.mockResolvedValueOnce({ recordset: [activeRow({ SessionExpiraEn: absoluteExpiry, TokenExpiraEn: absoluteExpiry })] });

    const res = await refresh();

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).not.toBe(createRefreshToken(TOKEN_ID));
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshTokenExpiresAt).toBe(absoluteExpiry.toISOString());
    expect(txRequest.query).toHaveBeenCalledTimes(3);
  });

  it('devuelve exactamente el mismo resultado al repetir token y clave', async () => {
    const issuedAt = new Date();
    const accessExpiry = new Date(issuedAt.getTime() + 900_000);
    const sessionExpiry = new Date(issuedAt.getTime() + 3_600_000);
    const claims = JSON.stringify({
      id: 7,
      email: 'alumno@examio.test',
      role: 'alumno',
      idAlumno: 30500,
      idDocente: null,
      sessionId: SESSION_ID,
    });
    const consumed = activeRow({
      FechaConsumo: new Date(),
      ReemplazadoPor: REPLACEMENT_ID,
      IdempotencyKey: KEY.toUpperCase(),
    });
    const successor = {
      TokenId: REPLACEMENT_ID.toUpperCase(),
      IdSesion: SESSION_ID,
      FechaEmision: issuedAt,
      FechaExpiracion: sessionExpiry,
      AccessTokenExpiraEn: accessExpiry,
      ClaimsJson: claims,
    };

    txRequest.query
      .mockResolvedValueOnce({ recordset: [consumed] })
      .mockResolvedValueOnce({ recordset: [successor] });
    const first = await refresh();

    txRequest.query
      .mockResolvedValueOnce({ recordset: [consumed] })
      .mockResolvedValueOnce({ recordset: [successor] });
    const second = await refresh();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('trata otra clave dentro de la gracia como conflicto recuperable sin revocar', async () => {
    txRequest.query.mockResolvedValueOnce({ recordset: [activeRow({
      FechaConsumo: new Date(Date.now() - 1_000),
      ReemplazadoPor: REPLACEMENT_ID,
      IdempotencyKey: KEY,
    })] });

    const res = await refresh(OTHER_KEY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REFRESH_CONFLICT');
    expect(txRequest.query).toHaveBeenCalledTimes(1);
  });

  it('revoca la familia al reutilizar fuera de la gracia', async () => {
    txRequest.query.mockResolvedValueOnce({ recordset: [activeRow({
      FechaConsumo: new Date(Date.now() - 20_000),
      ReemplazadoPor: REPLACEMENT_ID,
      IdempotencyKey: KEY,
    })] });

    const res = await refresh(OTHER_KEY);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_TOKEN_REUSED');
    expect(txRequest.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{}, undefined, 400, 'REQUEST_INVALID'],
    [{ RefreshToken: 'access-or-malformed-token' }, KEY, 401, 'REFRESH_TOKEN_INVALID'],
  ])('rechaza token ausente o inválido', async (body, key, status, code) => {
    let call = request(app).post('/api/auth/refresh');
    if (key) call = call.set('Idempotency-Key', key);
    const res = await call.send(body);
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('requiere Idempotency-Key UUID', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ RefreshToken: createRefreshToken(TOKEN_ID) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
  });

  it.each([
    ['REFRESH_TOKEN_EXPIRED', { TokenExpiraEn: new Date(Date.now() - 1_000) }],
    ['SESSION_REVOKED', { SessionRevocadaEn: new Date() }],
    ['REFRESH_TOKEN_REVOKED', { SessionRevocadaEn: new Date(), SessionMotivoRevocacion: 'logout' }],
    ['USER_INACTIVE', { Activo: false }],
    ['SESSION_REVOKED', { VinculacionActiva: false }],
  ])('diferencia %s desde estado server-side', async (code, overrides) => {
    txRequest.query.mockResolvedValueOnce({ recordset: [activeRow(overrides)] });
    const res = await refresh();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(code);
  });

  it('no deja estado parcial si falla la transacción', async () => {
    txRequest.query
      .mockResolvedValueOnce({ recordset: [activeRow()] })
      .mockRejectedValueOnce(new Error('insert failed'));
    const res = await refresh();
    const transaction = (mock.pool.Transaction as jest.Mock).mock.results.at(-1)?.value;

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AUTH_INFRASTRUCTURE_ERROR');
    expect(transaction.rollback).toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/logout', () => {
  it('revoca la familia usando refresh aunque no haya access token', async () => {
    txRequest.query.mockResolvedValueOnce({ recordset: [activeRow()] });
    const res = await request(app)
      .post('/api/auth/logout')
      .send({ RefreshToken: createRefreshToken(TOKEN_ID) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Sesión cerrada correctamente' });
    expect(txRequest.query).toHaveBeenCalledTimes(2);
  });

  it('es idempotente y no revela tokens desconocidos o malformados', async () => {
    const malformed = await request(app)
      .post('/api/auth/logout')
      .send({ RefreshToken: 'desconocido' });
    txRequest.query.mockResolvedValueOnce({ recordset: [] });
    const unknown = await request(app)
      .post('/api/auth/logout')
      .send({ RefreshToken: createRefreshToken(TOKEN_ID) });
    expect(malformed.status).toBe(200);
    expect(unknown.body).toEqual(malformed.body);
  });

  it('no revoca si un access token válido pertenece a otra sesión', async () => {
    const access = jwt.sign({
      id: 7,
      email: 'alumno@examio.test',
      role: 'alumno',
      idAlumno: 30500,
      idDocente: null,
      tokenType: 'access',
      sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    }, process.env.JWT_SECRET!, {
      algorithm: 'HS256',
      issuer: 'examio-api',
      audience: 'examio-bff',
      expiresIn: '15m',
      subject: '7',
    });
    txRequest.query.mockResolvedValueOnce({ recordset: [activeRow()] });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({ RefreshToken: createRefreshToken(TOKEN_ID) });

    expect(res.status).toBe(200);
    expect(txRequest.query).toHaveBeenCalledTimes(1);
  });

  it('permite revocar con access token vencido y refresh identificable', async () => {
    const expired = jwt.sign({
      id: 7,
      email: 'alumno@examio.test',
      role: 'alumno',
      tokenType: 'access',
      sessionId: SESSION_ID,
    }, process.env.JWT_SECRET!, {
      algorithm: 'HS256',
      issuer: 'examio-api',
      audience: 'examio-bff',
      expiresIn: -60,
      subject: '7',
    });
    txRequest.query.mockResolvedValueOnce({ recordset: [activeRow()] });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${expired}`)
      .send({ RefreshToken: createRefreshToken(TOKEN_ID) });

    expect(res.status).toBe(200);
    expect(txRequest.query).toHaveBeenCalledTimes(2);
  });
});
