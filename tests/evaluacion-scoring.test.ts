import {
  distribuirPuntajesIguales,
  materializarPuntajes,
  puntajeSql,
  resolverConfiguracionCalificacion,
} from '../src/services/evaluacion-scoring.service';

describe('configuración de calificación', () => {
  it('aplica defaults históricos 10/4/iguales/oculto/automático', () => {
    expect(resolverConfiguracionCalificacion({})).toEqual({
      EscalaCalificacion: 10,
      NotaAprobacion: 4,
      ModoPuntaje: 'iguales',
      MostrarPuntajePorPregunta: false,
      CorreccionAutomaticaCerradas: true,
    });
  });

  it('usa 40 como nota de aprobación default para escala 100', () => {
    expect(resolverConfiguracionCalificacion({ EscalaCalificacion: 100 }).NotaAprobacion).toBe(40);
  });

  it('conserva umbral y flags configurados por el docente', () => {
    expect(resolverConfiguracionCalificacion({
      EscalaCalificacion: 100,
      NotaAprobacion: 65,
      MostrarPuntajePorPregunta: true,
      CorreccionAutomaticaCerradas: false,
    })).toMatchObject({
      EscalaCalificacion: 100,
      NotaAprobacion: 65,
      MostrarPuntajePorPregunta: true,
      CorreccionAutomaticaCerradas: false,
    });
  });

  it('rechaza escala inválida con código estable', () => {
    expect(() => resolverConfiguracionCalificacion({ EscalaCalificacion: 20 as 10 }))
      .toThrow(expect.objectContaining({ code: 'SCORING_SCALE_INVALID' }));
  });

  it('rechaza umbral fuera de la escala con código estable', () => {
    expect(() => resolverConfiguracionCalificacion({ EscalaCalificacion: 10, NotaAprobacion: 40 }))
      .toThrow(expect.objectContaining({ code: 'PASSING_GRADE_INVALID' }));
  });

  it('exige umbral explícito al cambiar de escala', () => {
    expect(() => resolverConfiguracionCalificacion(
      { EscalaCalificacion: 100 },
      { EscalaCalificacion: 10, NotaAprobacion: 4 },
    )).toThrow(expect.objectContaining({ code: 'PASSING_GRADE_INVALID' }));
  });
});

describe('puntajes estructurales', () => {
  it('distribuye escala 10 en centavos exactos y con remanente estable', () => {
    const puntajes = distribuirPuntajesIguales(3, 10);
    expect(puntajes).toEqual([3.34, 3.33, 3.33]);
    expect(Math.round(puntajes.reduce((total, value) => total + value, 0) * 100)).toBe(1000);
  });

  it('distribuye escala 100 exactamente', () => {
    expect(distribuirPuntajesIguales(6, 100)).toEqual([16.67, 16.67, 16.67, 16.67, 16.66, 16.66]);
    expect(puntajeSql(100)).toBe('100.00');
  });

  it('acepta puntajes personalizados que suman 10', () => {
    const config = resolverConfiguracionCalificacion({ ModoPuntaje: 'personalizados' });
    expect(materializarPuntajes([{ PuntajeMaximo: 4 }, { PuntajeMaximo: 6 }], config, true))
      .toHaveLength(2);
  });

  it('acepta puntajes personalizados que suman 100', () => {
    const config = resolverConfiguracionCalificacion({
      EscalaCalificacion: 100,
      NotaAprobacion: 40,
      ModoPuntaje: 'personalizados',
    });
    expect(materializarPuntajes([{ PuntajeMaximo: 33.33 }, { PuntajeMaximo: 66.67 }], config, true))
      .toHaveLength(2);
  });

  it('rechaza una suma personalizada incorrecta', () => {
    const config = resolverConfiguracionCalificacion({ ModoPuntaje: 'personalizados' });
    expect(() => materializarPuntajes([{ PuntajeMaximo: 4 }, { PuntajeMaximo: 5 }], config, true))
      .toThrow(expect.objectContaining({ code: 'QUESTION_SCORE_TOTAL_INVALID' }));
  });

  it('permite puntajes personalizados incompletos en borrador', () => {
    const config = resolverConfiguracionCalificacion({ ModoPuntaje: 'personalizados' });
    expect(materializarPuntajes([{}], config, false)).toEqual([{}]);
  });
});

