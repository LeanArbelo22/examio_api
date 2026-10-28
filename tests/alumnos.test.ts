import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let adminToken: string;
let docenteToken: string;
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  adminToken = jwt.sign({ id: 1, email: 'admin@test.com', role: 'admin' }, process.env.JWT_SECRET);
  docenteToken = jwt.sign({ id: 2, email: 'docente@test.com', role: 'docente' }, process.env.JWT_SECRET);
  app = require('../src/app').app;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/alumnos', () => {
  it('retorna 200 con array de alumnos en camelCase', async () => {
    (mock.pool.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        { Matricula: 30500, Nombre: 'Julieta', Apellido: 'Acosta', Cuil: '27305001123', Correo: 'jacosta@cervantes.edu.ar', Estado: 'activo' },
        { Matricula: 30531, Nombre: 'Santiago', Apellido: 'Benitez', Cuil: '20305014567', Correo: 'sbenitez@cervantes.edu.ar', Estado: 'activo' },
      ],
    });

    const res = await request(app)
      .get('/api/alumnos')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({
      matricula: 30500,
      nombre: 'Julieta',
      apellido: 'Acosta',
      cuil: '27305001123',
      correo: 'jacosta@cervantes.edu.ar',
      estado: 'activo',
    });
    expect(res.body.data[1]).toEqual({
      matricula: 30531,
      nombre: 'Santiago',
      apellido: 'Benitez',
      cuil: '20305014567',
      correo: 'sbenitez@cervantes.edu.ar',
      estado: 'activo',
    });
  });

  it('retorna 401 sin token de autenticación', async () => {
    const res = await request(app).get('/api/alumnos');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Acceso no autorizado');
  });
});

describe('GET /api/alumnos/:matricula', () => {
  it('retorna 200 con un alumno en camelCase', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [{ Matricula: 30500, Nombre: 'Julieta', Apellido: 'Acosta', Cuil: '27305001123', Correo: 'jacosta@cervantes.edu.ar', Estado: 'activo' }],
    });

    const res = await request(app)
      .get('/api/alumnos/30500')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      matricula: 30500,
      nombre: 'Julieta',
      apellido: 'Acosta',
      cuil: '27305001123',
      correo: 'jacosta@cervantes.edu.ar',
      estado: 'activo',
    });
  });

  it('retorna 404 cuando el alumno no existe', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/alumnos/99999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Alumno no encontrado');
  });
});

describe('POST /api/alumnos', () => {
  it('retorna 201 al crear alumno exitosamente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/alumnos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ Matricula: 30999, Nombre: 'Test', Apellido: 'User', Cuil: '20309999999', Correo: 'test@cervantes.edu.ar' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Alumno creado correctamente');
  });

  it('retorna 400 cuando falla la validación Zod (Correo inválido)', async () => {
    const res = await request(app)
      .post('/api/alumnos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ Matricula: 30999, Nombre: 'Test', Apellido: 'User', Correo: 'email-invalido' });



    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Datos inválidos');
    expect(res.body.errors).toBeDefined();
  });

  it('retorna 400 cuando falta campo obligatorio (Nombre)', async () => {
    const res = await request(app)
      .post('/api/alumnos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ Matricula: 30999, Apellido: 'User', Correo: 'test@test.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/alumnos/:matricula', () => {
  it('retorna 200 al actualizar alumno exitosamente', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/alumnos/30500')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ Nombre: 'Julieta Updated', Apellido: 'Acosta', Correo: 'jacosta@cervantes.edu.ar' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Alumno actualizado correctamente');
  });
});

describe('DELETE /api/alumnos/:matricula', () => {
  it('retorna 200 al dar de baja un alumno', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .delete('/api/alumnos/30500')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Alumno dado de baja');
  });
});

describe('GET /api/alumnos/:matricula/materias', () => {
  it('retorna 200 con materias del alumno en camelCase', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
      recordset: [
        { NombreAlumno: 'Julieta Acosta', Materia: 'Bases de Datos I', Division: '1NMS' },
      ],
    });

    const res = await request(app)
      .get('/api/alumnos/30500/materias')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toEqual({
      nombreAlumno: 'Julieta Acosta',
      materia: 'Bases de Datos I',
      division: '1NMS',
    });
  });
});

describe('POST /api/alumnos/:matricula/inscripciones', () => {
  const activeStudent = { recordset: [{ Estado: 'activo' }] };
  const activeCommission = { recordset: [{ Id: 15, MateriaActiva: true }] };
  const noEnrollment = { recordset: [] };
  const existingEnrollment = { recordset: [{ IdAlumno: 30999, IdMateriaDivision: 15 }] };

  beforeEach(() => {
    (mock.transactionRequest.query as jest.Mock).mockReset();
    (mock.transactionRequest.execute as jest.Mock).mockReset().mockResolvedValue({ recordset: [] });
  });

  const prepareQueries = (
    student = activeStudent,
    commission = activeCommission,
    enrollment = noEnrollment
  ) => {
    (mock.transactionRequest.query as jest.Mock)
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(commission)
      .mockResolvedValueOnce(enrollment);
  };

  it('crea la inscripción con una transacción serializable y la relación correcta', async () => {
    prepareQueries();

    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: { matricula: 30999, idMateriaDivision: 15 },
      message: 'Alumno inscripto correctamente',
    });
    expect(mock.pool.Transaction).toHaveBeenCalledWith(mock.pool);
    const transaction = (mock.pool.Transaction as jest.Mock).mock.results.at(-1)?.value;
    expect(transaction.begin).toHaveBeenCalledWith(mock.pool.ISOLATION_LEVEL.SERIALIZABLE);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(mock.transactionRequest.execute).toHaveBeenCalledWith('SP_Alumno_InscribirMateria');
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('Matricula', mock.pool.Int, 30999);
    expect(mock.transactionRequest.input).toHaveBeenCalledWith('IdMateriaDivision', mock.pool.Int, 15);
    const sqlQueries = (mock.transactionRequest.query as jest.Mock).mock.calls
      .map(([query]) => query)
      .join('\n');
    expect(sqlQueries).toContain('UPDLOCK, HOLDLOCK');
    expect(sqlQueries).not.toMatch(/\b(Intento|Respuesta|Publicacion)\b/);
  });

  it('se refleja en la consulta existente de materias del alumno', async () => {
    prepareQueries();
    const getRequest = mock.pool.request();
    (getRequest.execute as jest.Mock)
      .mockResolvedValueOnce({
        recordset: [{ NombreAlumno: 'Alumno Demo', Materia: 'Programación', Division: '1A' }],
      });

    const createRes = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });
    const getRes = await request(app)
      .get('/api/alumnos/30999/materias')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(createRes.status).toBe(201);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toEqual([
      { nombreAlumno: 'Alumno Demo', materia: 'Programación', division: '1A' },
    ]);
  });

  it('devuelve 200 y no inserta cuando la inscripción ya existe', async () => {
    prepareQueries(activeStudent, activeCommission, existingEnrollment);

    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ matricula: 30999, idMateriaDivision: 15 });
    expect(res.body.message).toBe('El alumno ya estaba inscripto');
    expect(mock.transactionRequest.execute).not.toHaveBeenCalled();
  });

  it('mantiene una sola inserción ante dos solicitudes concurrentes equivalentes', async () => {
    let enrollmentChecks = 0;
    (mock.transactionRequest.query as jest.Mock).mockImplementation((query: string) => {
      if (query.includes('FROM Alumno')) return Promise.resolve(activeStudent);
      if (query.includes('FROM MateriaDivision')) return Promise.resolve(activeCommission);
      if (query.includes('FROM InscripcionMateria')) {
        enrollmentChecks += 1;
        return Promise.resolve(enrollmentChecks === 1 ? noEnrollment : existingEnrollment);
      }
      return Promise.resolve({ recordset: [] });
    });

    const sendEnrollment = () => request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });

    const responses = await Promise.all([sendEnrollment(), sendEnrollment()]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect(mock.transactionRequest.execute).toHaveBeenCalledTimes(1);
  });

  it('devuelve 404 cuando el alumno no existe', async () => {
    prepareQueries({ recordset: [] });

    const res = await request(app)
      .post('/api/alumnos/99999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('STUDENT_NOT_FOUND');
  });

  it.each(['inactivo', 'suspendido'])('rechaza un alumno con estado %s', async (estado) => {
    prepareQueries({ recordset: [{ Estado: estado }] });

    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STUDENT_INACTIVE');
  });

  it('devuelve 404 cuando MateriaDivision no existe o sus relaciones no son válidas', async () => {
    prepareQueries(activeStudent, { recordset: [] });

    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 99999 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MATERIA_DIVISION_NOT_FOUND');
  });

  it('rechaza una comisión asociada a una materia inactiva', async () => {
    prepareQueries(activeStudent, { recordset: [{ Id: 15, MateriaActiva: false }] });

    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MATERIA_INACTIVE');
  });

  it.each([
    [{ IdMateriaDivision: 0 }],
    [{ IdMateriaDivision: -1 }],
    [{ IdMateriaDivision: 1.5 }],
    [{ IdMateriaDivision: '15' }],
    [{}],
  ])('rechaza body inválido: %p', async (body) => {
    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
  });

  it.each(['abc', '0', '-1', '1.5'])('rechaza matrícula inválida: %s', async (matricula) => {
    const res = await request(app)
      .post(`/api/alumnos/${matricula}/inscripciones`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
  });

  it('rechaza una solicitud sin token', async () => {
    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCESS_TOKEN_MISSING');
  });

  it('rechaza un token inválido', async () => {
    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', 'Bearer token-invalido')
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCESS_TOKEN_INVALID');
  });

  it('rechaza un access token vencido', async () => {
    const expiredToken = jwt.sign(
      { id: 1, email: 'admin@test.com', role: 'admin' },
      process.env.JWT_SECRET!,
      { expiresIn: -60 }
    );

    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCESS_TOKEN_EXPIRED');
  });

  it('rechaza un usuario autenticado sin rol admin', async () => {
    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${docenteToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('hace rollback y no filtra detalles ante un error SQL', async () => {
    (mock.transactionRequest.query as jest.Mock)
      .mockRejectedValueOnce(new Error('Violation of UNIQUE KEY con datos internos'));

    const res = await request(app)
      .post('/api/alumnos/30999/inscripciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ IdMateriaDivision: 15 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: 'No se pudo inscribir al alumno',
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(res.body)).not.toContain('UNIQUE KEY');
    const transaction = (mock.pool.Transaction as jest.Mock).mock.results.at(-1)?.value;
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/alumnos/:matricula/estadisticas', () => {
  it('retorna 200 con estadísticas del alumno en camelCase', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        { TotalCorregidos: 10, PromedioGeneral: 7.25, Aprobados: 7, PorcentajeAprobacion: 70.0 },
      ],
    });

    const res = await request(app)
      .get('/api/alumnos/30500/estadisticas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      totalCorregidos: 10,
      promedioGeneral: 7.25,
      aprobados: 7,
      porcentajeAprobacion: 70.0,
    });
  });

  it('retorna 200 con ceros cuando no hay intentos corregidos', async () => {
    const reqBuilder = mock.pool.request();
    (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
      recordset: [
        { TotalCorregidos: 0, PromedioGeneral: null, Aprobados: 0, PorcentajeAprobacion: null },
      ],
    });

    const res = await request(app)
      .get('/api/alumnos/30500/estadisticas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retorna 401 sin token de autenticación', async () => {
    const res = await request(app)
      .get('/api/alumnos/30500/estadisticas');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
