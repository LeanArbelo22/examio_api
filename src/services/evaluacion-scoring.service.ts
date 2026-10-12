import { BancoError } from './banco-common.service';

export type EscalaCalificacion = 10 | 100;
export type ModoPuntaje = 'iguales' | 'personalizados';

export type ConfiguracionCalificacion = {
  EscalaCalificacion: EscalaCalificacion;
  NotaAprobacion: number;
  ModoPuntaje: ModoPuntaje;
  MostrarPuntajePorPregunta: boolean;
  CorreccionAutomaticaCerradas: boolean;
};

type ConfiguracionParcial = {
  EscalaCalificacion?: number;
  NotaAprobacion?: number;
  ModoPuntaje?: string;
  MostrarPuntajePorPregunta?: boolean;
  CorreccionAutomaticaCerradas?: boolean;
};
type GrupoConPuntaje = { Id?: number; PuntajeMaximo?: number | null };

const aNumero = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const aBooleano = (value: unknown, fallback: boolean): boolean =>
  value === undefined || value === null ? fallback : Boolean(value);

export function resolverConfiguracionCalificacion(
  input: ConfiguracionParcial,
  actual?: Record<string, unknown>,
): ConfiguracionCalificacion {
  const escalaActual = aNumero(actual?.EscalaCalificacion, 10);
  const escala = aNumero(input.EscalaCalificacion, escalaActual);
  if (escala !== 10 && escala !== 100) {
    throw new BancoError(400, 'EscalaCalificacion debe ser 10 o 100', 'SCORING_SCALE_INVALID');
  }

  if (actual && input.EscalaCalificacion !== undefined && escala !== escalaActual && input.NotaAprobacion === undefined) {
    throw new BancoError(
      400,
      'Al cambiar la escala debe indicarse NotaAprobacion explícitamente',
      'PASSING_GRADE_INVALID',
    );
  }

  const notaDefault = actual
    ? aNumero(actual.NotaAprobacion, escalaActual === 100 ? 40 : 4)
    : escala === 100 ? 40 : 4;
  const notaAprobacion = aNumero(input.NotaAprobacion, notaDefault);
  if (notaAprobacion < 0 || notaAprobacion > escala || Math.round(notaAprobacion * 100) !== notaAprobacion * 100) {
    throw new BancoError(
      400,
      'NotaAprobacion debe estar entre 0 y la escala, con hasta dos decimales',
      'PASSING_GRADE_INVALID',
    );
  }

  const modo = input.ModoPuntaje ?? actual?.ModoPuntaje ?? 'iguales';
  if (modo !== 'iguales' && modo !== 'personalizados') {
    throw new BancoError(400, 'ModoPuntaje inválido', 'QUESTION_SCORE_TOTAL_INVALID');
  }

  return {
    EscalaCalificacion: escala as EscalaCalificacion,
    NotaAprobacion: notaAprobacion,
    ModoPuntaje: modo as ModoPuntaje,
    MostrarPuntajePorPregunta: aBooleano(
      input.MostrarPuntajePorPregunta,
      aBooleano(actual?.MostrarPuntajePorPregunta, false),
    ),
    CorreccionAutomaticaCerradas: aBooleano(
      input.CorreccionAutomaticaCerradas,
      aBooleano(actual?.CorreccionAutomaticaCerradas, true),
    ),
  };
}

export function distribuirPuntajesIguales(cantidad: number, escala: EscalaCalificacion): number[] {
  if (cantidad <= 0) return [];
  const totalCentavos = escala * 100;
  const base = Math.floor(totalCentavos / cantidad);
  const remanente = totalCentavos - base * cantidad;
  return Array.from({ length: cantidad }, (_, index) => (base + (index < remanente ? 1 : 0)) / 100);
}

export function materializarPuntajes<T extends GrupoConPuntaje>(
  grupos: T[],
  configuracion: ConfiguracionCalificacion,
  exigirCompletos: boolean,
): T[] {
  if (configuracion.ModoPuntaje === 'iguales') {
    const puntajes = distribuirPuntajesIguales(grupos.length, configuracion.EscalaCalificacion);
    return grupos.map((grupo, index) => ({ ...grupo, PuntajeMaximo: puntajes[index] }));
  }

  let totalCentavos = 0;
  const materializados = grupos.map((grupo) => {
    if (grupo.PuntajeMaximo === undefined || grupo.PuntajeMaximo === null) {
      if (exigirCompletos) {
        throw new BancoError(400, 'Cada grupo requiere PuntajeMaximo', 'QUESTION_SCORE_TOTAL_INVALID');
      }
      return grupo;
    }
    const puntaje = Number(grupo.PuntajeMaximo);
    const centavos = Math.round(puntaje * 100);
    if (!Number.isFinite(puntaje) || puntaje < 0 || puntaje > configuracion.EscalaCalificacion || centavos !== puntaje * 100) {
      throw new BancoError(
        400,
        'PuntajeMaximo debe estar dentro de la escala y tener hasta dos decimales',
        'QUESTION_SCORE_OUT_OF_RANGE',
      );
    }
    totalCentavos += centavos;
    return { ...grupo, PuntajeMaximo: puntaje };
  });

  if (exigirCompletos && totalCentavos !== configuracion.EscalaCalificacion * 100) {
    throw new BancoError(
      400,
      'La suma de PuntajeMaximo debe coincidir exactamente con la escala',
      'QUESTION_SCORE_TOTAL_INVALID',
    );
  }
  return materializados;
}

export const puntajeSql = (value: number | null | undefined): string | null =>
  value === undefined || value === null ? null : Number(value).toFixed(2);

