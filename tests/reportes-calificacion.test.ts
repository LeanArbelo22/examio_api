import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
const dbRequest = mock.pool.request();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let adminToken: string;

const evaluationResult = () => ({
  recordsets: [
    [{
      TotalEvaluaciones: 2,
      TotalIntentos: 8,
      TotalIntentosAlcanceAcademico: 5,
      TotalIntentosCalificados: 4,
      PromedioIntentosCalificados: 7.5,
      PromedioIntentosCalificadosBase10: 7.5,
      TasaAprobacionIntentos: 75,
    }],
    [{ Categoria: 'Aprobados', Cantidad: 3 }],
    [{
      IdPublicacion: 47,
      IdActividad: 18,
      Titulo: 'Parcial mixto',
      EscalaCalificacion: 100,
      NotaAprobacion: 40,
      IntentosTotales: 5,
      IntentosAlcanceAcademico: 3,
      IntentosCalificados: 2,
      PromedioIntentosCalificados: 75,
      PromedioIntentosCalificadosBase10: 7.5,
    }],
    [{ Total: 1 }],
  ],
  recordset: [],
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  adminToken = jwt.sign(
    { id: 1, email: 'admin@test.com', role: 'admin', idDocente: null, idAlumno: null },
    process.env.JWT_SECRET,
  );
  app = require('../src/app').app;
});

beforeEach(() => {
  dbRequest.query.mockReset().mockResolvedValue({ recordset: [] });
  dbRequest.input.mockReset().mockReturnThis();
});

afterEach(() => jest.clearAllMocks());

describe('Etapa 5 - reportes con escalas y alcance académico', () => {
  it('mantiene todos como alcance predeterminado y normaliza agregados legacy a base 10', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Total: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ TotalIntentos: 4, PromedioGeneral: 7.5, TasaAprobacion: 50 }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/reportes/rendimiento')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpis).toMatchObject({ escalaPromedio: 10, alcanceIntentos: 'todos' });
    const sqlText = dbRequest.query.mock.calls.map(call => call[0]).join('\n');
    expect(sqlText).toContain('I.NotaFinal*10.0/NULLIF(AC.EscalaCalificacion,0)');
    expect(sqlText).toContain('I.NotaFinal>=AC.NotaAprobacion');
    expect(sqlText).toContain("I.Id IS NOT NULL AND I.Estado='entregado'");
    expect(sqlText).not.toMatch(/I\.NotaFinal\s*>=\s*[46](?:\.0+)?\b/);
  });

  it('aplica validos sólo a métricas académicas y conserva totalIntentos operativo', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Total: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ TotalIntentos: 9, IntentosAlcanceAcademico: 3 }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .get('/api/reportes/rendimiento?alcanceIntentos=validos')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpis).toMatchObject({
      totalIntentos: 9,
      intentosAlcanceAcademico: 3,
      alcanceIntentos: 'validos',
    });
    const sqlText = dbRequest.query.mock.calls.map(call => call[0]).join('\n');
    expect(sqlText).toContain('LEFT JOIN IntentoValidoOverride');
    expect(sqlText).toContain("I.Estado='entregado' AND I.Id=IVS.IdIntentoValido");
    expect(sqlText).toContain('COUNT(I.Id) AS TotalIntentos');
  });

  it('expone escala original por evaluación y promedio global normalizado', async () => {
    dbRequest.query.mockResolvedValueOnce(evaluationResult());

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios).toEqual({
      alcanceIntentos: 'todos',
      escalaPromedio: 10,
      conPendientesCorreccion: null,
      conIncidentes: null,
      tipoIncidente: null,
      severidad: null,
      soloIncidentesSinRevisar: null,
    });
    expect(res.body.data.kpis).toMatchObject({
      promedioIntentosCalificados: 7.5,
      promedioIntentosCalificadosBase10: 7.5,
    });
    expect(res.body.data.evaluaciones[0]).toMatchObject({
      escalaCalificacion: 100,
      notaAprobacion: 40,
      promedioIntentosCalificados: 75,
      promedioIntentosCalificadosBase10: 7.5,
    });
    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('I.NotaFinal >= PA.NotaAprobacion');
    expect(sqlText).toContain('I.NotaFinal*10.0/NULLIF(PA.EscalaCalificacion,0)');
  });

  it('respeta override manual con alcanceIntentos=validos sin alterar conteos operativos', async () => {
    dbRequest.query.mockResolvedValueOnce(evaluationResult());

    const res = await request(app)
      .get('/api/reportes/rendimiento-evaluaciones?alcanceIntentos=validos')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios.alcanceIntentos).toBe('validos');
    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('LEFT JOIN IntentoValidoOverride IVO');
    expect(sqlText).toContain('COALESCE(IVO.IdIntento');
    expect(sqlText).toContain('AND I.Id=IVS.IdIntentoValido');
    expect(sqlText).toContain('COUNT(I.Id) AS IntentosTotales');
  });

  it.each([
    ['true', 'DELETE FROM #ReporteEvaluaciones WHERE IntentosPendientesCorreccion=0;'],
    ['false', 'DELETE FROM #ReporteEvaluaciones WHERE IntentosPendientesCorreccion>0;'],
  ])('filtra publicaciones por carga pendiente con %s', async (value, expectedSql) => {
    dbRequest.query.mockResolvedValueOnce(evaluationResult());

    const res = await request(app)
      .get(`/api/reportes/rendimiento-evaluaciones?conPendientesCorreccion=${value}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios.conPendientesCorreccion).toBe(value === 'true');
    expect(dbRequest.query.mock.calls[0][0]).toContain(expectedSql);
  });

  it.each([
    '/api/reportes/rendimiento?alcanceIntentos=mejores',
    '/api/reportes/rendimiento-evaluaciones?alcanceIntentos=mejores',
    '/api/reportes/rendimiento-evaluaciones?conPendientesCorreccion=si',
  ])('rechaza extensiones inválidas: %s', async url => {
    const res = await request(app)
      .get(url)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(dbRequest.query).not.toHaveBeenCalled();
  });
});
