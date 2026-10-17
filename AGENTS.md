# AGENTS.md — API de Examio

## Propósito de la API

Backend HTTP de Examio. Expone operaciones académicas, evaluaciones, intentos,
correcciones, actas, telemetría, usuarios y reportes entre el frontend Next.js y
SQL Server. Mantiene contratos REST, validación de entrada, RBAC y adaptación de
resultados SQL a JSON.

## Stack real

Node.js, TypeScript 6, Express 5, SQL Server mediante `mssql` (sin ORM/query
builder), Zod 4, JWT, bcrypt y CORS. Testing con Jest 30, ts-jest y Supertest;
desarrollo con `ts-node-dev`. No hay linter, formatter ni logging estructurado.
Los scripts de `package.json` son la referencia operativa.

## Arquitectura actual

La arquitectura real es modular por dominio, pero no está completamente separada
en capas:

```text
HTTP
  -> app.ts / routes
  -> checkRole y validateRequest
  -> controller
  -> service (auth/banco y autorización de evaluaciones) o acceso directo con mssql
  -> Stored Procedure o SQL parametrizado
  -> mapKeysToCamelCase
  -> JSON { success, data/message }
```

- `src/app.ts` construye Express, registra middlewares y rutas, y exporta `app`.
  Importarlo no debe conectar a SQL ni abrir puertos.
- `src/index.ts` es el entrypoint ejecutable: conecta SQL Server y ejecuta
  `listen()`. Es el único lugar que debe usar el `PORT` fijo.
- Routes declaran método, path, RBAC, Zod y controller.
- Controllers mezclan actualmente HTTP, reglas, orquestación y persistencia.
- Auth tiene services para credenciales, JWT y sesiones rotatorias. Banco tiene
  services de gestión/copia transaccional, escritura/autorización de evaluaciones e
  idempotencia persistente; no existe `src/repositories/`.
- Schemas Zod en `src/schemas/`, normalmente con campos PascalCase.
- `checkRole` y `validateRequest` viven en `auth.middleware.ts`.
- Pool singleton en `config/db.ts`; `mapKeysToCamelCase` adapta resultados.
- Cada controller maneja errores; no hay error handler global.
- Tests HTTP con Supertest y `mssql` completamente mockeado.

No introducir una arquitectura nueva de forma transversal por un ticket pequeño.
Cuando una funcionalidad nueva tenga lógica relevante, preferir un service
acotado y reutilizable, sin migrar módulos no relacionados.

## Mapa rápido del proyecto

```text
api_node/
├── AGENTS.md                 # contexto operativo para agentes
├── README.md                 # contratos, endpoints y uso funcional
├── README_DATABASE.md        # referencia detallada de SQL Server
├── PLAN.md                   # seguimiento vivo de trabajo completado y pendiente
├── MAQUINA_ESTADOS.md        # estados y brechas de negocio
├── package.json              # scripts y dependencias
├── jest.config.js
├── tsconfig.json
├── src/
│   ├── app.ts                # construcción de Express, sin listen()
│   ├── index.ts              # conexión y arranque normal
│   ├── config/db.ts          # pool SQL singleton
│   ├── routes/               # entrada HTTP por módulo
│   ├── controllers/          # handlers y acceso a datos
│   ├── services/             # auth, banco y autorización de evaluaciones
│   ├── schemas/              # validación Zod
│   ├── middlewares/          # JWT, RBAC y validación
│   └── utils/                # adaptación camelCase
└── tests/
    ├── mocks/db.ts           # fábrica compartida de mocks mssql
    └── *.test.ts             # suites por módulo
```

Para modificar un módulo, empezar por route, controller, schema y test homónimos.

## Módulos

| Módulo | Responsabilidad | Entrada principal | Observaciones |
|---|---|---|---|
| Health | Identidad y disponibilidad API/SQL | `health.routes.ts`, `health.controller.ts` | Público; `service` debe ser exactamente `examio-api` |
| Banco | Preguntas propias, grupos, etiquetas y copias | `banco.routes.ts`, `banco.controller.ts`, services `banco*` | Admin consulta; solo docente propietario escribe; copias independientes |
| Auth | Login, access JWT, refresh rotatorio y logout | `auth.routes.ts`, `auth.controller.ts`, `auth.service.ts`, `auth-token.service.ts` | Sesiones persistidas en SQL; refresh opaco de un solo uso |
| Admin | Dashboard analítico | `admin.routes.ts`, `admin.controller.ts` | SQL agregado y filtros; solo admin |
| Alumnos | CRUD, materias y estadísticas | archivos `alumnos.*` | CRUD mediante SP; estadísticas con SQL inline |
| Docentes | CRUD, comisiones, materias y evaluaciones | archivos `docentes.*` | Revisar alcance docente y SP reutilizado |
| Carreras | CRUD, plan y alumnos | archivos `carreras.*` | Varias rutas legacy carecen de RBAC |
| Materias | CRUD, divisiones, alumnos y comisiones | archivos `materias.*` | Varias rutas legacy carecen de RBAC |
| Divisiones | Catálogo y CRUD parcial | archivos `divisiones.*` | Update/delete devuelven 501 |
| Comisiones | MateriaDivision y alumnos | archivos `comisiones.*` | `MateriaDivision` es una relación central |
| Evaluaciones | Actividades, borradores, publicación, grupos, preguntas y variantes | archivos `evaluaciones.*`, services `evaluacion-*` | Revisión optimista; publicación y guardado en banco transaccionales |
| Intentos | Inicio, respuestas, entrega, corrección e historial propio filtrable | archivos `intentos.*`, services `intento-*` | Flujo crítico y dependiente de SPs |
| Revisión | Políticas, permisos, sesiones breves y contenido autorizado | archivos `revision.*`, `revision-examen.service.ts` | Corrección confirmada es precondición; contenido alumno sólo por sesión |
| Actas | Cabecera, detalles y cierre | archivos `actas.*` | Operaciones transaccionales y estados |
| Telemetría | Navegación, eventos temporales e incidentes con duración | archivos `telemetria.*`, services `telemetria-*` | UUID + sesión/secuencia idempotentes; lote offline; sin consecuencias automáticas |
| Usuarios | Cuentas, hashes, roles y activación | archivos `usuarios.*` | Integridad cruzada con Alumno/Docente |
| Reportes | Rendimiento por alumno, evaluación, pregunta, variante, grupo y opción | archivos `reportes.*`, `reportes-preguntas.service.ts` | Limita docentes por `idDocente` del JWT; agregados globales separados de la página |

El catálogo completo y actualizado de endpoints está en `README.md`.

## Endpoints y contratos

- Los routers viven en `src/routes/` y se montan bajo `/api` desde `app.ts`.
- Los módulos usan paths y nombres en español; mantener compatibilidad.
- Los bodies de escritura suelen usar PascalCase porque reflejan parámetros SQL.
- Las respuestas de lectura deben exponer camelCase.
- Contratos: éxito `{ success: true, data/message }`; error
  `{ success: false, message }`; validación agrega `errors`.
- Códigos habituales: 200, 201, 400, 401, 403, 404 y 500.
- `GET /api/health` es público: 200 con base accesible, 503 degradado.
- Auth es público; el resto debe declarar explícitamente RBAC cuando corresponda.
- No asumir que rol equivale a propiedad: validar matrícula, intento, publicación
  o comisión cuando la operación depende del dueño.
- Endpoints sensibles: login, usuarios, mutaciones académicas, estructura de
  evaluaciones, respuestas, calificación, actas y telemetría.

Consultar la matriz del `README.md` antes de cambiar paths, payloads, roles o
respuestas. No duplicar aquí el catálogo HTTP.

## Base de datos

SQL Server usa PascalCase en tablas, columnas y SPs. La API usa parámetros
`mssql` y transforma resultados a camelCase. No hay ORM.

Modelo mínimo: `Carrera -> Materia`; `MateriaDivision` conecta Materia, Division y
Docente y concentra inscripciones, publicaciones y actas; `InscripcionMateria`
conecta alumnos; `Actividad -> Publicacion` y
`Actividad -> GrupoPregunta -> Pregunta -> Opcion`; `Publicacion -> Intento`;
`IntentoPregunta` congela variantes; `Intento -> Respuesta -> RespuestaOpcion`;
alertas y métricas dependen del intento; `ActaMateria -> DetalleActa`; `Usuario`
se vincula exclusivamente con Docente o Alumno según rol.

Reglas importantes:

- Reutilizar SPs, parametrizar consultas y usar transacciones relacionadas.
- En migraciones idempotentes, usar SQL dinámico para toda sentencia posterior que
  referencie tablas o columnas creadas o alteradas en el mismo batch (índices,
  constraints, backfills y consultas). SQL Server puede compilar esas referencias
  contra el esquema anterior y producir `Invalid column name` antes de ejecutarlas.
- Respetar bajas lógicas y constraints de estados.
- No cambiar esquema ni Stored Procedures sin necesidad y aprobación explícita.
- Mantener consistencia temporal; la documentación espera fechas ISO/UTC, aunque
  existen SPs legacy que usan `GETDATE()`.
- Edición de evaluaciones debe validar pertenencia de IDs anidados; grupos,
  preguntas, opciones y publicación no deben afectar otra actividad.

`README_DATABASE.md` es la referencia detallada de entidades, relaciones,
constraints y Stored Procedures.

## Tests

- Una suite por dominio: auth, alumnos, académico, evaluaciones, intentos, actas,
  admin, RBAC, reportes y health.
- Supertest recibe directamente `app` desde `src/app.ts`.
- Los tests no deben importar `src/index.ts`, conectar a SQL real ni usar
  `PORT=55803`.
- `tests/mocks/db.ts` fabrica `pool`, request builders, tipos SQL, transacciones
  y `connectDB` mockeados.
- Los tests suelen configurar `JWT_SECRET`, generar tokens y preparar resultados
  secuenciales de `query`/`execute`.
- `clearMocks` está habilitado; revisar implementaciones persistentes del mock al
  agregar casos.

Al cambiar un módulo, cubrir éxito/camelCase, validación, 404 aplicable, 401/403,
propiedad, estados, errores SQL, rollback y datos sensibles.

Ejecución recomendada:

```bash
npx jest tests/<modulo>.test.ts --runInBand
npm test
npx jest --detectOpenHandles
```

- Iterar con la suite afectada; usar `npm test` para app, middleware, auth, mocks,
  configuración o cambios transversales.
- Usar `--detectOpenHandles` al tocar arranque, conexiones, timers o recursos.
- Si un test necesita servidor real, usar `listen(0)` y cerrarlo en `afterAll`.
- No usar `--forceExit` para ocultar handles.
- Tras tests de infraestructura, verificar que 55803 no quede escuchando.

Estado de referencia reciente: 24 suites y 479 tests pasan, también con
`--runInBand --detectOpenHandles`.
Banco/evaluaciones agregan cobertura focalizada de aislamiento, estados,
revisiones y copias. Las constraints y concurrencia de SQL Server requieren además
verificación en una base aislada; los mocks no prueban esos comportamientos reales.

## Forma de trabajar en este proyecto

1. Analizar módulo y tests; identificar SPs, helpers y schemas reutilizables.
2. Mantener endpoints y esquema SQL salvo requerimiento explícito.
3. Para cambios grandes, presentar diseño, riesgos y alternativas antes de editar.
4. Mantener routes delgadas; extraer lógica reutilizable a service cuando aplique.
5. No crear repositories nominales sin una estrategia; hoy no existen.
6. Validar body con Zod y params/query explícitamente; usar datos validados.
7. Parametrizar SQL, aplicar camelCase y conservar contratos existentes.
8. Agregar tests del módulo y documentar endpoints nuevos.
9. No registrar secretos y preservar cambios ajenos del worktree.

Convenciones:

- Archivos: `<modulo>.routes.ts`, `<modulo>.controller.ts`,
  `<modulo>.schema.ts`, `<modulo>.test.ts`.
- Controllers exportan handlers `async`.
- SPs: `SP_<Entidad>_<Accion>`.
- SQL y payloads legacy: PascalCase; JSON de salida: camelCase.
- Errores capturados como `unknown` y convertidos con `instanceof Error`.

## Estado actual del proyecto

- Health identificable implementado en `GET /api/health`.
- Construcción de Express separada del servidor para evitar listeners al importar.
- Arranque detecta `EADDRINUSE` y muestra claramente el puerto ocupado; no mata
  procesos ajenos.
- Tests importan `src/app.ts`; Jest finaliza naturalmente y deja 55803 libre.
- Módulo de reportes agregado: rendimiento individual/listado, filtros,
  paginación y alcance docente.
- Borradores incompletos, publicación completa, referencias al banco e idempotencia
  persistente requieren la migración `20260926_evaluacion_revision_idempotencia.sql`.
- La migración `20261011_calificacion_intentos_telemetria.sql` fue aplicada dos veces y
  verificada en la base de prueba. No asumir que está aplicada en otros ambientes.
- La migración de etapa 1 `20261013_respuestas_multiples_justificacion.sql` debe
  reaplicarse con su versión corregida: la aplicación anterior conservó checks legacy
  de `Pregunta.Tipo`/`BancoPregunta.Tipo` que bloqueaban `multiple`, aunque el resto del
  esquema y el verificador anterior parecían correctos. El verificador actualizado
  detecta esos checks residuales. La etapa 2 implementa render inmutable,
  guardado atómico por conjunto con UUID/revisión, validación al entregar y corrección
  exacta/parcial desde snapshots. Requiere aplicar manualmente
  `20261014_runtime_respuestas_multiples.sql` y su verificador; no asumirlo en otros
  ambientes.
- La etapa previa a telemetría temporal requiere aplicar manualmente
  `20261015_anulacion_confirmacion_revision.sql`: agrega anulación por incidente,
  confirmación auditada de corrección y el bloqueo de revisión del alumno. No asumirla
  aplicada fuera de la base donde se verifique dos veces junto con su script de lectura.
- La etapa 3 de telemetría temporal requiere aplicar manualmente, después de la anterior,
  `20261016_telemetria_temporal.sql` y ejecutar su verificador. Reutiliza
  `IncidenteIntento`, agrega catálogo, pregunta/sesión/secuencia, escritura individual y
  por lote, listado paginado y unión de intervalos. No asumirla aplicada en otros ambientes.
- La etapa 4 de rendimiento por pregunta/grupo está implementada sin tablas agregadas ni
  SP nuevos. Requiere aplicar manualmente `20261017_indices_rendimiento_preguntas.sql` y
  revisar su verificador/planes con volumen representativo. Los endpoints agrupan por hash
  snapshot, normalizan puntaje por máximo y calculan tiempos por unión de intervalos.
- La etapa 5 de revisión está implementada y requiere aplicar manualmente
  `20261018_revision_examen.sql` y su verificador antes de desplegar el backend. Agrega
  políticas por publicación, permisos por intento, sesiones UUID de cinco minutos y
  auditoría. El backfill compatible es `al_corregir + libre`; `/completo` ya no entrega
  contenido a alumnos, que deben consumirlo mediante una sesión autorizada.
- Etapas 1 a 6 de calificación implementadas: configuración 10/100, puntaje por grupo,
  corrección por puntaje sobre `IntentoPregunta`, recálculo, override final auditado y
  selección automática/manual del intento válido, más historial propio filtrable basado
  en la identidad JWT y reportes con escala/umbral configurables. Los reportes admiten
  alcance `todos|validos`, normalizan agregados mixtos a base 10 y preservan valores
  originales por evaluación. Telemetría registra pérdidas de foco idempotentes con
  duración y resumen, sin consecuencias automáticas. `esCorrecta` sigue como
  compatibilidad temporal del endpoint de corrección. Las etapas 3 a 6 no requieren
  otra migración.
- Auth emite access JWT HS256 + refresh opaco, persiste familias en
  `AuthSession`/`AuthRefreshToken`, rota con bloqueo SQL y expone refresh/logout.
- Base local fue poblada con datos demo de reportes, pero ninguna sesión debe
  asumir que esos datos existen en otro entorno.
- Login aplica Zod y no registra contraseña ni hash.
- Build TypeScript está pendiente: la combinación `nodenext`, CommonJS y
  `verbatimModuleSyntax`, el `rootDir` y los tipos de `mssql` impiden que
  `npm run build` sea una validación confiable. No corregirlo incidentalmente.
- No hay repositories, error handler global, DTOs compartidos, lint ni formatter.
- El README y la máquina de estados contienen algunas afirmaciones legacy; ante
  contradicción, confirmar el controller/SP puntual.

## Riesgos y zonas delicadas

- Nunca importar `src/index.ts` desde tests. El incidente previo dejó Jest
  escuchando en 55803 con base mockeada y produjo falsos 401 desde el frontend.
- Un puerto abierto no identifica por sí solo la API. Verificar
  `/api/health` y `data.service === "examio-api"`.
- Login consulta la cuenta y solo devuelve `USER_INACTIVE` después de validar una
  contraseña correcta; usuario inexistente y contraseña incorrecta comparten
  `INVALID_CREDENTIALS` para evitar enumeración.
- Access tokens nuevos duran 15 minutos; refresh y sesión comparten un máximo
  absoluto configurable de 12 horas sin extensión deslizante.
- Refresh requiere `Idempotency-Key` UUID. `REFRESH_CONFLICT` es recuperable y
  nunca implica logout; replay fuera de la gracia revoca la familia.
- `AUTH_ALLOW_LEGACY_ACCESS_TOKENS=true` es transitorio. Retirarlo junto con el
  alias deprecado `token` cuando todos los clientes usen el contrato nuevo.
- El rate limiting de auth es local por proceso; producción multiinstancia
  requiere un límite distribuido adicional.
- RBAC verifica roles, pero la autorización por propiedad es incompleta en varios
  endpoints de alumno/docente.
- Carreras, materias y comisiones tienen rutas legacy sin `checkRole`, incluidas
  algunas mutaciones. Cambiarlas puede romper clientes: acordar el cambio.
- Los IDs anidados de edición completa de evaluaciones son críticos.
- `Idempotency-Key` UUID es obligatorio en los POST de creación/copia/publicación
  documentados. Reintentar con la misma clave/body; otra clave crea otra operación.
- `Actividad.Revision` no es historial. Edición/publicación comparan
  `RevisionEsperada`; importación incrementa y devuelve la revisión.
- Los puntajes pertenecen a `GrupoPregunta`, no a sus variantes. En modo iguales el
  reparto se materializa en centavos por ID estable; en personalizados la publicación
  exige suma exacta. El render alumno omite el máximo si la actividad lo configura.
- `mc` continúa significando selección única; `multiple` es un tipo distinto. No
  reinterpretar respuestas históricas. El runtime usa snapshots; el contrato legacy
  `IdOpcionNueva` continúa, mientras el nuevo usa conjunto, UUID y revisión optimista.
- Banco privado: propiedad por `Docente.Legajo`, estados y revisión optimista.
  `code` solo como borrador en v1. Admin no escribe ni importa bancos.
  Migración `20260908_banco_preguntas.sql` manual antes de desplegar. Nunca ejecutar al arrancar.
- Aplicar después `20260926_evaluacion_revision_idempotencia.sql`; ambas migraciones
  deben repetirse y verificarse primero en SQL Server aislado.
- Edición/importación de evaluaciones exige borrador sin intentos y alcance sobre
  todas las publicaciones. No se permite reapertura de publicada/archivada.
  Validar IDs anidados; coordinar edición/estado por bloqueo transaccional de Actividad.
- Las copias de banco son snapshots de contenido en las tablas actuales, no vínculos
  vivos. Preservar procedencia al adaptar un borrador; nunca sincronizar exámenes.
  Banco no tiene historial de versiones ni protección frente a UPDATE SQL manual.
- Intentos, respuestas, finalización y variantes dependen de consistencia entre
  varios SPs y tablas.
- `IncidenteIntento` usa `(IdIntento,EventoId)` como idempotencia. Inicio/cierre pueden
  llegar separados; no sobrescribir un evento completado ni agregar consecuencias
  automáticas. La sincronización nueva vence siete días después del fin del intento,
  pero un replay idéntico ya persistido debe seguir siendo válido.
- En telemetría temporal, `(IdIntento,SesionClienteId,SecuenciaCliente)` es una segunda
  identidad única. El lote procesa cada elemento por separado; los intervalos abiertos no
  suman y los solapados deben unirse. `MetricasNavegacion` sólo es fallback por pregunta
  cuando no existe `question_active` nuevo. Este evento usa `idIntentoPregunta` entregado
  por el render, nunca `idPregunta`. Los endpoints legacy no se paginan.
- Registrar un incidente no anula el intento. La consecuencia sólo se aplica mediante
  `PUT /intentos/:idIntento/anular-por-incidente/:eventoId`, que conserva respuestas,
  exige estado en progreso y audita una única anulación.
- La revisión del alumno exige corrección confirmada y autorización efectiva. Una
  revocación individual prevalece; un permiso activo autoriza ese intento; la política
  general sólo alcanza al intento válido actual. Las sesiones congelan la autorización,
  vencen en cinco minutos y, en acceso `unico`, sólo admiten un consumo atómico. No
  volver a exponer claves por `/intentos/:id/completo` para alumnos.
- Las transacciones de evaluaciones y actas deben hacer rollback ante cualquier
  fallo.
- Estados incompletos: vencimiento automático, anulación manual, firma de acta y
  suspensión de alumno.
- Divisiones expone update/delete, pero ambos responden 501.
- Dos endpoints de docente usan actualmente `SP_Docente_VerMaterias`.
- Fuera de reportes todavía pueden existir cálculos legacy con umbral 4 o 6. No
  unificarlos incidentalmente sin confirmar el contrato académico del módulo.
- `updateUsuario` puede nulificar asociaciones omitidas en una actualización
  parcial.
- No devolver mensajes SQL internos ni datos sensibles en endpoints nuevos.
- Los mocks son compartidos por suite: respetar orden y cantidad de llamadas
  `request/query/execute`, especialmente en consultas múltiples.
- `reportes.controller.ts` contiene agregaciones y filtros dinámicos delicados;
  preservar alcance docente, separación entre conteos operativos y académicos,
  normalización base 10 y paginación.
- Los reportes consumen la selección canónica sólo cuando
  `alcanceIntentos=validos`; `todos` es el default compatible. KPIs y gráficos deben
  calcularse antes de paginar y desde el mismo alcance SQL autorizado.
- Rendimiento por pregunta usa `ContenidoHashSnapshot`; no agrupar por texto ni tratar la
  procedencia del banco como vínculo vivo. Opciones/distractores salen del snapshot. Los
  tiempos ausentes son null, y `MetricasNavegacion` sólo reemplaza una pregunta sin
  `question_active`. No declarar diferencias “significativas” sin criterio aprobado.
- `InscripcionMateria` no tiene fecha de alta: “alumnos alcanzados” por una
  publicación representa el padrón actual de la comisión, no un padrón histórico.
- La aprobación en reportes usa `Actividad.NotaAprobacion`; no reintroducir constantes
  4/6 ni promediar directamente notas de escalas diferentes.

## Contexto recomendado para agentes

Una nueva sesión debe:

1. Leer `AGENTS.md`.
2. Leer solo la sección relevante de `README.md` o `README_DATABASE.md`.
3. Identificar el módulo afectado.
4. Abrir route, controller, schema/service relacionado.
5. Revisar únicamente los tests de ese módulo.
6. Buscar referencias concretas por nombre de símbolo, endpoint, SP o entidad.
7. Expandir la exploración solo si aparece una dependencia justificada.

No recorrer todo `/src`. No leer todas las suites. No relevar todos los módulos.
No abrir archivos masivamente para “entender el proyecto”.

## Cómo buscar información

- Preferir `rg '<simbolo>'` o `rg '<endpoint>'` en rutas, controller y tests.
- Buscar el nombre exacto del SP antes de modificar persistencia.
- Buscar referencias de un schema o helper antes de cambiar su contrato.
- Revisar el test del módulo antes de cambiar comportamiento observable.
- Consultar primero el catálogo de README para endpoints y roles.
- Consultar primero README_DATABASE para relaciones y SPs.
- Usar búsquedas recursivas amplias solo cuando una dependencia transversal lo
  justifique.
- Comparar el worktree antes de editar y no sobrescribir cambios del usuario.

## Documentación existente

### `README.md`

Documentación general de la API. Fuente para detalles funcionales, catálogo de
endpoints, payloads, respuestas, roles, variables y comandos.

### `README_DATABASE.md`

Referencia principal de estructura y comportamiento de SQL Server: entidades,
relaciones, restricciones, estados y Stored Procedures.

### `AGENTS.md`

Referencia principal para arquitectura real, convenciones de trabajo, estado
actual, riesgos y estrategia eficiente de navegación.

### `PLAN.md`

Registro vivo de fases completadas, cobertura pendiente, dependencias externas y
orden recomendado. No usarlo como fuente del contrato HTTP ni del modelo SQL.

Evitar duplicar información entre estos tres archivos.

## Reglas de mantenimiento de `AGENTS.md`

Actualizar solo cuando cambie información estructural o persistente:

- arquitectura o separación de responsabilidades;
- módulos;
- convenciones;
- estrategia de testing;
- decisiones técnicas importantes;
- riesgos conocidos;
- deuda relevante para trabajos futuros.

No actualizar por cada ticket menor. No usar como changelog, inventario exhaustivo
de endpoints ni copia de la documentación SQL.
