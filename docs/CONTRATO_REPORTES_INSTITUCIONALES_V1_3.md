# Contrato de síntesis institucional v1.3.0

Estado: aprobado e implementado. Fecha: 2026-10-24.

Este contrato amplía aditivamente v1.2.0 sobre:

```http
GET /api/reportes/rendimiento-evaluaciones
```

No reemplaza `serieMensual`, no modifica los campos legacy y no altera la
selección del intento válido, las notas ni los criterios de elegibilidad.

## Activación y parámetros

Los dos parámetros nuevos sólo son válidos con
`incluirResumenInstitucional=true`, por lo que conservan el RBAC administrativo:

| Parámetro | Valores | Default efectivo |
|---|---|---|
| `ordenRanking` | `aprobacion_asc`, `aprobacion_desc` | `aprobacion_asc` |
| `agrupacionSerie` | `mensual`, `semestral`, `anual` | omitido; no agrega `serieTemporal` |

- `ordenRanking` activa únicamente el orden nuevo de las tres comparativas. No
  requiere una serie ni fechas.
- `agrupacionSerie` activa `serieTemporal` y requiere `fechaDesde` y `fechaHasta`.
- `incluirSerieMensual=true` continúa activando `serieMensual` con el contrato
  v1.2.0. Puede combinarse con `agrupacionSerie`; ambas series se construyen desde
  la misma agregación mensual SQL.
- Si se omiten ambos parámetros nuevos, la forma de la respuesta permanece v1.2.0:
  no aparecen `criterios.ordenRanking`, `criterios.agrupacionSerie`,
  `comparativas.ordenRanking` ni `serieTemporal`.
- Las opciones institucionales sin `incluirResumenInstitucional=true` devuelven
  `400 REPORT_INSTITUTIONAL_OPTIONS_REQUIRE_SUMMARY`.

## ResultadosOficiales

Todos los bloques oficiales reutilizan este tipo:

```json
{
  "intentosValidosEntregados": 60,
  "resultadosConsiderados": 50,
  "resultadosPendientes": 10,
  "intentosPendientesConfirmacion": 7,
  "intentosConfirmadosSinNota": 3,
  "intentosConPreguntasSinPuntaje": 4,
  "preguntasSinPuntaje": 6,
  "aprobados": 21,
  "desaprobados": 29,
  "porcentajeAprobacion": 42,
  "porcentajeCoberturaConfirmada": 83.33
}
```

Invariante obligatoria:

```text
resultadosPendientes
= intentosPendientesConfirmacion + intentosConfirmadosSinNota
```

Las categorías son excluyentes: primero se clasifican los intentos no confirmados;
entre los confirmados, sólo quedan pendientes los que no tienen nota final. Los
contadores de preguntas sin puntaje son información adicional y no se suman a esa
ecuación.

## Dirección de comparativas

`ordenRanking` afecta `elegibles` de carreras, materias y comisiones:

1. proporción exacta `aprobados / resultadosConsiderados`, ascendente o descendente;
2. `resultadosConsiderados` descendente;
3. ID estable de la dimensión ascendente.

La comparación primaria usa productos cruzados enteros, antes de redondear los
porcentajes de presentación. Las posiciones se recalculan desde 1 para cada
dimensión. El orden y la elegibilidad de `evidenciaLimitada` y `sinResultados` no
cambian. El orden efectivo se informa en:

```json
{
  "criterios": { "ordenRanking": "aprobacion_desc" },
  "resumenInstitucional": {
    "comparativas": {
      "ordenRanking": "aprobacion_desc",
      "criteriosElegibilidad": {
        "muestraMinima": 10,
        "coberturaMinimaPorcentaje": 70,
        "naturaleza": "criterio_operativo_configurable"
      }
    }
  }
}
```

Ejemplo de ítem elegible corregido:

```json
{
  "idMateria": 18,
  "materia": "Seguridad de Redes",
  "posicion": 1,
  "resultadosOficiales": {
    "intentosValidosEntregados": 60,
    "resultadosConsiderados": 50,
    "resultadosPendientes": 10,
    "intentosPendientesConfirmacion": 7,
    "intentosConfirmadosSinNota": 3,
    "intentosConPreguntasSinPuntaje": 4,
    "preguntasSinPuntaje": 6,
    "aprobados": 21,
    "desaprobados": 29,
    "porcentajeAprobacion": 42,
    "porcentajeCoberturaConfirmada": 83.33
  }
}
```

## Serie temporal

`agrupacionSerie` agrega:

```json
{
  "criterios": { "agrupacionSerie": "semestral" },
  "resumenInstitucional": {
    "periodoEfectivo": {
      "desde": "2025-11-01T03:00:00.000Z",
      "hasta": "2026-10-24T15:00:00.000Z",
      "zonaHoraria": "America/Argentina/Buenos_Aires",
      "mesesCalendarioIncluidos": 12
    },
    "serieTemporal": {
      "agrupacion": "semestral",
      "zonaHoraria": "America/Argentina/Buenos_Aires",
      "puntos": []
    }
  }
}
```

Cada punto tiene esta forma:

```json
{
  "periodo": "2026-S1",
  "etiqueta": "enero-junio 2026",
  "limitesCalendario": {
    "desde": "2026-01-01T03:00:00.000Z",
    "hastaExclusivo": "2026-07-01T03:00:00.000Z"
  },
  "limitesEfectivos": {
    "desde": "2026-01-01T03:00:00.000Z",
    "hasta": "2026-06-30T23:59:59.999Z"
  },
  "periodoCompleto": true,
  "publicaciones": 8,
  "publicacionesConResultadosPendientes": 3,
  "resultadosOficiales": {
    "intentosValidosEntregados": 140,
    "resultadosConsiderados": 120,
    "resultadosPendientes": 20,
    "intentosPendientesConfirmacion": 15,
    "intentosConfirmadosSinNota": 5,
    "intentosConPreguntasSinPuntaje": 7,
    "preguntasSinPuntaje": 10,
    "aprobados": 72,
    "desaprobados": 48,
    "porcentajeAprobacion": 60,
    "porcentajeCoberturaConfirmada": 85.71
  }
}
```

Otro semestre puede informar, por ejemplo, 30 pendientes como `24 + 6`; un año
puede informar 40 como `31 + 9`. Los ejemplos no relajan la invariante.

### Reglas temporales

- `mensual`: mes calendario; ID `YYYY-MM`.
- `semestral`: enero-junio o julio-diciembre; ID `YYYY-S1`/`YYYY-S2`.
- `anual`: año calendario; ID `YYYY`.
- La zona institucional es `America/Argentina/Buenos_Aires`.
- `limitesCalendario` expresa el intervalo calendario semiabierto.
- `limitesEfectivos` es la intersección del período calendario con el rango
  efectivo consultado.
- `periodoCompleto` sólo es `true` si el rango efectivo cubre todo el período y
  éste ya finalizó respecto del único instante actual capturado por la petición.
- El final solicitado se limita al instante actual. Todos los bloques del reporte
  usan ese mismo período efectivo.
- El máximo continúa siendo 60 meses calendario incluidos, también para series
  semestrales y anuales.
- Se devuelven períodos vacíos. Sin resultados considerados los porcentajes son
  `null`; con resultados considerados y cero aprobados, aprobación es `0`.
- Los conteos se suman y los porcentajes se recalculan desde numeradores y
  denominadores agregados. Nunca se promedian porcentajes mensuales.
- La serie refleja el resultado válido vigente de las publicaciones del período;
  no reconstruye cuál era el resultado conocido históricamente al cerrar cada mes.

## Errores estables

| Código | Condición |
|---|---|
| `REPORT_RANKING_ORDER_INVALID` | `ordenRanking` desconocido |
| `REPORT_SERIES_GROUPING_INVALID` | `agrupacionSerie` desconocida |
| `REPORT_SERIES_PERIOD_REQUIRED` | falta una fecha requerida por una serie |
| `REPORT_SERIES_PERIOD_INVALID` | fecha o período efectivo inválido |
| `REPORT_SERIES_RANGE_TOO_LARGE` | más de 60 meses calendario incluidos |
| `REPORT_INSTITUTIONAL_OPTIONS_REQUIRE_SUMMARY` | opción institucional sin resumen |

Se conservan los códigos RBAC existentes: alumnos y docentes no obtienen el
resumen administrativo. No se unifican respuestas legacy de autorización.

## Ejemplos de consulta

Ranking descendente, sin serie:

```http
GET /api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&ordenRanking=aprobacion_desc
```

Serie semestral y mensual compatibles en una misma respuesta:

```http
GET /api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&incluirSerieMensual=true&agrupacionSerie=semestral&fechaDesde=2025-11-01T03:00:00.000Z&fechaHasta=2026-10-24T23:59:59.999Z
```

Serie anual sin solicitar el bloque mensual legacy:

```http
GET /api/reportes/rendimiento-evaluaciones?incluirResumenInstitucional=true&agrupacionSerie=anual&fechaDesde=2024-01-01T03:00:00.000Z&fechaHasta=2026-10-24T23:59:59.999Z
```

La paginación de `evaluaciones` no modifica jerarquía, comparativas ni series.
