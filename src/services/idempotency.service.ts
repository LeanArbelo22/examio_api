import crypto from 'crypto';
import { ActorBanco, BancoError, DbBanco, consultar } from './banco-common.service';

type IdempotencyRecord = {
  Id: number;
  RequestHash: string;
  Estado: 'en_progreso' | 'completada';
  ResultadoJson: string | null;
  StatusHttp: number | null;
};

export type IdempotencyStart =
  | { replay: false; id: number }
  | { replay: true; id: number; result: unknown; status: number };

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export function requestHash(payload: unknown): string {
  return crypto.createHash('sha256').update(canonical(payload), 'utf8').digest('hex');
}

function actorKey(actor: ActorBanco): string {
  const identity = actor.id ?? actor.idDocente;
  if (!identity) throw new BancoError(403, 'No se pudo identificar al actor', 'FORBIDDEN');
  return `${actor.role}:${identity}`;
}

export async function iniciarIdempotencia(
  db: DbBanco,
  actor: ActorBanco,
  operation: string,
  key: string,
  payload: unknown,
): Promise<IdempotencyStart> {
  const actorValue = actorKey(actor);
  const hash = requestHash(payload);
  const existing = (await consultar(db, `SELECT Id,RequestHash,Estado,ResultadoJson,StatusHttp
    FROM dbo.OperacionIdempotente WITH (UPDLOCK,HOLDLOCK)
    WHERE Actor=@Actor AND Operacion=@Operacion AND Clave=@Clave`,
    { Actor: actorValue, Operacion: operation, Clave: key })).recordset[0] as IdempotencyRecord | undefined;

  if (existing) {
    if (existing.RequestHash.toLowerCase() !== hash)
      throw new BancoError(409, 'Idempotency-Key ya fue utilizada con otro payload', 'IDEMPOTENCY_KEY_REUSED');
    if (existing.Estado !== 'completada' || !existing.ResultadoJson || !existing.StatusHttp)
      throw new BancoError(409, 'La operación idempotente continúa en progreso', 'IDEMPOTENCY_OPERATION_IN_PROGRESS');
    return { replay: true, id: existing.Id, result: JSON.parse(existing.ResultadoJson), status: existing.StatusHttp };
  }

  const inserted = await consultar(db, `INSERT INTO dbo.OperacionIdempotente
    (Actor,Operacion,Clave,RequestHash,Estado,FechaCreacion,FechaActualizacion)
    OUTPUT inserted.Id VALUES(@Actor,@Operacion,@Clave,@Hash,'en_progreso',SYSUTCDATETIME(),SYSUTCDATETIME())`,
    { Actor: actorValue, Operacion: operation, Clave: key, Hash: hash });
  return { replay: false, id: inserted.recordset[0].Id };
}

export async function completarIdempotencia(
  db: DbBanco,
  id: number,
  result: unknown,
  status: number,
) {
  const json = JSON.stringify(result);
  await consultar(db, `UPDATE dbo.OperacionIdempotente SET Estado='completada',ResultadoJson=@Resultado,
    StatusHttp=@Status,FechaActualizacion=SYSUTCDATETIME(),FechaExpiracion=DATEADD(DAY,7,SYSUTCDATETIME()) WHERE Id=@Id`,
    { Id: id, Resultado: json, Status: status });
}
