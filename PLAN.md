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
