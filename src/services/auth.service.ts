import crypto from 'crypto';
import * as sql from 'mssql';
import { pool } from '../config/db';
import { getAuthConfig } from '../config/auth.config';
import {
  AccessTokenClaims,
  AuthRole,
  createRefreshToken,
  hashRefreshToken,
  issueAccessToken,
  parseAndValidateRefreshToken,
} from './auth-token.service';

export class AuthServiceError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export interface AuthUser {
  Id: number;
  Email: string;
  Rol: AuthRole;
  PasswordHash: string;
  IdAlumno: number | null;
  IdDocente: number | null;
  IdentificadorInstitucional: number | null;
  NombreCompleto: string | null;
  Activo: boolean;
  VinculacionActiva: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

const userSelect = `
  SELECT U.Id, U.Email, U.Rol, U.PasswordHash, U.IdAlumno, U.IdDocente, U.Activo,
         CASE WHEN U.Rol = 'docente' THEN U.IdDocente WHEN U.Rol = 'alumno' THEN U.IdAlumno END AS IdentificadorInstitucional,
         ISNULL(D.Nombre + ' ' + D.Apellido, A.Nombre + ' ' + A.Apellido) AS NombreCompleto,
         CAST(CASE
           WHEN U.Rol = 'admin' THEN 1
           WHEN U.Rol = 'docente' AND D.Legajo IS NOT NULL AND D.Estado = 1 THEN 1
           WHEN U.Rol = 'alumno' AND A.Matricula IS NOT NULL AND A.Estado = 'activo' THEN 1
           ELSE 0
         END AS BIT) AS VinculacionActiva
  FROM Usuario U
  LEFT JOIN Docente D ON U.IdDocente = D.Legajo
  LEFT JOIN Alumno A ON U.IdAlumno = A.Matricula
`;

export const findUserByEmail = async (email: string): Promise<AuthUser | undefined> => {
  const result = await pool.request()
    .input('Email', sql.NVarChar, email)
    .query(`${userSelect} WHERE U.Email = @Email;`);
  return result.recordset[0] as AuthUser | undefined;
};

const claimsFromUser = (user: AuthUser, sessionId: string): AccessTokenClaims => ({
  id: user.Id,
  email: user.Email,
  role: user.Rol,
  idAlumno: user.IdAlumno,
  idDocente: user.IdDocente,
  sessionId,
});

const insertRefreshToken = async (request: sql.Request, values: {
  tokenId: string;
  sessionId: string;
  tokenHash: Buffer;
  issuedAt: Date;
  expiresAt: Date;
  accessTokenExpiresAt: Date;
  claimsJson: string;
}): Promise<void> => {
  await request
    .input('TokenId', sql.UniqueIdentifier, values.tokenId)
    .input('SessionId', sql.UniqueIdentifier, values.sessionId)
    .input('TokenHash', sql.VarBinary(32), values.tokenHash)
    .input('IssuedAt', sql.DateTime2, values.issuedAt)
    .input('ExpiresAt', sql.DateTime2, values.expiresAt)
    .input('AccessTokenExpiresAt', sql.DateTime2, values.accessTokenExpiresAt)
    .input('ClaimsJson', sql.NVarChar, values.claimsJson)
    .query(`
      INSERT INTO AuthRefreshToken
        (Id, IdSesion, TokenHash, FechaEmision, FechaExpiracion, AccessTokenExpiraEn, ClaimsJson)
      VALUES
        (@TokenId, @SessionId, @TokenHash, @IssuedAt, @ExpiresAt, @AccessTokenExpiresAt, @ClaimsJson);
    `);
};

export const createSession = async (user: AuthUser): Promise<AuthTokens> => {
  const config = getAuthConfig();
  const now = new Date();
  const sessionExpiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1000);
  const accessExpiresAt = new Date(Math.min(now.getTime() + config.accessTokenTtlSeconds * 1000, sessionExpiresAt.getTime()));
  const sessionId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const refreshToken = createRefreshToken(tokenId);
  const claims = claimsFromUser(user, sessionId);
  const transaction = new sql.Transaction(pool);

  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await transaction.request()
      .input('SessionId', sql.UniqueIdentifier, sessionId)
      .input('UserId', sql.Int, user.Id)
      .input('CreatedAt', sql.DateTime2, now)
      .input('ExpiresAt', sql.DateTime2, sessionExpiresAt)
      .query(`
        INSERT INTO AuthSession (Id, IdUsuario, FechaCreacion, FechaExpiracion, UltimaActividad)
        VALUES (@SessionId, @UserId, @CreatedAt, @ExpiresAt, @CreatedAt);
      `);
    await insertRefreshToken(transaction.request(), {
      tokenId,
      sessionId,
      tokenHash: hashRefreshToken(refreshToken),
      issuedAt: now,
      expiresAt: sessionExpiresAt,
      accessTokenExpiresAt: accessExpiresAt,
      claimsJson: JSON.stringify(claims),
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  return {
    accessToken: issueAccessToken(claims, now, accessExpiresAt).token,
    refreshToken,
    accessTokenExpiresAt: accessExpiresAt,
    refreshTokenExpiresAt: sessionExpiresAt,
    sessionId,
  };
};

interface LockedRefreshRow extends AuthUser {
  TokenId: string;
  IdSesion: string;
  TokenExpiraEn: Date;
  FechaConsumo: Date | null;
  ReemplazadoPor: string | null;
  IdempotencyKey: string | null;
  SessionExpiraEn: Date;
  SessionRevocadaEn: Date | null;
  SessionMotivoRevocacion: string | null;
}

const lockRefreshToken = async (transaction: sql.Transaction, tokenId: string, tokenHash: Buffer): Promise<LockedRefreshRow | undefined> => {
  const result = await transaction.request()
    .input('TokenId', sql.UniqueIdentifier, tokenId)
    .input('TokenHash', sql.VarBinary(32), tokenHash)
    .query(`
      SELECT RT.Id AS TokenId, RT.IdSesion, RT.FechaExpiracion AS TokenExpiraEn,
             RT.FechaConsumo, RT.ReemplazadoPor, RT.IdempotencyKey,
             S.FechaExpiracion AS SessionExpiraEn, S.FechaRevocacion AS SessionRevocadaEn,
             S.MotivoRevocacion AS SessionMotivoRevocacion,
             U.Id, U.Email, U.Rol, U.PasswordHash, U.IdAlumno, U.IdDocente, U.Activo,
             CASE WHEN U.Rol = 'docente' THEN U.IdDocente WHEN U.Rol = 'alumno' THEN U.IdAlumno END AS IdentificadorInstitucional,
             ISNULL(D.Nombre + ' ' + D.Apellido, A.Nombre + ' ' + A.Apellido) AS NombreCompleto,
             CAST(CASE
               WHEN U.Rol = 'admin' THEN 1
               WHEN U.Rol = 'docente' AND D.Legajo IS NOT NULL AND D.Estado = 1 THEN 1
               WHEN U.Rol = 'alumno' AND A.Matricula IS NOT NULL AND A.Estado = 'activo' THEN 1
               ELSE 0
             END AS BIT) AS VinculacionActiva
      FROM AuthRefreshToken RT WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN AuthSession S WITH (UPDLOCK, HOLDLOCK) ON S.Id = RT.IdSesion
      INNER JOIN Usuario U ON U.Id = S.IdUsuario
      LEFT JOIN Docente D ON U.IdDocente = D.Legajo
      LEFT JOIN Alumno A ON U.IdAlumno = A.Matricula
      WHERE RT.Id = @TokenId AND RT.TokenHash = @TokenHash;
    `);
  return result.recordset[0] as LockedRefreshRow | undefined;
};

const rebuildRotatedResult = async (transaction: sql.Transaction, replacementId: string): Promise<AuthTokens> => {
  const result = await transaction.request()
    .input('ReplacementId', sql.UniqueIdentifier, replacementId)
    .query(`
      SELECT RT.Id AS TokenId, RT.IdSesion, RT.FechaEmision, RT.FechaExpiracion,
             RT.AccessTokenExpiraEn, RT.ClaimsJson
      FROM AuthRefreshToken RT WHERE RT.Id = @ReplacementId;
    `);
  const successor = result.recordset[0];
  if (!successor) throw new AuthServiceError(500, 'AUTH_CONTRACT_ERROR', 'No se pudo reconstruir la renovación');
  const claims = JSON.parse(successor.ClaimsJson) as AccessTokenClaims;
  const issuedAt = new Date(successor.FechaEmision);
  const accessExpiresAt = new Date(successor.AccessTokenExpiraEn);
  return {
    accessToken: issueAccessToken(claims, issuedAt, accessExpiresAt).token,
    refreshToken: createRefreshToken(successor.TokenId),
    accessTokenExpiresAt: accessExpiresAt,
    refreshTokenExpiresAt: new Date(successor.FechaExpiracion),
    sessionId: successor.IdSesion,
  };
};

const revokeSession = async (transaction: sql.Transaction, sessionId: string, now: Date, reason: string): Promise<void> => {
  await transaction.request()
    .input('SessionId', sql.UniqueIdentifier, sessionId)
    .input('RevokedAt', sql.DateTime2, now)
    .input('Reason', sql.NVarChar, reason)
    .query(`
      UPDATE AuthSession
      SET FechaRevocacion = COALESCE(FechaRevocacion, @RevokedAt),
          MotivoRevocacion = COALESCE(MotivoRevocacion, @Reason)
      WHERE Id = @SessionId;
    `);
};

export const rotateRefreshToken = async (rawToken: string, idempotencyKey: string): Promise<AuthTokens> => {
  const parsed = parseAndValidateRefreshToken(rawToken);
  if (!parsed) throw new AuthServiceError(401, 'REFRESH_TOKEN_INVALID', 'La sesión no puede renovarse');

  const config = getAuthConfig();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let committed = false;
  try {
    const current = await lockRefreshToken(transaction, parsed.tokenId, parsed.tokenHash);
    if (!current) throw new AuthServiceError(401, 'REFRESH_TOKEN_INVALID', 'La sesión no puede renovarse');

    const now = new Date();
    if (current.SessionRevocadaEn) {
      const code = current.SessionMotivoRevocacion === 'logout' ? 'REFRESH_TOKEN_REVOKED' : 'SESSION_REVOKED';
      throw new AuthServiceError(401, code, 'La sesión no puede renovarse');
    }
    if (new Date(current.TokenExpiraEn).getTime() <= now.getTime() || new Date(current.SessionExpiraEn).getTime() <= now.getTime()) {
      throw new AuthServiceError(401, 'REFRESH_TOKEN_EXPIRED', 'La sesión expiró');
    }

    if (current.FechaConsumo) {
      const storedIdempotencyKey = current.IdempotencyKey?.toLowerCase();
      if (storedIdempotencyKey === idempotencyKey.toLowerCase() && current.ReemplazadoPor) {
        const repeated = await rebuildRotatedResult(transaction, current.ReemplazadoPor);
        await transaction.commit();
        committed = true;
        return repeated;
      }
      const elapsed = now.getTime() - new Date(current.FechaConsumo).getTime();
      if (elapsed <= config.refreshReuseGraceSeconds * 1000) {
        throw new AuthServiceError(409, 'REFRESH_CONFLICT', 'Existe una renovación concurrente en curso');
      }
      await revokeSession(transaction, current.IdSesion, now, 'refresh_reuse');
      await transaction.commit();
      committed = true;
      throw new AuthServiceError(401, 'REFRESH_TOKEN_REUSED', 'Se detectó reutilización de credenciales');
    }

    if (!current.Activo) {
      await revokeSession(transaction, current.IdSesion, now, 'user_inactive');
      await transaction.commit();
      committed = true;
      throw new AuthServiceError(401, 'USER_INACTIVE', 'El usuario no está habilitado');
    }
    if (!current.VinculacionActiva) {
      await revokeSession(transaction, current.IdSesion, now, 'institutional_link_invalid');
      await transaction.commit();
      committed = true;
      throw new AuthServiceError(401, 'SESSION_REVOKED', 'La vinculación institucional ya no es válida');
    }

    const replacementId = crypto.randomUUID();
    const replacementToken = createRefreshToken(replacementId);
    const sessionExpiresAt = new Date(current.SessionExpiraEn);
    const accessExpiresAt = new Date(Math.min(now.getTime() + config.accessTokenTtlSeconds * 1000, sessionExpiresAt.getTime()));
    const claims = claimsFromUser(current, current.IdSesion);

    await insertRefreshToken(transaction.request(), {
      tokenId: replacementId,
      sessionId: current.IdSesion,
      tokenHash: hashRefreshToken(replacementToken),
      issuedAt: now,
      expiresAt: sessionExpiresAt,
      accessTokenExpiresAt: accessExpiresAt,
      claimsJson: JSON.stringify(claims),
    });
    await transaction.request()
      .input('TokenId', sql.UniqueIdentifier, current.TokenId)
      .input('SessionId', sql.UniqueIdentifier, current.IdSesion)
      .input('ConsumedAt', sql.DateTime2, now)
      .input('ReplacementId', sql.UniqueIdentifier, replacementId)
      .input('IdempotencyKey', sql.UniqueIdentifier, idempotencyKey)
      .query(`
        UPDATE AuthRefreshToken
        SET FechaConsumo = @ConsumedAt, ReemplazadoPor = @ReplacementId, IdempotencyKey = @IdempotencyKey
        WHERE Id = @TokenId AND FechaConsumo IS NULL;
        UPDATE AuthSession SET UltimaActividad = @ConsumedAt WHERE Id = @SessionId;
      `);
    await transaction.commit();
    committed = true;
    return {
      accessToken: issueAccessToken(claims, now, accessExpiresAt).token,
      refreshToken: replacementToken,
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: sessionExpiresAt,
      sessionId: current.IdSesion,
    };
  } catch (error) {
    if (!committed) await transaction.rollback();
    throw error;
  }
};

export const revokeByRefreshToken = async (rawToken: string, accessSessionId?: string): Promise<void> => {
  const parsed = parseAndValidateRefreshToken(rawToken);
  if (!parsed) return;
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const current = await lockRefreshToken(transaction, parsed.tokenId, parsed.tokenHash);
    if (!current || (accessSessionId && accessSessionId !== current.IdSesion)) {
      await transaction.commit();
      return;
    }
    await revokeSession(transaction, current.IdSesion, new Date(), 'logout');
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
