import crypto from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { getAuthConfig } from '../config/auth.config';

export type AuthRole = 'admin' | 'docente' | 'alumno';

export interface AccessTokenClaims {
  id: number;
  email: string;
  role: AuthRole;
  idAlumno: number | null;
  idDocente: number | null;
  sessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

const base64Url = (value: Buffer): string => value.toString('base64url');

export const createRefreshToken = (tokenId: string): string => {
  const { refreshTokenSecret } = getAuthConfig();
  const canonicalTokenId = tokenId.toLowerCase();
  const proof = crypto.createHmac('sha256', refreshTokenSecret).update(canonicalTokenId).digest();
  return `ert1.${canonicalTokenId}.${base64Url(proof)}`;
};

export const hashRefreshToken = (token: string): Buffer =>
  crypto.createHash('sha256').update(token, 'utf8').digest();

export const parseAndValidateRefreshToken = (token: string): { tokenId: string; tokenHash: Buffer } | null => {
  const match = /^ert1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(token);
  if (!match) return null;

  const tokenId = match[1];
  const expected = createRefreshToken(tokenId);
  const receivedBuffer = Buffer.from(token, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return null;
  }
  return { tokenId, tokenHash: hashRefreshToken(token) };
};

export const issueAccessToken = (
  claims: AccessTokenClaims,
  issuedAt: Date,
  expiresAt: Date,
): IssuedAccessToken => {
  const config = getAuthConfig();
  const iat = Math.floor(issuedAt.getTime() / 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const token = jwt.sign(
    {
      ...claims,
      sub: String(claims.id),
      tokenType: 'access',
      iat,
      exp,
    },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      issuer: config.issuer,
      audience: config.audience,
    },
  );
  return { token, expiresAt };
};

export type AccessTokenVerification =
  | { valid: true; claims: AccessTokenClaims & JwtPayload; legacy: boolean }
  | { valid: false; reason: 'missing' | 'expired' | 'invalid' };

const hasModernMarker = (decoded: string | JwtPayload | null): boolean =>
  Boolean(decoded && typeof decoded !== 'string' && (
    decoded.tokenType !== undefined ||
    decoded.sessionId !== undefined ||
    decoded.iss !== undefined ||
    decoded.aud !== undefined
  ));

export const verifyAccessToken = (token: string | undefined): AccessTokenVerification => {
  if (!token) return { valid: false, reason: 'missing' };
  const config = getAuthConfig();
  const decoded = jwt.decode(token);

  try {
    if (hasModernMarker(decoded)) {
      const claims = jwt.verify(token, config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: config.issuer,
        audience: config.audience,
        clockTolerance: config.clockToleranceSeconds,
      }) as AccessTokenClaims & JwtPayload & { tokenType?: string };
      if (claims.tokenType !== 'access' || !claims.sessionId || !claims.sub) {
        return { valid: false, reason: 'invalid' };
      }
      return { valid: true, claims, legacy: false };
    }

    if (!config.allowLegacyAccessTokens) return { valid: false, reason: 'invalid' };
    const claims = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      clockTolerance: config.clockToleranceSeconds,
    }) as AccessTokenClaims & JwtPayload;
    if (!claims.id || !claims.email || !claims.role) return { valid: false, reason: 'invalid' };
    if (process.env.NODE_ENV !== 'test' && !claims.exp) return { valid: false, reason: 'invalid' };
    return { valid: true, claims, legacy: true };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) return { valid: false, reason: 'expired' };
    return { valid: false, reason: 'invalid' };
  }
};
