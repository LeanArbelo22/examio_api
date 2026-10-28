import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { getAuthConfig } from '../config/auth.config';

interface Counter {
  count: number;
  resetAt: number;
}


// Limita el numero de solicitudes por IP y por usuario para los endpoints de login y refresh token.
const counters = new Map<string, Counter>();

const consume = (key: string, windowSeconds: number, max: number): boolean => {
  const now = Date.now();
  if (counters.size > 10_000) {
    for (const [storedKey, counter] of counters) {
      if (counter.resetAt <= now) counters.delete(storedKey);
    }
  }
  const existing = counters.get(key);
  if (!existing || existing.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  existing.count += 1;
  return existing.count <= max;
};

const fingerprint = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const reject = (res: Response) => res.status(429).json({
  success: false,
  message: 'Demasiadas solicitudes. Intente nuevamente más tarde.',
  code: 'RATE_LIMITED',
});

export const loginRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const config = getAuthConfig();
  const email = typeof req.body?.Email === 'string' ? req.body.Email.trim().toLowerCase() : 'invalid';
  const key = `login:${req.ip}:${fingerprint(email)}`;
  const ipKey = `login-ip:${req.ip}`;
  if (!consume(ipKey, config.loginRateLimitWindowSeconds, config.loginRateLimitMax * 5) ||
      !consume(key, config.loginRateLimitWindowSeconds, config.loginRateLimitMax)) return reject(res);
  next();
};

export const refreshRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const config = getAuthConfig();
  const token = typeof req.body?.RefreshToken === 'string' ? req.body.RefreshToken : 'invalid';
  const publicId = token.split('.')[1] || 'invalid';
  const key = `refresh:${req.ip}:${fingerprint(publicId)}`;
  const ipKey = `refresh-ip:${req.ip}`;
  if (!consume(ipKey, config.refreshRateLimitWindowSeconds, config.refreshRateLimitMax * 5) ||
      !consume(key, config.refreshRateLimitWindowSeconds, config.refreshRateLimitMax)) return reject(res);
  next();
};

export const resetAuthRateLimitsForTests = (): void => counters.clear();
