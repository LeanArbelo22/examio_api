# Máquina de Estados — GestionExamio

> Documento de arquitectura que define el ciclo de vida de todas las entidades del sistema. Sirve como **Fuente de Verdad** para el desarrollo de Frontend, validación de API y reglas de negocio.

---

## 1. Introducción y Matriz General

### 1.1 Propósito

Las máquinas de estado son el núcleo de la integridad académica de EXAMIO. Cada transición está validada en tres capas:

| Capa              | Mecanismo                                                  |
| ----------------- | ---------------------------------------------------------- |
| **Base de Datos** | Constraints `CHECK` en las columnas de estado              |
| **API Node**      | Guardias imperativas en controladores (`400 Bad Request`)  |
| **Middleware**    | `checkRole` con JWT (`401`/`403`) y guardia de titularidad |

### 1.2 Matriz General

| Entidad       | Columna BD       | Tipo                   | Valores                                          | Terminal                          | Reversible                             |
| ------------- | ---------------- | ---------------------- | ------------------------------------------------ | --------------------------------- | -------------------------------------- |
| `Actividad`   | `Estado`         | `NVARCHAR` (CHECK)     | `borrador`, `publicada`, `archivada`             | `archivada`                       | No                                     |
| `Intento`     | `Estado`         | `NVARCHAR` (CHECK)     | `en_progreso`, `entregado`, `vencido`, `anulado` | `entregado`, `vencido`, `anulado` | No                                     |
| `ActaMateria` | `Estado`         | `NVARCHAR` (CHECK)     | `abierta`, `firmada`, `cerrada`                  | `cerrada`                         | No                                     |
| `Alumno`      | `Estado`         | `NVARCHAR(10)` (CHECK) | `activo`, `suspendido`, `inactivo`               | `inactivo`                        | Sí (vía endpoint PUT)                  |
| `Docente`     | `Estado`         | `BIT`                  | `1` (activo), `0` (baja)                         | `0`                               | Sí (vía endpoint PUT)                  |
| `Carrera`     | `Estado`         | `BIT`                  | `1` (activo), `0` (baja)                         | `0`                               | Sí (vía endpoint PUT)                  |
| `Materia`     | `Estado`         | `BIT`                  | `1` (activo), `0` (baja)                         | `0`                               | Sí (vía endpoint PUT)                  |
| `Usuario`     | `Activo`         | `BIT`                  | `1` (activo), `0` (inactivo)                     | `0`                               | Sí (vía endpoint PUT)                  |
| `DetalleActa` | `CondicionFinal` | `NVARCHAR` (CHECK)     | `regular`, `promocionado`, `libre`               | —                                 | No (clasificación, no estado dinámico) |
| `Respuesta`   | `EsCorrecta`     | `BIT` (nullable)       | `NULL`, `1`, `0`                                 | —                                 | Sí                                     |

---

## 2. Desglose Detallado por Entidad

### 2.1 Actividad

#### Catálogo de estados

| Estado      | Significado funcional                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `borrador`  | Estado inicial al crear la actividad manualmente. Solo el creador (docente/admin) puede verla. No hay `Publicacion` vinculada.                                                     |
| `publicada` | La actividad se ha creado con una publicación activa. Los alumnos inscriptos en la comisión destino pueden verla e iniciar intentos dentro de la ventana `FechaInicio`–`FechaFin`. |
| `archivada` | La actividad fue archivada manualmente. Los alumnos **no pueden** iniciar nuevos intentos. Las respuestas históricas se conservan íntegras.                                        |

#### Diagrama de transiciones

```
┌──────────┐    guardar-completo    ┌───────────┐
│ (ninguno)│ ─────────────────────▶│ publicada │
└──────────┘                        └───────────┘
                                          │
                                          │ PUT /:id/estado
                                          ▼
                                    ┌───────────┐
                                    │ archivada  │
                                    └───────────┘

┌───────────┐  modificar-completo   ┌───────────┐
│  borrador │ ◀────────────────────▶│  borrador │
│ (edición) │                       │ (editado) │
└───────────┘                       └───────────┘
```

> **Nota:** Por defecto `POST /api/evaluaciones/guardar-completo` inserta con estado `publicada`. Si se envía `"Estado": "borrador"` en el body, se crea en estado borrador para edición posterior vía `PUT /:id/modificar-completo`.

#### Tabla de disparadores y endpoints

| Transición                | Disparador                             | Endpoint                                           | Zod                    |
|---|---|---|---|---|
| — → `publicada`           | Docente/admin crea evaluación completa | `POST /api/evaluaciones/guardar-completo`          | `ActividadSchema`      |
| `borrador` → `borrador`   | Docente/admin edita estructura         | `PUT /api/evaluaciones/:id/modificar-completo`     | `ActividadUpdateSchema` |
| `publicada` → `archivada` | Docente/admin archiva actividad        | `PUT /api/evaluaciones/:id/estado`                 | Sin Zod (body directo) |
| `borrador` → `publicada`  | No implementado (creación directa)     | —                                                  | —                      |
| `archivada` → cualquier   | **No permitido** (terminal)            | —                                                  | —                      |

**Body `PUT /api/evaluaciones/:id/estado`:**

```json
{ "estado": "archivada" }
```

#### Restricciones y reglas de negocio

| Estado      | ¿Puede iniciar intento?                         | ¿Se puede editar estructura? | ¿Visible para alumnos? |
| ----------- | ----------------------------------------------- | ---------------------------- | ---------------------- |
| `borrador`  | No                                              | **Sí** (PUT /:id/modificar-completo) | No                     |
| `publicada` | Sí (dentro de ventana `FechaInicio`–`FechaFin`) | No (inmutable)               | Sí                     |
| `archivada` | No                                              | No (inmutable)               | No                     |

> **Inmutabilidad:** La estructura de preguntas y variantes **solo** se puede modificar mientras la actividad está en estado `borrador` (vía `PUT /api/evaluaciones/:id/modificar-completo`). Una vez `publicada` o `archivada`, la estructura es inmutable. El sorteo (`CROSS APPLY ... ORDER BY NEWID()`) ocurre una sola vez al iniciar el intento y se congela en `IntentoPregunta`.

---

### 2.2 Intento

#### Catálogo de estados

| Estado        | Significado funcional                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `en_progreso` | El alumno inició el examen. Puede guardar respuestas, cambiar opciones y navegar entre preguntas. El temporizador corre.                                                                             |
| `entregado`   | El alumno finalizó explícitamente (`POST /api/intentos/:id/finalizar`). Se calculó `NotaAutomatica`. Si hay preguntas abiertas, `NotaFinal` queda `NULL` pendiente de corrección manual del docente. |
| `vencido`     | El tiempo máximo (`DuracionMinutos`) se agotó automáticamente. **No implementado** en la lógica actual; reservado para uso futuro.                                                                   |
| `anulado`     | Anulación autoritativa de un intento en progreso vinculada a un incidente registrado. Conserva las respuestas y no publica nota. La anulación manual docente general continúa pendiente.             |

#### Diagrama de transiciones

```
                    ┌────────────┐
                    │ (ninguno)  │
                    └──────┬─────┘
                           │ POST /intentos/iniciar
                           ▼
                    ┌────────────┐
                    │en_progreso │
                    └─────┬──────┘
                     ┌────┴────┐
                     │         │ PUT anular-por-incidente
                     ▼         ▼
               ┌──────────┐  ┌────────┐
               │ entregado│  │ anulado │
               └──────────┘  └────────┘
                     ▲
                     │ (reservado — automático)
               ┌──────────┐
               │ vencido   │
               └──────────┘
```

#### Tabla de disparadores y endpoints

| Transición                  | Disparador                                                                                                                                           | Endpoint                           | Zod                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------- |
| — → `en_progreso`           | Alumno inicia examen. El SP congela variantes y retorna `IdIntento`. Idempotente: si ya hay un intento en progreso, retorna el mismo.                | `POST /api/intentos/iniciar`       | `IniciarExamenSchema` |
| `en_progreso` → `entregado` | Alumno finaliza explícitamente. El SP calcula `NotaAutomatica` y decide `NotaFinal` según composición del examen. Idempotente.                       | `POST /api/intentos/:id/finalizar` | —                     |
| `en_progreso` → `anulado`   | El alumno titular o administrador solicita la consecuencia con un `EventoId` elegible ya registrado. La operación es idempotente y auditada. | `PUT /api/intentos/:idIntento/anular-por-incidente/:eventoId` | — |
| `en_progreso` → `vencido`   | **No implementado.** (Reservado para timeout automático.)                                                                                            | —                                  | —                     |

**Body `POST /api/intentos/iniciar`:**

```json
{
  "IdPublicacion": 5,
  "IdAlumno": 30500
}
```

#### Restricciones y reglas de negocio

| Estado        | Guardar respuesta | Calificar docente | Corregir pregunta | Ver radiografía      | Reintentar                                        |
| ------------- | ----------------- | ----------------- | ----------------- | -------------------- | ------------------------------------------------- |
| `en_progreso` | ✅                | ❌ (400)          | ❌ (400)          | ❌                   | —                                                 |
| `entregado`   | ❌                | ✅                | ✅                | Sólo con corrección confirmada | Si `intentosRealizados < cantidadIntentosMaximos` |
| `vencido`     | ❌                | ✅                | ✅                | ❌ para alumno       | Depende de configuración                          |
| `anulado`     | ❌                | ✅                | ✅                | ❌ para alumno       | No                                                |

##### Cálculo de nota al entregar

| Composición del examen      | `Estado` resultante | `NotaFinal`                            | `NotaAutomatica`   |
| --------------------------- | ------------------- | -------------------------------------- | ------------------ |
| 100% mc/vf (sin abiertas)   | `entregado`         | `ROUND((Correctas/TotalChoice)*10, 2)` | Mismo valor        |
| Al menos 1 pregunta abierta | `entregado`         | `NULL`                                 | Nota parcial mc/vf |

> ⚠️ **Nota sobre la automatización del flujo:** Al mutar el estado a `entregado`, el sistema ejecuta la corrección lógica en caliente de todos los ítems cerrados (MC/VF), impactando sus respectivos flags de `Respuesta.EsCorrecta`. Las preguntas abiertas quedan exceptuadas de este proceso automático, permaneciendo en `NULL` hasta la acción del docente.

---

### 2.3 ActaMateria

#### Catálogo de estados

| Estado    | Significado funcional                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `abierta` | Acta creada. Se pueden cargar/modificar detalles de alumnos (`NotaCursada`, `NotaFinalExamen`, `CondicionFinal`). |
| `firmada` | Estado intermedio reservado para futura firma digital. **No implementado** en los controladores actuales.         |
| `cerrada` | Acta cerrada definitivamente. No se admiten más modificaciones. Datos registrados para siempre.                   |

#### Diagrama de transiciones

```
┌─────────┐   POST /cargar-detalle   ┌─────────┐   PUT /:id/cerrar   ┌─────────┐
│ abierta │ ────────────────────────▶│ abierta │ ───────────────────▶│ cerrada │
└─────────┘   (múltiples veces)      └─────────┘                     └─────────┘
                                           │
                                           │ (reservado — firma digital)
                                           ▼
                                      ┌─────────┐
                                      │ firmada │
                                      └─────────┘
```

#### Tabla de disparadores y endpoints

| Transición            | Disparador                                     | Endpoint                         | Zod                 |
| --------------------- | ---------------------------------------------- | -------------------------------- | ------------------- |
| — → `abierta`         | Admin/docente crea acta con libro y folio      | `POST /api/actas/crear-cierre`   | `ActaSchema`        |
| `abierta` → `abierta` | Admin/docente carga/modifica detalle de alumno | `POST /api/actas/cargar-detalle` | `DetalleActaSchema` |
| `abierta` → `cerrada` | Admin/docente cierra acta                      | `PUT /api/actas/:id/cerrar`      | —                   |
| `abierta` → `firmada` | **No implementado** (reservado)                | —                                | —                   |
| `cerrada` → cualquier | **No permitido** (terminal)                    | —                                | —                   |

#### Restricciones y reglas de negocio

| Estado    | Cargar detalle | Modificar detalle    | Cerrar               |
| --------- | -------------- | -------------------- | -------------------- |
| `abierta` | ✅             | ✅ (múltiples veces) | ✅                   |
| `firmada` | ❌             | ❌                   | ✅ (teóricamente)    |
| `cerrada` | ❌             | ❌                   | ❌ (ya está cerrada) |

---

### 2.4 Alumno

#### Catálogo de estados

| Estado       | Significado funcional                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `activo`     | Habilitado para cursar materias y rendir exámenes.                                                           |
| `suspendido` | Suspendido temporalmente. No puede rendir exámenes ni acceder al sistema. Sus datos históricos se conservan. |
| `inactivo`   | Baja lógica definitiva. Equivalente a "eliminado" pero sin borrado físico.                                   |

#### Diagrama de transiciones

```
                   ┌──────────┐
                   │ (ninguno)│
                   └────┬─────┘
                        │ POST /alumnos
                        ▼
                  ┌──────────┐
                  │  activo   │
                  └─────┬────┘
                   ┌────┴────┐
                   │         │
                   ▼         ▼
             ┌──────────┐  ┌────────────┐
             │ inactivo │  │ suspendido │
             └──────────┘  └────────────┘
```

#### Tabla de disparadores y endpoints

| Transición              | Disparador                                 | Endpoint                         | Zod            |
| ----------------------- | ------------------------------------------ | -------------------------------- | -------------- |
| — → `activo`            | Admin crea alumno                          | `POST /api/alumnos`              | `AlumnoSchema` |
| `activo` → `inactivo`   | Admin elimina (baja lógica)                | `DELETE /api/alumnos/:matricula` | —              |
| `activo` → `suspendido` | **No implementado**                        | —                                | —              |
| `suspendido` → `activo` | **No implementado**                        | —                                | —              |
| `inactivo` → `activo`   | Reactivación (no implementado formalmente) | —                                | —              |

> **Nota:** El endpoint `PUT /api/alumnos/:matricula` actualmente solo permite modificar `Nombre`, `Apellido`, `Correo`. No incluye `Estado` en su Zod schema. Para cambiar el estado de `inactivo` → `activo` sería necesario extender el esquema o crear un endpoint dedicado.

---

### 2.5 Entidades BIT (Docente, Carrera, Materia)

#### Catálogo de estados

| Valor       | Significado funcional                                                   |
| ----------- | ----------------------------------------------------------------------- |
| `1` (true)  | Activo — la entidad está habilitada en el sistema.                      |
| `0` (false) | Baja lógica — la entidad está deshabilitada. No se elimina físicamente. |

#### Diagrama de transiciones

```
┌──────────┐   POST /<entidad>   ┌────────┐   DELETE /<entidad>/:id   ┌────────┐
│ (ninguno)│ ───────────────────▶│   1    │ ─────────────────────────▶│   0    │
└──────────┘                     └────────┘                           └────────┘
                                     │
                                     │ PUT /<entidad>/:id (potencial)
                                     ▼
                                ┌────────┐
                                │   1    │ (reactivación)
                                └────────┘
```

#### Tabla de disparadores y endpoints

| Entidad | Crear (→ `1`)        | Baja lógica (`1` → `0`)        | Reactivar (`0` → `1`)                                 |
| ------- | -------------------- | ------------------------------ | ----------------------------------------------------- |
| Docente | `POST /api/docentes` | `DELETE /api/docentes/:legajo` | No implementado (requeriría `PUT` con campo `Estado`) |
| Carrera | `POST /api/carreras` | `DELETE /api/carreras/:id`     | No implementado                                       |
| Materia | `POST /api/materias` | `DELETE /api/materias/:id`     | No implementado                                       |

#### Restricciones

- Las queries de listado (`GET`) filtran por `Estado = 1`.
- Las entidades con `Estado = 0` se excluyen de todas las operaciones activas (inscripciones, asignaciones, etc.).

---

### 2.6 Usuario

#### Catálogo de estados

| Valor       | Significado funcional                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| `1` (true)  | Usuario habilitado. Puede autenticarse con credenciales y obtener JWT.               |
| `0` (false) | Usuario deshabilitado. El login rechaza el acceso aunque la contraseña sea correcta. |

#### Diagrama de transiciones

```
┌──────────┐   POST /usuarios   ┌────────┐   DELETE /usuarios/:id   ┌────────┐
│ (ninguno)│ ──────────────────▶│   1    │ ────────────────────────▶│   0    │
└──────────┘                    └────────┘                          └────────┘
                                    │
                                    │ PUT /usuarios/:id { "Activo": true }
                                    ▼
                               ┌────────┐
                               │   1    │ (reactivación)
                               └────────┘
```

#### Tabla de disparadores y endpoints

| Transición | Disparador                | Endpoint                   | Zod                                    |
| ---------- | ------------------------- | -------------------------- | -------------------------------------- |
| — → `1`    | Admin crea usuario        | `POST /api/usuarios`       | `UsuarioSchema`                        |
| `1` → `0`  | Admin deshabilita usuario | `DELETE /api/usuarios/:id` | —                                      |
| `0` → `1`  | Admin reactiva usuario    | `PUT /api/usuarios/:id`    | `UsuarioUpdateSchema` (field `Activo`) |

#### Restricciones

- `findUserByEmail` en `auth.service.ts` incluye `WHERE U.Activo = 1`.
- Un usuario inactivo **no puede** obtener JWT.
- No hay límite de intentos de login para usuarios inactivos (el servidor responde 401 genérico sin distinguir entre credenciales inválidas y usuario inactivo).

---

### 2.7 DetalleActa / Respuesta (Clasificaciones Ternarias)

#### DetalleActa.CondicionFinal

| Valor          | Significado funcional                                                    |
| -------------- | ------------------------------------------------------------------------ |
| `regular`      | Aprobó la cursada (nota ≥ 4 en `NotaCursada`). Debe rendir examen final. |
| `promocionado` | Aprobó sin examen final (nota ≥ 7 en `NotaCursada`).                     |
| `libre`        | No aprobó la cursada. Debe recursar o rendir como libre.                 |

#### Respuesta.EsCorrecta

#### Respuesta.EsCorrecta

| Valor       | Significado funcional                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `NULL`      | Pendiente de corrección manual (exclusivo de preguntas abiertas). El docente aún no revisó esta respuesta.     |
| `1` (true)  | La respuesta es correcta (calificada automáticamente para MC/VF o manualmente por el docente para abiertas).   |
| `0` (false) | La respuesta es incorrecta (calificada automáticamente para MC/VF o manualmente por el docente para abiertas). |

#### Mecanismo de asignación según el Tipo de Pregunta:

1. **Preguntas Cerradas (Multiple Choice / Verdadero o Falso):**
   - **Automatización:** El flag `EsCorrecta` se calcula, evalúa y graba **automáticamente en la Base de Datos a través del Stored Procedure** en el momento exacto en que el alumno envía el examen (`POST /api/intentos/:id/finalizar`).
   - El docente no interviene ni puede modificar este flag de forma manual para evitar alteraciones en los patrones de respuestas unívocas.

2. **Preguntas Abiertas (Desarrollo):**
   - **Evaluación Manual:** Al finalizar el intento, el sistema las setea inicialmente en `NULL`.
   - **Disparador Manual:** El docente debe corregir y asignar el valor (`1` o `0`) de forma explícita a través del endpoint dedicado:
     `PUT /api/intentos/:idIntento/preguntas/:idPregunta/corregir`

---

## 3. Guardias de Seguridad Implementadas

| Ubicación                        | Validación                                                                                     | Tipo          | HTTP  |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | ------------- | ----- |
| `auth.middleware.ts:13-14`       | `checkRole(roles)` — verifica que `decoded.role` esté incluido en el array de roles permitidos | Role-based    | `403` |
| `auth.middleware.ts:9`           | Token ausente (`!authHeader`)                                                                  | Autenticación | `401` |
| `auth.middleware.ts:20`          | Token inválido o expirado (`jwt.verify` lanza excepción)                                       | Autenticación | `401` |
| `intentos.controller.ts:289`     | Bloqueo de calificación si `Estado === 'en_progreso'`                                          | Estado        | `400` |
| `intentos.controller.ts:321`     | Bloqueo de corrección si `Estado === 'en_progreso'`                                            | Estado        | `400` |
| `intentos.controller.ts:203`     | Titularidad: si `role === 'alumno'`, compara `intento.IdAlumno` vs `req.user.idAlumno`         | Propiedad     | `403` |
| `validateRequest` (varios)       | Zod `safeParse` falla — payload mal formado                                                    | Validación    | `400` |
| `intentos.controller.ts:285-287` | Intento no encontrado                                                                          | Existencia    | `404` |
| `intentos.controller.ts:336-338` | Respuesta no encontrada al corregir                                                            | Existencia    | `404` |

### Flujo de autorización completo para una solicitud

```
Request → checkRole (JWT) ──401/403──→ ✗
          ↓ válido
         validateRequest (Zod) ──400──→ ✗
          ↓ válido
         Controller logic
          ├─ Guardia de existencia (404)
          ├─ Guardia de estado (400)
          ├─ Guardia de titularidad (403)
          └─ Operación BD → Response 200
```

---

## 4. Informe de Brechas y Deuda Técnica

### Brecha 1 — Estado `vencido` sin automatización

**Problema:**
El estado `vencido` está definido en el CHECK de BD (`CHK_Intento_Estado`) y documentado en los diagramas, pero **no existe ninguna lógica** (ni en el SP ni en la API) que lo active automáticamente al vencer `DuracionMinutos`. Esto significa que un alumno podría mantener un intento en `en_progreso` indefinidamente si no entrega explícitamente.

**Recomendación:**
Implementar un worker o scheduler que ejecute periódicamente:

```sql
UPDATE Intento SET Estado = 'vencido', FechaFin = SYSUTCDATETIME()
WHERE Estado = 'en_progreso'
  AND FechaInicio < DATEADD(MINUTE, -DuracionMinutos, SYSUTCDATETIME());
```

La API Node podría exponer un endpoint `/api/intentos/vencer` (protegido para `admin` o `sistema`) que ejecute este UPDATE, o bien un cron job externo que lo llame.

**Endpoint propuesto:** `POST /api/intentos/vencer` (admin/sistema)

---

### Brecha 2 — Falta de Endpoint para Anulación Manual por el Docente

**Problema:**
Existe una anulación autoritativa solicitada por el alumno y vinculada a un incidente,
pero registrar telemetría por sí solo continúa sin cambiar el estado. Todavía no existe
un mecanismo en la API para que un docente pueda anular un examen manualmente por un
criterio externo (por ejemplo, comportamiento sospechoso en el aula presencial).

**Recomendación:**
Agregar un endpoint administrativo dedicado:

```
PUT /api/intentos/:idIntento/anular
```

Que permita al cuerpo docente forzar el estado `anulado` dejando una justificación en la base de datos.

Con guardias:

- Solo roles `admin`, `docente`.
- Solo si el intento está en `en_progreso` (no se puede anular un intento ya entregado/vencido/anulado).

---

### Brecha 3 — Estado intermedio `firmada` de Acta no implementado

**Problema:**
El estado `firmada` en `ActaMateria` está documentado y existe en el CHECK de BD, pero ningún controlador lo usa. El salto directo es `abierta` → `cerrada`. No hay lógica de firma digital.

**Recomendación:**
Si no se planea implementar firma digital, **eliminar el valor `firmada` del CHECK** y simplificar la documentación. Si se planea implementar, crear el endpoint `PUT /api/actas/:id/firmar` con las validaciones correspondientes.

---

### Brecha 4 — Estado `suspendido` de Alumno inaccesible

**Problema:**
El CHECK de `Alumno.Estado` acepta `'activo'`, `'suspendido'`, `'inactivo'`, pero el CRUD actual (`PUT /api/alumnos/:matricula`) no incluye el campo `Estado` en `AlumnoSchema.partial()`. No hay forma de mover un alumno a `suspendido` ni de sacarlo de ese estado.

**Recomendación:**
Extender `AlumnoSchema` para incluir `Estado?: z.enum(['activo', 'suspendido', 'inactivo'])`. Esto permite que `PUT /api/alumnos/:matricula` pueda modificar el estado.

---

### Brecha 5 — Inmutabilidad sin validación explícita en capa API

**Problema:**
La inmutabilidad de la estructura de evaluación (`Actividad` + `GrupoPregunta` + `Pregunta` + `Opcion`) se garantiza por diseño (no hay endpoints de edición), pero **no hay una validación explícita** a nivel BD o API que impida una modificación directa en la base de datos.

**Recomendación:**
Agregar un trigger `INSTEAD OF UPDATE` o `INSTEAD OF DELETE` en las tablas `Actividad`, `GrupoPregunta`, `Pregunta` y `Opcion` que rechace cualquier modificación si la actividad tiene al menos un intento asociado. Alternativamente, crear una columna `Editada BIT` que se ponga a `0` al crear y a `1` si se intenta modificar.

---

### ~~Brecha 6 — Estado `borrador` sin flujo de creación~~ (RESUELTA)

**Estado actual:** `✅ Resuelta`. El schema `ActividadSchema` ahora acepta `Estado: z.enum(['borrador', 'publicada']).optional()`. Si el Frontend envía `"Estado": "borrador"`, el controlador corrige el estado después del SP. Si no se envía, el default es `'publicada'` (comportamiento legacy).

---

### Brecha 7 — Login sin validación Zod

**Problema:**
`POST /api/auth/login` está documentado con `LoginSchema` pero la ruta **no incluye** el middleware `validateRequest(LoginSchema)`. El controlador recibe `req.body` sin prevalidación (endpoint público).

**Referencia:** README §8.1

**Fix:**

```typescript
router.post("/login", validateRequest(LoginSchema), login);
```

---

### Resumen de brechas por severidad

| #   | Brecha                                 | Severidad | Esfuerzo estimado |
| --- | -------------------------------------- | --------- | ----------------- |
| 1   | `vencido` sin automatización           | 🔴 Alta   | 2–4h              |
| 2   | `anulado` sin endpoint                 | 🟡 Media  | 1–2h              |
| 3   | `firmada` sin implementar (o eliminar) | 🟢 Baja   | 0.5h              |
| 4   | `suspendido` inaccesible               | 🟡 Media  | 1h                |
| 5   | Inmutabilidad sin trigger              | 🟡 Media  | 2–3h              |
| 6   | ~~`borrador` sin flujo de creación~~    | ~~🟢 Baja~~ | ~~1h~~ ✅ Resuelta |
| 7   | Login sin Zod                          | 🟡 Media  | 0.25h             |

---

## 5. Apéndice: Payloads Zod Relacionados con Estados

| Esquema                   | Campo estado     | Valores permitidos                             |
| ------------------------- | ---------------- | ---------------------------------------------- |
| `CalificarSchema`         | `notaFinal`      | `z.number().min(0).max(10).multipleOf(0.01)`   |
| `CorregirRespuestaSchema` | `esCorrecta`     | `z.boolean().nullable()`                       |
| `DetalleActaSchema`       | `CondicionFinal` | `z.enum(['regular', 'promocionado', 'libre'])` |
| `AlumnoSchema` (actual)   | `Estado`         | **No incluido** (brecha #4)                    |

---

_Documento generado a partir del análisis de `README.md` y `README_DATABASE.md`. Última actualización: 2026-06-17._
