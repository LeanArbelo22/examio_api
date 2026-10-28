# Contrato de reportes institucionales v1.4.0

Estado: aprobado e implementado. Fecha: 2026-10-24.

Esta versión amplía aditivamente el contrato v1.3.0 de:

```http
GET /api/reportes/rendimiento-evaluaciones
```

No agrega parámetros, endpoints ni migraciones. Mantiene intactos los campos
legacy, los rankings, la elegibilidad, las posiciones, los filtros y la
paginación.

## Población oficial

`promedioNotaBase10` utiliza exclusivamente el resultado oficial de cada alumno y
publicación:

1. se resuelve primero el intento válido vigente: override manual si existe o,
   en su defecto, último intento entregado;
2. el intento debe estar `entregado`;
3. `CorreccionConfirmada` debe ser `1`;
4. `NotaFinal` debe ser no nula.

Se usa la `NotaFinal` efectiva, incluidos los overrides vigentes. Participan
aprobados y desaprobados; los pendientes quedan excluidos. La cantidad del
promedio coincide siempre con `resultadosConsiderados`.

## Campo aditivo

Todos los objetos `resultadosOficiales` agregan:

```json
{
  "promedioNotaBase10": 6.33
}
```

Tipo: `number | null`.

- `null`: no existen resultados considerados.
- `0`: existen resultados considerados cuyas notas normalizadas son realmente
  cero.
- El valor se presenta redondeado a dos decimales.

El campo aparece en:

- `data.kpis.resultadosOficiales`;
- cada fila de `data.evaluaciones[].resultadosOficiales`;
- `resumenInstitucional.global.resultadosOficiales`;
- carreras, materias y comisiones de la jerarquía;
- los objetos de carreras, materias y comisiones en `comparativas`;
- cada punto de `serieMensual`;
- cada punto mensual, semestral o anual de `serieTemporal`.

## Fórmula y precisión

Por cada resultado considerado:

```text
notaBase10 = NotaFinal * 10 / EscalaCalificacion
promedioNotaBase10 = SUM(notaBase10) / resultadosConsiderados
```

La consulta acumula `notaBase10` en milésimas mediante `BIGINT`. Los niveles
superiores y las series suman esos acumuladores y sus cantidades antes de dividir;
nunca promedian valores previamente calculados o redondeados. Los acumuladores son
internos y no forman parte del JSON.

Ejemplo con tres resultados oficiales: `8/10`, `70/100` y `4/10`:

```text
notas base 10 = 8 + 7 + 4
promedio = 19 / 3 = 6.33
```

El mismo cálculo aplicado a un período puede devolver:

```json
{
  "periodo": "2026-S1",
  "resultadosOficiales": {
    "intentosValidosEntregados": 23,
    "resultadosConsiderados": 20,
    "resultadosPendientes": 3,
    "intentosPendientesConfirmacion": 2,
    "intentosConfirmadosSinNota": 1,
    "intentosConPreguntasSinPuntaje": 0,
    "preguntasSinPuntaje": 0,
    "aprobados": 3,
    "desaprobados": 17,
    "porcentajeAprobacion": 15,
    "porcentajeCoberturaConfirmada": 86.96,
    "promedioNotaBase10": 4.75
  }
}
```

## Escalas inválidas

Las escalas oficiales admitidas son `10` y `100`. Si un resultado considerado
tiene escala nula o distinta, la petición completa falla: no se excluye el
registro ni se devuelve un promedio parcial.

```http
HTTP/1.1 500 Internal Server Error
```

```json
{
  "success": false,
  "code": "REPORT_INVALID_GRADING_SCALE",
  "message": "Existen resultados oficiales con una escala de calificación inválida"
}
```

No se exponen mensajes ni detalles internos de SQL Server.

## Compatibilidad

- No cambia `promedioIntentosCalificados` ni
  `promedioIntentosCalificadosBase10`, que conservan su población legacy.
- No cambia la selección del intento válido ni se recalifican notas históricas.
- No cambia `resultadosConsiderados`, aprobación, cobertura, pendientes,
  elegibilidad ni orden de rankings.
- Sin resultados oficiales, los porcentajes y el promedio oficial continúan
  siendo `null` según sus respectivos denominadores.
