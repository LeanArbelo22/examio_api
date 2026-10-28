// Este archivo contiene la configuración de autenticación y validación de variables de entorno relacionadas con la autenticación.
const parsePositiveInteger = (name: string, defaultValue: number): number => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return defaultValue;

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return parsed;
};

const parseBoolean = (name: string, defaultValue: boolean): boolean => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return defaultValue;
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  throw new Error(`${name} debe ser 'true' o 'false'`);
};

const requireSecret = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} no está definido en las variables de entorno`);
  if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres`);
  return value;
};

export interface AuthConfig {
  jwtSecret: string;
  refreshTokenSecret: string;
  accessTokenTtlSeconds: number;
  sessionTtlSeconds: number;
  issuer: string;
  audience: string;
  clockToleranceSeconds: number;
  refreshReuseGraceSeconds: number;
  allowLegacyAccessTokens: boolean;
  loginRateLimitWindowSeconds: number;
  loginRateLimitMax: number;
  refreshRateLimitWindowSeconds: number;
  refreshRateLimitMax: number;
}

export const getAuthConfig = (): AuthConfig => {
  const jwtSecret = requireSecret('JWT_SECRET');
  const refreshTokenSecret = requireSecret('AUTH_REFRESH_TOKEN_SECRET');
  if (jwtSecret === refreshTokenSecret) {
    throw new Error('AUTH_REFRESH_TOKEN_SECRET debe ser diferente de JWT_SECRET');
  }

  const accessTokenTtlSeconds = parsePositiveInteger('AUTH_ACCESS_TOKEN_TTL_SECONDS', 900);
  const sessionTtlSeconds = parsePositiveInteger('AUTH_SESSION_TTL_SECONDS', 43200);
  if (accessTokenTtlSeconds >= sessionTtlSeconds) {
    throw new Error('AUTH_ACCESS_TOKEN_TTL_SECONDS debe ser menor que AUTH_SESSION_TTL_SECONDS');
  }

  return {
    jwtSecret,
    refreshTokenSecret,
    accessTokenTtlSeconds,
    sessionTtlSeconds,
    issuer: process.env.AUTH_JWT_ISSUER || 'examio-api',
    audience: process.env.AUTH_JWT_AUDIENCE || 'examio-bff',
    clockToleranceSeconds: parsePositiveInteger('AUTH_CLOCK_TOLERANCE_SECONDS', 30),
    refreshReuseGraceSeconds: parsePositiveInteger('AUTH_REFRESH_REUSE_GRACE_SECONDS', 10),
    allowLegacyAccessTokens: parseBoolean('AUTH_ALLOW_LEGACY_ACCESS_TOKENS', true),
    loginRateLimitWindowSeconds: parsePositiveInteger('AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS', 900),
    loginRateLimitMax: parsePositiveInteger('AUTH_LOGIN_RATE_LIMIT_MAX', 10),
    refreshRateLimitWindowSeconds: parsePositiveInteger('AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS', 60),
    refreshRateLimitMax: parsePositiveInteger('AUTH_REFRESH_RATE_LIMIT_MAX', 30),
  };
};

export const validateAuthConfig = (): void => {
  void getAuthConfig();
};
