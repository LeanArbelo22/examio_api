# Contrato de síntesis institucional v1.2.0

**Estado:** aprobado e implementado

**Fecha:** 2026-10-21

**Endpoint:** `GET /api/reportes/rendimiento-evaluaciones`

Esta versión amplía aditivamente v1.1.0. No modifica campos legacy, selección del
intento válido, calificación ni pendientes operativos.

## Activación y filtros

- `idCarrera`: entero positivo; filtra por `Carrera.Id`.
- `incluirResumenInstitucional=true`: exclusivo de administrador; activa jerarquía y
  comparativas.
- `muestraMinimaRanking`: entero entre 1 y 100000, default 10.
- `coberturaMinimaRanking`: decimal entre 0 y 100, default 70.
- `incluirSerieMensual=true`: requiere resumen institucional, `fechaDesde` y
  `fechaHasta` ISO 8601.

Las opciones de elegibilidad o serie sin resumen devuelven
`400 REPORT_INSTITUTIONAL_OPTIONS_REQUIRE_SUMMARY`. El filtro de carrera puede usarse
sin solicitar el resumen. Carrera, materia, comisión, actividad y publicación se
validan contra sus relaciones reales; una combinación incompatible devuelve
`400 REPORT_FILTERS_INCONSISTENT`.

## Población y alcance

Todos los bloques nuevos parten del mismo conjunto después de RBAC y filtros y antes
de paginar `evaluaciones`. La dimensión temporal es `Publicacion.FechaInicio`.
Primero se resuelve el intento válido vigente; sólo después se evalúan entrega,
`CorreccionConfirmada` y `NotaFinal`. Los resultados oficiales siempre usan válidos
confirmados aunque un campo legacy use `alcanceIntentos=todos`.

Los porcentajes se calculan desde numeradores y denominadores agregados, nunca desde
promedios de porcentajes. Sin denominador se devuelve `null`.

## Tipos comunes

```ts
type ResultadosOficiales = {
  intentosValidosEntregados: number;
  resultadosConsiderados: number;
  resultadosPendientes: number;
  intentosPendientesConfirmacion: number;
  intentosConfirmadosSinNota: number;
  intentosConPreguntasSinPuntaje: number;
  preguntasSinPuntaje: number;
  aprobados: number;
  desaprobados: number;
  porcentajeAprobacion: number | null;
  porcentajeCoberturaConfirmada: number | null;
};

type PendientesOperativos = {
  intentosEntregadosPendientes: number;
  intentosPendientesConfirmacion: number;
  intentosSinNotaFinal: number;
  intentosConPreguntasSinPuntaje: number;
  preguntasSinPuntaje: number;
};
```

Cada agregado incluye además `publicaciones`,
`publicacionesConResultadosPendientes` y
`publicacionesConPendientesOperativos`. Las subcategorías operativas pueden
superponerse y no se suman.

## Jerarquía

La forma canónica es:

```text
resumenInstitucional.carreras[]
  -> materias[]
    -> comisiones[]
```

Carrera incluye `idCarrera,carrera`; materia agrega `idMateria,materia`; comisión
agrega `idMateriaDivision,division`. Todos los niveles contienen los agregados y
tipos comunes completos. `resumenInstitucional.materias` se conserva por
compatibilidad v1.1.0.

Las evaluaciones permanecen en `data.evaluaciones`, paginadas, y cada fila incluye
`idCarrera` y `carrera`. No se duplican dentro de la jerarquía.

## Comparativas

`resumenInstitucional.comparativas` contiene `carreras`, `materias` y `comisiones`.
Cada dimensión devuelve colecciones completas, sin truncamiento:

- `elegibles`: agrega `posicion` consecutiva desde 1;
- `evidenciaLimitada`: agrega `motivosNoElegibilidad`;
- `sinResultados`: usa `SIN_RESULTADOS_CONFIRMADOS`.

Motivos posibles: `MUESTRA_INSUFICIENTE`, `COBERTURA_INSUFICIENTE` y
`SIN_RESULTADOS_CONFIRMADOS`. Una entidad es elegible cuando cumple simultáneamente
la muestra y cobertura configuradas. La comparación de cobertura usa los conteos sin
redondear; el redondeo sólo se aplica a la presentación.

Elegibles se ordenan por aprobación ascendente, resultados considerados descendente
y luego ID ascendente. Evidencia limitada se ordena por muestra descendente,
cobertura descendente e ID. Sin resultados se ordena por nombre e ID. Esto expresa
menor aprobación observada, no una clasificación pedagógica automática.

## Serie mensual

`resumenInstitucional.serieMensual` contiene todos los meses calendario del período:

```ts
type PuntoSerieMensual = {
  periodo: string; // YYYY-MM
  periodoCompleto: boolean;
  publicaciones: number;
  publicacionesConResultadosPendientes: number;
  resultadosOficiales: ResultadosOficiales;
};
```

La agrupación usa `America/Argentina/Buenos_Aires`. `periodoEfectivo` informa
`desde`, `hasta`, `zonaHoraria` y `mesesCalendarioIncluidos`. El final efectivo es
el mínimo entre `fechaHasta` y el instante actual calculado una vez por petición; ese
mismo período limita resumen, jerarquía, comparativas, serie y evaluaciones.

`periodoCompleto=true` sólo cuando el rango cubre el mes calendario completo y el
mes ya terminó. Un mes vacío devuelve conteos cero y porcentajes `null`; con
resultados considerados y cero aprobados, la aprobación es 0.

Se aceptan hasta 60 meses calendario incluidos, calculados por año y mes local, no
por cantidad de días. Errores estables:

- `REPORT_SERIES_PERIOD_REQUIRED`: falta `fechaDesde` o `fechaHasta`;
- `REPORT_SERIES_PERIOD_INVALID`: ISO, orden o período efectivo inválido;
- `REPORT_SERIES_RANGE_TOO_LARGE`: más de 60 meses.

La serie refleja resultados vigentes de publicaciones iniciadas en cada mes; no es
un histórico del estado que tenían en ese momento.

## Compatibilidad y RBAC

Omitir `incluirResumenInstitucional` conserva la respuesta v1.1.0. Omitir
`incluirSerieMensual` no agrega `periodoEfectivo` ni `serieMensual`. Docentes y
alumnos no acceden al resumen institucional. KPIs, gráfico legacy, campos docentes,
ordenamiento y paginación se conservan.
