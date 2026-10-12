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
  docenteToken = jwt.sign({ id: 1, email: 'lfernandez@test.com', role: 'docente', idDocente: 10 }, process.env.JWT_SECRET);
  alumnoToken = jwt.sign({ id: 2, email: 'jalumno@test.com', role: 'alumno' }, process.env.JWT_SECRET);
  app = require('../src/app').app;
});

afterEach(() => {
  jest.clearAllMocks();
});

const payloadValido = {
  Titulo: 'Parcial I - Base de Datos',
  Descripcion: 'Evaluación de SQL y Normalización',
  Tipo: 'evaluacion',
  CantidadIntentosMaximos: 2,
  DuracionMinutos: 120,
  RecursosPermitidos: 'Hoja de fórmulas',
  IdMateriaDivision: 1,
  FechaInicio: '2030-06-15T10:00:00Z',
  FechaFin: '2030-06-15T12:00:00Z',
  GruposPreguntas: [
    {
      TituloReferencia: 'SQL Básico',
      Variantes: [
        {
          Enunciado: '¿Qué comando SELECT es correcto?',
          Tipo: 'mc',
          Opciones: [
            { Texto: 'SELECT * FROM users', EsCorrecta: true },
            { Texto: 'SELECT all FROM users', EsCorrecta: false },
          ],
        },
      ],
    },
  ],
};

describe('POST /api/evaluaciones/guardar-completo', () => {
  it('retorna 201 con { success, data: { idActividad } }', async () => {
    const tx = new mock.pool.Transaction();
    const txRequest = tx.request();
    (txRequest.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [] })   // idempotencia: no existe
      .mockResolvedValueOnce({ recordset: [{ Id: 900 }] }) // reserva idempotente
      .mockResolvedValueOnce({ recordset: [{ Id: 1, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 42, Revision: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 5 }] })  // INSERT Publicacion
      .mockResolvedValueOnce({ recordset: [{ Id: 10 }] })  // INSERT GrupoPregunta
      .mockResolvedValueOnce({ recordset: [{ Id: 100 }] }) // INSERT Pregunta
      .mockResolvedValueOnce({})                  // INSERT Opcion 1
      .mockResolvedValueOnce({})                  // INSERT Opcion 2
      .mockResolvedValueOnce({ recordset: [{ Estado: 'borrador', CantidadIntentosMaximos: 2, DuracionMinutos: 120,
        FechaInicio: '2030-06-15T10:00:00Z', FechaFin: '2030-06-15T12:00:00Z' }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 10, TituloReferencia: 'SQL Básico' }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 100, Enunciado: '¿Qué comando SELECT es correcto?', Tipo: 'mc' }] })
      .mockResolvedValueOnce({ recordset: payloadValido.GruposPreguntas[0].Variantes[0].Opciones })
      .mockResolvedValueOnce({ recordset: [{ Revision: 2 }] }) // publica
      .mockResolvedValueOnce({});                 // completa idempotencia

    const res = await request(app)
      .post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000001')
      .send(payloadValido);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ idActividad: 42, idPublicacion: 5, estado: 'publicada', revision: 2, importaciones: [] });
    expect(res.body.message).toBeUndefined();
  });

  it('retorna 400 cuando faltan campos obligatorios (Titulo vacío)', async () => {
    const res = await request(app)
      .post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ Tipo: 'evaluacion' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Datos inválidos');
  });

  it('retorna 400 con Tipo inválido', async () => {
    const res = await request(app)
      .post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ ...payloadValido, Tipo: 'examen_final' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('retorna 401 sin token de autenticación', async () => {
    const res = await request(app)
      .post('/api/evaluaciones/guardar-completo')
      .send(payloadValido);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('retorna 400 cuando Tipo=mc sin Opciones', async () => {
    const res = await request(app)
      .post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({
        ...payloadValido,
        GruposPreguntas: [
          {
            TituloReferencia: 'SQL Básico',
            Variantes: [
              { Enunciado: 'Pregunta sin opciones', Tipo: 'mc' },
            ],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('retorna 400 cuando Tipo=abierta con Opciones', async () => {
    const res = await request(app)
      .post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({
        ...payloadValido,
        GruposPreguntas: [
          {
            TituloReferencia: 'Desarrollo',
            Variantes: [
              {
                Enunciado: 'Pregunta de desarrollo',
                Tipo: 'abierta',
                Opciones: [{ Texto: 'opción inválida', EsCorrecta: false }],
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('borradores reales', () => {
  const prepararCreacion = (estructura: boolean) => {
    const tx = new mock.pool.Transaction();
    const respuestas: any[] = [
      { recordset: [] }, { recordset: [{ Id: 901 }] },
      { recordset: [{ Id: 1, IdDocente: 10, DocenteActivo: true }] },
      { recordset: [{ Id: 50, Revision: 1 }] }, { recordset: [{ Id: 60 }] },
    ];
    if (estructura) respuestas.push({ recordset: [{ Id: 70 }] }, { recordset: [{ Id: 80 }] });
    respuestas.push({ recordset: [] });
    (tx.request().query as jest.Mock).mockImplementation(() => Promise.resolve(respuestas.shift() ?? { recordset: [] }));
  };

  it('crea sin grupos y aplica defaults server-side', async () => {
    prepararCreacion(false);
    const res = await request(app).post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000010')
      .send({ Titulo: 'Borrador mínimo', IdMateriaDivision: 1, Estado: 'borrador' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      idActividad: 50, idPublicacion: 60, estado: 'borrador', revision: 1, importaciones: [],
      escalaCalificacion: 10, notaAprobacion: 4, modoPuntaje: 'iguales',
      mostrarPuntajePorPregunta: false, correccionAutomaticaCerradas: true,
    });
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Intentos', expect.anything(), 1);
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Duracion', expect.anything(), 90);
  });

  it('admite una mc incompleta dentro del borrador', async () => {
    prepararCreacion(true);
    const res = await request(app).post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000011')
      .send({ Titulo: 'Borrador incompleto', IdMateriaDivision: 1, Estado: 'borrador', GruposPreguntas: [
        { TituloReferencia: '', Variantes: [{ Enunciado: '', Tipo: 'mc', Opciones: [] }] },
      ] });
    expect(res.status).toBe(201); expect(res.body.data.revision).toBe(1);
  });

  it('aplica umbral 40 por defecto al crear un borrador sobre escala 100', async () => {
    prepararCreacion(false);
    const res = await request(app).post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000012')
      .send({ Titulo: 'Borrador sobre 100', IdMateriaDivision: 1, Estado: 'borrador', EscalaCalificacion: 100 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ escalaCalificacion: 100, notaAprobacion: 40 });
  });
});

describe('POST /api/evaluaciones/:idActividad/publicar-completo', () => {
  const publicarPayload = {
    ...payloadValido,
    IdPublicacion: 5,
    RevisionEsperada: 1,
    GuardarTodoEnBanco: false,
  };

  function prepararPublicacion(opciones: { gruposPublicables?: boolean; revision?: number } = {}) {
    const tx = new mock.pool.Transaction();
    const query = tx.request().query as jest.Mock;
    const gruposPublicables = opciones.gruposPublicables ?? true;
    const respuestas: any[] = [
      { recordset: [] }, { recordset: [{ Id: 902 }] },
      { recordset: [{ Id: 42, Estado: 'borrador', Revision: opciones.revision ?? 1 }] },
      { recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] }, { recordset: [] },
    ];
    if ((opciones.revision ?? 1) === 1) respuestas.push(
      { recordset: [{ Id: 1, IdDocente: 10, DocenteActivo: true }] },
      { recordset: [] }, { recordset: [] }, { recordset: [] },
      { recordset: [{ Id: 10 }] }, { recordset: [{ Id: 100 }] }, { recordset: [] }, { recordset: [] },
      { recordset: [{ Estado: 'borrador', CantidadIntentosMaximos: 2, DuracionMinutos: 120,
        FechaInicio: '2030-06-15T10:00:00Z', FechaFin: '2030-06-15T12:00:00Z' }] },
      { recordset: gruposPublicables ? [{ Id: 10, TituloReferencia: 'SQL Básico' }] : [] },
    );
    if ((opciones.revision ?? 1) === 1 && gruposPublicables) respuestas.push(
      { recordset: [{ Id: 100, Enunciado: '¿Qué comando SELECT es correcto?', Tipo: 'mc' }] },
      { recordset: payloadValido.GruposPreguntas[0].Variantes[0].Opciones },
      { recordset: [{ Revision: 2 }] }, { recordset: [] },
    );
    query.mockImplementation(() => Promise.resolve(respuestas.shift() ?? { recordset: [] }));
    return tx;
  }

  it('publica una estructura válida sin crear recursos de banco', async () => {
    const tx = prepararPublicacion();
    const res = await request(app).post('/api/evaluaciones/42/publicar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000020')
      .send(publicarPayload);
    expect(res.status).toBe(200); expect(res.body.data).toMatchObject({ estado: 'publicada', revision: 2, banco: [] });
    expect((tx.request().query as jest.Mock).mock.calls.some(([sql]) => String(sql).includes('INSERT INTO dbo.BancoPregunta'))).toBe(false);
    expect(ultimaTransaccion().commit).toHaveBeenCalled();
  });

  it('revierte si la estructura final no es publicable', async () => {
    const tx = prepararPublicacion({ gruposPublicables: false });
    const res = await request(app).post('/api/evaluaciones/42/publicar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000021')
      .send(publicarPayload);
    expect(res.status).toBe(400); expect(res.body.code).toBe('DRAFT_NOT_PUBLISHABLE');
    expect(ultimaTransaccion().rollback).toHaveBeenCalled(); expect(ultimaTransaccion().commit).not.toHaveBeenCalled();
  });

  it('rechaza una revisión obsoleta sin sobrescribir', async () => {
    const tx = prepararPublicacion({ revision: 2 });
    const res = await request(app).post('/api/evaluaciones/42/publicar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000022')
      .send(publicarPayload);
    expect(res.status).toBe(409); expect(res.body.code).toBe('DRAFT_REVISION_CONFLICT');
    expect(ultimaTransaccion().rollback).toHaveBeenCalled();
  });

  it('reproduce una publicación completada sin ejecutar escrituras', async () => {
    const tx = new mock.pool.Transaction();
    (tx.request().query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{
        Id: 99, RequestHash: require('../src/services/idempotency.service').requestHash(
          require('../src/schemas/evaluacion.schema').PublicarActividadSchema.parse(publicarPayload)),
        Estado: 'completada', ResultadoJson: JSON.stringify({ IdActividad: 42, IdPublicacion: 5, Estado: 'publicada', Revision: 2, Importaciones: [], Banco: [] }),
        StatusHttp: 200,
      }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 42, Estado: 'publicada', Revision: 2 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] });
    const res = await request(app).post('/api/evaluaciones/42/publicar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000023')
      .send(publicarPayload);
    expect(res.status).toBe(200); expect(res.body.data.revision).toBe(2);
    expect(tx.request().query).toHaveBeenCalledTimes(3); expect(ultimaTransaccion().commit).toHaveBeenCalled();
  });
});

describe('GET /api/evaluaciones/publicacion/:id', () => {
  it('retorna 200 con publicación en camelCase', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          IdPublicacion: 5,
          Titulo: 'Parcial I',
          Descripcion: 'SQL',
          DuracionMinutos: 120,
          FechaInicio: new Date('2026-06-15T10:00:00Z'),
          FechaFin: new Date('2026-06-15T12:00:00Z'),
          RecursosPermitidos: null,
          Materia: 'Bases de Datos I',
          Carrera: 'Analista de Sistemas',
          Docente: 'Laura Fernandez',
          GruposCount: 3,
        },
      ],
    });

    const res = await request(app)
      .get('/api/evaluaciones/publicacion/5')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.idPublicacion).toBe(5);
    expect(res.body.data.titulo).toBe('Parcial I');
    expect(res.body.data.materia).toBe('Bases de Datos I');
    expect(res.body.data.docente).toBe('Laura Fernandez');
    expect(res.body.data.gruposCount).toBe(3);
  });

  it('retorna 404 cuando la publicación no existe', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/evaluaciones/publicacion/999')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Publicación no encontrada');
  });
});

describe('GET /api/evaluaciones/pendientes/:matricula', () => {
  it('retorna 200 con flags correctos — sin intentos previos', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          IdPublicacion: 5,
          Titulo: 'Parcial I',
          Descripcion: 'SQL',
          DuracionMinutos: 120,
          FechaInicio: new Date('2026-06-15T10:00:00Z'),
          FechaFin: new Date('2026-06-15T12:00:00Z'),
          RecursosPermitidos: null,
          CantidadIntentosMaximos: 3,
          Materia: 'Bases de Datos I',
          Carrera: 'Analista de Sistemas',
          Docente: 'Laura Fernandez',
          EstadoUltimoIntento: null,
          IntentosRealizados: 0,
        },
      ],
    });

    const res = await request(app)
      .get('/api/evaluaciones/pendientes/30500')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].idPublicacion).toBe(5);
    expect(res.body.data[0].titulo).toBe('Parcial I');
    expect(res.body.data[0].materia).toBe('Bases de Datos I');
    expect(res.body.data[0].cantidadIntentosMaximos).toBe(3);
    expect(res.body.data[0].intentosRealizados).toBe(0);
    expect(res.body.data[0].estadoUltimoIntento).toBeNull();
    expect(res.body.data[0].enProgreso).toBe(false);
    expect(res.body.data[0].puedeReintentar).toBe(true);
    expect(res.body.data[0].intentosAgotados).toBe(false);
  });

  it('retorna flags correctos — intento en progreso', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          IdPublicacion: 5,
          Titulo: 'Parcial I',
          Descripcion: 'SQL',
          DuracionMinutos: 120,
          FechaInicio: new Date('2026-06-15T10:00:00Z'),
          FechaFin: new Date('2026-06-15T12:00:00Z'),
          RecursosPermitidos: null,
          CantidadIntentosMaximos: 3,
          Materia: 'Bases de Datos I',
          Carrera: 'Analista de Sistemas',
          Docente: 'Laura Fernandez',
          EstadoUltimoIntento: 'en_progreso',
          IntentosRealizados: 1,
        },
      ],
    });

    const res = await request(app)
      .get('/api/evaluaciones/pendientes/30500')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.body.data[0].estadoUltimoIntento).toBe('en_progreso');
    expect(res.body.data[0].enProgreso).toBe(true);
    expect(res.body.data[0].puedeReintentar).toBe(false);
    expect(res.body.data[0].intentosAgotados).toBe(false);
  });

  it('retorna flags correctos — intentos agotados', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          IdPublicacion: 5,
          Titulo: 'Parcial I',
          Descripcion: 'SQL',
          DuracionMinutos: 120,
          FechaInicio: new Date('2026-06-15T10:00:00Z'),
          FechaFin: new Date('2026-06-15T12:00:00Z'),
          RecursosPermitidos: null,
          CantidadIntentosMaximos: 2,
          Materia: 'Bases de Datos I',
          Carrera: 'Analista de Sistemas',
          Docente: 'Laura Fernandez',
          EstadoUltimoIntento: 'entregado',
          IntentosRealizados: 2,
        },
      ],
    });

    const res = await request(app)
      .get('/api/evaluaciones/pendientes/30500')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.body.data[0].estadoUltimoIntento).toBe('entregado');
    expect(res.body.data[0].enProgreso).toBe(false);
    expect(res.body.data[0].puedeReintentar).toBe(false);
    expect(res.body.data[0].intentosAgotados).toBe(true);
  });

  it('retorna flags correctos — entregado pero puede reintentar', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          IdPublicacion: 5,
          Titulo: 'Parcial I',
          Descripcion: 'SQL',
          DuracionMinutos: 120,
          FechaInicio: new Date('2026-06-15T10:00:00Z'),
          FechaFin: new Date('2026-06-15T12:00:00Z'),
          RecursosPermitidos: null,
          CantidadIntentosMaximos: 3,
          Materia: 'Bases de Datos I',
          Carrera: 'Analista de Sistemas',
          Docente: 'Laura Fernandez',
          EstadoUltimoIntento: 'entregado',
          IntentosRealizados: 1,
        },
      ],
    });

    const res = await request(app)
      .get('/api/evaluaciones/pendientes/30500')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.body.data[0].estadoUltimoIntento).toBe('entregado');
    expect(res.body.data[0].enProgreso).toBe(false);
    expect(res.body.data[0].puedeReintentar).toBe(true);
    expect(res.body.data[0].intentosAgotados).toBe(false);
  });
});

describe('GET /api/evaluaciones/intento/:idIntento/renderizar', () => {
  it('retorna 200 con preguntas sorteadas en camelCase', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [
        { IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc', GrupoConceptualmente: 'SQL Básico' },
        { IdPregunta: 20, Enunciado: '¿Normalización 3FN?', Tipo: 'vf', GrupoConceptualmente: 'Diseño BD' },
      ],
    });

    const res = await request(app)
      .get('/api/evaluaciones/intento/1/renderizar')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({
      idPregunta: 10,
      enunciado: '¿Qué es SQL?',
      tipo: 'mc',
      grupoConceptualmente: 'SQL Básico',
    });
    expect(res.body.data[1].idPregunta).toBe(20);
  });

  it('devuelve puntajeMaximo únicamente cuando la actividad lo habilita', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [{
        IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc', GrupoConceptualmente: 'SQL',
        PuntajeMaximo: 3.34, MostrarPuntajePorPregunta: true,
      }],
    });
    const visible = await request(app).get('/api/evaluaciones/intento/1/renderizar')
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(visible.body.data[0]).toMatchObject({ puntajeMaximo: 3.34 });
    expect(visible.body.data[0].mostrarPuntajePorPregunta).toBeUndefined();

    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [{
        IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc', GrupoConceptualmente: 'SQL',
        PuntajeMaximo: 3.34, MostrarPuntajePorPregunta: false,
      }],
    });
    const oculto = await request(app).get('/api/evaluaciones/intento/1/renderizar')
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(oculto.body.data[0].puntajeMaximo).toBeUndefined();
  });
});

describe('GET /api/evaluaciones/pregunta/:idPregunta/opciones/:idIntento', () => {
  it('retorna 200 con opciones en camelCase', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [
        { IdOpcion: 1, Texto: 'SELECT * FROM users', EsCorrecta: true, FueSeleccionada: 1 },
        { IdOpcion: 2, Texto: 'SELECT all FROM users', EsCorrecta: false, FueSeleccionada: 0 },
      ],
    });

    const res = await request(app)
      .get('/api/evaluaciones/pregunta/10/opciones/1')
      .set('Authorization', `Bearer ${alumnoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toEqual({
      idOpcion: 1,
      texto: 'SELECT * FROM users',
      esCorrecta: true,
      fueSeleccionada: 1,
    });
  });
});

describe('GET /api/evaluaciones/:id/detalle', () => {
  it('retorna 200 con estructura completa del examen', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock)
      .mockResolvedValueOnce({
        recordset: [
          {
            IdActividad: 42, Titulo: 'Parcial I', Descripcion: 'SQL', Tipo: 'evaluacion',
            DuracionMinutos: 120, CantidadIntentosMaximos: 2, Estado: 'publicada',
            EscalaCalificacion: 10, NotaAprobacion: 4, ModoPuntaje: 'iguales',
            MostrarPuntajePorPregunta: false, CorreccionAutomaticaCerradas: true,
            RecursosPermitidos: null, IdPublicacion: 5,
            FechaInicio: new Date('2026-06-15T10:00:00Z'),
            FechaFin: new Date('2026-06-15T12:00:00Z'),
            Materia: 'Bases de Datos I', Division: '1NMS',
          },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [
          { IdGrupo: 1, TituloReferencia: 'SQL Básico', PuntajeMaximo: 10, IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc', IdOpcion: 1, Texto: 'DDL', EsCorrecta: true },
          { IdGrupo: 1, TituloReferencia: 'SQL Básico', PuntajeMaximo: 10, IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc', IdOpcion: 2, Texto: 'DML', EsCorrecta: false },
        ],
      });

    const res = await request(app)
      .get('/api/evaluaciones/5/detalle')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.idPublicacion).toBe(5);
    expect(res.body.data.titulo).toBe('Parcial I');
    expect(res.body.data).toMatchObject({ escalaCalificacion: 10, notaAprobacion: 4, modoPuntaje: 'iguales' });
    expect(res.body.data.grupos).toHaveLength(1);
    expect(res.body.data.grupos[0].tituloReferencia).toBe('SQL Básico');
    expect(res.body.data.grupos[0].puntajeMaximo).toBe(10);
    expect(res.body.data.grupos[0].preguntas).toHaveLength(1);
    expect(res.body.data.grupos[0].preguntas[0].idPregunta).toBe(10);
    expect(res.body.data.grupos[0].preguntas[0].opciones).toHaveLength(2);
  });

  it('retorna 404 cuando la publicación no existe', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/evaluaciones/999/detalle')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Publicación no encontrada');
  });

  it('retorna 401 sin token de autenticación', async () => {
    const res = await request(app)
      .get('/api/evaluaciones/5/detalle');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/evaluaciones/:id/modificar-completo', () => {
  const updatePayload = {
    Titulo: 'Parcial I - Base de Datos (Modificado)',
    Descripcion: 'Versión actualizada',
    Tipo: 'evaluacion',
    CantidadIntentosMaximos: 3,
    DuracionMinutos: 90,
    IdMateriaDivision: 1,
    FechaInicio: '2030-06-16T10:00:00Z',
    FechaFin: '2030-06-16T12:00:00Z',
    IdPublicacion: 5,
    RevisionEsperada: 1,
    GruposPreguntas: [
      {
        Id: 10,
        TituloReferencia: 'SQL Avanzado',
        Variantes: [
          {
            Id: 100,
            Enunciado: '¿Qué es un JOIN?',
            Tipo: 'mc',
            Opciones: [
              { Id: 1, Texto: 'Combina tablas', EsCorrecta: true },
              { Texto: 'Nueva opción', EsCorrecta: false },
            ],
          },
        ],
      },
    ],
  };

  it('retorna 200 modificando textos, fecha y eliminando una opción', async () => {
    const mockReq = mock.pool.request();

    const tx = new mock.pool.Transaction();
    const txRequest = tx.request();
    (txRequest.query as jest.Mock)
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'borrador', Revision: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({ recordset: [] }) // sin intentos
      .mockResolvedValueOnce({ recordset: [{ Id: 1, IdDocente: 10, DocenteActivo: true }] })
      .mockResolvedValueOnce({})                   // UPDATE Actividad
      .mockResolvedValueOnce({})                   // UPDATE Publicacion
      .mockResolvedValueOnce({ recordset: [{ Id: 10, IdBancoGrupoOrigen: 20, RevisionBancoOrigen: 3 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 100, IdBancoPreguntaOrigen: 30, RevisionBancoOrigen: 4 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 1 }, { Id: 2 }] }) // SELECT opciones pregunta 100
      .mockResolvedValueOnce({})                   // DELETE estructura
      .mockResolvedValueOnce({ recordset: [{ Id: 10 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 100 }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ recordset: [{ Revision: 2 }] });

    const res = await request(app)
      .put('/api/evaluaciones/1/modificar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Evaluación modificada correctamente');
    expect(mockReq.query).not.toHaveBeenCalled();
    expect(txRequest.query).toHaveBeenCalledTimes(15);
    const sqlEjecutado = (txRequest.query as jest.Mock).mock.calls.map(([sql]) => String(sql));
    expect(sqlEjecutado.some(sql => sql.startsWith('UPDATE dbo.GrupoPregunta'))).toBe(true);
    expect(sqlEjecutado.some(sql => sql.startsWith('UPDATE dbo.Pregunta'))).toBe(true);
    expect(sqlEjecutado.some(sql => sql.startsWith('INSERT INTO dbo.GrupoPregunta'))).toBe(false);
    expect(sqlEjecutado.some(sql => sql.startsWith('INSERT INTO dbo.Pregunta'))).toBe(false);
    expect(sqlEjecutado.find(sql => sql.startsWith('UPDATE dbo.GrupoPregunta'))).toContain('COALESCE(IdBancoGrupoOrigen,@Banco)');
    expect(sqlEjecutado.find(sql => sql.startsWith('UPDATE dbo.Pregunta'))).toContain('COALESCE(IdBancoPreguntaOrigen,@Banco)');
  });

  it('retorna 400 si la actividad no está en borrador', async () => {
    mock.transactionRequest.query
      .mockResolvedValueOnce({ recordset: [{ Id: 1, Estado: 'publicada', Revision: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ Id: 5, IdDocente: 10, DocenteActivo: true }] });

    const res = await request(app)
      .put('/api/evaluaciones/1/modificar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send(updatePayload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('No se puede modificar una evaluación que ya ha sido publicada o archivada.');
  });
});

describe('GET /api/evaluaciones/:id/alumnos', () => {
  it('retorna 200 con alumnos inscriptos y estado de intento', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        {
          Matricula: 30500, Nombre: 'Julieta', Apellido: 'Acosta', Correo: 'jacosta@test.com',
          IdIntento: 1, EstadoIntento: 'entregado', NotaFinal: null, NotaAutomatica: 8.00,
          FechaInicioIntento: new Date('2026-06-15T10:00:00Z'),
          FechaFinIntento: new Date('2026-06-15T11:30:00Z'),
          NumeroIntento: 1, CantidadIntentosMaximos: 2,
        },
        {
          Matricula: 30531, Nombre: 'Santiago', Apellido: 'Benitez', Correo: 'sbenitez@test.com',
          IdIntento: null, EstadoIntento: null, NotaFinal: null, NotaAutomatica: null,
          FechaInicioIntento: null, FechaFinIntento: null,
          NumeroIntento: null, CantidadIntentosMaximos: 2,
        },
      ],
    });

    const res = await request(app)
      .get('/api/evaluaciones/5/alumnos')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].matricula).toBe(30500);
    expect(res.body.data[0].estadoIntento).toBe('entregado');
    expect(res.body.data[0].intentosAgotados).toBe(false);
    expect(res.body.data[1].matricula).toBe(30531);
    expect(res.body.data[1].estadoIntento).toBeNull();
    expect(res.body.data[1].intentosAgotados).toBe(false);
  });

  it('retorna 401 sin token de autenticación', async () => {
    const res = await request(app)
      .get('/api/evaluaciones/5/alumnos');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
