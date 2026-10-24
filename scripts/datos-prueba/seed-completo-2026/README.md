# Seed integral 2026 de Examio

Dataset exclusivamente sintético para `GestionExamio-Migracion`. No representa
la capacidad de alumnos ni el desempeño de docentes reales. Los scripts fueron
diseñados contra el esquema y las migraciones del repositorio; **no fueron
ejecutados ni validados mediante escrituras en SQL Server**.

## Orden de ejecución manual

1. Realizar un respaldo si se necesita recuperar el estado actual.
2. Abrir `01-preparar-academico.sql`, verificar la base seleccionada y cambiar
   únicamente `@CONFIRMAR_CARGA` a `1`.
3. Ejecutar la etapa 1 completa. Debe finalizar con `ETAPA_1_COMPLETA`.
4. Abrir `02-cargar-evaluaciones-resultados.sql`, verificar el mismo `@LoteId` y
   cambiar `@CONFIRMAR_CARGA` a `1`.
5. Prever crecimiento importante del log y ejecutar la etapa 2 sin otra
   transacción externa. Debe finalizar con `ETAPA_2_COMPLETA`.
6. Ejecutar `04-normalizar-correos-institucionales.sql` cambiando
   `@CONFIRMAR_CAMBIO` a `1`. Esta etapa sólo reemplaza el dominio de los correos.
7. Ejecutar `03-verificar-seed.sql`, que contiene únicamente `SELECT`.

Cada etapa usa `XACT_ABORT`, `TRY/CATCH` y transacción. Una etapa fallida revierte
sus propias escrituras. La segunda requiere que la primera haya registrado su
marcador. Repetir una etapa terminada con el mismo lote no duplica filas; cambiar
la configuración conservando el mismo lote provoca un error.

## Configuración

La configuración se concentra en la cabecera de `01-preparar-academico.sql` y se
persiste como JSON y SHA-256 en `ExamioTestDataLote`. La etapa 2 lee esa
configuración; no debe duplicarse manualmente.

Valores iniciales:

- lote: `A1202603-2026-4C04-8EED-000000000001`;
- semilla: `examio-seed-integral-2026-v1`;
- período: marzo-octubre de 2026;
- corte: 23 de octubre de 2026, 23:59:59.997 de Buenos Aires;
- 4 carreras, 30 materias por carrera, 2 comisiones por materia;
- 30 alumnos por cohorte/comisión y 10 docentes por carrera;
- 2 evaluaciones por comisión, 10 grupos y 3 variantes por grupo;
- reintentos: 10%; omisiones: 8%; pendientes configurables;
- resultados con perfiles alto, medio y bajo y tendencias sintéticas.

Para otro lote se debe usar otro UUID y, si la base contiene datos, otra base de
pruebas vacía. Esta versión aborta deliberadamente ante datos previos no
reconocidos: no mezcla ni sobrescribe muestras.

## Modelo académico elegido

- Hay 240 alumnos únicos: por carrera se crean dos cohortes de 30.
- Cada alumno cursa las 30 materias de su carrera en su cohorte. Esto produce
  exactamente 7.200 inscripciones, sin inventar alumnos por materia.
- Hay 40 docentes: diez por carrera. Cada docente recibe tres materias y ambas
  comisiones de esas materias; no se cruza entre carreras.
- Sólo hay dos filas de `Division`, reutilizadas como Cohorte A y Cohorte B.
  `MateriaDivision` representa cada comisión concreta.
- Cada evaluación usa una `Actividad` propia y una `Publicacion` para una
  comisión. Sus 30 alumnos comparten esa publicación.
- La primera evaluación de cada comisión cae entre marzo y junio; la segunda,
  entre julio y octubre. La planificación evita superponer materias de una misma
  cohorte el mismo día.

## Credenciales

Todas las cuentas usan la contraseña de pruebas `Cervantes2026`. La base recibe
un hash bcrypt de coste 10 generado y verificado offline con `bcryptjs`; nunca se
inserta la contraseña como hash ni se crean logins de SQL Server.

- administrador: `admin@cervantes.edu.ar`;
- docentes: `docente.c{1..4}.{1..10}@cervantes.edu.ar`;
- alumnos: `alumno.c{1..4}.{a|b}.{01..30}@cervantes.edu.ar`.

## Volumen previsto

Las cantidades exactas de alto nivel son 4 carreras, 120 materias, 240
comisiones, 240 alumnos, 7.200 inscripciones, 480 actividades/publicaciones,
14.400 intentos base entregados y 1.440 reintentos adicionales. Se esperan además
4.800 grupos, 14.400 preguntas de evaluación, 37.440 opciones, 158.400 preguntas
de intento y alrededor de 412 mil snapshots de opción. La telemetría supera las
177 mil filas.

La etapa 2 puede consumir varios minutos y un volumen importante del log según
hardware, recovery model e índices. No se afirma un tiempo ni tamaño exactos
porque el script no fue ejecutado. Antes de correrlo, comprobar espacio de datos,
log y backups. No cancelar salvo necesidad: `XACT_ABORT` y el `CATCH` harán
rollback, que también puede tardar.

## Escenarios analíticos

- perfiles altos, medios y bajos y tendencias ascendentes, descendentes y
  estables;
- escalas 10 y 100 con umbrales 6 y 60;
- publicaciones con cobertura normal, 50%, sólo ocho confirmados o ningún
  confirmado;
- aprobación observada cero en publicaciones controladas;
- omisiones calificadas con cero, crédito parcial y preguntas de rendimiento
  inferior al 30% con muestra suficiente;
- variantes elegidas determinísticamente y con diferencias descriptivas;
- pendientes de puntaje, pendientes de confirmación y correcciones reabiertas;
- 10% de reintentos, donde el último puede quedar pendiente;
- overrides manuales que conservan el primer intento como válido;
- overrides de nota con historial;
- tiempos por pregunta e incidentes para 20% de los intentos base;
- decisiones de supervisión informativas/advertencias y revisiones operativas;
- políticas y algunos permisos de revisión, sin fabricar sesiones de alumno;
- actas cerradas y detalles derivados de notas normalizadas a escala 10.

## Inventario completo de tablas

| Tabla | Propósito | Registros previstos | Generación |
|---|---|---:|---|
| Carrera | Oferta académica | 4 | Etapa 1 |
| Materia | Materias por carrera | 120 | 30 por carrera |
| Division | Cohortes reutilizables | 2 | A y B |
| Docente | Plantel sintético | 40 | 10 por carrera |
| Alumno | Alumnos sintéticos | 240 | 60 por carrera |
| MateriaDivision | Comisiones | 240 | 2 por materia |
| InscripcionMateria | Cursadas | 7.200 | cohorte completa en 30 materias |
| Usuario | Accesos de prueba | 281 | admin + docentes + alumnos |
| Actividad | Evaluaciones | 480 | una por publicación |
| Publicacion | Unidad analítica | 480 | dos por comisión |
| GrupoPregunta | Grupos puntuables | 4.800 | diez por actividad |
| Pregunta | Variantes | 14.400 | tres por grupo |
| Opcion | Opciones vigentes | 37.440 | según tipo cerrado |
| Intento | Rendiciones | 15.840 | 14.400 base + 1.440 reintentos |
| IntentoPregunta | Variante congelada | 158.400 | diez por intento |
| IntentoPreguntaOpcionSnapshot | Opciones históricas | ~411.840 | copia de la variante asignada |
| Respuesta | Contenido respondido | ~145.000 | excluye omisiones determinísticas |
| RespuestaOpcion | Selecciones cerradas | variable | coherente con nivel obtenido |
| HistorialRespuesta | Auditoría legacy | 0 | excepción deliberada |
| HistorialRespuestaCambio | Cambios idempotentes modernos | 0 | no se simulan doble clic ni ediciones |
| HistorialCorreccionIntentoPregunta | Corrección manual | ~45.000 | abiertas/código corregidas |
| HistorialNotaIntento | Override de nota | ~48 | subconjunto controlado |
| IntentoValidoOverride | Selección válida manual | ~53 | primer intento frente a retry pendiente |
| HistorialIntentoValidoOverride | Auditoría del override | ~53 | una fila por override |
| HistorialEstadoCorreccionIntento | Confirmación/reapertura | miles | confirmaciones y reaperturas |
| AlertaFraude | Modelo legacy | 0 | reemplazado por incidentes/supervisión |
| MetricasNavegacion | Fallback temporal legacy | 0 | se usa `question_active` |
| TipoEventoTelemetria | Catálogo técnico | 10 | valores exactos de migración |
| IncidenteIntento | Tiempos/eventos | >177.000 | preguntas, fin e incidentes |
| RevisionIncidenteIntento | Revisión operativa | ~1.440 | sin inferir fraude |
| AnulacionIntentoIncidente | Anulación autoritativa | 0 | política seed no anula intentos base |
| PoliticaSupervisionPublicacion | Política viva | 480 | configuración seed versionada |
| ReglaSupervisionPublicacion | Reglas vivas | 960 | foco y fullscreen |
| IntentoPoliticaSupervision | Snapshot por intento | 15.840 | congelado al inicio |
| IntentoReglaSupervision | Reglas congeladas | 31.680 | dos por intento |
| EstadoSupervisionIntento | Estado autoritativo | 15.840 | normal/advertido |
| DecisionSupervisionIntento | Decisiones por incidente | ~2.880 | advertir/informar |
| OverrideSupervisionIntento | Override docente | 0 | no se inventan desbloqueos |
| PoliticaRevisionPublicacion | Política de revisión | 480 | al_corregir + libre |
| PermisoRevisionIntento | Excepciones individuales | 40 | subconjunto controlado |
| SesionRevisionIntento | Sesiones cortas | 0 | sólo mediante uso real de API |
| AuditoriaRevisionIntento | Auditoría | ~520 | políticas y permisos |
| ConsumoRevisionUnicaIntento | Consumo único | 0 | depende de sesión real |
| ActaMateria | Actas | 240 | una por comisión |
| DetalleActa | Detalles | 7.200 | nota derivada y normalizada |
| BancoPregunta | Preguntas privadas | 120 | tres por docente |
| BancoOpcion | Opciones privadas | 400 | mc/multiple/vf |
| BancoGrupo | Grupos privados | 40 | uno por docente |
| BancoGrupoPregunta | Composición de grupo | 120 | tres variantes |
| BancoEtiqueta | Etiquetas privadas | 80 | dos por docente |
| BancoPreguntaEtiqueta | Etiquetado de pregunta | 120 | etiqueta sintética |
| BancoGrupoEtiqueta | Etiquetado de grupo | 80 | dos por grupo |
| AuthSession | Sesiones de autenticación | 0 inicial | se crea al iniciar sesión normalmente |
| AuthRefreshToken | Refresh opaco | 0 inicial | se crea/rota por AuthService |
| OperacionIdempotente | Requests idempotentes | 0 inicial | se crea al usar endpoints reales |
| ExamioTestDataLote | Identidad/configuración | 1 | lote, JSON y hash |
| ExamioTestDataEntidad | Trazabilidad | ~17.700 | IDs de entidades y etapas |
| sysdiagrams | Herramienta SSMS | 0 | no es dato funcional |

No se insertan filas “de relleno” en tablas cuyo significado exige una acción
real. Login/refresh, sesiones de revisión, consumos únicos y operaciones
idempotentes se generarán al probar la API. Tampoco se fabrican tokens ni secretos.

## Hashes, fechas y reproducibilidad

`ContenidoHash` usa exactamente el formato canónico vigente:

`SHA2_256(v1|tipo|enunciado|modoJustificacion|estrategia|tratamiento|opcionesJson)`

Las opciones se serializan por posición mediante `FOR JSON PATH`. Las decisiones
aleatorias derivan de SHA-256 sobre semilla e identidades lógicas; no se usa
`RAND()` ni `ABS(CHECKSUM(...))`. Los UUID de eventos también derivan de SHA-256.

Las fechas configuradas son locales de Buenos Aires y se convierten con
`AT TIME ZONE 'Argentina Standard Time'` a los `DATETIME2` UTC que consume la
aplicación. No se crean entregas, correcciones ni eventos posteriores al corte.

## Limitaciones

- No hubo conexión disponible a SQL Server durante la generación. Se leyó el
  esquema desde migraciones, documentación y scripts previamente ejecutados,
  pero todavía falta la validación manual real.
- CUIL se genera como identificador numérico único de prueba; la autenticación
  funcional depende de email/contraseña, no del CUIL.
- No se simulan tokens, sesiones ni operaciones HTTP internas.
- Los perfiles son escenarios artificiales y no habilitan conclusiones causales
  ni pedagógicas.
- El seed no modifica esquema ni ejecuta stored procedures. Requiere todas las
  migraciones ya aplicadas y las tablas auxiliares de pruebas existentes.

