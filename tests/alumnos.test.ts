import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let adminToken: string;
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  adminToken = jwt.sign({ id: 1, email: 'admin@test.com', role: 'admin' }, process.env.JWT_SECRET);
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
