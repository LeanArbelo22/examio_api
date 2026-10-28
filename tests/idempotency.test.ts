const consultar = jest.fn();
jest.mock('../src/services/banco-common.service', () => ({
  BancoError: class BancoError extends Error {
    constructor(public status: number, message: string, public code?: string) { super(message); }
  },
  consultar,
}));

const { requestHash, iniciarIdempotencia, completarIdempotencia } = require('../src/services/idempotency.service');
const db = { request: jest.fn() };
const actor = { id: 7, role: 'docente', idDocente: 100 };

beforeEach(() => jest.clearAllMocks());

it('calcula un hash determinista independiente del orden de las propiedades', () => {
  expect(requestHash({ b: 2, a: { d: 4, c: 3 } })).toBe(requestHash({ a: { c: 3, d: 4 }, b: 2 }));
});

it('reproduce el resultado persistido para el mismo actor, operación, clave y body', async () => {
  const body = { Titulo: 'Borrador' };
  consultar.mockResolvedValueOnce({ recordset: [{ Id: 1, RequestHash: requestHash(body), Estado: 'completada',
    ResultadoJson: JSON.stringify({ IdActividad: 5, Revision: 1 }), StatusHttp: 201 }] });
  await expect(iniciarIdempotencia(db, actor, 'evaluacion.crear', '00000000-0000-4000-8000-000000000001', body))
    .resolves.toEqual({ replay: true, id: 1, result: { IdActividad: 5, Revision: 1 }, status: 201 });
});

it('distingue reutilización con otro payload y operación todavía en progreso', async () => {
  consultar.mockResolvedValueOnce({ recordset: [{ Id: 1, RequestHash: requestHash({ a: 1 }), Estado: 'completada',
    ResultadoJson: '{}', StatusHttp: 201 }] });
  await expect(iniciarIdempotencia(db, actor, 'banco.crear', '00000000-0000-4000-8000-000000000002', { a: 2 }))
    .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  consultar.mockResolvedValueOnce({ recordset: [{ Id: 2, RequestHash: requestHash({ a: 1 }), Estado: 'en_progreso',
    ResultadoJson: null, StatusHttp: null }] });
  await expect(iniciarIdempotencia(db, actor, 'banco.crear', '00000000-0000-4000-8000-000000000003', { a: 1 }))
    .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_OPERATION_IN_PROGRESS' });
});

it('reserva y completa sin persistir el payload académico', async () => {
  consultar.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [{ Id: 8 }] }).mockResolvedValueOnce({ recordset: [] });
  const start = await iniciarIdempotencia(db, actor, 'banco.crear', '00000000-0000-4000-8000-000000000004',
    { Enunciado: 'contenido sensible', Opciones: ['secreta'] });
  expect(start).toEqual({ replay: false, id: 8 });
  expect(consultar.mock.calls[0][2]).toEqual(expect.objectContaining({ Actor: 'docente:7', Operacion: 'banco.crear' }));
  await completarIdempotencia(db, 8, { Id: 20, Revision: 1 }, 201);
  expect(consultar.mock.calls[1][2]).toEqual(expect.objectContaining({ Hash: expect.any(String) }));
  expect(JSON.stringify(consultar.mock.calls[1][2])).not.toContain('contenido sensible');
  expect(consultar.mock.calls[2][2]).toEqual(expect.objectContaining({ Resultado: JSON.stringify({ Id: 20, Revision: 1 }) }));
});
