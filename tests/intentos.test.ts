import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let docenteToken: string;
let alumnoToken: string;
const ultimaTransaccion = () => mock.pool.Transaction.mock.results.at(-1)!.value;
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  docenteToken = jwt.sign({ id: 1, email: 'docente@test.com', role: 'docente', idDocente: 10, idAlumno: null }, process.env.JWT_SECRET);
  alumnoToken = jwt.sign({ id: 2, email: 'alumno@test.com', role: 'alumno', idAlumno: 2, idDocente: null }, process.env.JWT_SECRET);
  app = require('../src/app').app;
});

afterEach(() => {
  jest.clearAllMocks();
  mock.transactionRequest.query.mockReset().mockResolvedValue({ recordset: [] });
  mock.transactionRequest.input.mockReset().mockReturnThis();
});

const scopeIntento = (overrides: Record<string, unknown> = {}) => ({
  IdIntento: 1,
  Estado: 'entregado',
  EscalaCalificacion: 10,
  NotaAprobacion: 4,
  IdDocente: 10,
  DocenteActivo: true,
  NotaFinal: null,
  NotaFinalManual: null,
  ...overrides,
});

const scopePregunta = (overrides: Record<string, unknown> = {}) => ({
  ...scopeIntento(),
  IdIntentoPregunta: 100,
  PuntajeMaximoSnapshot: 2,
  PuntajeMaximoGrupo: 2,
  PosicionGrupo: 1,
  TotalGrupos: 5,
  ...overrides,
});

const scopeGuardar = (overrides: Record<string, unknown> = {}) => ({
  IdIntentoPregunta: 100,
  IdAlumno: 2,
  Estado: 'en_progreso',
  Tipo: 'mc',
  ModoJustificacion: 'sin_justificacion',
  IdRespuesta: null,
  RtaTexto: null,
  Justificacion: null,
  Revision: 0,
  ...overrides,
});

describe('POST /api/intentos/iniciar', () => {
  it('retorna 200 con data del intento creado', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{ IntentosRealizados: 0, CantidadIntentosMaximos: 3 }],
    });
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [{ Id: 1, Estado: 'en_progreso' }],
    });

    const res = await request(app)
      .post('/api/intentos/iniciar')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ IdPublicacion: 5, IdAlumno: 2 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].id).toBe(1);
  });

  it('retorna 403 cuando se supera el límite de intentos', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{ IntentosRealizados: 3, CantidadIntentosMaximos: 3 }],
    });

    const res = await request(app)
      .post('/api/intentos/iniciar')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ IdPublicacion: 5, IdAlumno: 2 });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('límite máximo');
  });

  it('retorna 400 con datos inválidos', async () => {
    const res = await request(app)
      .post('/api/intentos/iniciar')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ IdPublicacion: 'no-numero' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('un reintento técnico reutiliza el intento en progreso devuelto por el SP', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ IntentosRealizados: 0, CantidadIntentosMaximos: 3 }] })
      .mockResolvedValueOnce({ recordset: [{ IntentosRealizados: 1, CantidadIntentosMaximos: 3 }] });
    (reqBuilder.execute as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'en_progreso' }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'en_progreso' }] });

    const body = { IdPublicacion: 5, IdAlumno: 2 };
    const first = await request(app)
      .post('/api/intentos/iniciar')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send(body);
    const retry = await request(app)
      .post('/api/intentos/iniciar')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send(body);

    expect(retry.body).toEqual(first.body);
    expect(reqBuilder.execute).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/intentos/guardar-respuesta', () => {
  it('retorna 200 al guardar opción', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeGuardar()] })
      .mockResolvedValueOnce({ recordset: [{ IdOpcion: 3 }] })
      .mockResolvedValueOnce({ recordset: [{ IdRespuesta: 9 }] });

    const res = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ IdIntento: 1, IdPregunta: 10, IdOpcionNueva: 3 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Respuesta guardada');
    expect(res.body.data).toMatchObject({
      idRespuesta: 9,
      idsOpcionesSeleccionadas: [3],
      revision: 1,
      replay: false,
    });
  });

  it('retorna 400 con datos inválidos', async () => {
    const res = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ IdPregunta: 10 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('reintentar el mismo texto legacy no crea otra revisión', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeGuardar({ Tipo: 'abierta' })] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ IdRespuesta: 9 }] })
      .mockResolvedValueOnce({ recordset: [scopeGuardar({
        Tipo: 'abierta', IdRespuesta: 9, RtaTexto: 'Respuesta preservada', Revision: 1,
      })] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const body = { IdIntento: 1, IdPregunta: 10, RtaTexto: 'Respuesta preservada' };
    const first = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send(body);
    const retry = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send(body);

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(first.body.data.revision).toBe(1);
    expect(retry.body.data).toMatchObject({ revision: 1, replay: true });
    const mutations = mock.transactionRequest.query.mock.calls
      .filter(([statement]) => String(statement).includes('DECLARE @RespuestaId'));
    expect(mutations).toHaveLength(1);
  });

  it('guarda selección múltiple y justificación con idempotencia por EventoId', async () => {
    const eventoId = '00000000-0000-4000-8000-000000000101';
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeGuardar({ Tipo: 'multiple', ModoJustificacion: 'obligatoria' })] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ IdOpcion: 3 }, { IdOpcion: 4 }, { IdOpcion: 5 }] })
      .mockResolvedValueOnce({ recordset: [{ IdRespuesta: 10 }] });

    const res = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({
        IdIntento: 1,
        IdPregunta: 10,
        IdOpcionesSeleccionadas: [5, 3],
        Justificacion: 'Ambas condiciones se cumplen.',
        RevisionEsperada: 0,
        EventoId: eventoId,
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      idsOpcionesSeleccionadas: [3, 5],
      justificacion: 'Ambas condiciones se cumplen.',
      revision: 1,
    });
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('EventoId', expect.anything(), eventoId);
    expect(mock.transactionRequest.query.mock.calls.at(-1)?.[0]).toContain('HistorialRespuestaCambio');
  });

  it('rechaza una revisión obsoleta sin modificar la respuesta', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeGuardar({
        Tipo: 'multiple', ModoJustificacion: 'opcional', IdRespuesta: 9, Revision: 2,
      })] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({
        IdIntento: 1, IdPregunta: 10, IdOpcionesSeleccionadas: [],
        RevisionEsperada: 1, EventoId: '00000000-0000-4000-8000-000000000102',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RESPONSE_REVISION_CONFLICT');
    expect(ultimaTransaccion().rollback).toHaveBeenCalled();
  });

  it('reproduce un EventoId idéntico aunque el intento ya haya sido entregado', async () => {
    const contenido = JSON.stringify({
      idsOpcionesSeleccionadas: [3, 5], rtaTexto: null, justificacion: 'Fundamento',
    });
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeGuardar({
        Tipo: 'multiple', ModoJustificacion: 'obligatoria', Estado: 'entregado',
        IdRespuesta: 10, Revision: 1,
      })] })
      .mockResolvedValueOnce({ recordset: [{
        IdRespuesta: 10, RevisionAnterior: 0, RevisionNueva: 1,
        RespuestaAnteriorJson: JSON.stringify({ idsOpcionesSeleccionadas: [], rtaTexto: null, justificacion: null }),
        RespuestaNuevaJson: contenido,
      }] });

    const res = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({
        IdIntento: 1, IdPregunta: 10, IdOpcionesSeleccionadas: [5, 3],
        Justificacion: 'Fundamento', RevisionEsperada: 0,
        EventoId: '00000000-0000-4000-8000-000000000103',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ revision: 1, replay: true, idsOpcionesSeleccionadas: [3, 5] });
    expect(ultimaTransaccion().commit).toHaveBeenCalled();
  });

  it('impide que un alumno guarde en un intento ajeno', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [scopeGuardar({ IdAlumno: 99 })] });
    const res = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ IdIntento: 1, IdPregunta: 10, IdOpcionNueva: 3 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_SCOPE_FORBIDDEN');
    expect(ultimaTransaccion().rollback).toHaveBeenCalled();
  });
});

describe('POST /api/intentos/:id/finalizar', () => {
  it('retorna 200 al finalizar examen', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{ IdIntento: 1, IdAlumno: 2, Estado: 'en_progreso' }],
    });
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [{
        Id: 1, Estado: 'entregado', NotaFinal: 8.00,
        CorreccionConfirmada: true, OrigenConfirmacionCorreccion: 'automatica',
      }],
    });

    const res = await request(app)
      .post('/api/intentos/1/finalizar')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].estado).toBe('entregado');
    expect(res.body.data[0]).toMatchObject({
      correccionConfirmada: true,
      origenConfirmacionCorreccion: 'automatica',
    });
  });

  it('un reintento técnico de finalización conserva el mismo estado terminal', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1, IdAlumno: 2, Estado: 'en_progreso' }] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1, IdAlumno: 2, Estado: 'entregado' }] });
    (reqBuilder.execute as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'entregado', NotaFinal: 8.00 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'entregado', NotaFinal: 8.00 }] });

    const first = await request(app)
      .post('/api/intentos/1/finalizar')
      .set('Authorization', `Bearer ${alumnoToken}`);
    const retry = await request(app)
      .post('/api/intentos/1/finalizar')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(retry.body).toEqual(first.body);
    expect(reqBuilder.execute).toHaveBeenCalledTimes(2);
  });

  it('mantiene el intento en progreso cuando falta una justificación obligatoria', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{ IdIntento: 1, IdAlumno: 2, Estado: 'en_progreso' }],
    });
    (reqBuilder.execute as jest.Mock).mockRejectedValueOnce({ number: 51320 });

    const res = await request(app)
      .post('/api/intentos/1/finalizar')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REQUIRED_JUSTIFICATION_MISSING');
  });
});

describe('GET /api/intentos/alumno/:idAlumno', () => {
  it('retorna 200 con historial del alumno', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        { Id: 1, IdAlumno: 30500, IdPublicacion: 5, Estado: 'entregado' },
      ],
    });

    const res = await request(app)
      .get('/api/intentos/alumno/30500')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].estado).toBe('entregado');
  });
});

describe('GET /api/intentos/:idIntento/completo', () => {
  it('retorna 200 con el intento completo (preguntas + respuestas + opciones)', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({
        recordset: [
          {
            IdIntento: 1, IdAlumno: 30500, IdPublicacion: 5, Estado: 'entregado',
            NotaFinal: null, NotaAutomatica: 2.00, NotaFinalCalculada: null, NotaFinalManual: null,
            FechaInicio: new Date('2026-06-15T10:00:00Z'),
            FechaFin: new Date('2026-06-15T11:30:00Z'),
            NumeroIntento: 1,
            Nombre: 'Julieta', Apellido: 'Acosta', Correo: 'jacosta@test.com',
            TituloEvaluacion: 'Parcial I', TipoEvaluacion: 'evaluacion', DuracionMinutos: 120,
            EscalaCalificacion: 10, NotaAprobacion: 4,
            IdDocente: 10, DocenteActivo: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [
          {
            IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc',
            GrupoConceptualmente: 'SQL Básico',
            PuntajeMaximoSnapshot: 2, PuntajeObtenido: 2, OrigenCorreccion: 'automatica',
            ComentariosCorreccion: null, CorregidoPor: null,
            FechaCorreccion: new Date('2026-06-15T11:30:00Z'),
            IdOpcion: 1, OpcionTexto: 'DDL', EsCorrecta: true,
            IdRespuesta: 1, RtaTexto: null,
            FueSeleccionada: 1,
          },
          {
            IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc',
            GrupoConceptualmente: 'SQL Básico',
            PuntajeMaximoSnapshot: 2, PuntajeObtenido: 2, OrigenCorreccion: 'automatica',
            ComentariosCorreccion: null, CorregidoPor: null,
            FechaCorreccion: new Date('2026-06-15T11:30:00Z'),
            IdOpcion: 2, OpcionTexto: 'DML', EsCorrecta: false,
            IdRespuesta: 1, RtaTexto: null,
            FueSeleccionada: 0,
          },
          {
            IdPregunta: 11, Enunciado: 'Explique normalización', Tipo: 'abierta',
            GrupoConceptualmente: 'Diseño BD',
            PuntajeMaximoSnapshot: 2, PuntajeObtenido: null, OrigenCorreccion: null,
            ComentariosCorreccion: null, CorregidoPor: null, FechaCorreccion: null,
            IdOpcion: null, OpcionTexto: null, EsCorrecta: null,
            IdRespuesta: 2, RtaTexto: 'Es un proceso para evitar redundancia',
            FueSeleccionada: 0,
          },
        ],
      });

    const res = await request(app)
      .get('/api/intentos/1/completo')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.idIntento).toBe(1);
    expect(res.body.data.nombre).toBe('Julieta');
    expect(res.body.data.tituloEvaluacion).toBe('Parcial I');
    expect(res.body.data).toMatchObject({ escalaCalificacion: 10, notaAprobacion: 4, notaFinalCalculada: null });
    expect(res.body.data.preguntas).toHaveLength(2);
    expect(res.body.data.preguntas[0].idPregunta).toBe(10);
    expect(res.body.data.preguntas[0]).toMatchObject({
      puntajeMaximo: 2,
      puntajeObtenido: 2,
      origenCorreccion: 'automatica',
    });
    expect(res.body.data.preguntas[0].respuesta).toBeDefined();
    expect(res.body.data.preguntas[0].respuesta.rtaTexto).toBeNull();
    expect(res.body.data.preguntas[0].opciones).toHaveLength(2);
    expect(res.body.data.preguntas[0].opciones[0]).toEqual({
      idOpcion: 1,
      texto: 'DDL',
      esCorrecta: true,
      fueSeleccionada: true,
    });
    expect(res.body.data.preguntas[0].opciones[1]).toEqual({
      idOpcion: 2,
      texto: 'DML',
      esCorrecta: false,
      fueSeleccionada: false,
    });
    expect(res.body.data.preguntas[1].idPregunta).toBe(11);
    expect(res.body.data.preguntas[1].tipo).toBe('abierta');
    expect(res.body.data.preguntas[1].opciones).toHaveLength(0);
    expect(res.body.data.preguntas[1].respuesta).toBeDefined();
    expect(res.body.data.preguntas[1].respuesta.rtaTexto).toBe('Es un proceso para evitar redundancia');
  });

  it('retorna 404 cuando el intento no existe', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/intentos/999/completo')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Intento no encontrado');
  });

  it('retorna 401 sin token de autenticación', async () => {
    const res = await request(app)
      .get('/api/intentos/1/completo');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('retorna 403 cuando el intento pertenece a otra comisión docente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{
        IdIntento: 1, IdAlumno: 30500, IdPublicacion: 5, Estado: 'entregado',
        IdDocente: 99, DocenteActivo: true,
      }],
    });

    const res = await request(app)
      .get('/api/intentos/1/completo')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_SCOPE_FORBIDDEN');
    expect(reqBuilder.query).toHaveBeenCalledTimes(1);
  });

  it('retorna 403 cuando alumno intenta ver intento de otro alumno', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          IdIntento: 1, IdAlumno: 30500, IdPublicacion: 5, Estado: 'entregado',
          NotaFinal: null, NotaAutomatica: 8.00,
          FechaInicio: new Date('2026-06-15T10:00:00Z'),
          FechaFin: new Date('2026-06-15T11:30:00Z'),
          NumeroIntento: 1,
          Nombre: 'Julieta', Apellido: 'Acosta', Correo: 'jacosta@test.com',
          TituloEvaluacion: 'Parcial I', TipoEvaluacion: 'evaluacion', DuracionMinutos: 120,
        },
      ],
    });

    const res = await request(app)
      .get('/api/intentos/1/completo')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Acceso denegado. No tienes permisos para ver la radiografía de este intento.');
  });

  it('retorna 200 cuando alumno ve su propio intento (id coincide)', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({
        recordset: [
          {
            IdIntento: 1, IdAlumno: 2, IdPublicacion: 5, Estado: 'entregado',
            CorreccionConfirmada: true,
            NotaFinal: null, NotaAutomatica: 8.00,
            FechaInicio: new Date('2026-06-15T10:00:00Z'),
            FechaFin: new Date('2026-06-15T11:30:00Z'),
            NumeroIntento: 1,
            Nombre: 'Julieta', Apellido: 'Acosta', Correo: 'jacosta@test.com',
            TituloEvaluacion: 'Parcial I', TipoEvaluacion: 'evaluacion', DuracionMinutos: 120,
          },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [{
          IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc',
          PuntajeMaximoSnapshot: 2, PuntajeObtenido: 2,
          IdOpcion: 1, OpcionTexto: 'Lenguaje de consulta', EsCorrecta: true,
          FueSeleccionada: 1, IdRespuesta: 1, RtaTexto: null,
        }],
      });

    const res = await request(app)
      .get('/api/intentos/1/completo')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ correccionConfirmada: true, correccionPendiente: false, revisionDisponible: true });
    expect(res.body.data.preguntas[0].opciones[0]).toMatchObject({
      esCorrecta: true,
      fueSeleccionada: true,
    });
  });

  it('no expone el contenido al alumno antes de confirmar la corrección', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{
        IdIntento: 1, IdAlumno: 2, IdPublicacion: 5, Estado: 'entregado',
        CorreccionConfirmada: false, IdDocente: 10, DocenteActivo: true,
      }],
    });

    const res = await request(app)
      .get('/api/intentos/1/completo')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REVIEW_NOT_AVAILABLE');
    expect(reqBuilder.query).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/intentos/:idIntento/anular-por-incidente/:eventoId', () => {
  const eventoId = '00000000-0000-4000-8000-000000000401';
  const scope = (overrides: Record<string, unknown> = {}) => ({
    IdIntento: 1, IdAlumno: 2, Estado: 'en_progreso', IdDocente: 10,
    DocenteActivo: true, CorreccionConfirmada: false, PendientesCorreccion: 2,
    ...overrides,
  });

  it('anula autoritativamente el intento y conserva una auditoría vinculada al evento', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scope()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ Id: 9, Tipo: 'focus_lost' }] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 1, EventoId: eventoId, TipoIncidente: 'focus_lost',
        Motivo: 'POLICY_FIRST_FOCUS_LOSS', Estado: 'anulado', Replay: false,
      }] });

    const res = await request(app)
      .put(`/api/intentos/1/anular-por-incidente/${eventoId}`)
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      idIntento: 1, eventoId, estado: 'anulado', replay: false,
      motivo: 'POLICY_FIRST_FOCUS_LOSS',
    });
    const sqlText = mock.transactionRequest.query.mock.calls[3][0];
    expect(sqlText).toContain("Estado='anulado'");
    expect(sqlText).toContain('NotaFinal=NULL');
    expect(sqlText).toContain('INSERT INTO dbo.AnulacionIntentoIncidente');
    expect(sqlText).not.toContain('DELETE FROM dbo.Respuesta');
  });

  it('devuelve el mismo resultado ante replay del EventoId', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scope({ Estado: 'anulado' })] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 1, EventoId: eventoId, TipoIncidente: 'focus_lost',
        Motivo: 'POLICY_FIRST_FOCUS_LOSS', AnuladoPor: 2,
      }] });

    const res = await request(app)
      .put(`/api/intentos/1/anular-por-incidente/${eventoId}`)
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ estado: 'anulado', replay: true, eventoId });
    expect(mock.transactionRequest.query).toHaveBeenCalledTimes(2);
  });

  it('rechaza anular un intento perteneciente a otro alumno', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [scope({ IdAlumno: 99 })] });
    const res = await request(app)
      .put(`/api/intentos/1/anular-por-incidente/${eventoId}`)
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_SCOPE_FORBIDDEN');
  });

  it('exige un incidente elegible ya registrado', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scope()] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });
    const res = await request(app)
      .put(`/api/intentos/1/anular-por-incidente/${eventoId}`)
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INCIDENT_EVENT_NOT_ELIGIBLE');
  });
});

describe('PUT /api/intentos/:idIntento/confirmar-correccion', () => {
  const scope = (overrides: Record<string, unknown> = {}) => ({
    IdIntento: 1, IdAlumno: 2, Estado: 'entregado', IdDocente: 10,
    DocenteActivo: true, CorreccionConfirmada: false, PendientesCorreccion: 0,
    ...overrides,
  });

  it('confirma y audita una corrección completa', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scope()] })
      .mockResolvedValueOnce({ recordset: [{
        IdIntento: 1, CorreccionPendiente: false, CorreccionConfirmada: true,
        CorreccionConfirmadaPor: 1, OrigenConfirmacionCorreccion: 'manual',
        RevisionDisponible: true, Replay: false,
      }] });

    const res = await request(app)
      .put('/api/intentos/1/confirmar-correccion')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      correccionPendiente: false, correccionConfirmada: true,
      revisionDisponible: true, replay: false,
    });
    expect(mock.transactionRequest.query.mock.calls[1][0]).toContain('HistorialEstadoCorreccionIntento');
  });

  it('es idempotente cuando la corrección ya estaba confirmada', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [scope({
      CorreccionConfirmada: true, CorreccionConfirmadaPor: 1,
      FechaCorreccionConfirmada: new Date(), OrigenConfirmacionCorreccion: 'manual',
    })] });
    const res = await request(app)
      .put('/api/intentos/1/confirmar-correccion')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ correccionConfirmada: true, replay: true });
    expect(mock.transactionRequest.query).toHaveBeenCalledTimes(1);
  });

  it('rechaza confirmar mientras exista una pregunta sin puntaje definitivo', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [scope({ PendientesCorreccion: 1 })] });
    const res = await request(app)
      .put('/api/intentos/1/confirmar-correccion')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CORRECTION_INCOMPLETE');
  });

  it('respeta el alcance de comisión del docente', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [scope({ IdDocente: 99 })] });
    const res = await request(app)
      .put('/api/intentos/1/confirmar-correccion')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_SCOPE_FORBIDDEN');
  });
});

describe('PUT /api/intentos/:idIntento/calificar', () => {
  it('retorna 200 al asignar nota a intento entregado', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeIntento()] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1, NotaFinal: 7.5, NotaFinalManual: 7.5, EscalaCalificacion: 10 }] });

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 7.5 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Nota asignada correctamente');
    expect(res.body.data.notaFinalManual).toBe(7.5);
    const sqlText = mock.transactionRequest.query.mock.calls[1][0];
    expect(sqlText).toContain('HistorialNotaIntento');
    expect(sqlText).toContain('NotaFinalManual = @NotaFinal');
    expect(sqlText).toContain('reapertura_nota');
  });

  it('retorna 200 al calificar intento vencido', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeIntento({ Estado: 'vencido' })] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1, NotaFinal: 4, NotaFinalManual: 4, EscalaCalificacion: 10 }] });

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 4.00 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retorna 200 al calificar intento anulado', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeIntento({ Estado: 'anulado' })] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1, NotaFinal: 2.5, NotaFinalManual: 2.5, EscalaCalificacion: 10 }] });

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 2.50 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retorna 400 cuando el intento está en progreso', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeIntento({ Estado: 'en_progreso' })] });

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 8.00 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('No se puede calificar un examen que aún está en progreso.');
    expect(res.body.code).toBe('ATTEMPT_NOT_DELIVERED');
  });

  it('retorna 404 cuando el intento no existe', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/intentos/999/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 6.00 });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Intento no encontrado');
  });

  it('retorna 400 con nota que excede la escala real (11 sobre 10)', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [scopeIntento()] });
    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 11 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('FINAL_GRADE_OUT_OF_RANGE');
  });

  it('acepta y audita 100.00 en una evaluación con escala 100', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopeIntento({ EscalaCalificacion: 100, NotaAprobacion: 40 })] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1, NotaFinal: 100, NotaFinalManual: 100, EscalaCalificacion: 100 }] });

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 100 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ notaFinal: 100, notaFinalManual: 100, escalaCalificacion: 100 });
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('NotaFinal', expect.anything(), 100);
  });

  it('retorna 400 con nota con más de 2 decimales', async () => {
    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 7.543 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('retorna 401 sin token de autenticación', async () => {
    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .send({ notaFinal: 5.00 });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('retorna 403 con rol alumno', async () => {
    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ notaFinal: 5.00 });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/intentos/:idIntento/preguntas/:idPregunta/corregir', () => {
  it('mantiene esCorrecta y lo traduce al puntaje máximo', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopePregunta()] })
      .mockResolvedValueOnce({
        recordset: [{
          IdIntento: 1, IdPregunta: 10, PuntajeMaximoSnapshot: 2, PuntajeObtenido: 2,
          OrigenCorreccion: 'manual', ComentariosDocente: 'Muy bien!', NotaFinalCalculada: 10,
        }],
      });

    const res = await request(app)
      .put('/api/intentos/1/preguntas/10/corregir')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ esCorrecta: true, comentariosDocente: 'Muy bien!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Respuesta corregida correctamente');
    expect(res.body.data).toMatchObject({ puntajeMaximoSnapshot: 2, puntajeObtenido: 2, origenCorreccion: 'manual' });
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('PuntajeObtenido', expect.anything(), 2);
  });

  it('retorna 400 cuando el intento está en progreso', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({
        recordset: [scopePregunta({ Estado: 'en_progreso' })],
    });

    const res = await request(app)
      .put('/api/intentos/1/preguntas/10/corregir')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ esCorrecta: true });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('ATTEMPT_NOT_DELIVERED');
  });

  it('permite modificar una corrección automática con puntaje parcial y la audita', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopePregunta()] })
      .mockResolvedValueOnce({
        recordset: [{
          IdIntento: 1, IdPregunta: 10, PuntajeMaximoSnapshot: 2, PuntajeObtenido: 1.5,
          OrigenCorreccion: 'manual', ComentariosDocente: 'Parcial', NotaFinalCalculada: 9.5,
        }],
      });

    const res = await request(app)
      .put('/api/intentos/1/preguntas/10/corregir')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ puntajeObtenido: 1.5, comentariosDocente: 'Parcial' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ puntajeObtenido: 1.5, origenCorreccion: 'manual' });
    const sqlText = mock.transactionRequest.query.mock.calls[1][0];
    expect(sqlText).toContain('HistorialCorreccionIntentoPregunta');
    expect(sqlText).toContain("OrigenCorreccion = 'manual'");
    expect(sqlText).toContain('UPDATE dbo.Respuesta');
    expect(sqlText).toContain('reapertura_pregunta');
  });

  it('corrige una pregunta omitida porque opera sobre IntentoPregunta', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [scopePregunta({ PuntajeMaximoSnapshot: 3 })] })
      .mockResolvedValueOnce({ recordset: [{ IdIntento: 1, IdPregunta: 10, PuntajeObtenido: 0, OrigenCorreccion: 'manual' }] });

    const res = await request(app)
      .put('/api/intentos/1/preguntas/10/corregir')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ puntajeObtenido: 0, comentariosDocente: 'Sin respuesta' });

    expect(res.status).toBe(200);
    expect(mock.transactionRequest.query.mock.calls[0][0]).toContain('LEFT JOIN dbo.IntentoPregunta');
    expect(mock.transactionRequest.query.mock.calls[1][0]).toContain('UPDATE dbo.IntentoPregunta');
  });

  it('rechaza un puntaje superior al máximo de la pregunta', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [scopePregunta({ PuntajeMaximoSnapshot: 2 })] });

    const res = await request(app)
      .put('/api/intentos/1/preguntas/10/corregir')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ puntajeObtenido: 2.01 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('QUESTION_SCORE_OUT_OF_RANGE');
    const transaction = (mock.pool.Transaction as jest.Mock).mock.results.at(-1)?.value;
    expect(transaction.rollback).toHaveBeenCalled();
  });

  it('impide corregir un intento de otra comisión', async () => {
    mock.transactionRequest.query.mockResolvedValueOnce({ recordset: [scopePregunta({ IdDocente: 99 })] });

    const res = await request(app)
      .put('/api/intentos/1/preguntas/10/corregir')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ puntajeObtenido: 1 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_SCOPE_FORBIDDEN');
  });
});

describe('GET /api/intentos/alumno/:idAlumno/detallados', () => {
  it('retorna 200 con intentos enriquecidos en camelCase', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          IdIntento: 1, IdAlumno: 30500, IdPublicacion: 5, Estado: 'entregado',
          NotaFinal: null, NotaAutomatica: 8.00,
          FechaInicio: new Date('2026-06-15T10:00:00Z'),
          FechaFin: new Date('2026-06-15T11:30:00Z'),
          NumeroIntento: 1,
          TituloEvaluacion: 'Parcial I', TipoEvaluacion: 'evaluacion',
          DuracionMinutos: 120,
          Materia: 'Bases de Datos I', Division: '1NMS',
        },
      ],
    });

    const res = await request(app)
      .get('/api/intentos/alumno/30500/detallados')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({
      idIntento: 1,
      idAlumno: 30500,
      idPublicacion: 5,
      estado: 'entregado',
      notaFinal: null,
      notaAutomatica: 8.00,
      fechaInicio: expect.any(String),
      fechaFin: expect.any(String),
      numeroIntento: 1,
      tituloEvaluacion: 'Parcial I',
      tipoEvaluacion: 'evaluacion',
      duracionMinutos: 120,
      materia: 'Bases de Datos I',
      division: '1NMS',
    });
  });

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .get('/api/intentos/alumno/30500/detallados');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/intentos/alumno/:idAlumno/historial-corregido', () => {
  it('retorna 200 solo con intentos con NotaFinal en camelCase', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          IdIntento: 1,
          TituloEvaluacion: 'Parcial I',
          Materia: 'Bases de Datos I',
          Division: '1NMS',
          FechaFin: new Date('2026-06-15T11:30:00Z'),
          NotaFinal: 8.00,
          NumeroIntento: 1,
        },
      ],
    });

    const res = await request(app)
      .get('/api/intentos/alumno/30500/historial-corregido')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({
      idIntento: 1,
      tituloEvaluacion: 'Parcial I',
      materia: 'Bases de Datos I',
      division: '1NMS',
      fechaFin: expect.any(String),
      notaFinal: 8.00,
      numeroIntento: 1,
    });
  });

  it('retorna 200 con array vacío si no hay corregidos', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/intentos/alumno/30500/historial-corregido')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .get('/api/intentos/alumno/30500/historial-corregido');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
