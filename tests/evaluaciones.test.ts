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
  docenteToken = jwt.sign({ id: 1, email: 'lfernandez@test.com', role: 'docente' }, process.env.JWT_SECRET);
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
  FechaInicio: '2026-06-15T10:00:00Z',
  FechaFin: '2026-06-15T12:00:00Z',
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
    (txRequest.execute as jest.Mock).mockResolvedValueOnce({ recordset: [{ IdActividad: 42 }] });
    (txRequest.query as jest.Mock)
      .mockResolvedValueOnce({})                  // INSERT Publicacion
      .mockResolvedValueOnce({ recordset: [{ Id: 10 }] })  // INSERT GrupoPregunta
      .mockResolvedValueOnce({ recordset: [{ Id: 100 }] }) // INSERT Pregunta
      .mockResolvedValueOnce({});                 // INSERT Opcion

    const res = await request(app)
      .post('/api/evaluaciones/guardar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send(payloadValido);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ idActividad: 42 });
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
            RecursosPermitidos: null, IdPublicacion: 5,
            FechaInicio: new Date('2026-06-15T10:00:00Z'),
            FechaFin: new Date('2026-06-15T12:00:00Z'),
            Materia: 'Bases de Datos I', Division: '1NMS',
          },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [
          { IdGrupo: 1, TituloReferencia: 'SQL Básico', IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc', IdOpcion: 1, Texto: 'DDL', EsCorrecta: true },
          { IdGrupo: 1, TituloReferencia: 'SQL Básico', IdPregunta: 10, Enunciado: '¿Qué es SQL?', Tipo: 'mc', IdOpcion: 2, Texto: 'DML', EsCorrecta: false },
        ],
      });

    const res = await request(app)
      .get('/api/evaluaciones/5/detalle')
      .set('Authorization', `Bearer ${docenteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.idPublicacion).toBe(5);
    expect(res.body.data.titulo).toBe('Parcial I');
    expect(res.body.data.grupos).toHaveLength(1);
    expect(res.body.data.grupos[0].tituloReferencia).toBe('SQL Básico');
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
    FechaInicio: '2026-06-16T10:00:00Z',
    FechaFin: '2026-06-16T12:00:00Z',
    IdPublicacion: 5,
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
    (mockReq.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{ Id: 1, Estado: 'borrador' }],
    });

    const tx = new mock.pool.Transaction();
    const txRequest = tx.request();
    (txRequest.query as jest.Mock)
      .mockResolvedValueOnce({})                   // UPDATE Actividad
      .mockResolvedValueOnce({})                   // UPDATE Publicacion
      .mockResolvedValueOnce({ recordset: [{ Id: 10 }] })  // SELECT grupos
      .mockResolvedValueOnce({ recordset: [{ Id: 100 }] }) // SELECT preguntas grupo 10
      .mockResolvedValueOnce({ recordset: [{ Id: 1 }, { Id: 2 }] }) // SELECT opciones pregunta 100
      .mockResolvedValueOnce({})                   // UPDATE GrupoPregunta
      .mockResolvedValueOnce({})                   // UPDATE Pregunta
      .mockResolvedValueOnce({})                   // DELETE Opcion id=2
      .mockResolvedValueOnce({})                   // UPDATE Opcion id=1
      .mockResolvedValueOnce({ recordset: [{ Id: 200 }] }); // INSERT new Opcion

    const res = await request(app)
      .put('/api/evaluaciones/1/modificar-completo')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Evaluación modificada correctamente');
    expect(mockReq.query).toHaveBeenCalledTimes(1);
    expect(txRequest.query).toHaveBeenCalledTimes(10);
  });

  it('retorna 400 si la actividad no está en borrador', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [{ Id: 1, Estado: 'publicada' }],
    });

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
