import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createMockPool } from './mocks/db';

const mock = createMockPool();
const dbRequest = mock.pool.request();

jest.mock('../src/config/db', () => mock);
jest.mock('mssql', () => mock.pool);

let app: any;
let adminToken: string;
let docenteToken: string;
let alumnoToken: string;

const kpis = {
  Presentadas: 240, Respondidas: 212, Omitidas: 28, PendientesCorreccion: 14,
  Correctas: 150, Parciales: 30, Incorrectas: 32, JustificacionesEntregadas: 80,
  PorcentajePuntajePromedio: 72.5, TasaAcierto: 70.75,
  MuestrasTiempo: 196, MuestrasTiempoNuevas: 180, MuestrasTiempoLegacy: 16,
  CoberturaTemporal: 0.8167, TiempoPromedioMilisegundos: 32000,
  TiempoMaximoMilisegundos: 120000,
};

const questionResult = (overrides: Record<string, unknown> = {}) => ({
  recordsets: [
    [kpis],
    [{
      ClaveContenido: 'a'.repeat(64), ContenidoHashSnapshot: 'a'.repeat(64),
      IdPregunta: 10, IdGrupoPregunta: 3, CantidadPreguntasOrigen: 2, CantidadGrupos: 1,
      Enunciado: 'Seleccione protocolos', Tipo: 'multiple', Grupo: 'Redes',
      TieneProcedenciaBanco: true, CantidadOrigenesBanco: 1,
      IncluyeSnapshotReconstruido: false, Presentadas: 20, Respondidas: 18, Omitidas: 2,
      PendientesCorreccion: 1, Correctas: 10, Parciales: 5, Incorrectas: 2,
      JustificacionesEntregadas: 12, PuntajePromedioObtenido: 1.5,
      PorcentajePuntajePromedio: 75, TasaAcierto: 58.82,
      MuestrasTiempo: 15, MuestrasTiempoNuevas: 13, MuestrasTiempoLegacy: 2,
      CoberturaTemporal: 0.75, TiempoPromedioMilisegundos: 30000,
      TiempoMedianaMilisegundos: 25000, TiempoMaximoMilisegundos: 80000,
    }],
    [{ Total: 1 }],
  ],
  recordset: [],
  ...overrides,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters';
  process.env.AUTH_REFRESH_TOKEN_SECRET = 'test-refresh-secret-key-with-at-least-32-characters';
  adminToken = jwt.sign(
    { id: 1, email: 'admin@test.com', role: 'admin', idDocente: null, idAlumno: null },
    process.env.JWT_SECRET,
  );
  docenteToken = jwt.sign(
    { id: 2, email: 'docente@test.com', role: 'docente', idDocente: 100542, idAlumno: null },
    process.env.JWT_SECRET,
  );
  alumnoToken = jwt.sign(
    { id: 3, email: 'alumno@test.com', role: 'alumno', idDocente: null, idAlumno: 30500 },
    process.env.JWT_SECRET,
  );
  app = require('../src/app').app;
});

beforeEach(() => {
  dbRequest.query.mockReset().mockResolvedValue({ recordset: [] });
  dbRequest.input.mockReset().mockReturnThis();
});

afterEach(() => jest.clearAllMocks());

describe('Etapa 4 - rendimiento por pregunta, grupo y opciones', () => {
  it('normaliza escalas mixtas y parciales múltiples por identidad histórica de contenido', async () => {
    dbRequest.query.mockResolvedValueOnce(questionResult());

    const res = await request(app)
      .get('/api/reportes/rendimiento-preguntas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpis).toMatchObject({
      presentadas: 240, respondidas: 212, omitidas: 28,
      pendientesCorreccion: 14, coberturaTemporal: 0.8167,
    });
    expect(res.body.data.items[0]).toMatchObject({
      contenidoHashSnapshot: 'a'.repeat(64), tipo: 'multiple',
      parciales: 5, porcentajePuntajePromedio: 75,
      tieneProcedenciaBanco: true, cantidadPreguntasOrigen: 2,
    });
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 25, total: 1, totalPages: 1 });

    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('PERCENTILE_CONT(0.5)');
    expect(sqlText).toContain('IP.ContenidoHashSnapshot');
    expect(sqlText).toContain('PuntajeObtenido*100.0/PuntajeMaximoSnapshot');
    expect(sqlText).toContain("E.Tipo='question_active'");
    expect(sqlText).toContain('dbo.MetricasNavegacion');
    expect(sqlText).not.toContain('JOIN dbo.BancoPregunta');
    expect(dbRequest.query).toHaveBeenCalledTimes(1);
  });

  it('aplica intentos válidos, confirmación, filtros y orden estable antes de paginar', async () => {
    dbRequest.query.mockResolvedValueOnce(questionResult());

    const res = await request(app)
      .get('/api/reportes/rendimiento-preguntas?idMateria=2&idMateriaDivision=4&idActividad=6&idPublicacion=8&idGrupoPregunta=3&idPregunta=10&fechaDesde=2026-10-01&fechaHasta=2026-10-31&estadoIntento=entregado&alcanceIntentos=validos&estadoCorreccion=confirmada&pagina=2&limite=10&ordenarPor=tasaAcierto&ordenDireccion=asc')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.criterios).toMatchObject({
      alcanceIntentos: 'validos', estadoCorreccion: 'confirmada',
      normalizacionPuntaje: 'porcentaje_puntaje_maximo',
    });
    expect(res.body.data.pagination.page).toBe(2);
    expect(dbRequest.input).toHaveBeenCalledWith('IdGrupoPregunta', 'INT', 3);
    expect(dbRequest.input).toHaveBeenCalledWith('IdPregunta', 'INT', 10);
    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('LEFT JOIN dbo.IntentoValidoOverride');
    expect(sqlText).toContain("I.Estado='entregado' AND I.Id=IVS.IdIntentoValido");
    expect(sqlText).toContain('I.CorreccionConfirmada=1 AND IP.PuntajeObtenido IS NOT NULL');
    expect(sqlText).toContain('ORDER BY TasaAcierto ASC,ClaveContenido ASC');
  });

  it('devuelve tiempos ausentes como null y cobertura cero', async () => {
    dbRequest.query.mockResolvedValueOnce(questionResult({
      recordsets: [
        [{ ...kpis, MuestrasTiempo: 0, MuestrasTiempoNuevas: 0, MuestrasTiempoLegacy: 0,
          CoberturaTemporal: 0, TiempoPromedioMilisegundos: null, TiempoMaximoMilisegundos: null }],
        [{ ClaveContenido: 'legacy:10', ContenidoHashSnapshot: null, IdPregunta: 10,
          Presentadas: 4, MuestrasTiempo: 0, CoberturaTemporal: 0,
          TiempoPromedioMilisegundos: null, TiempoMedianaMilisegundos: null,
          TiempoMaximoMilisegundos: null }],
        [{ Total: 1 }],
      ],
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-preguntas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toMatchObject({
      contenidoHashSnapshot: null, muestrasTiempo: 0, coberturaTemporal: 0,
      tiempoPromedioMilisegundos: null, tiempoMedianaMilisegundos: null,
    });
  });

  it('devuelve conteos en cero y página vacía cuando no existen presentaciones', async () => {
    dbRequest.query.mockResolvedValueOnce(questionResult({
      recordsets: [[{
        Presentadas: 0, Respondidas: 0, Omitidas: 0, PendientesCorreccion: 0,
        Correctas: 0, Parciales: 0, Incorrectas: 0, JustificacionesEntregadas: 0,
        PorcentajePuntajePromedio: null, TasaAcierto: null, MuestrasTiempo: 0,
        MuestrasTiempoNuevas: 0, MuestrasTiempoLegacy: 0, CoberturaTemporal: 0,
        TiempoPromedioMilisegundos: null, TiempoMaximoMilisegundos: null,
      }], [], [{ Total: 0 }]],
    }));

    const res = await request(app)
      .get('/api/reportes/rendimiento-preguntas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpis).toMatchObject({ presentadas: 0, respondidas: 0, omitidas: 0 });
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 25, total: 0, totalPages: 0 });
  });

  it('agrupa por grupo y adjunta variantes sin consultas N+1', async () => {
    dbRequest.query.mockResolvedValueOnce({
      recordsets: [
        [kpis],
        [{ IdGrupoPregunta: 3, Grupo: 'Redes', CantidadVariantes: 2,
          Presentadas: 40, DiferenciaVariantesPuntosPorcentuales: 12.5 }],
        [{ Total: 1 }],
        [
          { IdGrupoPregunta: 3, ClaveContenido: 'a'.repeat(64), IdPregunta: 10,
            Enunciado: 'TCP', PorcentajePuntajePromedio: 80 },
          { IdGrupoPregunta: 3, ClaveContenido: 'b'.repeat(64), IdPregunta: 11,
            Enunciado: 'UDP', PorcentajePuntajePromedio: 67.5 },
        ],
      ],
      recordset: [],
    });

    const res = await request(app)
      .get('/api/reportes/rendimiento-grupos')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toMatchObject({
      idGrupoPregunta: 3, cantidadVariantes: 2,
      diferenciaVariantesPuntosPorcentuales: 12.5,
    });
    expect(res.body.data.items[0].variantes).toHaveLength(2);
    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('#ReporteVariantesGrupo');
    expect(sqlText).toContain('#GruposPagina');
    expect(dbRequest.query).toHaveBeenCalledTimes(1);
  });

  it('calcula distribución y distractores exclusivamente desde snapshots', async () => {
    dbRequest.query.mockResolvedValueOnce({
      recordsets: [
        [{ Presentadas: 20, Respondidas: 18, Omitidas: 2,
          JustificacionesEntregadas: 8, TotalSelecciones: 25, SeleccionesDistractores: 7 }],
        [{ ClaveContenido: 'a'.repeat(64), ContenidoHashSnapshot: 'a'.repeat(64),
          Posicion: 2, Texto: 'UDP', EsCorrecta: false, EsDistractor: true,
          Presentaciones: 20, Selecciones: 7, PorcentajeSeleccion: 38.89 }],
        [{ Total: 1 }],
      ],
      recordset: [],
    });

    const res = await request(app)
      .get('/api/reportes/rendimiento-preguntas/10/opciones?ordenarPor=selecciones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.kpis).toMatchObject({ totalSelecciones: 25, seleccionesDistractores: 7 });
    expect(res.body.data.items[0]).toMatchObject({
      texto: 'UDP', esCorrecta: false, esDistractor: true, selecciones: 7,
    });
    const sqlText = dbRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('dbo.IntentoPreguntaOpcionSnapshot');
    expect(sqlText).toContain('dbo.RespuestaOpcion');
    expect(sqlText).not.toContain('JOIN dbo.Opcion');
    expect(sqlText).not.toContain('#TiemposRendimientoPregunta');
  });

  it('limita al docente a sus comisiones y rechaza filtros fuera de alcance', async () => {
    dbRequest.query
      .mockResolvedValueOnce({ recordset: [{ Permitido: 1 }] })
      .mockResolvedValueOnce(questionResult());

    const permitido = await request(app)
      .get('/api/reportes/rendimiento-preguntas?idPublicacion=8')
      .set('Authorization', `Bearer ${docenteToken}`);
    expect(permitido.status).toBe(200);
    expect(dbRequest.input).toHaveBeenCalledWith('IdDocente', 'INT', 100542);

    dbRequest.query.mockReset().mockResolvedValueOnce({ recordset: [] });
    const denegado = await request(app)
      .get('/api/reportes/rendimiento-preguntas/99/opciones')
      .set('Authorization', `Bearer ${docenteToken}`);
    expect(denegado.status).toBe(403);
    expect(denegado.body.code).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(dbRequest.query).toHaveBeenCalledTimes(1);
  });

  it('rechaza al alumno y solicitudes no autenticadas', async () => {
    const alumno = await request(app)
      .get('/api/reportes/rendimiento-preguntas')
      .set('Authorization', `Bearer ${alumnoToken}`);
    expect(alumno.status).toBe(403);

    const anonimo = await request(app).get('/api/reportes/rendimiento-grupos');
    expect(anonimo.status).toBe(401);
    expect(dbRequest.query).not.toHaveBeenCalled();
  });

  it.each([
    '/api/reportes/rendimiento-preguntas?limite=101',
    '/api/reportes/rendimiento-preguntas?estadoIntento=publicada',
    '/api/reportes/rendimiento-preguntas?estadoCorreccion=completa',
    '/api/reportes/rendimiento-grupos?alcanceIntentos=mejor',
    '/api/reportes/rendimiento-grupos?fechaDesde=2026-11-01&fechaHasta=2026-10-01',
    '/api/reportes/rendimiento-preguntas/abc/opciones',
    '/api/reportes/rendimiento-preguntas/10/opciones?idPregunta=12',
  ])('rechaza filtros inválidos sin consultar SQL: %s', async url => {
    const res = await request(app).get(url).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUEST_INVALID');
    expect(dbRequest.query).not.toHaveBeenCalled();
  });

  it('no expone errores SQL internos', async () => {
    dbRequest.query.mockRejectedValueOnce(new Error('Invalid object name dbo.Secreto'));
    const res = await request(app)
      .get('/api/reportes/rendimiento-preguntas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: 'No se pudo obtener el rendimiento por pregunta',
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(res.body)).not.toContain('dbo.Secreto');
  });
});
