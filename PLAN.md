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

- Suite completa final: **16 suites / 337 pruebas aprobadas**, también con
  `--runInBand --detectOpenHandles`; Jest finaliza naturalmente sin `--forceExit`.
- Suite del banco: **62 pruebas aprobadas**; incluye integración HTTP de copias
  durante creación/edición, rollback, conflictos y aislamiento.
- Comprobación estática focalizada sin emisión: sin diagnósticos nuevos en banco/autorización
  tras excluir la falta de declaraciones `mssql` ya documentada. No se modificó tsconfig
  ni se presenta esta comprobación como un build completo.
- El ejecutable local de Jest está instrumentado por Console Ninja y su hook intenta
  escribir fuera del workspace. Se ejecuta el mismo Jest mediante su API, sin alterar
  dependencias: `node -e 'process.env.NODE_ENV="test"; require("jest").run(["--runInBand"])'`.
- SQL Server real y frontend: **no ejecutados**, pendientes anteriores sin marcar completos.
