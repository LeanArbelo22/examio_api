import { getAuthConfig } from '../src/config/auth.config';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS = '900';
  process.env.AUTH_SESSION_TTL_SECONDS = '43200';
});

afterAll(() => {
  process.env = originalEnv;
});

describe('configuración de autenticación', () => {
  it('usa 15 minutos de access y 12 horas absolutas de sesión', () => {
    const config = getAuthConfig();
    expect(config.accessTokenTtlSeconds).toBe(900);
    expect(config.sessionTtlSeconds).toBe(43200);
  });

  it('exige secretos distintos y suficientemente largos', () => {
    process.env.AUTH_REFRESH_TOKEN_SECRET = process.env.JWT_SECRET;
    expect(() => getAuthConfig()).toThrow('debe ser diferente');
  });

  it('rechaza access tokens cuya duración alcanza el máximo de sesión', () => {
    process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS = '43200';
    expect(() => getAuthConfig()).toThrow('debe ser menor');
  });
});
