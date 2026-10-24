# Dataset sintético de analítica 2026

Estos archivos generan y verifican datos **exclusivamente sintéticos** para probar
reportes docentes e institucionales. Los patrones altos, medios, bajos, crecientes o
decrecientes son escenarios artificiales y no describen la capacidad de alumnos ni el
desempeño de docentes reales.

## Archivos

- `generar-dataset-analitica-2026.sql`: generador transaccional y configurable.
- `verificar-dataset-analitica-2026.sql`: consultas de verificación de sólo lectura.

El generador no fue ejecutado por Codex. Debe revisarse y ejecutarse manualmente sólo
en una copia de prueba de SQL Server.

## Uso seguro

1. Seleccionar explícitamente la base de pruebas en SSMS.
2. Ajustar `@BaseObjetivo`; el script aborta si no coincide exactamente con
   `DB_NAME()`.
3. Elegir un `@LoteId` UUID nuevo y una `@Semilla` estable.
4. Configurar el rango, corte, volumen, filtros y tasas.
5. Ejecutar primero con `@SoloEstimar = 1`. Esto muestra las comisiones incluidas y
   excluidas y los volúmenes estimados, sin crear tablas ni insertar filas.
6. Revisar la estimación y recién entonces cambiar a `@SoloEstimar = 0`.
7. Tras la ejecución manual, copiar el mismo `@LoteId` al verificador y ejecutar sus
   consultas `SELECT`.

No hay script de limpieza deliberadamente: el generador no actualiza ni elimina datos
previos. Si se necesita retirar un lote, debe diseñarse una operación separada,
revisada contra todas las FK y limitada a una base descartable.

## Configuración

La cabecera concentra:

- base objetivo, lote y semilla;
- fechas locales inicial/final, fecha de corte y zona horaria SQL Server;
- evaluaciones por comisión/mes, preguntas, variantes y participantes máximos;
- filtros CSV opcionales por IDs de carrera, materia, comisión y docente;
- política de exclusión para comisiones sin docente/usuario activo o sin alumnos;
- tasas de participación, fracción confirmada del escenario de cobertura baja,
  reintentos, omisiones y pendientes;
- probabilidades de acierto por perfil y crédito parcial.

Las tres fechas se configuran mediante `DATEFROMPARTS` y
`DATETIME2FROMPARTS`. Esto evita que `DATEFORMAT` o el idioma de la instancia
interpreten de forma diferente los literales de fecha.

Versión actual del generador: `1.0.2`.

Ejemplo para limitar la generación:

```sql
DECLARE @FiltroIdsCarrera NVARCHAR(MAX) = N'1,3';
DECLARE @FiltroIdsMateria NVARCHAR(MAX) = N'8,12,18';
DECLARE @FiltroIdsComision NVARCHAR(MAX) = NULL;
DECLARE @FiltroIdsDocente NVARCHAR(MAX) = N'109000';
```

Los filtros se combinan con `AND`. Una lista con elementos no numéricos aborta. Una
comisión sólo es elegible si su carrera y materia están activas, conserva sus relaciones reales y tiene docente activo,
usuario docente activo para auditorías y al menos un alumno activo inscripto. No se
crean alumnos ni inscripciones para completar cupos. Con las variables
`@ExcluirSinDocente`/`@ExcluirSinAlumnos` en `1`, esos casos se informan y excluyen;
en `0`, su presencia aborta para exigir una decisión explícita.

## Volumen previsto

Con los valores predeterminados (marzo-octubre inclusive):

- 8 meses;
- 2 publicaciones por comisión y mes: **16 publicaciones por comisión**;
- 10 grupos presentados por publicación;
- 4 grupos con 2 variantes y 6 con una: **14 preguntas de contenido por
  publicación**;
- **160 grupos** y **224 preguntas de contenido por comisión**;
- hasta 20 participantes por publicación normal, sólo si la inscripción real alcanza;
- 10 preguntas snapshot por intento, más el subconjunto determinístico de reintentos.

El total exacto de intentos depende del padrón y de los escenarios de muestra/cobertura.
El preflight del generador calcula el alcance real antes de escribir. No se debe estimar
intentando multiplicar tablas manualmente, porque eso puede producir un cartesiano.

## Repetibilidad e idempotencia

La pseudoaleatoriedad usa `SHA2_256(semilla + identidades lógicas)` y convierte cuatro
bytes a `bigint`. No usa un único `RAND()` ni `ABS(CHECKSUM(...))`, por lo que evita el
caso de overflow de `ABS` y conserva resultados para la misma configuración.

El script crea, dentro de su transacción, dos tablas auxiliares **sólo de datos de
prueba**:

- `dbo.ExamioTestDataLote`: UUID, hash y JSON de configuración;
- `dbo.ExamioTestDataEntidad`: relación del lote con actividades, publicaciones e
  intentos generados.

Estas tablas no son una migración del producto. El lote no se identifica únicamente
por títulos. Repetir el mismo UUID con la misma configuración devuelve
`LOTE_YA_APLICADO_SIN_CAMBIOS`; repetirlo con otra configuración aborta. Otro UUID crea
una muestra independiente.

El generador no llama Stored Procedures académicos. Utiliza `sys.sp_executesql`
solamente para crear y consultar de forma segura las dos tablas auxiliares cuando aún
no existían; toda entidad académica se inserta explícitamente bajo una única
transacción.

## Fechas

`@FechaInicialLocal`, `@FechaFinalLocal` y `@FechaCorteLocal` representan calendario de
`America/Buenos_Aires`. SQL Server usa el identificador Windows
`Argentina Standard Time`. El script convierte esos valores a UTC antes de insertar
`Publicacion.FechaInicio/FechaFin`, `Intento.FechaInicio/FechaFin` y fechas de
corrección/confirmación. Son columnas `DATETIME`/`DATETIME2` sin offset, pero el dataset
las trata como instantes UTC, igual que las escrituras modernas de la API.

No se generan intentos, entregas o confirmaciones después del corte. La serie mensual
de la API debe solicitar la zona `America/Argentina/Buenos_Aires`; el verificador
reagrupa los instantes UTC almacenados mediante `Argentina Standard Time`.

## Escenarios generados

- perfiles de rendimiento alto, medio y bajo por comisión;
- tendencias que mejoran, empeoran o permanecen estables;
- escalas 10 y 100, con umbrales 6 y 60;
- publicaciones normales, con muestra insuficiente, cobertura insuficiente y sin
  entregas (estas últimas contienen como máximo intentos en progreso);
- resultados confirmados mayoritarios, resultados pendientes de puntaje y pendientes
  de confirmación;
- resultados reales de cero, omisiones calificadas con cero y crédito parcial;
- pregunta controlada de bajo rendimiento con probabilidad suficiente para producir
  un hallazgo cuando existen al menos 10 muestras confirmadas;
- variantes con sesgo descriptivo reproducible, sin etiquetar automáticamente su
  calidad pedagógica;
- reintentos, caso “último pendiente y anterior confirmado” y overrides manuales de
  intento válido;
- notas calculadas desde la suma exacta de preguntas y algunos overrides de nota
  auditados;
- preguntas `mc`, `multiple`, `vf`, `abierta` y `code`, justificaciones, opciones,
  snapshots y correcciones manuales/automáticas coherentes.

Las preguntas de contenido común se crean como copias independientes con la misma
representación canónica. `ContenidoHash` se calcula con el algoritmo `v1` exacto de
`pregunta-content.service.ts`, incluyendo el JSON ordenado de opciones. No se usan
hashes arbitrarios.

El dataset no agrega telemetría ni incidentes artificiales. Para cubrir estados no
finalizados usa intentos `en_progreso`; no genera anulaciones porque una anulación
coherente requeriría un incidente y una decisión autoritativa que no son necesarios
para estos reportes. Sí materializa políticas y snapshots de supervisión sin eventos,
para que los intentos no queden estructuralmente incompletos.

Si el alcance contiene al menos cuatro comisiones, la primera queda como entidad sin
resultados confirmados y la segunda como entidad de cobertura limitada; esto permite
probar las tres colecciones de comparativas institucionales. Con menos comisiones los
extremos se distribuyen por publicación para no inutilizar todo el único alcance
académico disponible. El preflight permite anticipar cuál de ambos comportamientos se
aplicará.

## Verificación posterior

El verificador consulta:

1. identidad/configuración persistente del lote;
2. distribución por mes, carrera, materia y comisión;
3. mínimo de publicaciones por comisión/mes;
4. selección canónica, resultados considerados, pendientes y overrides;
5. pendientes operativos con categorías superpuestas y unión de intentos;
6. sumas de puntajes, notas calculadas/manuales/efectivas y confirmación;
7. muestras oficiales, exclusiones y hallazgos de pregunta;
8. diferencias descriptivas entre variantes;
9. duplicados, relaciones, snapshots y hashes canónicos;
10. reconciliación de sumas globales con agrupaciones por comisión.

Los contadores señalados como errores deben ser cero. Los escenarios estadísticos
dependen del número real de inscriptos: si ninguna comisión alcanza diez participantes,
el script no puede fabricar un hallazgo elegible sin violar la prohibición de inventar
inscripciones; el preflight y el verificador permiten detectar esa limitación.

## Limitaciones de validación actual

Al preparar estos archivos se intentó consultar `GestionExamio` únicamente con
`SELECT`, pero SQL Server en `localhost:1433` no estaba accesible. Por eso no se pudo
certificar el número actual de comisiones, inscripciones ni filas previstas, ni compilar
el script contra la instancia real. El diseño se contrastó con migraciones, services y
scripts vigentes del repositorio. La primera ejecución debe ser `@SoloEstimar = 1` y la
validación definitiva corresponde al entorno SQL Server de prueba.
