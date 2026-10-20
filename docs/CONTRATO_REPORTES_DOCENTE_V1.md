# Contrato de reportes docentes v1.0.0

**Estado:** acordado e implementado para la Entrega 1  
**Fecha:** 2026-10-19  
**Unidad de evaluación:** `idPublicacion`

Este documento fija las ampliaciones aditivas de los reportes docentes. No cambia
los campos legacy ni define el resumen institucional de la Entrega 2.

## Criterios comunes

Un resultado oficial se obtiene en este orden:

1. seleccionar el intento válido vigente mediante override manual o, si no existe,
   el último intento entregado con desempate estable;
2. exigir que ese intento esté entregado;
3. considerarlo resultado únicamente si `CorreccionConfirmada=1` y `NotaFinal` no
   es nula.

Un intento válido pendiente nunca se reemplaza por un intento anterior confirmado.
La aprobación compara `NotaFinal` con `Actividad.NotaAprobacion`.

`porcentajePuntajePromedio` conserva su fórmula y población legacy en todas las
consultas ordinarias. Cuando el alcance efectivo es `alcanceIntentos=validos` y
`estadoCorreccion=confirmada`, su población elegible coincide con
`muestrasConfirmadas`. Agregar o solicitar `resultadosOficiales`,
`pendientesOperativos`, `presentacionesOficiales` o `resumenInstitucional` no
modifica ningún campo legacy ni sus denominadores. Los contadores oficiales son
paralelos y no reemplazan `presentadas`, `respondidas`, `omitidas` ni
`pendientesCorreccion`.

Los porcentajes sin denominador son `null`; los conteos son `0`; las colecciones
vacías son `[]`.

## GET /api/reportes/rendimiento-evaluaciones

Se mantienen filtros, paginación, ordenamiento, campos y
`graficos.distribucionResultados`. Este gráfico conserva íntegramente su semántica
legacy. No se agrega otro gráfico en esta entrega.

`kpis` y cada elemento de `evaluaciones` agregan los mismos dos objetos. Si se
consulta una sola publicación, ambos objetos coinciden:

```json
{
  "resultadosOficiales": {
    "intentosValidosEntregados": 30,
    "resultadosConsiderados": 24,
    "resultadosPendientes": 6,
    "intentosPendientesConfirmacion": 4,
    "intentosConfirmadosSinNota": 2,
    "intentosConPreguntasSinPuntaje": 3,
    "preguntasSinPuntaje": 5,
    "aprobados": 18,
    "desaprobados": 6,
    "porcentajeAprobacion": 75,
    "porcentajeCoberturaConfirmada": 80
  },
  "pendientesOperativos": {
    "intentosEntregadosPendientes": 8,
    "intentosPendientesConfirmacion": 5,
    "intentosSinNotaFinal": 4,
    "intentosConPreguntasSinPuntaje": 3,
    "preguntasSinPuntaje": 6
  }
}
```

`resultadosConsiderados + resultadosPendientes = intentosValidosEntregados` y
`aprobados + desaprobados = resultadosConsiderados`.

`pendientesOperativos` observa todos los intentos entregados. Sus categorías pueden
superponerse. `intentosEntregadosPendientes` es la unión de IDs de intento distintos;
los subconjuntos no deben sumarse.

## GET /api/reportes/rendimiento-preguntas

Mantiene los filtros y campos existentes. Agrega el booleano opcional
`soloHallazgosBajoRendimiento`.

Los KPIs y cada ítem agregan:

```json
{
  "presentacionesOficiales": 220,
  "muestrasConfirmadas": 210,
  "presentacionesExcluidasSinPuntaje": 6,
  "presentacionesExcluidasSinMaximoPositivo": 4
}
```

La población es `IntentoPregunta` de intentos válidos entregados y confirmados. La
partición se aplica sin doble conteo:

1. `presentacionesExcluidasSinPuntaje`: puntaje nulo;
2. entre las restantes, `presentacionesExcluidasSinMaximoPositivo`: máximo nulo o
   menor o igual a cero;
3. las restantes forman `muestrasConfirmadas`.

Una omisión con puntaje definitivo cero y máximo positivo pertenece a
`muestrasConfirmadas`. `respondidas` y `muestrasConfirmadas` no son sinónimos.
El porcentaje oficial es el promedio de
`PuntajeObtenido * 100 / PuntajeMaximoSnapshot`, sin redondear antes de comparar y
con salida decimal de dos posiciones.

La regla de hallazgo es fija y versionada. Su ubicación canónica es
`data.reglaHallazgo`, al mismo nivel que `resumenFiltro`:

```json
{
  "reglaHallazgo": {
    "codigo": "pregunta_bajo_rendimiento",
    "version": 1,
    "porcentajePuntajeMaximoExclusivo": 30,
    "muestrasConfirmadasMinimas": 10
  },
  "resumenFiltro": {
    "preguntasEnCoberturaGeneral": 17,
    "preguntasConMuestraSuficiente": 12,
    "preguntasConMuestraInsuficiente": 5,
    "preguntasCoincidentes": 1,
    "presentacionesCoincidentes": 20,
    "muestrasConfirmadasCoincidentes": 18
  }
}
```

`criterios.reglaBajoRendimiento` se conserva como alias compatible, pero los clientes
nuevos deben consumir `data.reglaHallazgo`.

Un ítem agrega `hallazgoBajoRendimiento` con `detectado`, `codigo` y `version`.
La condición es muestra mayor o igual a 10 y porcentaje estrictamente menor a 30.

Cuando `soloHallazgosBajoRendimiento=true`, omitir alcance/corrección aplica
`validos + confirmada`. Enviar explícitamente otro valor devuelve
`400 REPORT_OFFICIAL_SCOPE_REQUIRED`; nunca se ignora un filtro explícito.

`resumenFiltro` se calcula antes de filtrar y paginar. Su estructura es la mostrada
en el ejemplo anterior.

Una pregunta con presentaciones oficiales y entre 0 y 9 muestras es insuficiente.
Las preguntas sin presentaciones oficiales quedan fuera de este universo; esta
entrega no promete listarlas como una categoría separada.

## GET /api/reportes/rendimiento-grupos

Los KPIs, grupos y variantes agregan `presentacionesOficiales`,
`muestrasConfirmadas`, `presentacionesExcluidasSinPuntaje` y
`presentacionesExcluidasSinMaximoPositivo` con las mismas reglas. Las diferencias
entre variantes son descriptivas y no generan alertas automáticas.

## GET /api/reportes/rendimiento-preguntas/:idPregunta/opciones

Agrega el query opcional `claveContenido`. Los clientes nuevos deben enviarlo con
el valor devuelto por el ítem de preguntas.

Con `claveContenido`, el `idPregunta` del path sólo valida pertenencia y alcance. La
agregación reúne todas las presentaciones de esa identidad histórica dentro de los
mismos filtros, incluidas copias independientes; no queda restringida al ID
representativo. `criterios.claveContenido` confirma la identidad efectiva y
`kpis.presentadas` coincide con el ítem de preguntas bajo filtros idénticos.

Si las formas de los snapshots de opciones no coinciden exactamente en posición,
texto y clave correcta, la API no mezcla evidencia y devuelve
`409 QUESTION_OPTION_EVIDENCE_INCONSISTENT`. Un par pregunta/clave inexistente en el
alcance devuelve `404 QUESTION_CONTENT_NOT_FOUND`.

Omitir `claveContenido` conserva el comportamiento legacy para compatibilidad.

## Navegación y fechas

Al navegar desde una publicación hacia preguntas se conserva solamente
`idPublicacion`, `alcanceIntentos=validos` y `estadoCorreccion=confirmada`. No se
trasladan `fechaDesde`/`fechaHasta`: evaluaciones filtra `Publicacion.FechaInicio` y
preguntas filtra `Intento.FechaInicio`.

Para días locales completos, el frontend construye los límites locales
`00:00:00.000` y `23:59:59.999` y los convierte a UTC. No concatena `Z` ni usa
offsets fijos.

## RBAC y errores estables

Administradores poseen alcance institucional. Docentes quedan limitados a
`MateriaDivision.IdDocente`. Alumnos no acceden.

- `400 REPORT_OFFICIAL_SCOPE_REQUIRED`.
- `404 QUESTION_CONTENT_NOT_FOUND`.
- `409 QUESTION_OPTION_EVIDENCE_INCONSISTENT`.

Los errores no exponen SQL ni amplían el alcance autorizado.

## Fuera de alcance

No incluye `resumenInstitucional`, agrupaciones administrativas, series, nuevos
endpoints, cambios de notas/corrección/intento válido ni migraciones. Esos cambios
pertenecen a la Entrega 2 o a mejoras opcionales posteriores.
