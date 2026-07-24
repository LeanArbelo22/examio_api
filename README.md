# API Node — GestionExamio

API REST desarrollada en Express 5 + TypeScript 6 que abstrae la lógica de negocio del sistema de gestión educativa GestionExamio. Actúa como capa intermedia entre el frontend y SQL Server, centralizando la validación de esquemas con Zod 4, el control de acceso basado en roles (RBAC) con `jsonwebtoken` + `bcryptjs`, y la transformación de PascalCase a camelCase en todas las respuestas.

---

## 1. Arquitectura General

```
                     HTTP (JSON)
                         │
                         ▼
 ┌───────────────────────────────────────────────────┐
 │              API Node (Express 5)                  │
 │                                                     │
 │  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │
 │  │  Rutas   │  │   Zod    │  │   checkRole      │  │
 │  │ (Router) │─▶│ Schemas  │─▶│   Middleware     │  │
 │  └──────────┘  └──────────┘  └─────────────────┘  │
 │       │                                              │
 │       ▼                                              │
 │  ┌─────────────────┐  ┌───────────────────────────┐ │
 │  │  Controladores   │  │  mapKeysToCamelCase()    │ │
 │  │  (Controllers)   │─▶│  (PascalCase → camelCase)│ │
 │  └─────────────────┘  └───────────────────────────┘ │
 │       │                                              │
 │       ▼                                              │
 │  ┌─────────────────┐                                 │
 │  │  mssql (pool)    │  (tedious / TDS)               │
 │  └─────────────────┘                                 │
 └──────────────────────┬──────────────────────────────┘
                        │
                        ▼
               SQL Server (GestionExamio)
```

| Componente | Rol |
|---|---|
| **Express 5** | Enrutamiento y middleware. Soporta async/await nativo. |
| **TypeScript 6** | Tipado estático estricto (`strict: true`). Compilación a `/dist` con `tsc`. |
| **mssql 12** | Driver TDS para SQL Server. `pool` es singleton. Soporta `sql.Transaction` para operaciones atómicas. |
| **Zod 4** | Esquemas de validación en cada `POST`/`PUT`. El middleware `validateRequest` rechaza payloads inválidos con `400` + array `errors`. |
| **jsonwebtoken + bcryptjs** | Autenticación stateless. `bcrypt.compare()` para contraseñas. JWT con payload `{ id, email, role, idAlumno, idDocente }` y expiración de 1 hora. |
| **ts-jest + supertest** | 202 tests de integración con mock completo de `mssql`. Sin dependencia de BD real. Supertest importa `src/app.ts` sin abrir un puerto. |

La construcción de Express está separada del arranque del proceso:

- `src/app.ts` configura middlewares y rutas, y exporta `app` sin ejecutar `listen()`.
- `src/index.ts` es el único entrypoint que conecta SQL Server y abre `PORT`.
- Importar `app` desde tests no inicia el servidor ni ocupa el puerto `55803`.

---

## 2. Configuración del Entorno

| Variable | Tipo | Default | Obligatoria | Propósito |
|---|---|---|---|---|
| `PORT` | `number` | `3000` | No | Puerto exclusivo de la ejecución normal del servidor Express. Los tests no dependen de este puerto. En desarrollo se utiliza `55803`. |
| `DB_SERVER` | `string` | `localhost` | Sí | Host/IP de SQL Server. |
| `DB_PORT` | `number` | `1433` | No | Puerto TCP de SQL Server. |
| `DB_USER` | `string` | `sa` | Sí | Usuario de conexión. |
| `DB_PASSWORD` | `string` | — | Sí | Contraseña del usuario. |
| `DB_NAME` | `string` | — | Sí | Base de datos destino (`GestionExamio`). |
| `JWT_SECRET` | `string` | — | Sí | Clave HMAC (mín. 32 caracteres) para access tokens JWT HS256. |
| `AUTH_REFRESH_TOKEN_SECRET` | `string` | — | Sí | Secreto HMAC (mín. 32 caracteres) exclusivo para refresh tokens; debe diferir de `JWT_SECRET`. |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS` | `number` | `900` | No | Vigencia del access token, inicialmente 15 minutos. |
| `AUTH_SESSION_TTL_SECONDS` | `number` | `43200` | No | Máximo absoluto de sesión, inicialmente 12 horas, sin extensión deslizante. |
| `AUTH_JWT_ISSUER` | `string` | `examio-api` | No | Issuer requerido en access tokens nuevos. |
| `AUTH_JWT_AUDIENCE` | `string` | `examio-bff` | No | Audience requerido en access tokens nuevos. |
| `AUTH_CLOCK_TOLERANCE_SECONDS` | `number` | `30` | No | Tolerancia de reloj en validación JWT. |
| `AUTH_REFRESH_REUSE_GRACE_SECONDS` | `number` | `10` | No | Ventana para distinguir carreras legítimas de reutilización. |
| `AUTH_ALLOW_LEGACY_ACCESS_TOKENS` | `boolean` | `true` | No | Compatibilidad transitoria con JWT anteriores sin claims estrictos. |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `number` | `900` | No | Ventana del limitador local de login. |
| `AUTH_LOGIN_RATE_LIMIT_MAX` | `number` | `10` | No | Máximo local de intentos por IP+email en la ventana. |
| `AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS` | `number` | `60` | No | Ventana del limitador local de refresh. |
| `AUTH_REFRESH_RATE_LIMIT_MAX` | `number` | `30` | No | Máximo local por IP+identificador público de token. |

**Ejemplo `.env`:**

```env
PORT=55803
DB_SERVER=localhost
DB_PORT=1433
DB_USER=Leandro
DB_PASSWORD=********
DB_NAME=GestionExamio
JWT_SECRET=c7a2e8f1d4b9a6c3f0e5d8b7a4c1f9e6d3b0a7c5f2e8d1b4a9c6f3e0d5b8a7
AUTH_REFRESH_TOKEN_SECRET=otro-secreto-independiente-de-al-menos-32-caracteres
AUTH_ACCESS_TOKEN_TTL_SECONDS=900
AUTH_SESSION_TTL_SECONDS=43200
AUTH_REFRESH_REUSE_GRACE_SECONDS=10
AUTH_ALLOW_LEGACY_ACCESS_TOKENS=true
```

`src/index.ts` valida esta configuración antes de conectar SQL Server y abrir el
puerto. El TTL de access debe ser menor que el máximo absoluto de sesión y los
dos secretos no pueden coincidir.

---

## 3. Convención de Respuestas (Contrato Global)

### 3.1 Respuesta Exitosa (Lectura — lista)

```json
{
  "success": true,
  "data": [
    { "id": 1, "nombre": "Analista de Sistemas", "duracionSemestres": 6 }
  ]
}
```

### 3.2 Respuesta Exitosa (Lectura — individual)

```json
{
  "success": true,
  "data": {
    "id": 1,
    "nombre": "Analista de Sistemas",
    "descripcion": "Carrera de tecnología",
    "duracionSemestres": 6
  }
}
```

### 3.3 Respuesta Exitosa (Escritura — con mensaje)

```json
{
  "success": true,
  "message": "Alumno creado correctamente"
}
```

### 3.4 Respuesta Exitosa (Escritura — con ID generado)

```json
{
  "success": true,
  "data": { "idActividad": 42 }
}
```

### 3.5 Respuesta de Error (recurso no encontrado)

```json
{
  "success": false,
  "message": "Alumno no encontrado"
}
```

Los errores procesables incluyen además `code` en el nivel superior:

```json
{
  "success": false,
  "message": "Access token vencido",
  "code": "ACCESS_TOKEN_EXPIRED"
}
```

### 3.6 Respuesta de Error (validación Zod)

```json
{
  "success": false,
  "message": "Datos inválidos",
  "errors": [
    {
      "code": "invalid_string",
      "validation": "email",
      "path": ["Correo"],
      "message": "Invalid email address"
    }
  ]
}
```

### 3.7 Códigos de Estado HTTP

| Código | Significado |
|---|---|
| `200` | Operación exitosa (lectura, modificación, borrado lógico). |
| `201` | Recurso creado exitosamente. |
| `400` | Error de validación Zod — payload mal formado. |
| `401` | Token JWT ausente, inválido o expirado. |
| `403` | Rol del usuario no autorizado para la ruta. |
| `404` | Recurso no encontrado. |
| `500` | Error interno (conexión BD, excepción no capturada). |

### 3.8 Convención camelCase

Toda respuesta atraviesa `mapKeysToCamelCase()` antes de serializarse. Las claves PascalCase devueltas por SQL Server se transforman automáticamente:

| Base de datos (PascalCase) | Respuesta JSON (camelCase) |
|---|---|
| `IdPublicacion` | `idPublicacion` |
| `NombreCompleto` | `nombreCompleto` |
| `CantidadIntentosMaximos` | `cantidadIntentosMaximos` |
| `FueSeleccionada` | `fueSeleccionada` |

---

## 4. Matriz de Rutas y Seguridad (RBAC)

Cada endpoint detalla: método, ruta, esquema Zod que valida el body (si aplica), los roles autorizados por `checkRole`, y el payload JSON exacto que debe enviarse en **PascalCase** (tal como lo esperan los stored procedures).

### 4.0 Health check

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/health` | — | Público |

El endpoint identifica inequívocamente al proceso de la API y ejecuta una consulta liviana `SELECT 1` contra SQL Server con un timeout de 2 segundos.

**API y base disponibles — `200 OK`:**

```json
{
  "success": true,
  "data": {
    "service": "examio-api",
    "environment": "development",
    "database": "reachable"
  }
}
```

**API disponible y base degradada — `503 Service Unavailable`:**

```json
{
  "success": false,
  "data": {
    "service": "examio-api",
    "environment": "development",
    "database": "unreachable"
  },
  "message": "Service temporarily unavailable"
}
```

`environment` proviene de `NODE_ENV` y usa `development` cuando no está definido. La respuesta no incluye nombres de servidor, base o usuario, credenciales, connection strings ni secretos JWT.

### 4.1 Auth

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| POST | `/api/auth/login` | `LoginSchema` | Público |
| POST | `/api/auth/refresh` | `RefreshSchema` | Server-to-server; refresh token + idempotencia |
| POST | `/api/auth/logout` | `LogoutSchema` | Refresh token; access token opcional |

**Body `POST /api/auth/login`:**

```json
{
  "Email": "lfernandez@cervantes.edu.ar",
  "Password": "Cervantes2026"
}
```

**Respuesta `POST /api/auth/login` — `200`:**

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt-hs256>",
    "token": "<mismo-jwt-hs256>",
    "refreshToken": "<token-opaco>",
    "accessTokenExpiresAt": "2026-07-23T18:00:00.000Z",
    "refreshTokenExpiresAt": "2026-07-24T05:45:00.000Z",
    "user": {
      "id": 1,
      "email": "usuario@institucion.edu.ar",
      "name": "Nombre Apellido",
      "role": "alumno",
      "identificadorInstitucional": 30500,
      "idAlumno": 30500,
      "idDocente": null
    }
  }
}
```

`accessToken` es canónico. `token` es un alias deprecado para clientes actuales y
debe retirarse después de migrar el frontend. El login valida el body antes de
consultar SQL, no registra credenciales y crea `AuthSession` +
`AuthRefreshToken` dentro de una transacción.

El access token dura 15 minutos y la sesión tiene un máximo absoluto inicial de
12 horas. Refresh no extiende dicho máximo. Los timestamps se devuelven siempre
en UTC ISO 8601; el cliente no debe inferirlos decodificando JWT.

**Body `POST /api/auth/refresh`:**

```http
Idempotency-Key: 3d20fc1c-c3f5-4f28-a5b1-cd0319ccfe24
Content-Type: application/json
```

```json
{
  "RefreshToken": "<refresh-token-actual>"
}
```

`Idempotency-Key` es obligatorio, debe ser un UUID y representa una operación de
renovación dentro de una sesión. Respuesta `200`:

```json
{
  "success": true,
  "data": {
    "accessToken": "<nuevo-jwt-hs256>",
    "refreshToken": "<nuevo-token-opaco>",
    "accessTokenExpiresAt": "2026-07-23T18:15:00.000Z",
    "refreshTokenExpiresAt": "2026-07-24T05:45:00.000Z"
  }
}
```

La renovación bloquea la fila en SQL Server, consume el refresh anterior e
inserta el sucesor en una única transacción serializable. Una repetición con el
mismo token y la misma clave devuelve exactamente el mismo resultado. Otra clave
dentro de `AUTH_REFRESH_REUSE_GRACE_SECONDS` recibe `409 REFRESH_CONFLICT` sin
revocar la sesión. El BFF debe esperar la renovación en curso o volver a leer su
estado server-side; **no debe ejecutar logout**. Fuera de esa tolerancia, reutilizar
el token revoca la familia y responde `401 REFRESH_TOKEN_REUSED`.

La ventana de 10 segundos solo tolera carreras legítimas: no prolonga la validez
general de un token consumido. La coordinación se mantiene entre múltiples
instancias porque los bloqueos y metadatos residen en SQL Server. El BFF debe
aplicar single-flight por sesión siempre que sea posible.

**Body `POST /api/auth/logout`:**

```json
{
  "RefreshToken": "<refresh-token-actual>"
}
```

`Authorization: Bearer <access-token>` es opcional. Si se presenta un access
token nuevo y válido, debe corresponder a la misma `AuthSession`. El refresh token
es suficiente aunque el access haya vencido. Logout revoca la familia completa y
es idempotente:

```json
{
  "success": true,
  "message": "Sesión cerrada correctamente"
}
```

Tokens desconocidos, malformados, vencidos o ya revocados producen la misma
respuesta para no revelar sesiones. No existe logout global en este contrato.
Los access tokens son stateless y pueden conservar validez criptográfica hasta
15 minutos después del logout.

#### Claims y validación

Los access tokens nuevos usan exclusivamente HS256 y contienen `sub`, `id`,
`email`, `role`, `idAlumno`, `idDocente`, `sessionId`, `tokenType: "access"`,
`iss`, `aud`, `iat` y `exp`. El middleware valida algoritmo, issuer, audience,
tipo y expiración. Un refresh token es opaco y nunca se acepta como access.

Con `AUTH_ALLOW_LEGACY_ACCESS_TOKENS=true`, JWT antiguos firmados con
`JWT_SECRET` y sin marcadores modernos continúan aceptándose temporalmente. Si un
token contiene cualquier marcador moderno (`tokenType`, `sessionId`, `iss` o
`aud`), se le exige el contrato estricto completo: la compatibilidad no permite
emitir tokens nuevos incompletos. Desactivar la opción cuando todos los clientes
usen `accessToken` y no queden sesiones JWT antiguas; después puede retirarse el
alias `token`.

En cada refresh se recarga usuario, rol y asociación institucional desde SQL. Un
usuario inactivo o una asociación inválida revoca la sesión. Un cambio válido de
rol/asociación aparece en el próximo access token; el anterior puede conservar
claims previos hasta 15 minutos.

#### Códigos de autenticación

| HTTP | Código | Uso del BFF |
|---|---|---|
| 400 | `REQUEST_INVALID` | Body o `Idempotency-Key` inválido; no reintentar como refresh automático. |
| 401 | `INVALID_CREDENTIALS` | Login fallido sin enumerar usuario inexistente/contraseña incorrecta. |
| 401 | `USER_INACTIVE` | Credenciales correctas pero cuenta inactiva, o desactivada antes del refresh. |
| 401 | `ACCESS_TOKEN_MISSING` | Falta bearer token. |
| 401 | `ACCESS_TOKEN_INVALID` | Firma, algoritmo, issuer, audience, tipo o formato inválido. |
| 401 | `ACCESS_TOKEN_EXPIRED` | El BFF puede ejecutar un único refresh y repetir una vez la solicitud original. |
| 401 | `REFRESH_TOKEN_INVALID` | Refresh malformado, desconocido o de otro tipo. |
| 401 | `REFRESH_TOKEN_EXPIRED` | Se alcanzó el máximo absoluto de sesión. |
| 401 | `REFRESH_TOKEN_REVOKED` | Familia cerrada mediante logout. |
| 401 | `REFRESH_TOKEN_REUSED` | Replay fuera de tolerancia; la familia fue revocada. |
| 401 | `SESSION_REVOKED` | Sesión revocada o vinculación institucional inválida. |
| 403 | `FORBIDDEN` | Usuario autenticado sin rol; nunca intentar refresh. |
| 409 | `REFRESH_CONFLICT` | Carrera recuperable; esperar/sincronizar, nunca logout. |
| 429 | `RATE_LIMITED` | Esperar respetando política del BFF. |
| 503 | `AUTH_INFRASTRUCTURE_ERROR` | Falla temporal, sin detalles internos. |
| 500 | `AUTH_CONTRACT_ERROR` | Inconsistencia interna inesperada. |

Una sesión inexistente no se diferencia públicamente de un refresh desconocido:
ambos usan `REFRESH_TOKEN_INVALID` para no crear un oráculo de enumeración.

Login usa un limitador local por IP+email normalizado; refresh usa
IP+identificador público del token, más un límite agregado por IP. Los límites permiten varias renovaciones
concurrentes legítimas y nunca almacenan el token completo. Esta defensa es por
proceso y no basta en despliegues multiinstancia: producción debe agregar rate
limiting distribuido en gateway, proxy o infraestructura.

Producción requiere HTTPS de extremo a extremo. No deben registrarse
contraseñas, hashes, access tokens, refresh tokens ni sus headers. Rotar
`JWT_SECRET` invalida access tokens existentes, pero una sesión activa puede
recuperarse mediante refresh. Rotar `AUTH_REFRESH_TOKEN_SECRET` invalida todos
los refresh tokens y equivale operativamente a cerrar todas las sesiones; debe
planificarse como una rotación coordinada. No existe todavía un keyring de
secretos anteriores.

#### Contrato para NextAuth/BFF

- Los callbacks server-side conservan `accessToken`, `refreshToken` y ambos
  vencimientos en el JWT HttpOnly de NextAuth.
- Nunca exponer esos cuatro campos, `sessionId` ni `token` mediante
  `session.user`.
- Ante `ACCESS_TOKEN_EXPIRED`, ejecutar single-flight, llamar `/refresh` con un
  UUID por operación, persistir ambos tokens rotados y repetir la solicitud
  original como máximo una vez.
- Ante `REFRESH_CONFLICT`, esperar/consultar la sesión server-side; no borrar la
  sesión y no iniciar otra cadena de refresh con el token consumido.
- No intentar refresh ante `FORBIDDEN`, `REQUEST_INVALID` o errores funcionales
  académicos.
- Reenviar el body original sin transformarlo y solamente desde Route Handlers
  server-side.

Refresh, logout fallido y errores de autenticación no modifican intentos,
publicaciones, respuestas ni temporizadores. Renovar no pausa ni amplía un
examen. El reloj autoritativo es backend/SQL Server. Inicio y finalización ya son
idempotentes; guardar la misma opción o el mismo texto no duplica la respuesta.
Telemetría puede duplicarse ante reintentos y permanece como decisión separada.

### 4.2 Alumnos

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/alumnos` | — | `admin`, `docente` |
| GET | `/api/alumnos/:matricula` | — | `admin`, `docente`, `alumno` |
| POST | `/api/alumnos` | `AlumnoSchema` | `admin` |
| PUT | `/api/alumnos/:matricula` | `AlumnoSchema.partial()` | `admin` |
| DELETE | `/api/alumnos/:matricula` | — | `admin` |
| GET | `/api/alumnos/:matricula/materias` | — | `admin`, `docente`, `alumno` |
| GET | `/api/alumnos/:matricula/estadisticas` | — | `admin`, `docente`, `alumno` |

**Body `POST /api/alumnos`:**

```json
{
  "Matricula": 30999,
  "Nombre": "Julieta",
  "Apellido": "Acosta",
  "Cuil": "27305001123",
  "Correo": "jacosta@cervantes.edu.ar"
}
```

**Body `PUT /api/alumnos/:matricula`** (parcial, todos los campos son opcionales):

```json
{
  "Nombre": "Julieta Actualizada",
  "Apellido": "Acosta",
  "Correo": "jacosta@cervantes.edu.ar"
}
```

**Response `GET /api/alumnos/:matricula/estadisticas`:**

```json
{
  "success": true,
  "data": {
    "totalCorregidos": 12,
    "promedioGeneral": 7.25,
    "aprobados": 9,
    "porcentajeAprobacion": 75.0
  }
}
```

### 4.3 Docentes

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/docentes` | — | `admin`, `docente` |
| GET | `/api/docentes/:legajo` | — | `admin`, `docente` |
| POST | `/api/docentes` | `DocenteSchema` | `admin` |
| PUT | `/api/docentes/:legajo` | `DocenteSchema.partial()` | `admin` |
| DELETE | `/api/docentes/:legajo` | — | `admin` |
| GET | `/api/docentes/:legajo/comisiones` | — | `admin`, `docente` |
| GET | `/api/docentes/estado/:estado` | — | `admin` |
| POST | `/api/docentes/:legajo/asignar` | `AsignarComisionSchema` | `admin` |
| GET | `/api/docentes/:legajo/materias` | — | `admin`, `docente` |
| GET | `/api/docentes/:legajo/evaluaciones` | — | `admin`, `docente` |

**Body `POST /api/docentes`:**

```json
{
  "Legajo": 100542,
  "Nombre": "Laura",
  "Apellido": "Fernandez",
  "Cuil": "27300542157",
  "Correo": "lfernandez@cervantes.edu.ar"
}
```

**Body `PUT /api/docentes/:legajo`** (parcial):

```json
{
  "Nombre": "Laura Actualizada",
  "Apellido": "Fernandez",
  "Correo": "laura@cervantes.edu.ar"
}
```

**Body `POST /api/docentes/:legajo/asignar`:**

```json
{
  "IdMateriaDivision": 15
}
```

### 4.4 Carreras

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/carreras` | — | Público |
| GET | `/api/carreras/:id` | — | Público |
| POST | `/api/carreras` | `CarreraSchema` | Público |
| PUT | `/api/carreras/:id` | `CarreraSchema.partial()` | Público |
| DELETE | `/api/carreras/:id` | — | Público |
| GET | `/api/carreras/:id/plan` | — | Público |
| GET | `/api/carreras/:id/alumnos` | — | Público |

**Body `POST /api/carreras`:**

```json
{
  "Nombre": "Analista de Sistemas",
  "Descripcion": "Carrera de tecnología",
  "DuracionSemestres": 6
}
```

**Body `PUT /api/carreras/:id`** (parcial):

```json
{
  "Nombre": "Analista de Sistemas (Actualizado)"
}
```

### 4.5 Materias

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/materias` | — | Público |
| GET | `/api/materias/:id` | — | Público |
| POST | `/api/materias` | `MateriaSchema` | Público |
| PUT | `/api/materias/:id` | `MateriaSchema.partial()` | Público |
| DELETE | `/api/materias/:id` | — | Público |
| GET | `/api/materias/:id/alumnos` | — | Público |
| POST | `/api/materias/:id/division` | `AsignarDivisionSchema` | Público |
| GET | `/api/materias/:id/comisiones` | — | Público |

**Body `POST /api/materias`:**

```json
{
  "Nombre": "Bases de Datos I",
  "Semestre": 3,
  "IdCarrera": 1
}
```

**Body `PUT /api/materias/:id`** (parcial):

```json
{
  "Nombre": "Bases de Datos I (Actualizado)",
  "Semestre": 3
}
```

**Body `POST /api/materias/:id/division`:**

```json
{
  "Id": 5
}
```

### 4.6 Comisiones

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/comisiones` | — | Público |
| GET | `/api/comisiones/:id/alumnos` | — | Público |

### 4.7 Divisiones

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/divisiones` | — | Público |
| GET | `/api/divisiones/:id` | — | Público |
| POST | `/api/divisiones` | `DivisionSchema` | `admin` |
| PUT | `/api/divisiones/:id` | — | `admin` | ⚠️ Retorna `501 Not Implemented` |
| DELETE | `/api/divisiones/:id` | — | `admin` | ⚠️ Retorna `501 Not Implemented` |

**Body `POST /api/divisiones`:**

```json
{
  "Descripcion": "1NMS"
}
```

### 4.8 Evaluaciones

| Método | Endpoint | Zod | Roles |
|---|---|---|---|---|
| POST | `/api/evaluaciones/guardar-completo` | `ActividadSchema` | `admin`, `docente` |
| PUT | `/api/evaluaciones/:id/modificar-completo` | `ActividadUpdateSchema` | `admin`, `docente` |
| PUT | `/api/evaluaciones/:id/estado` | — | `admin`, `docente` |
| GET | `/api/evaluaciones/intento/:idIntento/renderizar` | — | `alumno`, `admin`, `docente` |
| GET | `/api/evaluaciones/pregunta/:idPregunta/opciones/:idIntento` | — | `alumno`, `admin`, `docente` |
| GET | `/api/evaluaciones/publicacion/:id` | — | `alumno`, `admin`, `docente` |
| GET | `/api/evaluaciones/pendientes/:matricula` | — | `alumno`, `admin`, `docente` |
| GET | `/api/evaluaciones/:id/detalle` | — | `admin`, `docente` |
| GET | `/api/evaluaciones/:id/alumnos` | — | `admin`, `docente` |

**Body `POST /api/evaluaciones/guardar-completo`:**

> El campo `Estado` es opcional. Si no se envía, se crea como `'publicada'`. Si se envía `'borrador'`, la actividad se crea en estado borrador y puede editarse luego vía `PUT /api/evaluaciones/:id/modificar-completo`.

```json
{
  "Titulo": "Parcial I - Base de Datos",
  "Descripcion": "Evaluación de SQL y Normalización",
  "Tipo": "evaluacion",
  "CantidadIntentosMaximos": 2,
  "DuracionMinutos": 120,
  "RecursosPermitidos": "Hoja de fórmulas",
  "IdMateriaDivision": 1,
  "FechaInicio": "2026-06-15T10:00:00Z",
  "FechaFin": "2026-06-15T12:00:00Z",
  "Estado": "borrador",
  "GruposPreguntas": [
    {
      "TituloReferencia": "SQL Básico",
      "Variantes": [
        {
          "Enunciado": "¿Qué comando SELECT es correcto?",
          "Tipo": "mc",
          "Opciones": [
            { "Texto": "SELECT * FROM users", "EsCorrecta": true },
            { "Texto": "SELECT all FROM users", "EsCorrecta": false }
          ]
        }
      ]
    }
  ]
}
```

**Response `GET /api/evaluaciones/pendientes/:matricula`:**

> El Dashboard del alumno devuelve flags calculados para que el Frontend bloquee/habilite botones sin lógica adicional.

```json
{
  "success": true,
  "data": [
    {
      "idPublicacion": 5,
      "titulo": "Parcial I",
      "materia": "Bases de Datos I",
      "carrera": "Analista de Sistemas",
      "docente": "Laura Fernandez",
      "duracionMinutos": 120,
      "fechaInicio": "2026-06-15T10:00:00Z",
      "fechaFin": "2026-06-15T12:00:00Z",
      "recursosPermitidos": null,
      "cantidadIntentosMaximos": 3,
      "intentosRealizados": 1,
      "estadoUltimoIntento": "entregado",
      "enProgreso": false,
      "puedeReintentar": true,
      "intentosAgotados": false
    }
  ]
}
```

**Response `GET /api/evaluaciones/:id/detalle`:**

> Devuelve la estructura completa de un examen: header + grupos → preguntas → opciones.

```json
{
  "success": true,
  "data": {
    "idActividad": 42,
    "titulo": "Parcial I - Base de Datos",
    "descripcion": "Evaluación de SQL y Normalización",
    "tipo": "evaluacion",
    "duracionMinutos": 120,
    "cantidadIntentosMaximos": 2,
    "estado": "publicada",
    "recursosPermitidos": null,
    "idPublicacion": 5,
    "fechaInicio": "2026-06-15T10:00:00.000Z",
    "fechaFin": "2026-06-15T12:00:00.000Z",
    "materia": "Bases de Datos I",
    "division": "1NMS",
    "grupos": [
      {
        "idGrupo": 1,
        "tituloReferencia": "SQL Básico",
        "preguntas": [
          {
            "idPregunta": 10,
            "enunciado": "¿Qué comando SELECT es correcto?",
            "tipo": "mc",
            "opciones": [
              { "idOpcion": 1, "texto": "SELECT * FROM users", "esCorrecta": true },
              { "idOpcion": 2, "texto": "SELECT all FROM users", "esCorrecta": false }
            ]
          }
        ]
      }
    ]
  }
}
```

**Response `GET /api/evaluaciones/:id/alumnos`:**

> Devuelve los alumnos inscriptos con el estado de su intento (si existe).

```json
{
  "success": true,
  "data": [
    {
      "matricula": 30500,
      "nombre": "Julieta",
      "apellido": "Acosta",
      "correo": "jacosta@cervantes.edu.ar",
      "idIntento": 1,
      "estadoIntento": "entregado",
      "notaFinal": null,
      "notaAutomatica": 8.00,
      "fechaInicioIntento": "2026-06-15T10:00:00.000Z",
      "fechaFinIntento": "2026-06-15T11:30:00.000Z",
      "numeroIntento": 1,
      "cantidadIntentosMaximos": 2,
      "intentosAgotados": false
    }
  ]
}
```

**Body `PUT /api/evaluaciones/:id/modificar-completo`:**

> ⚠️ **Solo funciona en estado `borrador`.** Si la actividad está `publicada` o `archivada`, el endpoint responde `400 Bad Request`.
>
> El payload es idéntico al de creación (`POST /evaluaciones/guardar-completo`) con dos diferencias:
> 1. Incluye `IdPublicacion` para identificar la publicación a actualizar.
> 2. Los objetos anidados (`GrupoPregunta`, `Pregunta`, `Opcion`) pueden incluir un campo `Id` opcional. Si se envía, el registro se actualiza; si no, se crea uno nuevo.
>
> **Comportamiento inteligente:** Dentro de una transacción atómica, el endpoint:
> - Actualiza los datos macro de `Actividad` y `Publicacion`.
> - Actualiza registros existentes (los que llegan con `Id`).
> - Inserta registros nuevos (los que llegan sin `Id`).
> - Elimina registros que existían en BD pero ya no vienen en el payload (respeta el orden de claves foráneas: Opciones → Preguntas → Grupos).

```json
{
  "Titulo": "Parcial I - Base de Datos (Modificado)",
  "Descripcion": "Versión actualizada",
  "Tipo": "evaluacion",
  "CantidadIntentosMaximos": 3,
  "DuracionMinutos": 90,
  "IdMateriaDivision": 1,
  "FechaInicio": "2026-06-16T10:00:00Z",
  "FechaFin": "2026-06-16T12:00:00Z",
  "IdPublicacion": 5,
  "GruposPreguntas": [
    {
      "Id": 10,
      "TituloReferencia": "SQL Avanzado",
      "Variantes": [
        {
          "Id": 100,
          "Enunciado": "¿Qué es un JOIN?",
          "Tipo": "mc",
          "Opciones": [
            { "Id": 1, "Texto": "Combina tablas", "EsCorrecta": true },
            { "Texto": "Nueva opción", "EsCorrecta": false }
          ]
        }
      ]
    }
  ]
}
```

**Body `PUT /api/evaluaciones/:id/estado`:**

> ⚠️ **Excepción a la regla PascalCase.** Este endpoint no pasa por validación Zod; el controlador lee `req.body.estado` directamente. La clave se envía en **minúscula** por implementación actual.

```json
{
  "estado": "archivada"
}
```

### 4.9 Intentos

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| POST | `/api/intentos/iniciar` | `IniciarExamenSchema` | `alumno`, `admin` |
| POST | `/api/intentos/guardar-respuesta` | `GuardarRespuestaSchema` | `alumno`, `admin` |
| POST | `/api/intentos/:id/finalizar` | — | `alumno`, `admin` |
| GET | `/api/intentos/alumno/:idAlumno` | — | `alumno`, `admin`, `docente` |
| GET | `/api/intentos/alumno/:idAlumno/detallados` | — | `alumno`, `admin`, `docente` |
| GET | `/api/intentos/alumno/:idAlumno/historial-corregido` | — | `alumno`, `admin`, `docente` |
| GET | `/api/intentos/:idIntento/completo` | — | `admin`, `docente`, `alumno`* |
| **PUT** | `/api/intentos/:idIntento/calificar` | `CalificarSchema` | `admin`, `docente` |
| **PUT** | `/api/intentos/:idIntento/preguntas/:idPregunta/corregir` | `CorregirRespuestaSchema` | `docente` |

**Body `POST /api/intentos/iniciar`:**

```json
{
  "IdPublicacion": 5,
  "IdAlumno": 30500
}
```

**Response `GET /api/intentos/:idIntento/completo`:**

> Devuelve el intento con todas las preguntas (congeladas), las opciones y las respuestas del alumno en una sola llamada.
>
> ⚠️ Cada opción lleva `fueSeleccionada: true/false` para que el Frontend pueda pintar directamente cuál fue marcada, sin cruzar arrays.
>
> \* `alumno` — solo puede acceder a su propio intento (validación por titularidad `IdAlumno` vs. `req.user.idAlumno`).

```json
{
  "success": true,
  "data": {
    "idIntento": 1,
    "idAlumno": 30500,
    "idPublicacion": 5,
    "estado": "entregado",
    "notaFinal": null,
    "notaAutomatica": 8.00,
    "fechaInicio": "2026-06-15T10:00:00.000Z",
    "fechaFin": "2026-06-15T11:30:00.000Z",
    "numeroIntento": 1,
    "nombre": "Julieta",
    "apellido": "Acosta",
    "correo": "jacosta@cervantes.edu.ar",
    "tituloEvaluacion": "Parcial I - Base de Datos",
    "tipoEvaluacion": "evaluacion",
    "duracionMinutos": 120,
    "preguntas": [
      {
        "idPregunta": 10,
        "enunciado": "¿Qué comando SELECT es correcto?",
        "tipo": "mc",
        "grupoConceptualmente": "SQL Básico",
        "respuesta": {
          "idRespuesta": 1,
          "rtaTexto": null,
          "esCorrecta": null,
          "comentariosDocente": null
        },
        "opciones": [
          { "idOpcion": 1, "texto": "SELECT * FROM users", "esCorrecta": true, "fueSeleccionada": true },
          { "idOpcion": 2, "texto": "SELECT all FROM users", "esCorrecta": false, "fueSeleccionada": false }
        ]
      },
      {
        "idPregunta": 11,
        "enunciado": "Explique normalización",
        "tipo": "abierta",
        "grupoConceptualmente": "Diseño BD",
        "respuesta": {
          "idRespuesta": 2,
          "rtaTexto": "Es un proceso para evitar redundancia",
          "esCorrecta": null,
          "comentariosDocente": null
        },
        "opciones": []
      }
    ]
  }
}
```

**Body `POST /api/intentos/guardar-respuesta`:**

```json
{
  "IdIntento": 1,
  "IdPregunta": 10,
  "IdOpcionNueva": 3
}
```

**Body `PUT /api/intentos/:idIntento/calificar`:**

```json
{
  "notaFinal": 7.5
}
```

**Response `PUT /api/intentos/:idIntento/calificar`:**

```json
{
  "success": true,
  "message": "Nota asignada correctamente"
}
```

**Body `PUT /api/intentos/:idIntento/preguntas/:idPregunta/corregir`:**

> ⚠️ **Excepción a la regla PascalCase.** Este endpoint no pasa por un SP; el controlador consume los datos directamente. Las claves se envían en **camelCase** (mismo criterio que `CalificarSchema`).

```json
{
  "esCorrecta": true,
  "comentariosDocente": "Excelente respuesta, demuestra dominio del concepto."
}
```

**Response `PUT /api/intentos/:idIntento/preguntas/:idPregunta/corregir`:**

```json
{
  "success": true,
  "message": "Respuesta corregida correctamente"
}
```

**Response `GET /api/intentos/alumno/:idAlumno/detallados`:**

```json
{
  "success": true,
  "data": [
    {
      "idIntento": 1,
      "idAlumno": 30500,
      "idPublicacion": 5,
      "estado": "entregado",
      "notaFinal": null,
      "notaAutomatica": 8.00,
      "fechaInicio": "2026-06-15T10:00:00.000Z",
      "fechaFin": "2026-06-15T11:30:00.000Z",
      "numeroIntento": 1,
      "tituloEvaluacion": "Parcial I",
      "tipoEvaluacion": "evaluacion",
      "duracionMinutos": 120,
      "materia": "Bases de Datos I",
      "division": "1NMS"
    }
  ]
}
```

**Response `GET /api/intentos/alumno/:idAlumno/historial-corregido`:**

> Solo devuelve intentos con `NotaFinal IS NOT NULL` y `Estado = 'entregado'`. Excluye exámenes con preguntas abiertas pendientes de corrección manual.

```json
{
  "success": true,
  "data": [
    {
      "idIntento": 1,
      "tituloEvaluacion": "Parcial I",
      "materia": "Bases de Datos I",
      "division": "1NMS",
      "fechaFin": "2026-06-15T11:30:00.000Z",
      "notaFinal": 8.00,
      "numeroIntento": 1
    }
  ]
}
```

### 4.10 Actas

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/actas` | — | `admin`, `docente` |
| GET | `/api/actas/:id` | — | `admin`, `docente` |
| PUT | `/api/actas/:id/cerrar` | — | `admin`, `docente` |
| POST | `/api/actas/crear-cierre` | `ActaSchema` | `admin`, `docente` |
| POST | `/api/actas/cargar-detalle` | `DetalleActaSchema` | `admin`, `docente` |

**Body `POST /api/actas/crear-cierre`:**

```json
{
  "IdMateriaDivision": 5,
  "Libro": "LIBRO-A",
  "Folio": "FOLIO-001"
}
```

**Body `POST /api/actas/cargar-detalle`:**

```json
{
  "IdActa": 1,
  "IdAlumno": 30500,
  "NotaCursada": 7.5,
  "NotaFinalExamen": 8.5,
  "CondicionFinal": "regular"
}
```

### 4.11 Telemetría

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| POST | `/api/telemetria/alerta` | `AlertaSchema` | `alumno`, `admin` |
| GET | `/api/telemetria/alerta/:idIntento` | — | `docente`, `admin` |
| POST | `/api/telemetria/navegacion` | `NavegacionSchema` | `alumno`, `admin` |

**Body `POST /api/telemetria/alerta`:**

```json
{
  "IdIntento": 1,
  "TipoIncidente": "fullscreen_exit",
  "Detalle": "El alumno salió de la pantalla completa a los 5 minutos"
}
```

**Body `POST /api/telemetria/navegacion`:**

```json
{
  "IdIntento": 1,
  "IdPregunta": 10,
  "SegundosPermanencia": 45
}
```

### 4.12 Usuarios

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/usuarios` | — | `admin` |
| POST | `/api/usuarios` | `UsuarioSchema` | `admin` |
| PUT | `/api/usuarios/:id` | `UsuarioUpdateSchema` | `admin` |
| DELETE | `/api/usuarios/:id` | — | `admin` |

**Body `POST /api/usuarios`:**

```json
{
  "Email": "nuevo@cervantes.edu.ar",
  "Password": "MiClave2026",
  "Rol": "docente",
  "IdDocente": 108990,
  "Activo": true
}
```

**Body `PUT /api/usuarios/:id`** (parcial, todos los campos son opcionales):

```json
{
  "Email": "actualizado@cervantes.edu.ar",
  "Rol": "admin",
  "Activo": true
}
```

> ⚠️ `Password` se envía en texto plano; el servidor lo hashea con `bcrypt.hash(password, 10)` antes de persistir. `GET /api/usuarios` nunca expone `PasswordHash` en la respuesta.

---

### 4.13 Administración — Dashboard Analítico

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/admin/dashboard/analitica` | — | `admin` |

**Query Params (todos opcionales):**

| Parámetro | Tipo | Descripción |
|---|---|---|
| `idCarrera` | `number` | Filtrar por carrera |
| `idMateria` | `number` | Filtrar por materia |
| `idMateriaDivision` | `number` | Filtrar por comisión |
| `legajoDocente` | `number` | Filtrar por docente |
| `matriculaAlumno` | `number` | Filtrar por alumno |

**Response `GET /api/admin/dashboard/analitica`:**

> Devuelve KPIs globales, listado de intentos y evaluaciones publicadas. Todos los filtros se aplican como `AND` en las consultas.

```json
{
  "success": true,
  "data": {
    "kpis": {
      "totalIntentos": 45,
      "promedioGeneral": 6.75,
      "tasaAprobacion": 68.89,
      "totalAlertasFraude": 3
    },
    "intentos": [
      {
        "idIntento": 1,
        "matricula": 30500,
        "nombreAlumno": "Julieta Acosta",
        "tituloEvaluacion": "Parcial I",
        "comisionMateria": "1NMS",
        "fechaInicio": "2026-06-15T10:00:00.000Z",
        "estado": "entregado",
        "notaFinal": 8.00,
        "totalAlertas": 0
      }
    ],
    "evaluaciones": [
      {
        "legajoDocente": 100542,
        "nombreDocente": "Laura Fernandez",
        "tituloEvaluacion": "Parcial I",
        "nombreMateria": "Bases de Datos I",
        "nombreDivision": "1NMS",
        "fechaPublicacion": "2026-06-10T08:00:00.000Z",
        "estado": "publicada",
        "alumnosInscriptos": 25
      }
    ]
  }
}
```

---

### 4.14 Reportes — Rendimiento por Alumno

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| GET | `/api/reportes/rendimiento` | — | `admin`, `docente` |

**Descripción:**
Endpoint consolidado que devuelve el rendimiento académico de alumnos. Soporta dos modos:

- **Modo detalle** (con `matricula`): KPIs del alumno + desglose por actividad con todos los intentos.
- **Modo listado** (sin `matricula`): Todos los alumnos dentro del alcance del docente/administrador con KPIs por alumno y paginación.

**Query Params (todos opcionales):**

| Parámetro | Tipo | Default | Propósito |
|---|---|---|---|
| `matricula` | `number` | — | Filtrar por un alumno específico |
| `idMateria` | `number` | — | Filtrar por materia |
| `idMateriaDivision` | `number` | — | Filtrar por comisión |
| `idActividad` | `number` | — | Filtrar por evaluación (solo modo detalle) |
| `estado` | `enum` | — | `entregado` \| `en_progreso` \| `vencido` |
| `fechaDesde` | `string` (ISO 8601) | — | Filtro por fecha de inicio del intento |
| `fechaHasta` | `string` (ISO 8601) | — | Filtro por fecha de inicio del intento |
| `promedioMin` | `number` (0–10) | — | Promedio mínimo (modo listado) |
| `promedioMax` | `number` (0–10) | — | Promedio máximo (modo listado) |
| `ordenarPor` | `enum` | `alumno` | `alumno` \| `promedio` \| `aprobados` \| `intentos` |
| `ordenDireccion` | `enum` | `asc` | `asc` \| `desc` |
| `pagina` | `number` | `1` | Número de página (modo listado) |
| `limite` | `number` | `20` | Resultados por página, máx. 100 |

**Reglas de negocio:**
- Roles: `docente` o `admin`. El `alumno` recibe 403.
- El `idDocente` se obtiene exclusivamente del JWT (`req.user.idDocente`). No se recibe por URL/query.
- Cuando el usuario es `docente`, solo ve alumnos pertenecientes a sus `MateriaDivision`.
- Cuando el usuario es `admin`, no hay restricción de docente.
- `fechaDesde` ≤ `fechaHasta` — si se invierten, 400 Bad Request.
- `promedioMin` ≤ `promedioMax` — 400 si se invierten.
- `limite` entre 1 y 100.
- Sin `matricula`: devuelve listado paginado con KPIs globales y por alumno.
- Con `matricula`: devuelve detalle completo con KPIs del alumno y actividades agrupadas.

**Response — modo detalle (`?matricula=30500`):**

```json
{
  "success": true,
  "data": {
    "alumno": {
      "matricula": 30500,
      "nombre": "Julieta",
      "apellido": "Acosta"
    },
    "kpis": {
      "totalIntentos": 5,
      "totalCorregidos": 4,
      "promedioGeneral": 7.25,
      "aprobados": 3,
      "desaprobados": 1,
      "porcentajeAprobacion": 75.0
    },
    "actividades": [
      {
        "idActividad": 1,
        "titulo": "Parcial I",
        "tipo": "evaluacion",
        "materia": "Matemática",
        "division": "A",
        "intentos": 2,
        "notaMaxima": 8.5,
        "notaPromedio": 8.0,
        "mejorIntento": {
          "numeroIntento": 2,
          "notaFinal": 8.5,
          "notaAutomatica": null,
          "fechaFin": "2026-06-20T11:00:00.000Z"
        }
      }
    ]
  }
}
```

**Response — modo listado (sin `matricula`):**

```json
{
  "success": true,
  "data": {
    "paginacion": {
      "pagina": 1,
      "limite": 20,
      "total": 45,
      "totalPaginas": 3
    },
    "kpis": {
      "totalAlumnos": 45,
      "conIntentos": 40,
      "totalIntentos": 180,
      "promedioGeneral": 6.8,
      "tasaAprobacion": 72.5
    },
    "alumnos": [
      {
        "matricula": 30500,
        "nombre": "Julieta",
        "apellido": "Acosta",
        "totalIntentos": 5,
        "totalCorregidos": 4,
        "promedio": 7.25,
        "aprobados": 3,
        "desaprobados": 1,
        "porcentajeAprobacion": 75.0
      }
    ]
  }
}
```

---

## 5. Esquemas Zod — Detalle Completo

### 5.1 Tipos de Dato y Obligatoriedad

| Esquema | Campo | Tipo Zod | Obligatorio |
|---|---|---|---|
| `LoginSchema` | `Email` | `z.string().email().max(150)` | Sí |
| | `Password` | `z.string().min(1)` | Sí |
| `AlumnoSchema` | `Matricula` | `z.number().int()` | Sí |
| | `Nombre` | `z.string()` | Sí |
| | `Apellido` | `z.string()` | Sí |
| | `Cuil` | `z.string()` | No |
| | `Correo` | `z.string().email()` | Sí |
| `DocenteSchema` | `Legajo` | `z.number().int()` | Sí |
| | `Nombre` | `z.string()` | Sí |
| | `Apellido` | `z.string()` | Sí |
| | `Cuil` | `z.string()` | No |
| | `Correo` | `z.string().email()` | Sí |
| `CarreraSchema` | `Nombre` | `z.string()` | Sí |
| | `Descripcion` | `z.string()` | No |
| | `DuracionSemestres` | `z.number().int()` | No |
| `MateriaSchema` | `Nombre` | `z.string()` | Sí |
| | `Semestre` | `z.number().int()` | No |
| | `IdCarrera` | `z.number().int()` | Sí |
| `DivisionSchema` | `Descripcion` | `z.string()` | Sí |
| `ActaSchema` | `IdMateriaDivision` | `z.number().int()` | Sí |
| | `Libro` | `z.string()` | Sí |
| | `Folio` | `z.string()` | Sí |
| `DetalleActaSchema` | `IdActa` | `z.number().int()` | Sí |
| | `IdAlumno` | `z.number().int()` | Sí |
| | `NotaCursada` | `z.number()` | Sí |
| | `NotaFinalExamen` | `z.number()` | No (nullable) |
| | `CondicionFinal` | `z.enum([...])` | Sí |
| `ActividadSchema` | `Titulo` | `z.string()` | Sí |
| | `Descripcion` | `z.string()` | No |
| | `Tipo` | `z.enum([...])` | Sí |
| | `CantidadIntentosMaximos` | `z.number().int()` | Sí |
| | `DuracionMinutos` | `z.number().int()` | Sí (nullable) |
| | `RecursosPermitidos` | `z.string()` | No |
| | `IdMateriaDivision` | `z.number().int()` | Sí |
| | `FechaInicio` | `z.string().datetime()` | Sí |
| | `FechaFin` | `z.string().datetime()` | Sí |
| | `Estado` | `z.enum(['borrador', 'publicada'])` | No (default `'publicada'`) |
| | `GruposPreguntas` | `z.array(GrupoPreguntaBaseSchema)` | Sí |
| `ActividadUpdateSchema` | `IdPublicacion` | `z.number().int()` | Sí |
| | `Titulo` | `z.string()` | Sí |
| | `Descripcion` | `z.string()` | No |
| | `Tipo` | `z.enum([...])` | Sí |
| | `CantidadIntentosMaximos` | `z.number().int()` | Sí |
| | `DuracionMinutos` | `z.number().int()` | Sí (nullable) |
| | `RecursosPermitidos` | `z.string()` | No |
| | `IdMateriaDivision` | `z.number().int()` | Sí |
| | `FechaInicio` | `z.string().datetime()` | Sí |
| | `FechaFin` | `z.string().datetime()` | Sí |
| | `GruposPreguntas` | `z.array(GrupoPreguntaSchema con Id opcional en cada nivel)` | Sí |
| `IniciarExamenSchema` | `IdPublicacion` | `z.number().int()` | Sí |
| | `IdAlumno` | `z.number().int()` | Sí |
| `GuardarRespuestaSchema` | `IdIntento` | `z.number().int()` | Sí |
| | `IdPregunta` | `z.number().int()` | Sí |
| | `IdOpcionNueva` | `z.number().int()` | No (nullable) |
| | `RtaTexto` | `z.string()` | No (nullable) |
| `AsignarDivisionSchema` | `Id` | `z.number().int()` | Sí |
| `AsignarComisionSchema` | `IdMateriaDivision` | `z.number().int()` | Sí |
| `AlertaSchema` | `IdIntento` | `z.number().int()` | Sí |
| | `TipoIncidente` | `z.string()` | Sí |
| | `Detalle` | `z.string()` | No |
| `NavegacionSchema` | `IdIntento` | `z.number().int()` | Sí |
| | `IdPregunta` | `z.number().int()` | Sí |
| | `SegundosPermanencia` | `z.number().int()` | Sí |
| `CalificarSchema` | `notaFinal` | `z.number().min(0).max(10).multipleOf(0.01)` | Sí |
| `CorregirRespuestaSchema` | `esCorrecta` | `z.boolean().nullable()` | No (puede ser null) |
| | `comentariosDocente` | `z.string().nullable().optional()` | No |
| `UsuarioSchema` | `Email` | `z.string().email()` | Sí |
| | `Password` | `z.string()` | Sí |
| | `Rol` | `z.enum([...])` | Sí |
| | `IdDocente` | `z.number().int()` | No (nullable) |
| | `IdAlumno` | `z.number().int()` | No (nullable) |
| | `Activo` | `z.boolean()` | No |
| `UsuarioUpdateSchema` | `Email` | `z.string().email()` | No |
| | `Password` | `z.string()` | No |
| | `Rol` | `z.enum([...])` | No |
| | `IdDocente` | `z.number().int()` | No (nullable) |
| | `IdAlumno` | `z.number().int()` | No (nullable) |
| | `Activo` | `z.boolean()` | No |

### 5.2 Restricciones de Longitud (`.max()`)

| Esquema | Campo | `max()` |
|---|---|---|
| `AlumnoSchema` | `Nombre` | 50 |
| | `Apellido` | 50 |
| | `Cuil` | 20 |
| | `Correo` | 50 |
| `DocenteSchema` | `Nombre` | 50 |
| | `Apellido` | 50 |
| | `Cuil` | 20 |
| | `Correo` | 50 |
| `CarreraSchema` | `Nombre` | 100 |
| | `Descripcion` | 500 |
| `MateriaSchema` | `Nombre` | 100 |
| `DivisionSchema` | `Descripcion` | 50 |
| `ActaSchema` | `Libro` | 20 |
| | `Folio` | 20 |
| `DetalleActaSchema` | `NotaCursada` | `min(0).max(10).multipleOf(0.01)` |
| | `NotaFinalExamen` | `min(0).max(10).multipleOf(0.01)` |
| `ActividadSchema` | `Titulo` | 150 |
| | `Descripcion` | 1000 |
| | `RecursosPermitidos` | 500 |
| `AlertaSchema` | `TipoIncidente` | 50 |
| | `Detalle` | 250 |
| `OpcionSchema` (anidado) | `Texto` | 500 |
| `GrupoPreguntaSchema` (anidado) | `TituloReferencia` | 150 |
| `UsuarioSchema` | `Email` | 150 |
| `CalificarSchema` | `notaFinal` | `min(0).max(10).multipleOf(0.01)` |
| `CorregirRespuestaSchema` | `comentariosDocente` | Sin restricción (NVARCHAR(MAX)) |

### 5.3 Enumeraciones (`z.enum()`)

| Esquema | Campo | Valores |
|---|---|---|
| `ActividadSchema` | `Tipo` | `'evaluacion'`, `'tp'`, `'tarea'` |
| `VarianteSchema` (anidado) | `Tipo` | `'mc'`, `'vf'`, `'abierta'`, `'code'` |
| `DetalleActaSchema` | `CondicionFinal` | `'regular'`, `'promocionado'`, `'libre'` |
| `UsuarioSchema` / `UsuarioUpdateSchema` | `Rol` | `'admin'`, `'docente'`, `'alumno'` |

---

## 6. Manual de Testing

### 6.1 Ejecución

```bash
npm install         # Una sola vez
npm test            # Suite completa (202 tests)
npx jest --verbose  # Reporte detallado (202 tests)
npx jest tests/auth.test.ts  # Archivo específico
npx jest -t "carreras"       # Por patrón de nombre
```

### 6.2 Estructura

```
tests/
├── mocks/
│   └── db.ts               ← Fábrica de mock de mssql
├── admin.test.ts           ← Dashboard analítico + KPIs + filtros + RBAC
├── auth.test.ts            ← Login, contrato compatible y seguridad de credenciales
├── auth-refresh.test.ts    ← Rotación, concurrencia, reutilización y logout
├── auth-config.test.ts     ← Validación de secretos y duraciones
├── alumnos.test.ts         ← CRUD Alumnos + camelCase + estadísticas
├── evaluaciones.test.ts    ← Evaluaciones + modificar-completo + preguntas + detalle + alumnos
├── intentos.test.ts        ← Intentos, respuestas, reintentos, corrección e historial
├── academico.test.ts       ← Carreras, Materias, Docentes
├── actas.test.ts           ← Actas, Detalle, decimales
├── health.test.ts          ← Identidad de API, disponibilidad SQL y contrato degradado
├── rbac.test.ts            ← checkRole, JWT estricto/legacy, tipos y roles
└── reportes.test.ts        ← Rendimiento por alumno + listado + filtros + paginación
```

### 6.3 Aislamiento

```typescript
const mock = createMockPool();
jest.mock('mssql', () => mock.pool);
jest.mock('../src/config/db', () => mock);

// Simular resultado de SP
const reqBuilder = mock.pool.request();
(reqBuilder.execute as jest.Mock).mockResolvedValueOnce({
  recordset: [{ Id: 1, Nombre: 'Analista de Sistemas' }],
});
```

### 6.4 Tokens JWT en Tests

```typescript
process.env.JWT_SECRET = 'test-secret-key';
adminToken = jwt.sign(
  { id: 1, email: 'admin@test.com', role: 'admin', idAlumno: null, idDocente: null },
  process.env.JWT_SECRET
);
```

---

## 7. Scripts de Desarrollo

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor con `ts-node-dev` (recarga automática). |
| `npm run build` | Compilación TypeScript → `/dist`. |
| `npm test` | Suite de tests con Jest. |

> **Limitación conocida de build:** actualmente `npm run build` falla por la
> configuración TypeScript preexistente. El proyecto combina `module: "nodenext"`
> y un paquete CommonJS con `verbatimModuleSyntax: true`; además, `rootDir` no
> está acompañado por un `include` que excluya tests y scripts, y falta el tipado
> declarado de `mssql`. Esta deuda no afecta `npm run dev` ni la suite Jest, pero
> requiere una normalización específica de la estrategia CommonJS/ESM y del
> alcance de compilación antes de considerar operativo el build de producción.

---

## 8. Errores Conocidos y Deuda Técnica

### 8.1 Auth — transición y límites distribuidos

El login ya aplica Zod, elimina logs sensibles y emite access + refresh tokens
rotatorios. Permanecen dos tareas operativas:

- Desactivar `AUTH_ALLOW_LEGACY_ACCESS_TOKENS` y retirar el alias `token` después
  de migrar todos los clientes.
- Configurar rate limiting distribuido en producción. El limitador incluido es
  deliberadamente local por proceso y solo constituye defensa básica.

---

### 8.2 Docentes — SP duplicado en comisiones y materias

**Archivo:** `src/controllers/docentes.controller.ts:81-134`

| Endpoint | Controlador | SP que llama |
|---|---|---|
| `GET /api/docentes/:legajo/comisiones` | `getComisionesByDocente` | `SP_Docente_VerMaterias` |
| `GET /api/docentes/:legajo/materias` | `getMateriasByDocente` | `SP_Docente_VerMaterias` |

Ambos endpoints ejecutan el mismo SP (`SP_Docente_VerMaterias`), por lo que devuelven datos idénticos. Es un error por copy-paste. `getMateriasByDocente` debería llamar a un SP diferente (ej. `SP_Docente_ObtenerMaterias`) o ejecutar una query directa que retorne solo las materias del docente.

**Fix pendiente:** Corregir `getMateriasByDocente` para que consulte datos de materias (no comisiones).
