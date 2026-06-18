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
| **ts-jest + supertest** | 147 tests de integración con mock completo de `mssql`. Sin dependencia de BD real. |

---

## 2. Configuración del Entorno

| Variable | Tipo | Default | Obligatoria | Propósito |
|---|---|---|---|---|
| `PORT` | `number` | `3000` | No | Puerto del servidor Express. |
| `DB_SERVER` | `string` | `localhost` | Sí | Host/IP de SQL Server. |
| `DB_PORT` | `number` | `1433` | No | Puerto TCP de SQL Server. |
| `DB_USER` | `string` | `sa` | Sí | Usuario de conexión. |
| `DB_PASSWORD` | `string` | — | Sí | Contraseña del usuario. |
| `DB_NAME` | `string` | — | Sí | Base de datos destino (`GestionExamio`). |
| `JWT_SECRET` | `string` | — | Sí | Clave HMAC para JWT. Si no se define, el servidor lanza `Error` al iniciar. |

**Ejemplo `.env`:**

```env
PORT=55803
DB_SERVER=localhost
DB_PORT=1433
DB_USER=Leandro
DB_PASSWORD=********
DB_NAME=GestionExamio
JWT_SECRET=c7a2e8f1d4b9a6c3f0e5d8b7a4c1f9e6d3b0a7c5f2e8d1b4a9c6f3e0d5b8a7
```

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

### 4.1 Auth

| Método | Endpoint | Zod | Roles |
|---|---|---|---|
| POST | `/api/auth/login` | `LoginSchema` | Público |

**Body `POST /api/auth/login`:**

```json
{
  "Email": "lfernandez@cervantes.edu.ar",
  "Password": "Cervantes2026"
}
```

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
npm test            # Suite completa (147 tests)
npx jest --verbose  # Reporte detallado (147 tests)
npx jest tests/auth.test.ts  # Archivo específico
npx jest -t "carreras"       # Por patrón de nombre
```

### 6.2 Estructura

```
tests/
├── mocks/
│   └── db.ts               ← Fábrica de mock de mssql
├── admin.test.ts           ← Dashboard analítico + KPIs + filtros + RBAC (5)
├── auth.test.ts            ← Login, bcrypt, JWT (4)
├── alumnos.test.ts         ← CRUD Alumnos + camelCase + estadísticas (13)
├── evaluaciones.test.ts    ← Evaluaciones + modificar-completo + preguntas + detalle + alumnos (21)
├── intentos.test.ts        ← Intentos + getIntentoCompleto + calificar + corregir + detallados + historial (28)
├── academico.test.ts       ← Carreras, Materias, Docentes (41)
├── actas.test.ts           ← Actas, Detalle, decimales (15)
└── rbac.test.ts            ← checkRole, JWT, roles (20)
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

---

## 8. Errores Conocidos y Deuda Técnica

### 8.1 Auth — Login sin validación Zod

**Archivo:** `src/routes/auth.routes.ts:6`

El endpoint `POST /api/auth/login` está documentado con `LoginSchema` pero la ruta no incluye el middleware `validateRequest(LoginSchema)`. Actualmente el controlador recibe `req.body` sin prevalidación.

**Impacto:** Endpoint público acepta payloads mal formados sin rechazarlos en la capa HTTP.

**Fix pendiente:**
```typescript
// src/routes/auth.routes.ts
import { validateRequest } from '../middlewares/auth.middleware';
import { LoginSchema } from '../schemas/academico.schema';

router.post('/login', validateRequest(LoginSchema), login);
```

---

### 8.2 Docentes — SP duplicado en comisiones y materias

**Archivo:** `src/controllers/docentes.controller.ts:81-134`

| Endpoint | Controlador | SP que llama |
|---|---|---|
| `GET /api/docentes/:legajo/comisiones` | `getComisionesByDocente` | `SP_Docente_VerMaterias` |
| `GET /api/docentes/:legajo/materias` | `getMateriasByDocente` | `SP_Docente_VerMaterias` |

Ambos endpoints ejecutan el mismo SP (`SP_Docente_VerMaterias`), por lo que devuelven datos idénticos. Es un error por copy-paste. `getMateriasByDocente` debería llamar a un SP diferente (ej. `SP_Docente_ObtenerMaterias`) o ejecutar una query directa que retorne solo las materias del docente.

**Fix pendiente:** Corregir `getMateriasByDocente` para que consulte datos de materias (no comisiones).
