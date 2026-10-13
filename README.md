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
| **ts-jest + supertest** | 432 tests de referencia con mock completo de `mssql`. Sin dependencia de BD real. Supertest importa `src/app.ts` sin abrir un puerto. |

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
| POST | `/api/alumnos/:matricula/inscripciones` | `InscripcionAlumnoSchema` | `admin` |
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

#### Inscribir un alumno en una comisión

`POST /api/alumnos/:matricula/inscripciones` crea la relación entre el alumno y
una `MateriaDivision`. Requiere un access token con rol `admin`.

- `matricula`: entero positivo en el path.
- El body conserva el casing PascalCase habitual de escritura:

```json
{
  "IdMateriaDivision": 15
}
```

Una inscripción nueva devuelve `201 Created`:

```json
{
  "success": true,
  "data": {
    "matricula": 30999,
    "idMateriaDivision": 15
  },
  "message": "Alumno inscripto correctamente"
}
```

La operación es idempotente por la clave lógica
`(IdMateriaDivision, IdAlumno)`. Si la relación ya existe, devuelve `200 OK` con
el mismo recurso y no vuelve a insertar:

```json
{
  "success": true,
  "data": {
    "matricula": 30999,
    "idMateriaDivision": 15
  },
  "message": "El alumno ya estaba inscripto"
}
```

La API valida alumno activo, existencia de `MateriaDivision`, integridad de sus
relaciones con materia/división y materia activa. SQL Server serializa por la
relación mediante una transacción `SERIALIZABLE` y bloqueos
`UPDLOCK/HOLDLOCK`; la PK compuesta es la defensa final frente a duplicados. La
garantía funciona entre procesos o instancias que comparten la misma base.

| HTTP | `code` | Significado |
|---:|---|---|
| 400 | `REQUEST_INVALID` | Matrícula o body inválidos |
| 401 | `ACCESS_TOKEN_MISSING` | Falta el access token |
| 401 | `ACCESS_TOKEN_INVALID` | Access token inválido |
| 401 | `ACCESS_TOKEN_EXPIRED` | Access token vencido |
| 403 | `FORBIDDEN` | El usuario autenticado no es `admin` |
| 404 | `STUDENT_NOT_FOUND` | No existe la matrícula |
| 404 | `MATERIA_DIVISION_NOT_FOUND` | No existe la comisión o sus relaciones no son válidas |
| 409 | `STUDENT_INACTIVE` | El alumno está inactivo o suspendido |
| 409 | `MATERIA_INACTIVE` | La materia asociada está dada de baja |
| 500 | `INTERNAL_ERROR` | Fallo interno sin detalles SQL |

La inscripción pasa a ser visible mediante
`GET /api/alumnos/:matricula/materias`, los listados de alumnos por comisión y
las evaluaciones pendientes publicadas para esa `MateriaDivision`. No crea ni
modifica publicaciones, intentos, respuestas, notas o actas existentes. El
modelo actual no define cupos, períodos/cierre de inscripción, correlatividades
ni inscripción masiva; esas reglas no se infieren en este endpoint.

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

**Contrato `GET /api/docentes/:legajo/evaluaciones`:** devuelve una fila por
publicación, sin agrupar, ordenada por `fechaFin DESC`. Un docente sólo puede
consultar su propio legajo; `admin` conserva alcance global.

```json
{
  "success": true,
  "data": [
    {
      "idPublicacion": 31,
      "idActividad": 25,
      "idMateria": 8,
      "idMateriaDivision": 17,
      "titulo": "Primer parcial",
      "tipo": "evaluacion",
      "duracionMinutos": 90,
      "cantidadIntentosMaximos": 2,
      "estado": "publicada",
      "fechaInicio": "2026-10-20T12:00:00.000Z",
      "fechaFin": "2026-10-20T13:30:00.000Z",
      "materia": "Fundamentos de Redes de Datos",
      "division": "1° A",
      "carrera": "Tecnicatura Superior en Redes",
      "alumnosInscriptos": 28,
      "totalIntentos": 19
    }
  ]
}
```

Los identificadores provienen directamente de `Actividad.Id`, `Materia.Id` y
`MateriaDivision.Id`. `carrera` se resuelve mediante `Materia.IdCarrera`; el
frontend puede agrupar por IDs sin depender de nombres potencialmente repetidos.

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
| POST | `/api/evaluaciones/:idActividad/publicar-completo` | `PublicarActividadSchema` | `admin`, `docente` |
| POST | `/api/evaluaciones/:id/importar-banco` | `ImportarBancoSchema` | `docente` |
| PUT | `/api/evaluaciones/:id/estado` | — | `admin`, `docente` |
| GET | `/api/evaluaciones/intento/:idIntento/renderizar` | — | `alumno`, `admin`, `docente` |
| GET | `/api/evaluaciones/pregunta/:idPregunta/opciones/:idIntento` | — | `alumno`, `admin`, `docente` |
| GET | `/api/evaluaciones/publicacion/:id` | — | `alumno`, `admin`, `docente` |
| GET | `/api/evaluaciones/pendientes/:matricula` | — | `alumno`, `admin`, `docente` |
| GET | `/api/evaluaciones/publicaciones/:idPublicacion/alumnos/:matricula/intentos` | — | `alumno`*, `admin`, `docente` |
| PUT | `/api/evaluaciones/publicaciones/:idPublicacion/alumnos/:matricula/intento-valido` | `SeleccionarIntentoValidoSchema` | `admin`, `docente` |
| DELETE | `/api/evaluaciones/publicaciones/:idPublicacion/alumnos/:matricula/intento-valido` | — | `admin`, `docente` |
| GET | `/api/evaluaciones/:id/detalle` | — | `admin`, `docente` |
| GET | `/api/evaluaciones/:id/alumnos` | — | `admin`, `docente` |

**Body `POST /api/evaluaciones/guardar-completo`:**

> `Idempotency-Key` (UUID) es obligatorio. Por compatibilidad, omitir `Estado`
> conserva el comportamiento publicado. Con `Estado: "borrador"` solo son obligatorios
> `Titulo` e `IdMateriaDivision`; el servidor completa tipo, intentos, duración y fechas.

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
  "EscalaCalificacion": 100,
  "NotaAprobacion": 40,
  "ModoPuntaje": "personalizados",
  "MostrarPuntajePorPregunta": true,
  "CorreccionAutomaticaCerradas": false,
  "GruposPreguntas": [
    {
      "TituloReferencia": "SQL Básico",
      "PuntajeMaximo": 100,
      "Variantes": [
        {
          "Enunciado": "¿Qué comando SELECT es correcto?",
          "Tipo": "mc",
          "ModoJustificacion": "sin_justificacion",
          "EstrategiaCorreccion": "exacta",
          "TratamientoJustificacion": "informativa",
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

Un borrador admite cero grupos, grupos sin variantes, títulos/enunciados temporales
vacíos y preguntas incompletas. Defaults: `Tipo=evaluacion`, un intento, 90 minutos,
escala 10, nota de aprobación 4, puntajes iguales, puntaje oculto para el alumno,
corrección automática de cerradas habilitada, inicio UTC ahora + 5 minutos,
fin inicio + 24 horas y `GruposPreguntas=[]`. Las fechas
pueden quedar en el pasado al editar, pero siempre debe cumplirse `FechaFin > FechaInicio`.
La creación responde:

```json
{
  "success": true,
  "data": {
    "idActividad": 42,
    "idPublicacion": 15,
    "estado": "borrador",
    "revision": 1,
    "escalaCalificacion": 10,
    "notaAprobacion": 4,
    "modoPuntaje": "iguales",
    "mostrarPuntajePorPregunta": false,
    "correccionAutomaticaCerradas": true,
    "importaciones": [],
    "banco": []
  }
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
    "revision": 2,
    "escalaCalificacion": 10,
    "notaAprobacion": 4,
    "modoPuntaje": "iguales",
    "mostrarPuntajePorPregunta": false,
    "correccionAutomaticaCerradas": true,
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
        "puntajeMaximo": 10,
        "preguntas": [
          {
            "idPregunta": 10,
            "enunciado": "¿Qué comando SELECT es correcto?",
            "tipo": "mc",
            "modoJustificacion": "sin_justificacion",
            "estrategiaCorreccion": "exacta",
            "tratamientoJustificacion": "informativa",
            "contenidoHash": "<sha256-del-contenido>",
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

#### Configuración de calificación — etapa 1

- `EscalaCalificacion` acepta únicamente `10` o `100`.
- `NotaAprobacion` debe estar entre cero y la escala, con hasta dos decimales.
  Al crear, su default es 4 para escala 10 y 40 para escala 100.
- Al cambiar la escala de un borrador debe enviarse una nota de aprobación explícita;
  el backend no convierte valores silenciosamente.
- `ModoPuntaje="iguales"` ignora como fuente autoritativa cualquier reparto enviado.
  El detalle de borrador calcula el reparto sobre la estructura completa y la publicación
  lo materializa en centavos, por orden estable de grupos, incluyendo importaciones.
- `ModoPuntaje="personalizados"` permite una configuración incompleta en borrador,
  pero publicar exige `PuntajeMaximo` en cada grupo y suma exacta igual a la escala.
  Una importación nueva en este modo debe guardarse primero en borrador para asignarle
  puntaje antes de publicar.
- El detalle docente siempre incluye `puntajeMaximo`. El render del alumno lo omite
  cuando `MostrarPuntajePorPregunta=false`.
- `CorreccionAutomaticaCerradas` se persiste y el SP de finalización respeta el flag.
  La etapa 2 permite reemplazar esas autocorrecciones mediante el mismo endpoint de
  corrección, dejando auditoría.

Esta funcionalidad requiere aplicar manualmente
`migrations/20261011_calificacion_intentos_telemetria.sql`, después de las migraciones
del banco y de revisión/idempotencia. Validar luego con
`scripts/verificar-calificacion-intentos-telemetria.sql`. El backend no ejecuta DDL al arrancar.

#### Selección múltiple y justificación — etapas 1 y 2

Los borradores de evaluación y el banco admiten `Tipo="multiple"` y tres campos
aditivos por pregunta:

- `ModoJustificacion`: `sin_justificacion` (default), `opcional` u `obligatoria`.
- `EstrategiaCorreccion`: `exacta` (default), `parcial_sin_penalizacion` o
  `parcial_penalizada`. Las estrategias parciales sólo corresponden a `multiple`.
- `TratamientoJustificacion`: `informativa` (default) o `revision_manual`. La revisión
  manual exige una justificación opcional/obligatoria; `abierta` y `code` conservan
  tratamiento informativo porque su respuesta principal ya se corrige manualmente.

`multiple` disponible requiere al menos dos opciones y una correcta; puede tener más
de una correcta. `ContenidoHash` es calculado por el servidor sobre tipo, enunciado,
configuración y opciones ordenadas. Identifica contenido equivalente, no propiedad ni
procedencia, y cambia cuando una copia se adapta.

El runtime de la etapa 2 permite publicar estas configuraciones, congela enunciado,
tipo, configuración y opciones al iniciar el intento, restaura la respuesta en progreso
y guarda el conjunto completo de opciones de forma atómica. Los contratos legacy
mantienen sus defaults.

Requiere aplicar manualmente
`migrations/20261013_respuestas_multiples_justificacion.sql` después de la migración
de calificación y ejecutar
`scripts/verificar-respuestas-multiples-justificacion.sql`. La migración prepara
snapshots e historial, pero no recalifica ni modifica notas históricas.

Después debe aplicarse `migrations/20261014_runtime_respuestas_multiples.sql` y
ejecutarse `scripts/verificar-runtime-respuestas-multiples.sql`. Esta segunda migración
actualiza los SP existentes de inicio, render, opciones y entrega; no crea SP nuevos.

Reglas de autocorrección congeladas por intento:

- `exacta`: máximo sólo al seleccionar todas las correctas y ninguna incorrecta.
- `parcial_sin_penalizacion`: proporción de correctas seleccionadas sobre el total de
  correctas, sin descontar distractores.
- `parcial_penalizada`: resta además la proporción de distractores seleccionados y aplica
  piso cero. Todos los resultados se redondean a dos decimales.

Con `TratamientoJustificacion="informativa"`, el puntaje de opciones puede ser definitivo.
Con `revision_manual`, se conserva en `puntajeAutomaticoOpciones` como valor provisional,
pero `puntajeObtenido` queda pendiente hasta la corrección docente. Una pregunta contestada
con justificación obligatoria no puede entregarse sin ella; guardar el borrador incompleto sí
está permitido. Una pregunta totalmente omitida no exige justificación para entregar.

#### Selección del intento académicamente válido — etapa 3

`GET /api/evaluaciones/publicaciones/:idPublicacion/alumnos/:matricula/intentos`
devuelve el resumen de todos los intentos de esa combinación, sin respuestas ni opciones.
El alumno sólo puede consultar su propia matrícula; el docente sólo puede consultar
publicaciones de sus comisiones activas. Admin conserva acceso global.

Si no existe una selección manual, el intento válido es el último con estado `entregado`,
ordenado de forma determinística por `fechaFin DESC`, `numeroIntento DESC` e
`idIntento DESC`. Los intentos `en_progreso`, `vencido` y `anulado` nunca desplazan a
uno entregado. Cada elemento agrega `esIntentoValido` y
`seleccionIntentoValido` (`automatica`, `manual` o `null`).

```json
{
  "success": true,
  "data": [
    {
      "idIntento": 12,
      "idPublicacion": 5,
      "idAlumno": 30500,
      "numeroIntento": 2,
      "estado": "entregado",
      "fechaInicio": "2026-10-11T13:00:00.000Z",
      "fechaFin": "2026-10-11T14:00:00.000Z",
      "notaFinal": 8.5,
      "escalaCalificacion": 10,
      "notaAprobacion": 4,
      "estadoCorreccion": "completa",
      "preguntasPendientesCorreccion": 0,
      "esIntentoValido": true,
      "seleccionIntentoValido": "automatica"
    }
  ]
}
```

Para fijar manualmente un intento entregado:

```http
PUT /api/evaluaciones/publicaciones/5/alumnos/30500/intento-valido
Content-Type: application/json

{ "IdIntento": 11 }
```

La selección manual es persistente, auditada y prevalece aunque después se entregue
otro intento. Repetir el mismo `IdIntento` es idempotente. `DELETE` sobre el mismo path
elimina el override, también de forma auditada, y restaura inmediatamente la regla
automática. Si no hay intentos entregados, devuelve `idIntento: null`.

Errores funcionales estables: `ATTEMPT_SCOPE_FORBIDDEN` (403) para acceso fuera de
alcance y `ATTEMPT_SELECTION_INVALID` (409) cuando el candidato no está entregado, no
pertenece a la combinación indicada o la selección persistida es incoherente. Esta
etapa reutiliza las tablas creadas por la migración de calificación; no requiere un
script SQL adicional.

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
      "correccionPendiente": true,
      "correccionConfirmada": false,
      "revisionDisponible": false,
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
> El payload es el contrato de borrador e incluye:
> 1. Incluye `IdPublicacion` para identificar la publicación a actualizar.
> 2. `RevisionEsperada`, obligatoria. Una revisión obsoleta responde 409
>    `DRAFT_REVISION_CONFLICT`.
> 3. Los objetos anidados (`GrupoPregunta`, `Pregunta`, `Opcion`) pueden incluir un campo `Id` opcional. Si se envía, el registro se actualiza conservando su ID; si no, se crea uno nuevo.
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
  "RevisionEsperada": 1,
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
| PUT | `/api/intentos/:idIntento/anular-por-incidente/:eventoId` | — | `alumno`, `admin` |
| GET | `/api/intentos/mios` | `MisIntentosQuerySchema` (query) | `alumno` |
| GET | `/api/intentos/alumno/:idAlumno` | — | `alumno`, `admin`, `docente` |
| GET | `/api/intentos/alumno/:idAlumno/detallados` | — | `alumno`, `admin`, `docente` |
| GET | `/api/intentos/alumno/:idAlumno/historial-corregido` | — | `alumno`, `admin`, `docente` |
| GET | `/api/intentos/:idIntento/completo` | — | `admin`, `docente`, `alumno`* |
| **PUT** | `/api/intentos/:idIntento/calificar` | `CalificarSchema` | `admin`, `docente` |
| **PUT** | `/api/intentos/:idIntento/preguntas/:idPregunta/corregir` | `CorregirRespuestaSchema` | `docente` |
| **PUT** | `/api/intentos/:idIntento/confirmar-correccion` | — | `admin`, `docente` |

**Body `POST /api/intentos/iniciar`:**

```json
{
  "IdPublicacion": 5,
  "IdAlumno": 30500
}
```

#### Historial filtrable del alumno — etapa 4

`GET /api/intentos/mios` toma la matrícula exclusivamente del access token. No recibe
ni acepta `matricula` o `idAlumno` desde el navegador. Es un endpoint de resumen: no
expone preguntas, respuestas, opciones ni contenido completo del examen.

Filtros opcionales, combinados con semántica AND:

| Query | Valores |
|---|---|
| `idMateria` | entero positivo |
| `idMateriaDivision` | entero positivo |
| `fechaDesde`, `fechaHasta` | fecha `YYYY-MM-DD` o timestamp ISO 8601 |
| `estado` | `en_progreso`, `entregado`, `vencido`, `anulado` |
| `resultado` | `aprobado`, `desaprobado`, `pendiente` |
| `pagina` | entero positivo; default `1` |
| `limite` | `1..100`; default `20` |
| `ordenarPor` | `fecha`, `materia`, `evaluacion`, `nota`; default `fecha` |
| `ordenDireccion` | `asc`, `desc`; default `desc` |

Las fechas filtran `Intento.FechaInicio`. Una `fechaHasta` sin hora incluye el día
completo mediante un límite superior exclusivo al comienzo del día siguiente; un
timestamp se compara de forma inclusiva. El orden siempre agrega `idIntento DESC` como
desempate estable.

`resultado` usa la nota efectiva `Intento.NotaFinal` y el umbral particular
`Actividad.NotaAprobacion`; una nota nula produce `pendiente`. Se preservan la nota y
escala originales, por lo que el endpoint no mezcla ni normaliza silenciosamente
escalas 10/100.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "idIntento": 15,
        "idActividad": 8,
        "idPublicacion": 12,
        "titulo": "Parcial SQL",
        "tipo": "evaluacion",
        "idMateria": 4,
        "materia": "Bases de Datos",
        "idMateriaDivision": 9,
        "division": "2A",
        "numeroIntento": 2,
        "cantidadIntentosMaximos": 3,
        "estado": "entregado",
        "fechaInicio": "2026-10-01T10:00:00.000Z",
        "fechaFin": "2026-10-01T11:00:00.000Z",
        "notaAutomatica": 65,
        "notaFinal": 72,
        "escalaCalificacion": 100,
        "notaAprobacion": 40,
        "resultado": "aprobado",
        "estadoCorreccion": "completa",
        "correccionPendiente": false,
        "correccionConfirmada": true,
        "revisionDisponible": true,
        "esIntentoValido": true,
        "seleccionIntentoValido": "automatica"
      }
    ],
    "resumen": {
      "totalIntentos": 12,
      "totalEvaluaciones": 7,
      "evaluacionesAprobadas": 4,
      "evaluacionesDesaprobadas": 2,
      "evaluacionesPendientes": 1
    },
    "paginacion": {
      "pagina": 1,
      "limite": 20,
      "total": 12,
      "totalPaginas": 1
    }
  }
}
```

El resumen se calcula sobre todos los intentos que cumplen los filtros, antes de
paginar. `totalIntentos` cuenta todas las filas y `totalEvaluaciones` las publicaciones
distintas. Las tres categorías académicas cuentan sólo intentos canónicamente válidos;
por eso una publicación que únicamente tenga intentos no entregados no integra todavía
aprobadas, desaprobadas ni pendientes académicas.

La marca válida se resuelve antes de aplicar filtros: prevalece el override manual y,
si no existe, el último `entregado` por `FechaFin`, `NumeroIntento` e `Id`. Filtrar la
página no cambia cuál es el intento válido. Los endpoints históricos con matrícula se
mantienen sin cambios por compatibilidad.

**Response `GET /api/intentos/:idIntento/completo`:**

> Devuelve el intento con todas las preguntas (congeladas), las opciones y las respuestas del alumno en una sola llamada.
>
> ⚠️ Cada opción lleva `fueSeleccionada: true/false` para que el Frontend pueda pintar directamente cuál fue marcada, sin cruzar arrays.
>
> \* `alumno` — sólo puede acceder a su propio intento y cuando la corrección está
> confirmada. Antes recibe `409 REVIEW_NOT_AVAILABLE`; no se exponen preguntas,
> respuestas, comentarios ni claves correctas.

```json
{
  "success": true,
  "data": {
    "idIntento": 1,
    "idAlumno": 30500,
    "idPublicacion": 5,
    "estado": "entregado",
    "notaFinal": null,
    "notaAutomatica": 2.00,
    "notaFinalCalculada": null,
    "notaFinalManual": null,
    "correccionPendiente": false,
    "correccionConfirmada": true,
    "revisionDisponible": true,
    "escalaCalificacion": 10,
    "notaAprobacion": 4,
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
        "puntajeMaximo": 2.00,
        "puntajeObtenido": 2.00,
        "origenCorreccion": "automatica",
        "comentariosDocente": null,
        "corregidoPor": null,
        "fechaCorreccion": "2026-06-15T11:30:00.000Z",
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

Contrato nuevo para selección múltiple, justificación, concurrencia optimista e
idempotencia offline:

```json
{
  "IdIntento": 1,
  "IdPregunta": 10,
  "IdOpcionesSeleccionadas": [3, 5],
  "Justificacion": "Ambas condiciones se cumplen.",
  "RevisionEsperada": 2,
  "EventoId": "b0c1d99d-dac3-4ad7-b983-9c400267bd31"
}
```

`EventoId` y `RevisionEsperada` se envían juntos. Repetir el mismo evento y contenido
devuelve el resultado anterior sin duplicar cambios; reutilizarlo con otro contenido o
guardar sobre una revisión obsoleta devuelve `409`. El array vacío representa una
selección omitida y permite guardar borradores incompletos.

Respuesta:

```json
{
  "success": true,
  "message": "Respuesta guardada y auditada correctamente.",
  "data": {
    "idRespuesta": 21,
    "idIntento": 1,
    "idPregunta": 10,
    "idsOpcionesSeleccionadas": [3, 5],
    "rtaTexto": null,
    "justificacion": "Ambas condiciones se cumplen.",
    "revision": 3,
    "replay": false
  }
}
```

El contrato legacy de selección única se conserva:

```json
{
  "IdIntento": 1,
  "IdPregunta": 10,
  "IdOpcionNueva": 3
}
```

También continúa aceptándose `RtaTexto` para `abierta` y `code`. Las opciones deben
pertenecer al snapshot de la pregunta y `mc`/`vf` admiten como máximo una. El alumno
sólo puede modificar sus propios intentos en estado `en_progreso`.

`GET /api/evaluaciones/intento/:idIntento/renderizar` agrega la configuración congelada
y `respuesta` (`idsOpcionesSeleccionadas`, texto, justificación y revisión), sin exponer
claves correctas. `GET /api/evaluaciones/pregunta/:idPregunta/opciones/:idIntento`
renderiza texto y selección desde el snapshot; `esCorrecta` se omite para alumnos.

`POST /api/intentos/:id/finalizar` conserva su body vacío e idempotencia. Puede devolver
`409 REQUIRED_JUSTIFICATION_MISSING`; en ese caso el intento continúa `en_progreso` y
ninguna nota fue modificada.

Si todas las preguntas quedan autocorregidas con puntaje definitivo, la entrega confirma
automáticamente la corrección y habilita la revisión. Si queda al menos un puntaje
pendiente, `correccionConfirmada` permanece en `false`.

#### Anulación autoritativa por incidente

`PUT /api/intentos/:idIntento/anular-por-incidente/:eventoId` no recibe body. El evento
debe existir previamente en `IncidenteIntento` y ser `focus_lost` o `fullscreen_exit`.
El alumno sólo puede anular su propio intento en progreso; `admin` queda disponible para
un proceso institucional autorizado sin introducir otro mecanismo de autenticación.

```json
{
  "success": true,
  "data": {
    "idIntento": 1,
    "eventoId": "550e8400-e29b-41d4-a716-446655440000",
    "tipoIncidente": "focus_lost",
    "motivo": "POLICY_FIRST_FOCUS_LOSS",
    "estado": "anulado",
    "replay": false
  }
}
```

La operación es serializable e idempotente por intento/evento. Un replay devuelve el
mismo resultado; otro evento para un intento ya anulado devuelve
`409 ATTEMPT_ALREADY_CANCELLED`. Se conservan todas las respuestas sincronizadas, se
marca el intento como `anulado` y todas sus notas quedan en `null`. La política temporal
vigente considera la primera pérdida detectada; el frontend debe sincronizar respuestas
pendientes antes de solicitar la anulación.

#### Confirmación de corrección

`PUT /api/intentos/:idIntento/confirmar-correccion` tampoco recibe body. Requiere docente
propietario de la comisión o administrador, un intento fuera de `en_progreso` y todas las
preguntas con `PuntajeObtenido` definitivo. Si quedan pendientes devuelve
`409 CORRECTION_INCOMPLETE`.

```json
{
  "success": true,
  "message": "Corrección confirmada correctamente",
  "data": {
    "idIntento": 1,
    "correccionPendiente": false,
    "correccionConfirmada": true,
    "correccionConfirmadaPor": 7,
    "fechaCorreccionConfirmada": "2026-10-15T15:30:00.000Z",
    "origenConfirmacionCorreccion": "manual",
    "revisionDisponible": true,
    "replay": false
  }
}
```

Repetir la confirmación no duplica auditoría. Corregir una pregunta o modificar la nota
después de confirmar vuelve a dejar la corrección pendiente y registra la reapertura.
Durante esta etapa, confirmar un intento entregado habilita la revisión del alumno; la
etapa 5 separará esa visibilidad mediante políticas y sesiones específicas.

**Body `PUT /api/intentos/:idIntento/calificar`:**

```json
{
  "notaFinal": 7.5
}
```

`notaFinal` acepta hasta dos decimales y se valida contra la
`escalaCalificacion` de la actividad, por lo que `100.00` es válido únicamente en
escala 100. Este endpoint conserva su path y body, pero la nota se registra como
override docente en `NotaFinalManual`, actualiza la nota efectiva `NotaFinal` y
genera una fila de auditoría. No modifica `NotaFinalCalculada`.

**Response `PUT /api/intentos/:idIntento/calificar`:**

```json
{
  "success": true,
  "message": "Nota asignada correctamente",
  "data": {
    "idIntento": 1,
    "notaAutomatica": 2,
    "notaFinalCalculada": 8.5,
    "notaFinalManual": 7.5,
    "notaFinal": 7.5,
    "escalaCalificacion": 10,
    "notaAprobacion": 4
  }
}
```

**Body `PUT /api/intentos/:idIntento/preguntas/:idPregunta/corregir`:**

> ⚠️ **Excepción a la regla PascalCase.** Este endpoint no pasa por un SP; el controlador consume los datos directamente. Las claves se envían en **camelCase** (mismo criterio que `CalificarSchema`).

Contrato canónico:

```json
{
  "puntajeObtenido": 1.5,
  "comentariosDocente": "Respuesta parcialmente correcta."
}
```

Por compatibilidad sigue aceptándose `esCorrecta: true|false|null`: `true` se
traduce al máximo congelado, `false` a cero y `null` deja la pregunta pendiente.
Si se envían ambos campos, `puntajeObtenido` es autoritativo. El puntaje debe estar
entre cero y `puntajeMaximo`, con hasta dos decimales.

La operación actualiza `IntentoPregunta`, por lo que admite preguntas omitidas sin
fila en `Respuesta`. También permite reemplazar una corrección automática: el origen
pasa a `manual` y se registra el valor anterior/nuevo, comentario, usuario y fecha en
el historial. Luego recalcula `NotaAutomatica`, `NotaFinalCalculada` y la nota efectiva;
un override docente existente siempre prevalece. La operación es transaccional y el
docente debe pertenecer a la comisión del intento.

**Response `PUT /api/intentos/:idIntento/preguntas/:idPregunta/corregir`:**

```json
{
  "success": true,
  "message": "Respuesta corregida correctamente",
  "data": {
    "idIntento": 1,
    "idPregunta": 10,
    "puntajeMaximoSnapshot": 2,
    "puntajeObtenido": 1.5,
    "origenCorreccion": "manual",
    "comentariosDocente": "Respuesta parcialmente correcta.",
    "notaFinalCalculada": 8.5,
    "notaFinalManual": null,
    "notaFinal": 8.5,
    "escalaCalificacion": 10,
    "notaAprobacion": 4
  }
}
```

Errores funcionales relevantes: `QUESTION_SCORE_OUT_OF_RANGE` (400),
`ATTEMPT_NOT_DELIVERED` (400 para un intento todavía en progreso) y
`ATTEMPT_SCOPE_FORBIDDEN` (403).

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

> Devuelve intentos con `NotaFinal IS NOT NULL` y `Estado = 'entregado'`. La presencia
> de una nota manual no habilita por sí sola la devolución: el frontend debe usar
> `correccionConfirmada` y `revisionDisponible`.

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
      "numeroIntento": 1,
      "correccionPendiente": false,
      "correccionConfirmada": true,
      "revisionDisponible": true
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
| PUT | `/api/telemetria/intentos/:idIntento/incidentes/:eventoId` | `IncidenteFocoSchema` | `alumno`, `admin` |
| GET | `/api/telemetria/intentos/:idIntento/resumen` | — | `docente`, `admin` |
| GET | `/api/telemetria/intentos/:idIntento/incidentes` | — | `docente`, `admin` |

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

Los endpoints `alerta` y `navegacion` se conservan como contratos legacy. La pérdida
de foco o salida de pantalla completa usa un `eventoId` UUID generado por el cliente y un `PUT`
naturalmente idempotente.

**Inicio de pérdida de foco:**

```json
{
  "Tipo": "focus_lost",
  "FechaInicioCliente": "2026-10-12T10:15:00.000Z"
}
```

**Finalización posterior del mismo evento:**

```json
{
  "Tipo": "focus_lost",
  "FechaFinCliente": "2026-10-12T10:15:23.500Z",
  "DuracionMilisegundos": 23500
}
```

También pueden enviarse inicio, fin y duración juntos. Repetir el mismo UUID con los
mismos datos devuelve el incidente existente sin duplicarlo; reutilizarlo con datos
incompatibles devuelve `409 FOCUS_EVENT_CONFLICT`.

Reglas:

- El alumno sólo registra eventos de sus propios intentos; la identidad proviene del JWT.
- Docente y administrador consultan. El docente queda limitado a sus comisiones activas.
- Se registran timestamps de recepción en el servidor además de los timestamps cliente.
- Se toleran cinco minutos de diferencia de reloj y hasta siete días desde `FechaFin`
  para sincronización tardía. Un replay idéntico ya persistido continúa siendo válido.
- La diferencia entre timestamps y `DuracionMilisegundos` admite hasta dos segundos de
  desviación por temporizadores del navegador.
- La pérdida de foco no anula, vence ni finaliza el intento y no crea consecuencias
  automáticas. Los eventos se conservan aunque otro intento pase a ser el válido.
- No se almacenan respuestas, tokens ni contenido del examen.

**Resumen docente/admin:**

```json
{
  "success": true,
  "data": {
    "cantidadPerdidasFoco": 4,
    "segundosTotalesFuera": 95,
    "promedioSegundosFuera": 23.75,
    "maximoSegundosFuera": 41
  }
}
```

`cantidadPerdidasFoco` incluye eventos iniciados y completados. Las métricas de duración
usan únicamente eventos completados y se expresan en segundos. El listado devuelve los
timestamps cliente/servidor, duración en milisegundos y estado `iniciado|completado`,
ordenados por inicio e ID.

Errores funcionales nuevos: `FOCUS_EVENT_INVALID` (400),
`FOCUS_EVENT_SCOPE_FORBIDDEN` (403), `FOCUS_EVENT_NOT_FOUND` (404),
`FOCUS_EVENT_CONFLICT`, `FOCUS_EVENT_NOT_STARTED` y
`FOCUS_EVENT_SYNC_WINDOW_EXPIRED` (409).

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

### 4.14 Reportes — Rendimiento por Evaluación

| Método | Endpoint | Validación | Roles |
|---|---|---|---|
| GET | `/api/reportes/rendimiento-evaluaciones` | `RendimientoEvaluacionesQuerySchema` | `admin`, `docente` |

La unidad de cada fila es una `Publicacion` cuya actividad tiene
`Tipo = 'evaluacion'`. KPIs y gráficos se calculan sobre todo el alcance después
de RBAC y filtros; `evaluaciones` contiene únicamente la página solicitada.

#### Filtros

Todos son opcionales y se combinan con semántica AND. El schema es estricto:
parámetros desconocidos también producen `400 REQUEST_INVALID`.

| Parámetro | Tipo/default | Regla |
|---|---|---|
| `idMateria` | entero positivo | Materia de la comisión |
| `idMateriaDivision` | entero positivo | Comisión exacta |
| `idActividad` | entero positivo | Actividad base |
| `idPublicacion` | entero positivo | Publicación exacta |
| `estado` | enum | `borrador`, `publicada` o `archivada`; corresponde a `Actividad.Estado` |
| `fechaDesde` | ISO 8601 | `Publicacion.FechaInicio >= fechaDesde` |
| `fechaHasta` | ISO 8601 | `Publicacion.FechaInicio <= fechaHasta` |
| `alcanceIntentos` | enum, default `todos` | `todos` calcula resultados sobre cada entrega; `validos` usa un único intento académico por alumno/publicación |
| `conPendientesCorreccion` | boolean | `true` conserva evaluaciones con pendientes; `false`, sólo evaluaciones sin pendientes |
| `pagina` | entero, default `1` | Mínimo 1 |
| `limite` | entero, default `20` | Entre 1 y 100 |
| `ordenarPor` | enum, default `fecha` | `evaluacion`, `fecha`, `promedio`, `entregados`, `aprobacion`, `pendientesCorreccion` |
| `ordenDireccion` | enum, default `desc` | `asc` o `desc` |

Todo orden agrega `idPublicacion ASC` como desempate estable. Las fechas pueden
ser `YYYY-MM-DD` o timestamps ISO 8601; `fechaDesde` no puede superar
`fechaHasta`.

#### RBAC y alcance

- `admin` consulta todas las publicaciones institucionales alcanzadas por los filtros.
- `docente` usa exclusivamente `idDocente` del access token y sólo consulta
  `MateriaDivision.IdDocente = idDocente`.
- No se acepta identidad docente desde query string.
- Si un docente especifica materia, comisión, actividad o publicación que no
  coincide con una publicación de evaluación de su alcance, recibe
  `403 REPORT_SCOPE_FORBIDDEN`. La respuesta no distingue recurso inexistente de
  recurso ajeno.
- `alumno` recibe `403 FORBIDDEN`.

#### Reglas de cálculo

- **Evaluación:** una publicación de una actividad con `Tipo = 'evaluacion'`.
- **Alumno alcanzado:** alumno actualmente presente en `InscripcionMateria` para
  la `MateriaDivision` publicada. La tabla no conserva fecha de inscripción, por
  lo que no representa un padrón histórico al momento de publicación.
- **Alumno único:** matrícula distinta dentro de todas las publicaciones
  filtradas; si aparece en varias publicaciones se cuenta una vez.
- **Alumno que inició:** matrícula distinta con al menos un intento en esa publicación.
- **Sin iniciar:** `max(alumnosAlcanzados - alumnosQueIniciaron, 0)`.
- **Entregado:** intento cuyo estado es exactamente `entregado`.
- **Pendiente de corrección:** intento `entregado` con `NotaFinal IS NULL`. Es el
  estado efectivo dejado por finalización cuando existen preguntas abiertas y
  continúa así hasta la asignación de nota final.
- **Alcance operativo:** `intentosTotales`, estados y pendientes de corrección
  siempre cuentan todos los intentos alcanzados, independientemente de
  `alcanceIntentos`.
- **Alcance académico:** calificados, promedio, aprobados y desaprobados usan todos
  los entregados cuando `alcanceIntentos=todos`. Con `validos` usan como máximo un
  entregado por alumno/publicación: el override manual si existe o, en caso
  contrario, el último por `FechaFin DESC, NumeroIntento DESC, Id DESC`.
- **Calificado:** intento académico `entregado` con `NotaFinal IS NOT NULL`.
- **Promedio por evaluación:** promedio de notas originales de esa actividad; la fila
  informa `escalaCalificacion` y `notaAprobacion` para interpretarlo. También expone
  `promedioIntentosCalificadosBase10`.
- **Promedio global:** promedio ponderado por intento calificado, normalizado a base
  10 mediante `NotaFinal * 10 / EscalaCalificacion`; no es un promedio de promedios.
  Sin intentos calificados devuelve `null`.
- **Aprobado/desaprobado:** compara la nota original con
  `Actividad.NotaAprobacion`; no usa umbrales hardcodeados.
- **Tasa de aprobación:** intentos aprobados / intentos calificados × 100. Sin
  denominador devuelve `null`.
- `en_progreso`, `vencido` y `anulado` se cuentan separadamente. No participan
  en calificados, promedio ni tasa.

`graficos.distribucionResultados` usa categorías mutuamente excluyentes por
intento: `Aprobados`, `Desaprobados`, `Pendientes de corrección`, `En progreso`,
`Vencidos` y `Anulados`. Las dos primeras y la pendiente sólo clasifican
intentos `entregado`; las restantes corresponden directamente al estado.

El filtro `conPendientesCorreccion` se aplica antes de calcular KPIs, gráficos,
total y página. Por lo tanto, todos esos bloques describen exactamente el mismo
conjunto de evaluaciones filtradas.

#### Response

```json
{
  "success": true,
  "data": {
    "criterios": {
      "alcanceIntentos": "todos",
      "escalaPromedio": 10,
      "conPendientesCorreccion": null
    },
    "kpis": {
      "totalEvaluaciones": 12,
      "totalAlumnosAlcanzados": 280,
      "totalAlumnosUnicos": 145,
      "totalIntentos": 260,
      "totalEntregados": 230,
      "totalEnProgreso": 15,
      "totalVencidos": 5,
      "totalAnulados": 10,
      "totalIntentosAlcanceAcademico": 230,
      "totalIntentosCalificados": 210,
      "intentosPendientesCorreccion": 20,
      "promedioIntentosCalificados": 7.15,
      "promedioIntentosCalificadosBase10": 7.15,
      "tasaAprobacionIntentos": 74.3
    },
    "graficos": {
      "distribucionResultados": [
        { "categoria": "Aprobados", "cantidad": 156 },
        { "categoria": "Desaprobados", "cantidad": 54 },
        { "categoria": "Pendientes de corrección", "cantidad": 20 },
        { "categoria": "En progreso", "cantidad": 15 },
        { "categoria": "Vencidos", "cantidad": 5 },
        { "categoria": "Anulados", "cantidad": 10 }
      ]
    },
    "evaluaciones": [
      {
        "idPublicacion": 47,
        "idActividad": 18,
        "titulo": "Parcial SQL",
        "idMateria": 5,
        "materia": "Bases de Datos",
        "idMateriaDivision": 12,
        "division": "2A",
        "fechaInicio": "2026-08-01T12:00:00.000Z",
        "fechaFin": "2026-08-01T14:00:00.000Z",
        "estado": "publicada",
        "escalaCalificacion": 100,
        "notaAprobacion": 60,
        "alumnosAlcanzados": 30,
        "alumnosQueIniciaron": 28,
        "sinIniciar": 2,
        "intentosTotales": 30,
        "entregados": 27,
        "enProgreso": 1,
        "vencidos": 1,
        "anulados": 1,
        "intentosAlcanceAcademico": 24,
        "intentosCalificados": 24,
        "intentosPendientesCorreccion": 3,
        "promedioIntentosCalificados": 71.5,
        "promedioIntentosCalificadosBase10": 7.15,
        "intentosAprobados": 18,
        "intentosDesaprobados": 6,
        "porcentajeAprobacionIntentos": 75.0
      }
    ],
    "paginacion": {
      "pagina": 1,
      "limite": 20,
      "total": 12,
      "totalPaginas": 1
    }
  }
}
```

Un listado vacío devuelve `200`, `evaluaciones: []`, `total: 0`,
`totalPaginas: 0`, `distribucionResultados: []`; promedio y tasa son `null`.

#### Errores

| HTTP | `code` | Motivo |
|---:|---|---|
| 400 | `REQUEST_INVALID` | Filtro, fecha, paginación u ordenamiento inválidos |
| 401 | `ACCESS_TOKEN_MISSING` / `ACCESS_TOKEN_INVALID` / `ACCESS_TOKEN_EXPIRED` | Autenticación |
| 403 | `FORBIDDEN` | Rol no autorizado |
| 403 | `REPORT_SCOPE_FORBIDDEN` | Identidad docente inválida o filtro explícito fuera de alcance |
| 500 | `INTERNAL_ERROR` | Error interno sin SQL ni stack |

El endpoint existente `GET /api/reportes/rendimiento` conserva sus modos y estructura
general; la interpretación académica configurable se documenta a continuación.

---

### 4.15 Reportes — Rendimiento por Alumno

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
| `estado` | `enum` | — | `entregado` \| `en_progreso` \| `vencido` \| `anulado` |
| `fechaDesde` | `string` (ISO 8601) | — | Filtro por fecha de inicio del intento |
| `fechaHasta` | `string` (ISO 8601) | — | Filtro por fecha de inicio del intento |
| `alcanceIntentos` | `enum` | `todos` | `todos` \| `validos`; limita sólo las métricas académicas y, en detalle, los intentos devueltos |
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
- Los contadores operativos conservan todos los intentos. Promedio, corregidos y
  aprobación usan `alcanceIntentos`.
- `validos` respeta el override manual y, si no existe, usa el último intento entregado
  por alumno/publicación con desempate estable.
- Aprobación compara cada nota con `Actividad.NotaAprobacion`.
- Los promedios que combinan actividades se normalizan a base 10. Cada actividad
  conserva su `escalaCalificacion`, `notaAprobacion` y notas originales.

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
      "intentosAlcanceAcademico": 4,
      "totalCorregidos": 4,
      "promedioGeneral": 7.25,
      "escalaPromedio": 10,
      "alcanceIntentos": "todos",
      "aprobados": 3,
      "desaprobados": 1,
      "porcentajeAprobacion": 75.0
    },
    "actividades": [
      {
        "idActividad": 1,
        "titulo": "Parcial I",
        "tipo": "evaluacion",
        "escalaCalificacion": 10,
        "notaAprobacion": 6,
        "materia": "Matemática",
        "division": "A",
        "intentos": 2,
        "notaMaxima": 8.5,
        "notaPromedio": 8.0,
        "mejorIntento": {
          "numeroIntento": 2,
          "notaFinal": 8.5,
          "notaAutomatica": null,
          "fechaFin": "2026-06-20T11:00:00.000Z",
          "esIntentoValido": true,
          "seleccionIntentoValido": "automatica"
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
      "intentosAlcanceAcademico": 160,
      "promedioGeneral": 6.8,
      "escalaPromedio": 10,
      "alcanceIntentos": "todos",
      "tasaAprobacion": 72.5
    },
    "alumnos": [
      {
        "matricula": 30500,
        "nombre": "Julieta",
        "apellido": "Acosta",
        "totalIntentos": 5,
        "intentosAlcanceAcademico": 4,
        "totalCorregidos": 4,
        "promedio": 7.25,
        "escalaPromedio": 10,
        "alcanceIntentos": "todos",
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
| | `Tipo` | `z.enum([...])` | No (default `evaluacion`) en borrador |
| | `CantidadIntentosMaximos` | `z.number().int().min(1).max(10)` | No (default `1`) en borrador |
| | `DuracionMinutos` | entero positivo o `null` | No (default `90`) en borrador |
| | `RecursosPermitidos` | `z.string()` | No |
| | `IdMateriaDivision` | `z.number().int()` | Sí |
| | `FechaInicio` | `z.string().datetime()` | No (ahora UTC + 5 min) en borrador |
| | `FechaFin` | `z.string().datetime()` | No (inicio + 24 h) en borrador |
| | `Estado` | `z.enum(['borrador', 'publicada'])` | No (default `'publicada'`) |
| | `GruposPreguntas` | estructura estricta de borrador/publicación | No (`[]`) en borrador; mínimo 1 publicada |
| `ActividadUpdateSchema` | `IdPublicacion` | `z.number().int()` | Sí |
| | `RevisionEsperada` | entero positivo | Sí |
| | `Titulo` | `z.string()` | Sí |
| | `Descripcion` | `z.string()` | No |
| | `Tipo` | `z.enum([...])` | Sí |
| | `CantidadIntentosMaximos` | `z.number().int()` | Sí |
| | `DuracionMinutos` | `z.number().int()` | Sí (nullable) |
| | `RecursosPermitidos` | `z.string()` | No |
| | `IdMateriaDivision` | `z.number().int()` | Sí |
| | `FechaInicio` | `z.string().datetime()` | Sí |
| | `FechaFin` | `z.string().datetime()` | Sí |
| | `GruposPreguntas` | estructura de borrador con Id opcional en cada nivel | No (default `[]`) |
| `PublicarActividadSchema` | `IdPublicacion`, `RevisionEsperada` | enteros positivos | Sí |
| | `GuardarTodoEnBanco` | `z.boolean()` | Sí |
| | `GruposPreguntas` | estructura publicable estricta | Sí, mínimo 1 |
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
| `IncidenteFocoSchema` | `Tipo` | `focus_lost`, `fullscreen_exit` | Sí |
| | `FechaInicioCliente` | timestamp ISO 8601 | Inicio sí; finalización posterior no |
| | `FechaFinCliente` | timestamp ISO 8601 | No; debe acompañar duración |
| | `DuracionMilisegundos` | entero seguro no negativo | No; debe acompañar fecha fin |
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
| `VarianteSchema` (anidado) | `Tipo` | `'mc'`, `'multiple'`, `'vf'`, `'abierta'`, `'code'` |
| | `ModoJustificacion` | `'sin_justificacion'`, `'opcional'`, `'obligatoria'` |
| | `EstrategiaCorreccion` | `'exacta'`, `'parcial_sin_penalizacion'`, `'parcial_penalizada'` |
| | `TratamientoJustificacion` | `'informativa'`, `'revision_manual'` |
| `DetalleActaSchema` | `CondicionFinal` | `'regular'`, `'promocionado'`, `'libre'` |
| `UsuarioSchema` / `UsuarioUpdateSchema` | `Rol` | `'admin'`, `'docente'`, `'alumno'` |

---

## 6. Manual de Testing

### 6.1 Ejecución

```bash
npm install         # Una sola vez
npm test            # Suite completa (432 tests de referencia actual)
npx jest --verbose  # Reporte detallado
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
├── alumnos.test.ts         ← CRUD, inscripción idempotente, camelCase + estadísticas
├── evaluaciones.test.ts    ← Evaluaciones + modificar-completo + preguntas + detalle + alumnos
├── intentos.test.ts        ← Intentos, respuestas, reintentos, corrección e historial
├── intentos-mios.test.ts   ← Historial propio, filtros, resumen, paginación y RBAC
├── intento-valido.test.ts  ← Selección automática/manual, auditoría, reversión y RBAC
├── academico.test.ts       ← Carreras, Materias, Docentes
├── actas.test.ts           ← Actas, Detalle, decimales
├── health.test.ts          ← Identidad de API, disponibilidad SQL y contrato degradado
├── rbac.test.ts            ← checkRole, JWT estricto/legacy, tipos y roles
├── reportes.test.ts        ← Rendimiento por alumno/evaluación + filtros + paginación global
├── reportes-calificacion.test.ts ← Escalas, umbrales, alcance válido y pendientes
└── telemetria-focus.test.ts ← Incidentes idempotentes, duración, resumen, alcance y RBAC
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

Ambos endpoints ejecutan el mismo SP (`SP_Docente_VerMaterias`), por lo que devuelven datos idénticos. Es un error por copy-paste. `getMateriasByDocente` debería llamar a un SP diferente (ej. `SP_Docente_ObtenerMaterias`) o ejecutar una query directa que retorne solo las materias del docente. La navegación de evaluaciones no depende de estos endpoints: `GET /api/docentes/:legajo/evaluaciones` ya devuelve los IDs y nombres de materia, comisión y carrera necesarios para agrupar en el frontend.

**Fix pendiente:** Corregir `getMateriasByDocente` para que consulte datos de materias (no comisiones).

## Banco privado de preguntas (backend v1)

Requiere aplicar manualmente `migrations/20260908_banco_preguntas.sql` antes de desplegar
este backend. Las verificaciones de solo lectura están en
`scripts/verificar-banco-preguntas.sql`. No se migra contenido académico existente.
El estado de implementación y los pendientes de frontend/SQL están en `PLAN.md`.

El banco pertenece a `Docente.Legajo`, obtenido de `idDocente` del JWT. El docente
debe estar activo. Los administradores solo consultan; alumnos no tienen acceso.
Los administradores deben indicar `?idDocente=<legajo>` también en detalles y etiquetas.
Los docentes no pueden elegir un propietario distinto. Un ID ajeno responde 404.

### Endpoints del banco

Base: `/api/banco-preguntas`. Escrituras en PascalCase; respuestas en camelCase.
Para preguntas/grupos, `PUT` reemplaza el contenido completo: enviar opciones,
etiquetas, composición y estado deseados; omisiones toman los defaults de creación.

| Método | Path | Roles | Resultado |
|---|---|---|---|
| GET | `/preguntas` | docente, admin | Listado paginado de metadatos, sin opciones |
| GET | `/preguntas/:id` | docente, admin | Detalle con opciones y claves de corrección |
| POST | `/preguntas` | docente | Crear pregunta, 201 |
| PUT | `/preguntas/:id` | docente | Reemplazar pregunta con `RevisionEsperada`, 200 |
| PATCH | `/preguntas/:id/estado` | docente | Cambiar estado con `RevisionEsperada` |
| GET | `/grupos` | docente, admin | Listado paginado |
| GET | `/grupos/:id` | docente, admin | Composición, posición y revisión actual de cada pregunta |
| POST | `/grupos` | docente | Crear grupo, 201 |
| POST | `/grupos/desde-contenido` | docente | Crear grupo y preguntas nuevas/propias en una transacción, 201 |
| PUT | `/grupos/:id` | docente | Reemplazar composición con `RevisionEsperada` |
| PATCH | `/grupos/:id/estado` | docente | Cambiar estado con `RevisionEsperada` |
| GET | `/etiquetas` | docente, admin | Etiquetas del propietario, ordenadas por nombre |
| POST | `/etiquetas` | docente | Crear etiqueta, 201 |
| PUT | `/etiquetas/:id` | docente | Renombrar etiqueta |
| DELETE | `/etiquetas/:id` | docente | Eliminar etiqueta y asociaciones, sin borrar contenido |
| POST | `/desde-evaluacion` | docente | Copiar selección autorizada como borradores, 201 |

Listados de preguntas/grupos: `texto`, `estado`, `etiqueta`, `pagina` (1 por defecto,
máximo 1.000.000), `tamano` (20 por defecto, máximo 100); `tipo` solo para preguntas.
Texto busca una subcadena literal, no un patrón SQL. Sin estado, devuelve borradores
y disponibles. Para ver archivados enviar `estado=archivado`.
Orden: actualización descendente e ID descendente. Respuesta:
`{ success: true, data: { items, total, pagina, tamano } }`; `total` no depende de la página.

Pregunta de ejemplo:

```json
{
  "Titulo": "Protocolos de transporte",
  "Enunciado": "¿Cuál de estos es un protocolo de transporte?",
  "Tipo": "mc",
  "Estado": "disponible",
  "ModoJustificacion": "sin_justificacion",
  "EstrategiaCorreccion": "exacta",
  "TratamientoJustificacion": "informativa",
  "Opciones": [
    { "Texto": "TCP", "EsCorrecta": true },
    { "Texto": "RAM", "EsCorrecta": false }
  ],
  "Etiquetas": []
}
```

Para un borrador basta `Titulo` y `Tipo`: enunciado vacío, opciones/etiquetas vacías
y estado borrador son los defaults. En `PUT` agregar `RevisionEsperada` con la
revisión leída. `Titulo`: 150 caracteres; enunciado: 100.000; opción: 500;
máximo 100 opciones y 200 etiquetas por recurso. Se rechazan campos desconocidos,
incluido un propietario enviado en el body.

Grupo de ejemplo (IDs ilustrativos, pertenecientes al docente):

```json
{
  "TituloReferencia": "Redes: variantes equivalentes",
  "Estado": "disponible",
  "Preguntas": [10, 11],
  "Etiquetas": [3]
}
```

El orden de `Preguntas` y `Opciones` determina su posición en el banco. Un grupo
contiene hasta 200 preguntas diferentes. Las etiquetas pueden asignarse a preguntas
y grupos; su nombre tiene hasta 50 caracteres. Se ignoran espacios exteriores y
mayúsculas al detectar nombres duplicados para un mismo propietario.
Body de etiqueta: `{ "Nombre": "Redes" }`.

### Disponibilidad y revisiones

`borrador` permite contenido incompleto. `disponible` requiere:

- Enunciado no vacío.
- `mc`: al menos dos opciones, textos no vacíos y exactamente una correcta.
- `multiple`: al menos dos opciones, textos no vacíos y al menos una correcta.
- `vf`: exactamente `Verdadero` y `Falso` (sin distinción de mayúsculas), una correcta.
- `abierta`: sin opciones.
- `code`: no habilitado para uso en v1; puede conservarse como borrador.
- Grupo no vacío y todas sus variantes disponibles.

`archivado` conserva el contenido e impide nuevas importaciones. Puede restaurarse
a borrador o disponible (con validación). Body de cambio de estado:
`{ "Estado": "archivado", "RevisionEsperada": 2 }`.

Editar una pregunta disponible la mantiene disponible si sigue siendo válida.
Retirarla de disponibilidad devuelve a borrador sus grupos disponibles en la misma
transacción. La respuesta de pregunta/estado incluye `gruposAfectados: [{ id, revision }]`.
Las revisiones de preguntas/grupos se incrementan al modificarlos; una revisión
desactualizada devuelve 409. Cambiar una variante no incrementa por sí mismo la
revisión del grupo: la importación verifica ambas. No hay historial de versiones.

### Incorporar contenido a una evaluación

`POST /api/evaluaciones/:id/importar-banco` (solo docente) agrega copias a un borrador
guardado, sin reemplazar el resto. Exige que no tenga intentos y que todas las
publicaciones pertenezcan a comisiones del docente.

```json
{
  "ImportacionesBanco": [
    { "Tipo": "pregunta", "IdPregunta": 10, "RevisionEsperada": 2,
      "TituloReferencia": "Una consigna de redes" },
    { "Tipo": "grupo", "IdGrupo": 20, "RevisionEsperada": 3,
      "Preguntas": [{ "IdPregunta": 11, "RevisionEsperada": 1 }] }
  ]
}
```

Un grupo requiere la lista completa de sus preguntas y revisiones actuales; la
composición o revisión cambiada devuelve 409. Máximo 100 selecciones. No puede
repetirse una pregunta dentro de la solicitud, ni a través de distintos grupos.
No se deduplica por texto. `Idempotency-Key` evita repetir la misma operación ante
reintentos; una clave nueva representa una solicitud explícita nueva.

El mismo campo opcional `ImportacionesBanco` se admite en
`POST /api/evaluaciones/guardar-completo` y `PUT /api/evaluaciones/:id/modificar-completo`.
Conservar el resto del payload actual, incluido `GruposPreguntas` (puede ser `[]`
al crear exclusivamente desde el banco). En la edición completa, `GruposPreguntas`
sigue siendo reemplazo: omitir grupos anteriores de esa lista los elimina.
Las importaciones se agregan después del contenido manual, en la misma transacción.

Una pregunta individual crea un grupo nuevo con una sola variante. Un grupo crea
todas sus variantes. Todos los IDs de destino son nuevos; no enviar IDs del banco
como IDs anidados de evaluación. La edición normal permite adaptar el contenido
copiado; no permite trasladar IDs existentes entre grupos.

El endpoint dedicado devuelve 201 con
`data: { importaciones: [...], revision: 3 }`. Cada importación conserva el mapping
`{ idGrupo, idBancoGrupo, preguntas: [{ idPregunta, idBancoPregunta,
revisionBancoOrigen, opciones: [{ idOpcion, idBancoOpcion }] }] }`.
Creación completa conserva `data.idActividad` y agrega `data.importaciones`;
edición completa conserva `message` y agrega `data.importaciones` cuando corresponde.
Sin importaciones se preservan las respuestas anteriores.

El contenido siempre se lee del banco en el servidor. La procedencia es informativa.
El detalle de evaluación devuelve `idBancoGrupoOrigen`/`idBancoPreguntaOrigen`,
`revisionBancoOrigen` y `fechaIncorporacionBanco` en los grupos/preguntas respectivos.
No hay sincronización con copias existentes. Cambiar o archivar el banco no altera
evaluaciones, intentos ni opciones ya copiadas. Una copia adaptada conserva su origen,
pero la revisión de origen no certifica que siga siendo idéntica.

### Copiar evaluaciones anteriores hacia el banco

`POST /api/banco-preguntas/desde-evaluacion`:

```json
{ "IdActividad": 5, "Preguntas": [100], "Grupos": [30] }
```

Se exige al menos una selección y pertenencia de todos los IDs a esa actividad.
No superponer preguntas sueltas con preguntas incluidas en los grupos seleccionados.
Solo el docente con alcance sobre todas las publicaciones puede copiar. La actividad
puede estar publicada o archivada: se lee, no se modifica. Se crean borradores propios,
sin etiquetas; el título inicial de cada pregunta toma el título del grupo original.
Respuesta: `data.preguntas` con `{ idPreguntaOrigen, idBancoPregunta }` y `data.grupos`
con `{ idGrupoOrigen, idBancoGrupo, preguntas }`. No se atribuye autoría histórica ni
se deduplica por texto. El administrador no puede realizar esta operación.

### Cambios de seguridad en evaluaciones

Crear exige comisión propia; modificar exige alcance sobre todas las publicaciones
y también sobre la comisión destino. Admin conserva gestión de evaluaciones, pero
no importa bancos ajenos. Se verifican IDs de publicación, grupos, preguntas y opciones
antes de modificar la estructura; un fallo revierte toda la operación.

Transiciones: borrador → publicada/archivada; publicada → archivada. No hay reapertura.
Repetir el mismo estado no modifica datos. Toda edición/importación estructural exige
borrador sin intentos. Los controles se ejecutan dentro de la transacción, con bloqueo
común de la actividad. No se agregaron triggers contra modificaciones SQL manuales.

Errores: 400 validación/contenido/estado; 401 autenticación; 403 rol o alcance de
evaluación; 404 recurso inexistente/ajeno en banco; 409 revisión o conflicto; 500
persistencia con mensaje genérico. El frontend debe recargar ante 409 y no reintentar
con una clave nueva tras una respuesta incierta: debe repetir la misma `Idempotency-Key`.

### Grupo compuesto desde el editor

`POST /api/banco-preguntas/grupos/desde-contenido` permite mezclar preguntas propias
existentes y nuevas sin guardar la evaluación. Requiere `Idempotency-Key` y crea todo
en una transacción. `Origen` es una unión discriminada estricta:

```json
{
  "TituloReferencia": "Redes: variantes equivalentes",
  "Etiquetas": [3],
  "Preguntas": [
    { "Origen": "existente", "IdPregunta": 10, "RevisionEsperada": 2 },
    {
      "Origen": "nueva",
      "ClaveCliente": "4e096ceb-51fd-49a1-8f80-c3760edaf021",
      "Pregunta": { "Titulo": "TCP", "Enunciado": "", "Tipo": "mc", "Opciones": [], "Etiquetas": [] }
    }
  ]
}
```

Las claves cliente y los IDs existentes no se repiten; hay entre 1 y 200 variantes.
Las nuevas preguntas y el grupo quedan en borrador y conservan el orden enviado.
Respuesta: `data.grupo { id, revision, estado }` y
`data.preguntas [{ claveCliente, id, revision }]` para las preguntas nuevas.

### Referencias opcionales del banco

Grupos y variantes manuales de creación, edición y publicación aceptan respectivamente
`ReferenciaBanco: { IdGrupo, RevisionEsperada }` y
`ReferenciaBanco: { IdPregunta, RevisionEsperada }`. Se valida propiedad y revisión;
los IDs del banco nunca se usan como IDs de evaluación. Una actualización conserva
la procedencia si omite la referencia, puede agregarla a un objeto que todavía no la
tenía y no puede sustituir un origen ya persistido por otro. No existe sincronización.

### Publicación completa

`POST /api/evaluaciones/:idActividad/publicar-completo` recibe el contenido completo
del borrador, `IdPublicacion`, `RevisionEsperada`, `GuardarTodoEnBanco` obligatorio e
`ImportacionesBanco` opcional. También requiere `Idempotency-Key`.

En una única transacción: bloquea y autoriza la actividad, comprueba revisión/ausencia
de intentos, guarda la última edición, resuelve importaciones, valida desde SQL la
estructura final, opcionalmente resuelve el banco, publica e incrementa la revisión.
La validación autoritativa exige ventana no vencida, al menos un grupo y una variante,
enunciados completos, `mc` con dos opciones y una correcta, `multiple` con dos opciones
y al menos una correcta, `vf` con Verdadero/Falso y una correcta, y `abierta`/`code`
sin opciones. El runtime de etapa 2 permite publicar justificaciones y estrategias
de selección múltiple. `code` puede publicarse en evaluación,
pero al copiarse al banco queda como borrador.

Con `GuardarTodoEnBanco=true`, una referencia se reutiliza solo si contenido, estado
y composición ordenada actuales coinciden. Si difiere, se crea una copia independiente;
no se actualiza la anterior ni se deduplica por texto. Preguntas válidas mc/vf/abierta
y sus grupos completos quedan disponibles; code y cualquier grupo que lo contenga,
en borrador. La respuesta contiene IDs, estado, nueva revisión, importaciones y mappings
en `data.banco`. Cualquier fallo produce rollback de evaluación, banco e idempotencia.
El cambio de estado legacy ya no permite publicar un borrador: debe usarse este endpoint.

### Idempotencia persistente y errores estables

Es obligatorio un UUID en `Idempotency-Key` para: creación/publicación completa,
importación del banco, creación de pregunta/grupo, grupo desde contenido y copia desde
evaluación. SQL Server identifica actor + operación + clave y conserva SHA-256 del body,
estado, resultado mínimo, status y fechas UTC. No almacena tokens, contraseñas,
enunciados, opciones ni claves correctas. Misma clave/body reproduce el resultado;
otro body responde 409 `IDEMPOTENCY_KEY_REUSED`. La reserva y el resultado forman parte
de la transacción de negocio, por lo que un rollback no registra éxito. La expiración
se fija a siete días; no hay job automático de purga y cualquier limpieza debe ser una
operación administrada separada.

| Código | HTTP | Significado |
|---|---:|---|
| `DRAFT_REVISION_CONFLICT` | 409 | El borrador cambió desde la lectura |
| `BANK_REVISION_CONFLICT` | 409 | Cambió una pregunta/grupo referenciado |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Misma clave con otro request |
| `DRAFT_NOT_PUBLISHABLE` | 400 | La estructura/configuración final es inválida |
| `BANK_CONTENT_INVALID` | 400 | Contenido o composición del banco inválidos |
| `EVALUATION_ALREADY_PUBLISHED` | 400 | La actividad ya no es editable |
| `EVALUATION_HAS_ATTEMPTS` | 409 | Existen intentos y la estructura es inmutable |

### Migración y despliegue

Después de `20260908_banco_preguntas.sql`, aplicar manualmente
`migrations/20260926_evaluacion_revision_idempotencia.sql`. Agrega y rellena
`Actividad.Revision`, y crea `OperacionIdempotente` con unicidad e índices. Ambas
migraciones son aditivas, transaccionales e idempotentes; el backend nunca las ejecuta
al arrancar. Repetirlas y ejecutar `scripts/verificar-banco-preguntas.sql` y
`scripts/verificar-evaluacion-idempotencia.sql` primero sobre SQL Server aislado.
Los tests Jest usan SQL mockeado y no sustituyen esas pruebas reales.

Validación local de esta entrega: `npm test -- --runInBand` y
`npx jest --runInBand --detectOpenHandles`, ambos con 21 suites/432 pruebas. El puerto
55803 quedó libre. `npm run build` continúa bloqueado por la configuración TypeScript
global preexistente (`rootDir` sin `include`, y después la incompatibilidad
NodeNext/CommonJS/verbatim y tipos de `mssql` ya documentada). No se ejecutó SQL Server
real ni se aplicaron migraciones: repetición de DDL, constraints, concurrencia,
deadlocks y rollback real siguen pendientes en una base aislada autorizada.
