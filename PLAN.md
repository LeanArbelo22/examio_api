# Plan de acción técnico — API de Examio

Este documento es el registro vivo de estabilización y evolución de la API.
Debe actualizarse al completar una tarea o cuando una decisión funcional cambie
su alcance. No reemplaza los contratos de `README.md`, el modelo de
`README_DATABASE.md` ni las convenciones de `AGENTS.md`.

## Estados

- `[x]` Completado y verificado.
- `[~]` En progreso o cubierto parcialmente.
- `[ ]` Pendiente.
- `[!]` Bloqueado por una decisión funcional, infraestructura u otro repositorio.

## Principios de ejecución

- Trabajar por dominio y con cambios pequeños, verificables y reversibles.
- Mantener contratos HTTP y esquema SQL salvo cambio explícitamente aprobado.
- Agregar primero cobertura focalizada y después ejecutar la suite completa.
- No convertir deuda acotada en una migración arquitectónica transversal.
- No registrar ni persistir tokens, contraseñas, hashes o secretos reutilizables.
- Reflejar en README únicamente comportamiento efectivo y verificado.

## Navegación docente por evaluaciones

**Estado: COMPLETADA**

- [x] Ampliar aditivamente `GET /api/docentes/:legajo/evaluaciones` con IDs de
  actividad, materia y comisión, más carrera obtenida por la relación real.
- [x] Mantener una fila por publicación, los campos legacy y el orden por fecha de fin.
- [x] Restringir al docente autenticado a su propio legajo; admin conserva alcance global.
- [x] Cubrir comisiones múltiples, materias homónimas, aislamiento y respuesta vacía.
- [x] Mantener documentado, fuera de alcance, el SP duplicado de `/materias` y
  `/comisiones`.

## Calificación configurable — etapa 1

**Estado: COMPLETADA — SQL APLICADO Y VERIFICADO EN BASE DE PRUEBA**

- [x] Agregar escala 10/100, umbral, modo de puntaje, visibilidad y flag de
  corrección automática a creación, edición, publicación y detalle.
- [x] Mantener defaults compatibles 10/4/iguales/oculto/automático.
- [x] Materializar reparto igual exacto en centavos y validar suma personalizada.
- [x] Ocultar el puntaje en el DTO de render del alumno cuando corresponde.
- [x] Preparar migración única, transaccional e idempotente, sin ejecución automática.
- [x] Ampliar notas de intentos a `DECIMAL(5,2)` sin modificar actas.
- [x] Preparar snapshot/corrección por pregunta, auditorías, override de intento válido
  e incidentes de foco para las etapas siguientes.
- [x] Actualizar los SP existentes de inicio, render y finalización; sin SP nuevos.
- [x] Agregar verificación SQL de solo lectura y cobertura Jest focalizada.
- [x] Comparar la migración con el esquema efectivo de una base de prueba.
- [x] Aplicar dos veces y ejecutar la verificación de solo lectura.
- [x] Integrar en frontend el editor y render con puntaje visible/oculto.
- [ ] Probar explícitamente rollback y correcciones concurrentes contra SQL Server real.

## Calificación configurable — etapa 2

**Estado: BACKEND IMPLEMENTADO — PENDIENTE PRUEBA MANUAL FRONTEND/SQL REAL**

- [x] Evolucionar la corrección a `puntajeObtenido` sobre `IntentoPregunta`.
- [x] Mantener `esCorrecta` como compatibilidad temporal.
- [x] Permitir corregir preguntas omitidas y modificar autocorrecciones.
- [x] Auditar valor, comentario, origen y actor de cada corrección.
- [x] Recalcular nota automática, calculada y efectiva dentro de la transacción.
- [x] Convertir `calificar` en override final auditado, válido en escalas 10/100.
- [x] Exponer puntajes, origen y descomposición de nota en el intento completo.
- [x] Validar propiedad de la comisión para escrituras docentes.
- [x] Agregar cobertura focalizada de compatibilidad, parciales, 100.00 y rollback.
- [ ] Probar manualmente corrección parcial, pregunta omitida y modificación de una
  autocorrección desde el frontend contra la base de prueba.
- [ ] Probar dos correcciones concurrentes sobre el mismo intento en SQL Server real.

La inconsistencia de reportes por escalas 10/100 y umbrales hardcodeados quedó resuelta
de forma transversal en la etapa 5. Otros módulos legacy todavía pueden contener reglas
4/6 propias; no unificarlas incidentalmente sin revisar su contrato académico.

## Calificación configurable — etapa 3

**Estado: BACKEND IMPLEMENTADO — PENDIENTE PRUEBA MANUAL FRONTEND/SQL REAL**

- [x] Resolver automáticamente el último intento `entregado` con desempate estable por
  fecha de finalización, número e ID.
- [x] Excluir `en_progreso`, `vencido` y `anulado` de la selección automática.
- [x] Exponer un resumen seguro de todos los intentos por alumno/publicación.
- [x] Permitir selección manual persistente, auditada, reversible e idempotente.
- [x] Mantener el override manual frente a entregas posteriores.
- [x] Validar candidato, publicación, alumno y propiedad docente dentro de transacción.
- [x] Permitir al alumno consultar únicamente sus propios resúmenes, sin respuestas.
- [x] Cerrar el acceso al detalle completo de intentos para docentes ajenos a la comisión.
- [x] Agregar cobertura focalizada para selección, desempates, RBAC, auditoría y rollback.
- [ ] Probar manualmente alta, reemplazo y eliminación del override desde el frontend.
- [ ] Probar dos selecciones concurrentes contra SQL Server real.

La etapa reutiliza `IntentoValidoOverride` e `HistorialIntentoValidoOverride`, ya creadas
por `20261011_calificacion_intentos_telemetria.sql`; no requiere otra migración.

## Calificación configurable — etapa 4

**Estado: BACKEND IMPLEMENTADO — PENDIENTE PRUEBA MANUAL FRONTEND/SQL REAL**

- [x] Agregar `GET /api/intentos/mios`, exclusivo de alumno e identificado por JWT.
- [x] Mantener los endpoints históricos con matrícula por compatibilidad.
- [x] Validar filtros de materia, comisión, fechas, estado, resultado, paginación y orden.
- [x] Combinar filtros con semántica AND y ordenar con desempate estable por ID.
- [x] Calcular resultado con `Actividad.NotaAprobacion`, preservando escalas 10/100.
- [x] Resolver intento válido antes de filtrar y respetar el override manual.
- [x] Calcular resumen sobre todo el resultado filtrado, independiente de la página.
- [x] Omitir respuestas, opciones y contenido completo del examen.
- [x] Reutilizar tablas actuales sin migración ni Stored Procedures nuevos.
- [x] Agregar cobertura focalizada de identidad, filtros, fechas, orden, resumen y RBAC.
- [ ] Probar filtros combinados y paginación desde el frontend contra SQL Server real.
- [ ] Verificar el plan de ejecución con un volumen representativo de intentos.

## Calificación configurable — etapa 5

**Estado: BACKEND IMPLEMENTADO — PENDIENTE PRUEBA MANUAL FRONTEND/SQL REAL**

- [x] Aplicar `Actividad.NotaAprobacion` en ambos endpoints de reportes.
- [x] Normalizar a base 10 los promedios que combinan actividades de escalas 10/100.
- [x] Preservar escala, umbral y promedio original en filas de una evaluación.
- [x] Incorporar `alcanceIntentos=todos|validos`, con `todos` como default compatible.
- [x] Separar conteos operativos de métricas académicas.
- [x] Respetar override manual y selección automática estable en alcance `validos`.
- [x] Filtrar evaluaciones mediante `conPendientesCorreccion=true|false` antes de KPIs
  y paginación.
- [x] Mantener RBAC docente y calcular agregados sobre todo el conjunto filtrado.
- [x] Agregar cobertura focalizada para umbral, escalas, alcance, override y pendientes.
- [ ] Probar manualmente ambos reportes con datos mixtos 10/100 en el frontend.
- [ ] Ejecutar las consultas contra SQL Server real con varios intentos y overrides.
- [ ] Verificar planes de ejecución con un volumen representativo.

La etapa reutiliza la migración ya aplicada
`20261011_calificacion_intentos_telemetria.sql`; no requiere otro script SQL.

## Calificación configurable — etapa 6

**Estado: BACKEND IMPLEMENTADO — PENDIENTE PRUEBA MANUAL FRONTEND/SQL REAL**

- [x] Agregar `PUT /api/telemetria/intentos/:idIntento/incidentes/:eventoId`.
- [x] Admitir inicio y cierre separados o juntos, con replay idempotente por UUID.
- [x] Rechazar reutilización incompatible del UUID sin duplicar ni sobrescribir datos.
- [x] Validar titularidad del intento desde el alumno del JWT.
- [x] Registrar timestamps cliente y recepción server-side sin consecuencias automáticas.
- [x] Documentar tolerancia de reloj de cinco minutos y sincronización tardía de siete días.
- [x] Agregar resumen y listado para docente propietario/administrador.
- [x] Calcular cantidad, suma, promedio y máximo de pérdidas de foco.
- [x] Mantener los endpoints legacy de `AlertaFraude` y navegación.
- [x] Reutilizar `IncidenteIntento` sin migración ni Stored Procedures nuevos.
- [x] Cubrir inicio, cierre, idempotencia, conflicto, duración, RBAC, alcance y agregados.
- [ ] Probar ciclo offline/reintento desde el frontend contra SQL Server real.
- [ ] Probar escrituras concurrentes del mismo UUID contra la constraint real.
- [ ] Verificar planes de ejecución y volumen de incidentes por intento.

La etapa reutiliza la migración ya aplicada
`20261011_calificacion_intentos_telemetria.sql`; no requiere otro script SQL.

## Evolución — etapa previa a telemetría temporal

**Estado: BACKEND IMPLEMENTADO — PENDIENTE SQL REAL E INTEGRACIÓN FRONTEND**

- [x] Agregar anulación autoritativa e idempotente vinculada a un `EventoId` existente.
- [x] Restringir la operación al alumno titular o administrador autorizado.
- [x] Exigir intento en progreso, conservar respuestas y mantener todas las notas nulas.
- [x] Ampliar aditivamente el incidente actual con `fullscreen_exit`.
- [x] Persistir y auditar confirmación automática/manual de la corrección.
- [x] Exigir puntajes definitivos antes de la confirmación docente.
- [x] Reabrir la corrección al modificar una pregunta o la nota después de confirmar.
- [x] Exponer `correccionConfirmada` y `revisionDisponible` en el historial propio.
- [x] Bloquear con `REVIEW_NOT_AVAILABLE` el intento completo del alumno no confirmado.
- [x] Exponer claves correctas al alumno únicamente después de la confirmación.
- [x] Agregar migración idempotente y verificador de sólo lectura.
- [x] Agregar cobertura HTTP focalizada de replay, RBAC, pendientes y revisión segura.
- [ ] Aplicar dos veces `20261015_anulacion_confirmacion_revision.sql` en SQL Server
  de prueba y ejecutar `verificar-anulacion-confirmacion-revision.sql`.
- [ ] Probar desde el frontend: sincronizar respuestas, registrar incidente, anular y
  confirmar/reabrir correcciones.
- [ ] Probar anulación y confirmación concurrentes contra SQL Server real.

La consecuencia temporal se activa sólo mediante el endpoint explícito de anulación;
registrar un incidente por sí solo continúa sin modificar el intento. La etapa 3
generalizará eventos y tiempos; la etapa 5 reemplazará la habilitación directa por una
política y sesiones de revisión.

## Evolución — etapa 3: telemetría temporal confiable

**Estado: BACKEND IMPLEMENTADO — PENDIENTE SQL REAL E INTEGRACIÓN FRONTEND**

- [x] Extender `IncidenteIntento` sin romper las filas ni endpoints legacy.
- [x] Agregar catálogo de eventos y unicidad por intento, sesión y secuencia.
- [x] Incorporar escritura individual idempotente y cierre posterior de intervalos.
- [x] Incorporar lote de hasta 500 eventos con resultado y transacción por elemento.
- [x] Agregar listado paginado, resumen, unión de solapamientos y fallback legacy.
- [x] Exponer `idIntentoPregunta` junto con `idPregunta` en el render del examen.
- [x] Validar reloj, duración, orden temporal, ventana de siete días y pertenencia.
- [x] Mantener los eventos sin efectos sobre nota, estado o intento válido.
- [x] Agregar migración idempotente, verificador de sólo lectura y tests focalizados.
- [ ] Aplicar dos veces `20261016_telemetria_temporal.sql` en SQL Server de prueba y
  ejecutar `verificar-telemetria-temporal.sql`.
- [ ] Probar replays y UUID/secuencia concurrentes contra las constraints reales.
- [ ] Contrastar en SQL real la unión de intervalos solapados y el fallback por pregunta.
- [ ] Integrar la cola offline del frontend y probar recuperación posterior al cierre.

Los endpoints legacy mantienen `200`, listado completo y ventana de siete días. El
nuevo `GET /eventos` limita cada página a 100. El lote no usa una transacción global:
un elemento rechazado o en conflicto no revierte los elementos válidos.

## Evolución — etapa 4: rendimiento por pregunta y grupo

**Estado: BACKEND IMPLEMENTADO — PENDIENTE ÍNDICES, PLANES E INTEGRACIÓN FRONTEND**

- [x] Agregar reportes paginados de preguntas, grupos/variantes y distribución de opciones.
- [x] Aplicar filtros por estructura académica, fechas, estado, corrección y alcance
  `todos|validos`, con RBAC docente por comisión y administrador institucional.
- [x] Calcular KPIs sobre todo el conjunto filtrado antes de paginar, con orden estable.
- [x] Normalizar puntajes como porcentaje del máximo snapshot para combinar escalas 10/100.
- [x] Conservar identidad histórica por `ContenidoHashSnapshot` y tratar el banco sólo
  como procedencia de una copia independiente.
- [x] Unir intervalos `question_active` superpuestos, devolver tiempos ausentes como null
  y usar navegación legacy sólo como fallback por pregunta.
- [x] Calcular opciones/distractores desde snapshots y adjuntar variantes por grupo sin N+1.
- [x] Agregar tests focalizados, documentación, migración de índices y verificador de lectura.
- [x] Ejecutar las consultas de preguntas, grupos, opciones y medianas en SQL Server real
  con los datos disponibles, sin aplicar escrituras.
- [ ] Aplicar dos veces `20261017_indices_rendimiento_preguntas.sql` y ejecutar
  `verificar-indices-rendimiento-preguntas.sql`.
- [ ] Comparar planes antes/después con volumen representativo. La base de prueba actual
  es pequeña y no permite concluir selectividad o costo productivo de los índices.
- [ ] Integrar y comprobar manualmente dashboards de preguntas, variantes, grupos y opciones.

No se aplica una etiqueta de “diferencia significativa” entre variantes hasta acordar un
umbral o método estadístico. El contrato expone diferencia porcentual y tamaño de muestra.

### Entregas 1 y 2 — análisis docente e institucional v1.1.0 / v1.2.0

- [x] Cerrar contrato en `docs/CONTRATO_REPORTES_DOCENTE_V1.md`.
- [x] Agregar resultados oficiales y pendientes operativos sin alterar campos/gráfico legacy.
- [x] Agregar muestras oficiales, exclusiones disjuntas y hallazgo versionado por pregunta.
- [x] Agregar muestras oficiales a grupos/variantes y evidencia exacta por `claveContenido`.
- [x] Mantener RBAC, selección canónica de intento y paginación posterior a agregados.
- [x] Validar exactitud funcional contra SQL Server real con datos controlados.
- [x] Implementar la Entrega 2 de resumen institucional por materia/comisión.
- [x] Ampliar la síntesis institucional con carrera, comparativas completas y serie
  mensual de hasta 60 meses, según
  `docs/CONTRATO_REPORTES_INSTITUCIONALES_V1_2.md`.
- [ ] Comparar planes con un volumen representativo; la base de prueba sigue siendo pequeña.

## Evolución — etapa 5: políticas y sesiones de revisión

**Estado: CORRECCIÓN BACKEND IMPLEMENTADA — PENDIENTE NUEVA MIGRACIÓN, SQL REAL Y AJUSTE FRONTEND**

- [x] Agregar políticas por publicación: `nunca`, `al_corregir`, `ventana` y `manual`.
- [x] Agregar acceso `unico|libre`, revisión optimista y auditoría de cambios.
- [x] Incorporar permisos individuales activos/revocados ligados al intento concreto.
- [x] Aplicar precedencia de corrección, revocación, permiso y política sobre intento válido.
- [x] Emitir sesiones de cinco minutos con `Idempotency-Key` y snapshot de autorización.
- [x] Garantizar una sola sesión única activa y consumo atómico con conflicto en el replay.
- [x] Construir el contenido del alumno desde snapshots, sin reutilizar `/completo`.
- [x] Reservar `/completo` para docentes/administradores y exigir sesión al alumno.
- [x] Propagar la política efectiva a `revisionDisponible` en historiales compatibles.
- [x] Crear migración idempotente, backfill compatible y verificador de sólo lectura.
- [x] Agregar pruebas focalizadas de modos, ventanas, permisos, revocación, intento válido,
  sesiones, expiración, consumo, RBAC y auditoría.
- [x] Corregir `nunca` como prohibición absoluta y `manual` como autorización sólo
  individual, manteniendo los paths y payloads existentes.
- [x] Persistir el consumo `unico` por intento para impedir nuevas emisiones después de
  la primera apertura real, sin agotarlo por una sesión vencida sin consumo.
- [x] Limitar cada expiración al mínimo entre 300 segundos, ventana general y permiso
  individual, y ampliar aditivamente el contrato de disponibilidad.
- [x] Crear `20261019_semantica_revision_unica.sql` y su verificador de sólo lectura.
- [x] Aplicar dos veces `20261018_revision_examen.sql` en SQL Server de prueba y ejecutar
  `verificar-revision-examen.sql`.
- [ ] Aplicar dos veces `20261019_semantica_revision_unica.sql` después de la anterior y
  ejecutar `verificar-semantica-revision-unica.sql`.
- [ ] Probar emisión/consumo y revocación concurrentes contra SQL Server real.
- [x] Integrar en frontend configuración docente, permisos y revisión por sesión de la
  etapa original.
- [ ] Integrar en frontend los campos aditivos y motivos estables de la corrección
  semántica, después de aplicar `20261019`.

El despliegue de backend requiere aplicar ambas migraciones en orden. La creación de
nuevas publicaciones ya inserta la política default en la misma transacción. No se
modificaron Stored Procedures ni datos académicos históricos.

**Siguiente trabajo funcional:** etapa 6, políticas configurables de pantalla completa
e incidentes.

---

## Evolución — etapa 6: políticas configurables de fullscreen e incidentes

**Estado: BACKEND IMPLEMENTADO — PENDIENTE MIGRACIÓN, SQL REAL E INTEGRACIÓN FRONTEND**

- [x] Agregar política y reglas versionadas por publicación.
- [x] Congelar política, reglas y estado al iniciar o reanudar un intento.
- [x] Mantener `temporal-v1` como configuración predeterminada compatible.
- [x] Evaluar cantidad, duración individual y duración acumulada uniendo solapamientos.
- [x] Aplicar prioridad autoritativa y devolver sólo la instrucción operativa al cliente.
- [x] Reutilizar la anulación transaccional con actor `sistema` e idempotencia por evento.
- [x] Mantener el guardado de respuestas durante bloqueos visuales.
- [x] Incorporar detalle docente y overrides auditados sin reapertura de anulados.
- [x] Crear `20261019_politicas_supervision.sql` y verificador de sólo lectura.
- [x] Agregar cobertura focalizada de snapshots, prioridad, replay, recuperación,
  anulación y override.
- [ ] Aplicar la migración dos veces y ejecutar `verificar-politicas-supervision.sql`.
- [ ] Probar eventos simultáneos, unicidad y anulación contra SQL Server real.
- [ ] Integrar editor docente y acciones dirigidas por backend en el frontend.

---

## Evolución — etapa 7: visibilidad operativa de anulaciones e incidentes

**Estado: BACKEND IMPLEMENTADO — PENDIENTE MIGRACIÓN, SQL REAL E INTEGRACIÓN FRONTEND**

- [x] Crear historial append-only `RevisionIncidenteIntento` con revisión optimista.
- [x] Reutilizar `OperacionIdempotente` para la revisión docente por evento.
- [x] Excluir eventos con `EsIncidente=0` de listados y conteos operativos.
- [x] Agregar listado por publicación con filtros, KPIs y navegación al intento.
- [x] Ampliar aditivamente rendimiento por evaluación con anulaciones e incidentes.
- [x] Mantener KPIs sobre todo el conjunto filtrado antes de paginar.
- [x] Preservar `escalaCalificacion`, `notaAprobacion`, notas y estados académicos.
- [x] Crear `20261020_visibilidad_incidentes.sql` y verificador de sólo lectura.
- [x] Agregar cobertura de RBAC, filtros, conteos, revisión, replay y concurrencia optimista.
- [ ] Aplicar la migración dos veces y ejecutar `verificar-visibilidad-incidentes.sql`.
- [ ] Verificar consistencia listado/detalle, concurrencia y planes en SQL Server real.
- [ ] Integrar badges, filtros y enlaces al intento en el frontend.

---

## Fase 0 — Access y refresh tokens server-side

**Estado: COMPLETADA — 2026-07-23**

- [x] Emitir access JWT HS256 de 15 minutos con issuer, audience y `tokenType`.
- [x] Crear sesiones absolutas configurables de 12 horas, sin extensión deslizante.
- [x] Emitir refresh tokens opacos con UUID aleatorio, prueba HMAC y hash persistido.
- [x] Crear `AuthSession` y `AuthRefreshToken` mediante migración idempotente.
- [x] Rotar refresh tokens dentro de una transacción serializable en SQL Server.
- [x] Revocar la familia ante logout o reutilización fuera de tolerancia.
- [x] Exigir `Idempotency-Key` UUID y devolver resultados repetibles.
- [x] Mantener `accessToken` canónico y `token` como alias legacy deprecado.
- [x] Aplicar Zod al login y eliminar logs de contraseña/hash.
- [x] Diferenciar errores de autenticación mediante códigos estables.
- [x] Validar configuración antes de iniciar la API.
- [x] Verificar el flujo real: health, login, rotación, repetición idempotente,
  logout y rechazo posterior con `REFRESH_TOKEN_REVOKED`.
- [x] Verificar 12 suites y 202 tests, también con `--detectOpenHandles`.

### Cobertura de regresión ya existente

- [x] Refresh vencido por expiración del token.
- [x] Refresh revocado mediante estado de sesión y motivo `logout`.
- [x] Usuario desactivado entre login y refresh.
- [x] Asociación institucional invalidada antes del refresh.
- [x] Misma clave idempotente, clave diferente dentro de gracia y replay posterior.
- [x] Rollback ante fallo durante la rotación.
- [x] Logout sin access, logout idempotente, token desconocido y access vencido.
- [x] Rechazo de algoritmo, issuer y audience incorrectos.
- [x] Rechazo de refresh opaco usado como access token.
- [x] Rate limiting local de login.
- [x] Prueba manual real de logout seguido de refresh revocado.

---

## Fase 1 — Reforzar cobertura automatizada de autenticación

**Estado: PENDIENTE — NO BLOQUEA LA INTEGRACIÓN FRONTEND**

- [ ] Verificar que un cambio válido de rol o asociación se refleje en el próximo
  access token sin aceptar identidad controlada por el body.
- [ ] Agregar un caso separado donde expire `AuthSession` aunque el registro de
  refresh todavía tenga una fecha futura.
- [ ] Verificar que el access token emitido cerca del fin de sesión quede
  truncado al máximo absoluto y nunca lo supere.
- [ ] Rechazar un refresh con formato válido y prueba HMAC alterada.
- [ ] Rechazar un JWT firmado correctamente pero con `tokenType` distinto de
  `access`, sin permitir fallback legacy.
- [ ] Cubrir el rate limiting local de `/api/auth/refresh`, incluidos límite por
  token y límite agregado por IP.
- [ ] Crear una regresión HTTP stateful de logout seguido de refresh que comparta
  el mismo estado de persistencia mockeado.
- [ ] Probar dos renovaciones verdaderamente concurrentes. La suite actual simula
  secuencialmente el estado resultante; para validar bloqueos reales entre
  conexiones se necesita un test de integración opt-in contra SQL Server o un
  harness transaccional dedicado que no forme parte de la suite aislada.
- [ ] Verificar que un cambio de rol inválido o una vinculación eliminada revoque
  la familia sin dejar una rotación parcial.

**Criterio de finalización:** todos los casos anteriores pasan de forma
determinista, sin depender de esperas arbitrarias ni de una base real en la suite
Jest estándar. El caso de bloqueo SQL puede vivir en una suite de integración
separada y documentada.

---

## Fase 2 — Retiro de compatibilidad y preparación productiva

**Estado: PENDIENTE**

- [!] Desactivar `AUTH_ALLOW_LEGACY_ACCESS_TOKENS` cuando el frontend y cualquier
  otro cliente hayan migrado y no queden JWT legacy vigentes.
- [!] Retirar el alias deprecado `token` después de confirmar que ningún cliente
  lo consume.
- [ ] Agregar rate limiting distribuido en gateway, proxy o infraestructura para
  despliegues multiinstancia; el límite en memoria seguirá siendo defensa local.
- [ ] Definir retención de `AuthSession` y `AuthRefreshToken`, ventana mínima de
  auditoría y job idempotente de purga de familias expiradas/revocadas.
- [ ] Definir un procedimiento de rotación de `JWT_SECRET` y
  `AUTH_REFRESH_TOKEN_SECRET`. Evaluar keyring solo si se necesita rotación sin
  invalidación coordinada.
- [ ] Exigir y verificar HTTPS en la configuración de despliegue.
- [ ] Ejecutar la migración y configurar secretos independientes en cada ambiente.
- [ ] Resolver la configuración TypeScript (`rootDir/include`,
  CommonJS/NodeNext, `verbatimModuleSyntax` y tipos de `mssql`) hasta recuperar
  un `npm run build` operativo.

---

## Fase 3 — Continuidad e idempotencia de evaluaciones

**Estado: PENDIENTE — REQUIERE DECISIONES FUNCIONALES**

- [ ] Definir idempotencia de telemetría para evitar duplicar alertas o métricas
  ante el único reintento del BFF.
- [ ] Implementar vencimiento automático de intentos con una autoridad temporal
  única en backend/SQL Server.
- [!] Acordar qué sucede cuando vence el tiempo mientras existen respuestas
  pendientes o solicitudes en curso.
- [ ] Verificar que refresh, logout fallido y errores de autenticación nunca
  modifiquen intento, publicación, respuestas o temporizador.
- [ ] Mantener la idempotencia existente de inicio, misma respuesta y
  finalización al introducir cualquier cambio temporal.

---

## Otras deudas registradas

- [ ] Completar autorización por propiedad en endpoints de alumno y docente.
- [!] Acordar RBAC para rutas legacy de carreras, materias y comisiones antes de
  protegerlas para no romper clientes.
- [ ] Resolver el SP duplicado en materias/comisiones de docentes.
- [!] Unificar el umbral oficial de aprobación actualmente calculado como 4 o 6.
- [ ] Corregir actualizaciones parciales de usuario que pueden nulificar
  asociaciones omitidas.
- [ ] Completar update/delete de divisiones o retirar temporalmente las rutas 501.

## Orden recomendado

1. Completar la fase 1 como iteración pequeña de tests.
2. Finalizar la migración frontend y retirar luego compatibilidad legacy.
3. Recuperar el build TypeScript antes de preparar producción.
4. Definir retención y rate limiting distribuido.
5. Acordar reglas temporales e idempotencia de telemetría antes de modificar
   evaluaciones.

## Próximo paso

Implementar la fase 1 empezando por tests unitarios/HTTP que no requieren SQL
real. Diseñar por separado el test opt-in de concurrencia contra SQL Server para
no degradar el aislamiento de la suite Jest estándar.

## Evolución: selección múltiple y justificación

### Etapa 1 — modelo y edición

- [x] Tipo `multiple` y configuración de justificación/corrección en schemas.
- [x] Persistencia y copia bidireccional en evaluación y banco.
- [x] Hash de contenido independiente de IDs y procedencia.
- [x] Migración idempotente con preparación de respuesta, snapshots e historial.
- [x] Bloqueo 409 al publicar contenido cuyo runtime corresponde a la etapa 2.
- [x] Cobertura HTTP focalizada y documentación.
- [ ] Reaplicar dos veces la versión corregida de
  `20261013_respuestas_multiples_justificacion.sql` en SQL Server de prueba y ejecutar
  su verificador. La primera aplicación dejó vigente `CHK_Pregunta_Tipo` y un check
  autogenerado de `BancoPregunta` que todavía bloqueaban `multiple`.
- [x] Etapa 2 backend: render inmutable, guardado atómico/revisionado, entrega y
  corrección del nuevo modelo, con compatibilidad legacy y cobertura HTTP.
- [ ] Aplicar dos veces `20261014_runtime_respuestas_multiples.sql` en SQL Server de
  prueba y ejecutar `verificar-runtime-respuestas-multiples.sql`.

---

## Banco privado de preguntas — implementación de alternativa 1 (2026-09-08)

**Estado: backend implementado; pendiente aplicar/verificar SQL en un entorno
aislado y construir frontend. No habilitado como funcionalidad completa de producto.**

### Backend terminado

- [x] Módulo `/api/banco-preguntas`: preguntas, opciones, grupos reutilizables y etiquetas.
- [x] Propiedad por docente activo; admin solo consulta; alumnos sin acceso al banco.
- [x] Estados borrador/disponible/archivado, revisiones y errores 409 para edición obsoleta.
- [x] Borradores incompletos; validación de mc/vf/abierta al habilitar; `code` no importable.
- [x] Edición válida conserva disponibilidad. Archivar/retirar una pregunta de disponibilidad
  devuelve a borrador sus grupos disponibles, informándolos en la respuesta.
- [x] Filtros, paginación estable y etiquetas privadas con unicidad normalizada.
- [x] Copia transaccional con IDs nuevos y procedencia al crear, editar o agregar a un borrador.
- [x] Selección completa con revisión de grupo y revisiones de sus variantes; sin sincronización.
- [x] Copia explícita desde evaluaciones autorizadas hacia borradores propios del banco.
- [x] Validación de comisión destino y todas las publicaciones de una actividad para docentes.
- [x] Validación de pertenencia/repetición de IDs anidados; rollback ante cualquier fallo.
- [x] Bloqueo de edición si hay intentos; transiciones sin reapertura; estado/edición en transacción.
- [x] Contratos y ejemplos de integración registrados en README; modelo en README_DATABASE.
- [x] Suite del banco y ajustes de fixtures de evaluaciones/RBAC; sin SQL real en Jest.
- [x] Borradores reales de evaluación con defaults y estructura incompleta permitida.
- [x] `Actividad.Revision`, edición optimista y revisión devuelta en creación, edición,
  detalle, importación y publicación.
- [x] Grupo desde contenido mixto, referencias opcionales y preservación de procedencia.
- [x] Publicación completa transaccional con `GuardarTodoEnBanco`, comparación de contenido
  y copias independientes cuando la referencia ya no coincide.
- [x] Idempotencia persistente para POST de creación/copia/publicación; clave UUID,
  hash canónico, replay y conflicto de payload.

### SQL y despliegue — pendiente operativo (no ejecutado)

Responsable: backend/DBA; dependencia: seleccionar una base SQL Server aislada y
confirmar el esquema efectivo. Los scripts están guardados en el proyecto.

- [x] Preparar `migrations/20260908_banco_preguntas.sql`: siete tablas, FKs de propietario,
  índices, auditoría UTC y procedencia nullable en tablas actuales; sin cambios a SPs.
- [x] Preparar `scripts/verificar-banco-preguntas.sql`: metadatos, constraints, índices,
  conteos, disponibilidad incoherente y procedencia. Solo lectura.
- [x] Preparar `migrations/20260926_evaluacion_revision_idempotencia.sql` y
  `scripts/verificar-evaluacion-idempotencia.sql`; no aplicados sobre bases compartidas.
- [ ] Comparar metadatos efectivos con el DDL antes de aplicar. Criterio: tipos, claves,
  schema dbo y nulabilidad compatibles; no continuar si hay una instalación parcial.
- [ ] Aplicar migración en base aislada y repetirla. Criterio: segunda ejecución sin
  duplicación, constraints confiables y datos previos intactos.
- [ ] Ejecutar consultas de verificación. Criterio: siete tablas, relaciones correctas,
  auditoría/procedencia válidas y ninguna incoherencia nueva de disponibilidad.
- [ ] Verificar con SQL Server el rechazo de relaciones entre propietarios distintos
  y la unicidad de etiquetas/posiciones. Los mocks no prueban constraints reales.
- [ ] Probar rollback real con fallo a mitad de copia. Criterio: ningún grupo/pregunta/opción
  de destino parcial; no dejar datos de prueba en ambientes compartidos.
- [ ] Probar dos sesiones concurrentes: editar/importar, publicar/editar y cambiar estado
  de variante/importar grupo. Criterio: copia consistente o error, nunca mezcla de revisiones
  ni estructura modificada después de publicación. Medir bloqueo por docente y deadlocks.
- [ ] Prueba funcional contra API y SQL: crear desde banco, iniciar intento, verificar una
  variante por grupo, responder/corregir y luego editar/archivar el banco. Criterio: examen
  e intento originales conservan contenido y claves de corrección.
- [ ] Desplegar migración antes del backend. Criterio: health correcto y prueba de copia
  exitosa. Si se revierte backend, conservar tablas/columnas nuevas; no borrar bancos.

### Frontend — pendiente separado

Responsable: frontend Next.js; dependencia: backend desplegado y migración verificada.
No se modificaron archivos del frontend en esta implementación.

- [ ] Agregar servicios/tipos y rutas BFF para los endpoints del banco. Criterio: PascalCase
  al escribir, camelCase al leer y propagación de 400/401/403/404/409 sin logout por conflicto.
- [ ] Pantalla docente del banco con búsqueda, filtro por tipo/estado/etiqueta y paginación.
  Criterio: distinguir archivados y no mostrar acciones de otro propietario.
- [ ] Editor de preguntas con título, enunciado, tipo, opciones y clave correcta; permitir
  guardar borradores incompletos. Criterio: mc con respuesta única, vf verdadero/falso,
  abierta sin opciones; code identificado como no utilizable todavía.
- [ ] Editor de grupos con selección de variantes propias y orden. Criterio: no repetir
  preguntas y mostrar cuáles impiden disponibilidad. No confundir grupo con carpeta temática:
  el motor sortea una pregunta por grupo.
- [ ] Gestión de etiquetas de pregunta/grupo. Criterio: renombrar/eliminar asociaciones
  sin borrar contenido; manejar nombre duplicado con 409.
- [ ] Acciones de disponibilidad, archivado y restauración. Criterio: informar los
  `gruposAfectados` al retirar disponibilidad de una pregunta.
- [ ] Manejo de edición concurrente con `RevisionEsperada`. Criterio: ante 409 recargar
  y permitir revisar los cambios; nunca sobrescribir silenciosamente.
- [ ] Selector de banco al crear examen, mediante `ImportacionesBanco`. Criterio: enviar
  IDs/revisiones de todas las variantes de grupos y evitar selección duplicada.
- [ ] Importar a borrador guardado usando el endpoint dedicado o edición completa.
  Criterio: mapear los IDs nuevos de la respuesta y conservar los grupos actuales si se
  usa PUT completo; recordar que grupos omitidos de `GruposPreguntas` se eliminan.
- [ ] Permitir adaptar la copia y mostrar su independencia respecto del banco. Criterio:
  no tratar IDs de banco como IDs del examen ni presentar revisión de origen como igualdad
  garantizada. No se soporta mover IDs existentes entre grupos en la edición actual.
- [ ] Acción "Guardar en mi banco" desde preguntas/grupos de evaluaciones autorizadas.
  Criterio: selección explícita, nuevos borradores, sin prometer atribución histórica.
- [ ] Vista administrativa de consulta con selector de docente (`idDocente` también en
  detalles), sin controles de escritura/importación; respuestas correctas visibles solo
  a admin/propietario, nunca reutilizar estos DTOs para pantallas de alumnos.
- [ ] Actualizar controles del editor de evaluaciones: impedir reapertura y edición
  publicada/archivada o con intentos; manejar comisión/publicación fuera de alcance.
- [ ] E2E con dos docentes y admin: aislamiento, copia independiente, edición concurrente,
  archivado y preservación del examen. Ante timeout, repetir exactamente el mismo body y
  la misma `Idempotency-Key`; nunca generar automáticamente una clave nueva.

### Próxima etapa y deudas detectadas

- [ ] Banco público/compartido: definir visibilidad, atribución y permisos antes de diseñar
  nuevas tablas. No confundir lectura compartida con edición del original.
- [ ] Historial de versiones: hoy revisión es control de concurrencia, no permite reconstruir
  un estado anterior del banco. Mantener snapshots de evaluaciones durante esa evolución.
- [ ] Soporte completo de `code`: el schema legacy lo admite, pero el SP de finalización
  revisado solo cuenta `abierta` como manual. Definir corrección manual y cubrir todo el flujo
  antes de habilitar disponibilidad/importación de code.
- [ ] Reporte de rendimiento por pregunta/grupo reutilizable en múltiples evaluaciones.
  Alcance y criterios pendientes detallados en la sección siguiente.
- [ ] Asociaciones opcionales a varias materias, dificultad y archivos adjuntos.
- [ ] Autoría histórica/transferencia: no inferir autor por el docente actual de la comisión.
  Una actividad con publicaciones de varios docentes queda fuera del alcance de copia/edición
  docente en v1; definir colaboración explícita antes de flexibilizar esa regla.
- [x] Idempotencia persistente de POST de copia/creación/publicación implementada. La purga
  automática sigue deliberadamente ausente; retención mínima documentada de siete días.
- [ ] Auditar autorización de consultas legacy de evaluaciones/intentos y exposición de
  `EsCorrecta` al alumno. Esta entrega protege el banco y sus operaciones de copia, no completa
  toda la autorización por propiedad del sistema.
- [ ] Protección frente a SQL manual y reglas de publicación legacy: no se agregaron triggers
  ni se endurecieron globalmente schemas de preguntas anteriores. La garantía de inmutabilidad
  de esta entrega cubre los caminos de API modificados.
- [ ] Evolucionar el bloqueo por docente si las pruebas de concurrencia muestran contención;
  mantener atomicidad de composición, estados y revisión de variantes.
- [ ] Resolver deuda previa de build TypeScript y tipos de mssql en un ticket propio. La
  comprobación estática focalizada no equivale a recuperar `npm run build`.

### Reporte de rendimiento del banco — pendiente de próxima etapa

Solicitud registrada: analizar preguntas y grupos del banco a través de múltiples
evaluaciones, además del detalle por publicación. No implementado en esta entrega.

**Backend y datos**

- [ ] Diseñar consultas y endpoints que relacionen `BancoPregunta` con las copias mediante
  `Pregunta.IdBancoPreguntaOrigen`, y `BancoGrupo` mediante
  `GrupoPregunta.IdBancoGrupoOrigen`. Conservar el desglose por actividad, publicación,
  comisión y fecha; aplicar propiedad docente y permisos de consulta administrativa.
- [ ] Calcular exposición desde `IntentoPregunta`: contar solo los intentos a los que se
  asignó cada variante. Separar respuestas correctas, incorrectas, omitidas y pendientes
  de corrección; no tratar una respuesta abierta sin corregir como error.
- [ ] Agregar rendimiento de grupo desde el grupo de la evaluación y su procedencia.
  No inferir pertenencia histórica usando las asociaciones actuales del banco: una
  pregunta puede integrar varios grupos y una incorporación individual no registra
  necesariamente `IdBancoGrupoOrigen`.
- [ ] Registrar una correspondencia histórica explícita para copias evaluación → banco.
  Caso concreto: docente `108991`, publicación `50`, importada mediante
  `scripts/importar-publicacion-50-banco-docente-108991.sql`. El script devuelve el mapa
  de IDs, pero no lo persiste ni modifica la evaluación; la etiqueta identifica el lote,
  no cada correspondencia. Recuperar/verificar ese mapa antes de incluir sus resultados
  históricos. No inferirlo únicamente por texto, título ni orden de IDs, ni atribuirle
  retroactivamente una incorporación banco → evaluación que no ocurrió.
- [ ] Cubrir aislamiento, variantes sorteadas, preguntas sin respuesta, corrección manual,
  múltiples publicaciones de una actividad, múltiples intentos y contenido adaptado.
  Verificar que los agregados no dupliquen respuestas por joins y que los totales sean
  independientes de la paginación; comprobar las consultas contra SQL Server aislado.

**Decisiones de producto y modelo**

- [ ] Definir si las métricas se calculan por intento o por alumno y, en este último caso,
  cómo elegir entre primer, último o mejor intento. Mientras no se acuerde otra regla,
  mantener métricas explícitamente por intento, consistentes con reportes actuales.
- [ ] Definir estados de intentos incluidos y denominadores de cada porcentaje; mostrar
  tamaño de muestra y distinguir alumnos únicos de cantidad de intentos.
- [ ] Distinguir versiones y copias adaptadas antes de comparar contenido como equivalente.
  `RevisionBancoOrigen` conserva la revisión al copiar, pero no garantiza igualdad tras
  editar la copia ni permite reconstruir versiones anteriores del banco. Evaluar versiones
  inmutables o una huella del contenido relevante, incluyendo opciones y clave correcta,
  sin sincronizar ni alterar las evaluaciones históricas.

**Frontend**

- [ ] Incorporar la vista de rendimiento desde preguntas/grupos del banco, con resumen
  global y desglose por evaluación, publicación y comisión; filtros de fecha y versión
  según el contrato acordado con backend.
- [ ] Mostrar muestra, aciertos, errores, omisiones y pendientes de corrección; indicar
  si la unidad es alumno o intento. Identificar contenido adaptado y evaluaciones sin
  trazabilidad histórica, sin presentar ausencia de datos como rendimiento cero.
- [ ] Permitir navegar al detalle de las evaluaciones autorizadas y verificar que filtros
  y paginación mantengan métricas consistentes con el resumen.

### Evidencia de validación local

- Suite completa actual: **26 suites / 513 pruebas aprobadas**, también con
  `--runInBand --detectOpenHandles`. Jest finaliza naturalmente sin `--forceExit`.
- Suite del banco: **66 pruebas aprobadas**; incluye integración HTTP de copias
  durante creación/edición, rollback, conflictos y aislamiento.
- Comprobación estática focalizada sin emisión: sin diagnósticos nuevos en banco/autorización
  tras excluir la falta de declaraciones `mssql` ya documentada. No se modificó tsconfig
  ni se presenta esta comprobación como un build completo.
- El ejecutable local de Jest está instrumentado por Console Ninja y su hook intenta
  escribir fuera del workspace. Se ejecuta el mismo Jest mediante su API, sin alterar
  dependencias: `node -e 'process.env.NODE_ENV="test"; require("jest").run(["--runInBand"])'`.
- SQL Server real y frontend: **no ejecutados**, pendientes anteriores sin marcar completos.
