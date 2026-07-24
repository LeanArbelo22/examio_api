import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let docenteToken: string;
let alumnoToken: string;
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  docenteToken = jwt.sign({ id: 1, email: 'docente@test.com', role: 'docente' }, process.env.JWT_SECRET);
  alumnoToken = jwt.sign({ id: 2, email: 'alumno@test.com', role: 'alumno', idAlumno: 2, idDocente: null }, process.env.JWT_SECRET);
  app = require('../src/app').app;
});

afterEach(() => {
  jest.clearAllMocks();
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
      .send({ IdPublicacion: 5, IdAlumno: 30500 });

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
      .send({ IdPublicacion: 5, IdAlumno: 30500 });

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

    const body = { IdPublicacion: 5, IdAlumno: 30500 };
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
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ IdIntento: 1, IdPregunta: 10, IdOpcionNueva: 3 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Respuesta guardada');
  });

  it('retorna 400 con datos inválidos', async () => {
    const res = await request(app)
      .post('/api/intentos/guardar-respuesta')
      .set('Authorization', `Bearer ${alumnoToken}`)
      .send({ IdPregunta: 10 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('reintentar el mismo texto actualiza la respuesta existente sin insertar otra fila', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ recordset: [{ Id: 9 }] })
      .mockResolvedValueOnce({});

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
    const statements = (reqBuilder.query as jest.Mock).mock.calls.map(([statement]) => statement);
    expect(statements.filter((statement) => String(statement).startsWith('INSERT INTO Respuesta'))).toHaveLength(1);
    expect(statements.filter((statement) => String(statement).startsWith('UPDATE Respuesta'))).toHaveLength(1);
  });
});

describe('POST /api/intentos/:id/finalizar', () => {
  it('retorna 200 al finalizar examen', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [{ Id: 1, Estado: 'entregado', NotaFinal: 8.00 }],
    });

    const res = await request(app)
      .post('/api/intentos/1/finalizar')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].estado).toBe('entregado');
  });

  it('un reintento técnico de finalización conserva el mismo estado terminal', async () => {
    const reqBuilder = mock.pool.request();
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
        recordset: [
          {
            IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc',
            GrupoConceptualmente: 'SQL Básico',
            IdOpcion: 1, OpcionTexto: 'DDL', EsCorrecta: true,
            IdRespuesta: 1, RtaTexto: null,
            FueSeleccionada: 1,
          },
          {
            IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc',
            GrupoConceptualmente: 'SQL Básico',
            IdOpcion: 2, OpcionTexto: 'DML', EsCorrecta: false,
            IdRespuesta: 1, RtaTexto: null,
            FueSeleccionada: 0,
          },
          {
            IdPregunta: 11, Enunciado: 'Explique normalización', Tipo: 'abierta',
            GrupoConceptualmente: 'Diseño BD',
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
    expect(res.body.data.preguntas).toHaveLength(2);
    expect(res.body.data.preguntas[0].idPregunta).toBe(10);
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
        recordset: [],
      });

    const res = await request(app)
      .get('/api/intentos/1/completo')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PUT /api/intentos/:idIntento/calificar', () => {
  it('retorna 200 al asignar nota a intento entregado', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'entregado' }] })
      .mockResolvedValueOnce({});

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 7.5 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Nota asignada correctamente');
  });

  it('retorna 200 al calificar intento vencido', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'vencido' }] })
      .mockResolvedValueOnce({});

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 4.00 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retorna 200 al calificar intento anulado', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'anulado' }] })
      .mockResolvedValueOnce({});

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 2.50 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retorna 400 cuando el intento está en progreso', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'en_progreso' }] });

    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 8.00 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('No se puede calificar un examen que aún está en progreso.');
  });

  it('retorna 404 cuando el intento no existe', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/intentos/999/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 6.00 });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Intento no encontrado');
  });

  it('retorna 400 con nota que excede el rango (11)', async () => {
    const res = await request(app)
      .put('/api/intentos/1/calificar')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ notaFinal: 11 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Datos inválidos');
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
  it('retorna 200 al corregir respuesta exitosamente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({
        recordset: [{ Estado: 'entregado' }],
      })
      .mockResolvedValueOnce({
        rowsAffected: [1],
      });

    const res = await request(app)
      .put('/api/intentos/1/preguntas/10/corregir')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ esCorrecta: true, comentariosDocente: 'Muy bien!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Respuesta corregida correctamente');
  });

  it('retorna 400 cuando el intento está en progreso', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Estado: 'en_progreso' }],
    });

    const res = await request(app)
      .put('/api/intentos/1/preguntas/10/corregir')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ esCorrecta: true });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
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
