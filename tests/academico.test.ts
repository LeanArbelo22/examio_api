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

describe('Carreras', () => {
  describe('GET /api/carreras', () => {
    it('retorna 200 con array de carreras en camelCase', async () => {
      (mock.pool.query as jest.Mock).mockResolvedValueOnce({
        recordset: [
          { Id: 1, Nombre: 'Analista de Sistemas', Descripcion: 'Carrera de tecnología', DuracionSemestres: 6 },
          { Id: 2, Nombre: 'Contador Público', Descripcion: 'Carrera de ciencias económicas', DuracionSemestres: 8 },
        ],
      });

      const res = await request(app).get('/api/carreras');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toEqual({
        id: 1,
        nombre: 'Analista de Sistemas',
        descripcion: 'Carrera de tecnología',
        duracionSemestres: 6,
      });
      expect(res.body.data[1].nombre).toBe('Contador Público');
    });

    it('retorna 500 cuando ocurre un error en la BD', async () => {
      (mock.pool.query as jest.Mock).mockRejectedValueOnce(new Error('Connection failed'));

      const res = await request(app).get('/api/carreras');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Connection failed');
    });
  });

  describe('GET /api/carreras/:id', () => {
    it('retorna 200 con una carrera en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Id: 1, Nombre: 'Analista de Sistemas', Descripcion: 'Carrera de tecnología', DuracionSemestres: 6 }],
      });

      const res = await request(app).get('/api/carreras/1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        id: 1,
        nombre: 'Analista de Sistemas',
        descripcion: 'Carrera de tecnología',
        duracionSemestres: 6,
      });
    });

    it('retorna 404 cuando la carrera no existe', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app).get('/api/carreras/999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Carrera no encontrada');
    });
  });

  describe('POST /api/carreras', () => {
    it('retorna 201 al crear carrera exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .post('/api/carreras')
        .send({ Nombre: 'Licenciatura en Sistemas', Descripcion: 'Nueva carrera', DuracionSemestres: 8 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Carrera creada correctamente');
    });

    it('retorna 400 cuando se supera max(100) en Nombre', async () => {
      const res = await request(app)
        .post('/api/carreras')
        .send({ Nombre: 'A'.repeat(101), Descripcion: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Datos inválidos');
      expect(res.body.errors).toBeDefined();
    });

    it('retorna 400 cuando se supera max(500) en Descripcion', async () => {
      const res = await request(app)
        .post('/api/carreras')
        .send({ Nombre: 'Carrera Test', Descripcion: 'A'.repeat(501) });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('retorna 400 cuando falta campo obligatorio (Nombre)', async () => {
      const res = await request(app)
        .post('/api/carreras')
        .send({ Descripcion: 'Sin nombre' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PUT /api/carreras/:id', () => {
    it('retorna 200 al actualizar carrera exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .put('/api/carreras/1')
        .send({ Nombre: 'Licenciatura Actualizada' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Carrera actualizada correctamente');
    });

    it('retorna 400 con Nombre que supera max(100)', async () => {
      const res = await request(app)
        .put('/api/carreras/1')
        .send({ Nombre: 'A'.repeat(101) });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('DELETE /api/carreras/:id', () => {
    it('retorna 200 al dar de baja una carrera', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app).delete('/api/carreras/1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Carrera dada de baja');
    });
  });

  describe('GET /api/carreras/:id/plan', () => {
    it('retorna 200 con plan de estudios en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [
          { IdMateria: 10, NombreMateria: 'Programación I', Semestre: 1 },
          { IdMateria: 20, NombreMateria: 'Base de Datos I', Semestre: 2 },
        ],
      });

      const res = await request(app).get('/api/carreras/1/plan');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toEqual({ idMateria: 10, nombreMateria: 'Programación I', semestre: 1 });
    });
  });

  describe('GET /api/carreras/:id/alumnos', () => {
    it('retorna 200 con alumnos inscriptos en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [
          { Matricula: 30500, NombreCompleto: 'Julieta Acosta' },
        ],
      });

      const res = await request(app).get('/api/carreras/1/alumnos');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0]).toEqual({ matricula: 30500, nombreCompleto: 'Julieta Acosta' });
    });
  });
});

describe('Materias', () => {
  describe('GET /api/materias', () => {
    it('retorna 200 con array de materias en camelCase', async () => {
      (mock.pool.query as jest.Mock).mockResolvedValueOnce({
        recordset: [
          { Id: 1, Nombre: 'Bases de Datos I', Semestre: 2, IdCarrera: 1 },
          { Id: 2, Nombre: 'Programación I', Semestre: 1, IdCarrera: 1 },
        ],
      });

      const res = await request(app).get('/api/materias');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toEqual({ id: 1, nombre: 'Bases de Datos I', semestre: 2, idCarrera: 1 });
    });
  });

  describe('GET /api/materias/:id', () => {
    it('retorna 200 con una materia en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Id: 1, Nombre: 'Bases de Datos I', Semestre: 2, IdCarrera: 1 }],
      });

      const res = await request(app).get('/api/materias/1');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: 1, nombre: 'Bases de Datos I', semestre: 2, idCarrera: 1 });
    });

    it('retorna 404 cuando la materia no existe', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app).get('/api/materias/999');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Materia no encontrada');
    });
  });

  describe('POST /api/materias', () => {
    it('retorna 201 al crear materia exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .post('/api/materias')
        .send({ Nombre: 'Base de Datos II', Semestre: 3, IdCarrera: 1 });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Materia creada correctamente');
    });

    it('retorna 400 cuando Nombre supera max(100)', async () => {
      const res = await request(app)
        .post('/api/materias')
        .send({ Nombre: 'A'.repeat(101), IdCarrera: 1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('retorna 400 cuando falta IdCarrera', async () => {
      const res = await request(app)
        .post('/api/materias')
        .send({ Nombre: 'Materia sin carrera' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PUT /api/materias/:id', () => {
    it('retorna 200 al actualizar materia exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .put('/api/materias/1')
        .send({ Nombre: 'Bases de Datos I (Actualizado)', Semestre: 2 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Materia actualizada correctamente');
    });
  });

  describe('POST /api/materias/:id/division', () => {
    it('retorna 200 al asignar división exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .post('/api/materias/1/division')
        .send({ Id: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('División asignada a la materia');
    });

    it('retorna 400 cuando falta Id en el body', async () => {
      const res = await request(app)
        .post('/api/materias/1/division')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Datos inválidos');
    });
  });

  describe('GET /api/materias/:id/alumnos', () => {
    it('retorna 200 con alumnos de la materia en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Matricula: 30500, Nombre: 'Julieta', Apellido: 'Acosta' }],
      });

      const res = await request(app).get('/api/materias/1/alumnos');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual({ matricula: 30500, nombre: 'Julieta', apellido: 'Acosta' });
    });
  });

  describe('GET /api/materias/:id/comisiones', () => {
    it('retorna 200 con comisiones de la materia en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Id: 1, Division: '1NMS', Cupo: 30 }],
      });

      const res = await request(app).get('/api/materias/1/comisiones');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual({ id: 1, division: '1NMS', cupo: 30 });
    });
  });
});

describe('Docentes', () => {
  describe('GET /api/docentes', () => {
    it('retorna 200 con array de docentes en camelCase (admin)', async () => {
      (mock.pool.query as jest.Mock).mockResolvedValueOnce({
        recordset: [
          { Legajo: 100542, Nombre: 'Laura', Apellido: 'Fernandez', Correo: 'lfernandez@cervantes.edu.ar', Estado: 'activo' },
        ],
      });

      const res = await request(app)
        .get('/api/docentes')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0]).toEqual({
        legajo: 100542,
        nombre: 'Laura',
        apellido: 'Fernandez',
        correo: 'lfernandez@cervantes.edu.ar',
        estado: 'activo',
      });
    });

    it('retorna 401 sin token de autenticación', async () => {
      const res = await request(app).get('/api/docentes');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/docentes/:legajo', () => {
    it('retorna 200 con un docente en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Legajo: 100542, Nombre: 'Laura', Apellido: 'Fernandez', Correo: 'lfernandez@cervantes.edu.ar', Estado: 'activo' }],
      });

      const res = await request(app)
        .get('/api/docentes/100542')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        legajo: 100542,
        nombre: 'Laura',
        apellido: 'Fernandez',
        correo: 'lfernandez@cervantes.edu.ar',
        estado: 'activo',
      });
    });

    it('retorna 404 cuando el docente no existe', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .get('/api/docentes/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Docente no encontrado');
    });
  });

  describe('POST /api/docentes', () => {
    it('retorna 201 al crear docente exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .post('/api/docentes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ Legajo: 99999, Nombre: 'Nuevo', Apellido: 'Docente', Cuil: '20999999999', Correo: 'nuevo@cervantes.edu.ar' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Docente creado correctamente');
    });

    it('retorna 400 cuando Correo no es válido', async () => {
      const res = await request(app)
        .post('/api/docentes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ Legajo: 99999, Nombre: 'Nuevo', Apellido: 'Docente', Correo: 'email-invalido' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });

    it('retorna 400 cuando Nombre supera max(50)', async () => {
      const res = await request(app)
        .post('/api/docentes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ Legajo: 99999, Nombre: 'A'.repeat(51), Apellido: 'Docente', Correo: 'doc@test.com' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('retorna 401 sin token', async () => {
      const res = await request(app)
        .post('/api/docentes')
        .send({ Legajo: 99999, Nombre: 'Test', Apellido: 'User', Correo: 'test@test.com' });

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/docentes/:legajo', () => {
    it('retorna 200 al actualizar docente exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .put('/api/docentes/100542')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ Nombre: 'Laura Actualizada', Apellido: 'Fernandez', Correo: 'laura@cervantes.edu.ar' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Docente actualizado correctamente');
    });
  });

  describe('DELETE /api/docentes/:legajo', () => {
    it('retorna 200 al dar de baja un docente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .delete('/api/docentes/100542')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Docente dado de baja');
    });
  });

  describe('POST /api/docentes/:legajo/asignar', () => {
    it('retorna 200 al asignar comisión exitosamente', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .post('/api/docentes/100542/asignar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ IdMateriaDivision: 15 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Comisión asignada correctamente');
    });

    it('retorna 400 cuando falta IdMateriaDivision', async () => {
      const res = await request(app)
        .post('/api/docentes/100542/asignar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Datos inválidos');
    });
  });

  describe('GET /api/docentes/:legajo/comisiones', () => {
    it('retorna 200 con comisiones del docente en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Id: 1, Materia: 'Bases de Datos I', Division: '1NMS' }],
      });

      const res = await request(app)
        .get('/api/docentes/100542/comisiones')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual({ id: 1, materia: 'Bases de Datos I', division: '1NMS' });
    });
  });

  describe('GET /api/docentes/estado/:estado', () => {
    it('retorna 200 con docentes filtrados por estado', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Legajo: 100542, Nombre: 'Laura', Apellido: 'Fernandez', Estado: true }],
      });

      const res = await request(app)
        .get('/api/docentes/estado/true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual({ legajo: 100542, nombre: 'Laura', apellido: 'Fernandez', estado: true });
    });
  });

  describe('GET /api/docentes/:legajo/materias', () => {
    it('retorna 200 con materias del docente en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
        recordset: [{ Materia: 'Bases de Datos I', Division: '1NMS' }],
      });

      const res = await request(app)
        .get('/api/docentes/100542/materias')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual({ materia: 'Bases de Datos I', division: '1NMS' });
    });
  });

  describe('GET /api/docentes/:legajo/evaluaciones', () => {
    it('retorna 200 con evaluaciones del docente en camelCase', async () => {
      const reqBuilder = mock.pool.request();
      (reqBuilder.query as jest.Mock).mockResolvedValueOnce({
        recordset: [
          {
            IdPublicacion: 5, Titulo: 'Parcial I', Tipo: 'evaluacion',
            DuracionMinutos: 120, CantidadIntentosMaximos: 2, Estado: 'publicada',
            FechaInicio: new Date('2026-06-15T10:00:00Z'),
            FechaFin: new Date('2026-06-15T12:00:00Z'),
            Materia: 'Bases de Datos I', Division: '1NMS',
            AlumnosInscriptos: 25, TotalIntentos: 10,
          },
        ],
      });

      const res = await request(app)
        .get('/api/docentes/100542/evaluaciones')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0]).toEqual({
        idPublicacion: 5, titulo: 'Parcial I', tipo: 'evaluacion',
        duracionMinutos: 120, cantidadIntentosMaximos: 2, estado: 'publicada',
        fechaInicio: expect.any(String), fechaFin: expect.any(String),
        materia: 'Bases de Datos I', division: '1NMS',
        alumnosInscriptos: 25, totalIntentos: 10,
      });
    });

    it('retorna 401 sin token de autenticación', async () => {
      const res = await request(app)
        .get('/api/docentes/100542/evaluaciones');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
