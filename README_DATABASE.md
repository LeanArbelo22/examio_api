# Documentación de la Base de Datos — GestionExamio

---

## 1. Nomenclatura y Diseño

La base de datos `GestionExamio` sigue una convención **PascalCase** consistente en tablas, columnas y procedimientos almacenados.

| Elemento | Convención | Ejemplo |
|---|---|---|
| Tablas | PascalCase singular | `Alumno`, `MateriaDivision`, `Intento` |
| Columnas | PascalCase | `IdPublicacion`, `NombreCompleto`, `CantidadIntentosMaximos` |
| Procedimientos | Prefijo `SP_` + PascalCase | `SP_Alumno_ObtenerTodo`, `SP_Intento_IniciarExamen` |
| Restricciones | Según diseño DDL | `PK_Alumno`, `FK_DetalleActa_IdActa`, `CHK_Intento_Estado` |

La API Node transforma todas las claves a **camelCase** mediante `mapKeysToCamelCase()` antes de devolver la respuesta JSON. La base de datos opera internamente en PascalCase; la API expone camelCase. Esta transformación es recursiva sobre objetos y arreglos anidados.

### 1.1 Tipos de Datos Predominantes

| Tipo SQL | Uso |
|---|---|
| `INT` | Claves primarias (con `IDENTITY`), foráneas, semestres, contadores. |
| `NVARCHAR(n)` | Cadenas de longitud fija o variable (nombres, descripciones, correos). |
| `NVARCHAR(MAX)` | Enunciados de preguntas (`Pregunta.Enunciado`). |
| `DECIMAL(4,2)` | Notas y calificaciones (rango `0.00`–`10.00`, dos decimales fijos). |
| `DATETIME` | Fechas de inicio, fin, creación (`GETDATE()`). |
| `BIT` | Flags booleanos (`Activo`, `Visible`, `EsCorrecta`). |

---

## 2. Diccionario de Entidades

### 2.1 Tablas Base del Negocio (Bedelía)

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `Carrera` | `Id INT IDENTITY` | Catálogo de carreras. Campos: `Nombre` (unique), `Descripcion`, `DuracionSemestres`, `Estado BIT` (1=activo, 0=baja). |
| `Materia` | `Id INT IDENTITY` | Materias del plan de estudios. FK a `Carrera(Id)`. Campos: `Nombre`, `Semestre`, `IdCarrera`, `Estado BIT`. |
| `Division` | `Id INT IDENTITY` | Divisiones o comisiones de cursada. Campos: `Descripcion` (unique, ej. "1NMS", "2NMS"). |
| `Docente` | `Legajo INT` | Docentes. Campos: `Nombre`, `Apellido`, `Cuil` (unique), `Correo` (unique), `Estado BIT`. |
| `Alumno` | `Matricula INT` | Alumnos. Campos: `Nombre`, `Apellido`, `Cuil` (unique), `Correo` (unique), `Estado NVARCHAR(10)` con CHECK (`'activo'`, `'suspendido'`, `'inactivo'`). |

### 2.2 Tablas Intermedias (Asignaciones)

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `MateriaDivision` | `Id INT IDENTITY` | **Entidad asociativa central**. Vincula `Materia` + `Division` + `Docente` (opcional). Unique constraint `(IdMateria, IdDivision)`. Es la unidad organizativa fundamental para inscripciones, publicaciones y actas. |
| `InscripcionMateria` | `(IdMateriaDivision, IdAlumno)` | Inscripción de un alumno a una comisión. FK compuesta a `MateriaDivision(Id)` y `Alumno(Matricula)`. Habilita al alumno a ver evaluaciones pendientes de esa comisión. |

### 2.3 Tablas del Motor de Evaluaciones

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `Actividad` | `Id INT IDENTITY` | Cabecera de evaluación/tp/tarea. Campos: `Titulo`, `Descripcion`, `Tipo` (CHECK: `'evaluacion'`, `'tp'`, `'tarea'`), `PermiteMultiplesIntentos BIT` (columna legacy del DDL, no utilizada por la API Node actual, la cual delega la lógica en `CantidadIntentosMaximos INT`), `DuracionMinutos INT`, `Estado` (CHECK: `'borrador'`, `'publicada'`, `'archivada'`), `RecursosPermitidos`. |
| `Publicacion` | `Id INT IDENTITY` | Instancia publicada de una `Actividad` en una `MateriaDivision`. Define ventana de tiempo (`FechaInicio`, `FechaFin`) y visibilidad (`Visible BIT`). |
| `GrupoPregunta` | `Id INT IDENTITY` | Agrupación lógica de preguntas. FK a `Actividad(Id)`. Campos: `TituloReferencia` (ej. "SQL Básico"). |
| `Pregunta` | `Id INT IDENTITY` | Pregunta individual. FK a `GrupoPregunta(Id)`. Campos: `Enunciado NVARCHAR(MAX)`, `Tipo` (CHECK: `'mc'`, `'vf'`, `'abierta'`, `'code'`). |
| `Opcion` | `Id INT IDENTITY` | Opciones de respuesta para preguntas `mc`/`vf`. FK a `Pregunta(Id)`. Campos: `Texto NVARCHAR(500)`, `EsCorrecta BIT`. |

### 2.4 Tablas de Seguimiento de Exámenes

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `Intento` | `Id INT IDENTITY` | Intento de examen iniciado por un alumno. FK a `Publicacion(Id)` y `Alumno(Matricula)`. Campos: `NumeroIntento INT`, `FechaInicio`, `FechaFin`, `Estado` (CHECK: `'en_progreso'`, `'entregado'`, `'vencido'`, `'anulado'`), `NotaFinal DECIMAL(4,2)` (NULL si hay preguntas abiertas pendientes de corrección manual), `NotaAutomatica DECIMAL(4,2)` (nota parcial de los componentes mc/vf, siempre se calcula al finalizar). |
| **`IntentoPregunta`** | `Id INT IDENTITY` | **Congela las variantes del sorteo**. Por cada `GrupoPregunta` de la actividad, `SP_Intento_IniciarExamen` selecciona una `Pregunta` aleatoria (`ORDER BY NEWID()`) y la inserta aquí. `SP_Intento_ObtenerExamenDinamico` solo lee esta tabla. Sin esta tabla, el alumno recibiría preguntas distintas en cada renderizado. FK a `Intento(Id)` y `Pregunta(Id)`. |
| `Respuesta` | `Id INT IDENTITY` | Contenedor de respuesta del alumno por pregunta. FK a `Intento(Id)` y `Pregunta(Id)`. Unique constraint `(IdIntento, IdPregunta)`. Campos: `RtaTexto NVARCHAR(MAX)` (para preguntas abiertas), `EsCorrecta BIT` (nullable, para corrección manual), `ComentariosDocente NVARCHAR(MAX)` (nullable). |
| **`RespuestaOpcion`** | `(IdRespuesta, IdOpcion)` | **Junction** entre `Respuesta` y `Opcion`. Almacena qué opción(es) seleccionó el alumno. Permite el JOIN que usan `SP_Pregunta_ObtenerOpciones` y `SP_Intento_FinalizarExamen`. |
| **`HistorialRespuesta`** | `Id INT IDENTITY` | **Auditoría de cambios de opción**. Cada vez que el alumno cambia su respuesta, `SP_Respuesta_GuardarOpcion` inserta aquí la opción anterior y la nueva. Permite reconstruir la secuencia completa de decisiones. |

### 2.5 Tablas Antifraude y Telemetría

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `AlertaFraude` | `Id INT IDENTITY` | Incidentes de seguridad detectados durante un intento. FK a `Intento(Id)`. Campos: `TipoIncidentes NVARCHAR(50)` (plural — ej. `'fullscreen_exit'`, `'focus_lost'`), `Detalle NVARCHAR(250)`, `Timestamp DATETIME`. |
| `MetricasNavegacion` | `Id INT IDENTITY` | Métricas de navegación del alumno. FK a `Intento(Id)` y `Pregunta(Id)`. Campos: `FechaIngreso`, `FechaEgreso`, columna calculada `SegundosPermanencia AS DATEDIFF(SECOND, FechaIngreso, FechaEgreso)`. |

### 2.6 Tablas del Módulo de Actas

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `ActaMateria` | `Id INT IDENTITY` | Cabecera del acta de examen final. FK a `MateriaDivision(Id)`. Campos: `FechaCierre`, `Libro NVARCHAR(20)`, `Folio NVARCHAR(20)`, `Estado` (CHECK: `'abierta'`, `'firmada'`, `'cerrada'`). |
| `DetalleActa` | `(IdActa, IdAlumno)` | Líneas del acta. FK compuesta a `ActaMateria(Id)` y `Alumno(Matricula)`. Campos: `NotaCursada DECIMAL(4,2)`, `NotaFinalExamen DECIMAL(4,2)` (nullable), `CondicionFinal` (CHECK: `'regular'`, `'promocionado'`, `'libre'`). |

### 2.7 Tablas de Seguridad

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `Usuario` | `Id INT IDENTITY` | Cuentas de acceso al sistema. `Email` unique. `PasswordHash NVARCHAR(255)` (hash de bcrypt). `Rol` (CHECK: `'docente'`, `'alumno'`, `'admin'`). FK opcionales a `Docente(Legajo)` y `Alumno(Matricula)` con CHECK cruzado que asegura que un docente tenga `IdDocente` no nulo y `IdAlumno` nulo, y viceversa. `Activo BIT`. |
| `AuthSession` | `Id UNIQUEIDENTIFIER` | Familia de credenciales asociada a `Usuario`. Conserva creación, expiración absoluta, última actividad y revocación. No contiene tokens. |
| `AuthRefreshToken` | `Id UNIQUEIDENTIFIER` | Eslabón de rotación de una sesión. Conserva hash SHA-256, expiraciones, consumo, sucesor, clave de idempotencia y snapshot no sensible de claims. Nunca guarda el refresh o access token completo. |

---

## 3. Lógica Transaccional (Procedimientos Almacenados)

### 3.1 Inicio de Examen y Congelamiento de Variantes

**Procedimiento:** `SP_Intento_IniciarExamen`

Ejecutado por `POST /api/intentos/iniciar`. Transacción atómica que crea el intento, congela las variantes y devuelve el `IdIntento`.

**Parámetros:**
| Parámetro | Tipo | Descripción |
|---|---|---|
| `@IdPublicacion` | `INT` | ID de la publicación a rendir |
| `@IdAlumno` | `INT` | Matrícula del alumno |

**Retorno:** `(IdIntento INT, Status NVARCHAR(2))` — siempre `'OK'`.

**Código completo:**

```sql
ALTER PROCEDURE [dbo].[SP_Intento_IniciarExamen]
    @IdPublicacion INT, 
    @IdAlumno INT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @IdIntento INT;
        DECLARE @IdActividad INT;
        DECLARE @ProximoIntento INT = 1;

        SELECT @IdActividad = IdActividad FROM Publicacion WHERE Id = @IdPublicacion;

        -- 1. Si ya tiene uno en curso, devolvemos ese mismo (no duplica)
        SELECT @IdIntento = Id FROM Intento
        WHERE IdPublicacion = @IdPublicacion AND IdAlumno = @IdAlumno AND Estado = 'en_progreso';

        IF @IdIntento IS NULL
        BEGIN
            -- 2. Calcula el correlativo del intento
            SELECT @ProximoIntento = ISNULL(MAX(NumeroIntento), 0) + 1
            FROM Intento
            WHERE IdPublicacion = @IdPublicacion AND IdAlumno = @IdAlumno;

            -- 3. Crea el intento (FechaInicio en UTC)
            INSERT INTO Intento (IdPublicacion, IdAlumno, NumeroIntento, FechaInicio, Estado)
            VALUES (@IdPublicacion, @IdAlumno, @ProximoIntento, SYSUTCDATETIME(), 'en_progreso');

            SET @IdIntento = SCOPE_IDENTITY();

            -- 4. Sorteo: 1 pregunta aleatoria por GrupoPregunta vía CROSS APPLY
            INSERT INTO IntentoPregunta (IdIntento, IdPregunta)
            SELECT @IdIntento, P.Id
            FROM GrupoPregunta GP
            CROSS APPLY (
                SELECT TOP 1 Id FROM Pregunta WHERE IdGrupoPregunta = GP.Id ORDER BY NEWID()
            ) P
            WHERE GP.IdActividad = @IdActividad;
        END;

        COMMIT TRANSACTION;
        SELECT @IdIntento AS IdIntento, 'OK' AS Status;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
```

**Comportamiento detallado:**

1. Obtiene el `IdActividad` desde la `Publicacion` solicitada.
2. Verifica si el alumno ya tiene un intento `'en_progreso'` para esa publicación. Si existe, lo retorna (no duplica).
3. Si no existe, calcula el correlativo `NumeroIntento` y crea el registro en `Intento` con estado `'en_progreso'` y `FechaInicio = SYSUTCDATETIME()` (UTC puro).
4. **Sorteo por `CROSS APPLY`**: por cada `GrupoPregunta` de la actividad, selecciona UNA pregunta aleatoria (`TOP 1 ... ORDER BY NEWID()`) y la inserta en `IntentoPregunta`. Esto CONGELA las variantes para todo el ciclo de vida del intento.
5. Retorna `(IdIntento, Status)`.

**Nota de timezone:** `FechaInicio` se almacena en **UTC** mediante `SYSUTCDATETIME()`. Todas las comparaciones temporales del sistema deben usar la misma referencia (UTC). El Frontend convierte a la zona horaria del usuario al momento de mostrar.

El sorteo ocurre **exclusivamente aquí**. Cualquier renderizado posterior consulta las variantes ya fijadas en `IntentoPregunta`.

### 3.2 Renderizado de Examen (Solo Lectura)

**Procedimiento:** `SP_Intento_ObtenerExamenDinamico`

Ejecutado por `GET /api/evaluaciones/intento/:idIntento/renderizar`. Es una consulta de **solo lectura** sobre `IntentoPregunta`:

```sql
SELECT P.Id AS IdPregunta, P.Enunciado, P.Tipo, GP.TituloReferencia AS GrupoConceptualmente
FROM IntentoPregunta IP
INNER JOIN Pregunta P ON IP.IdPregunta = P.Id
INNER JOIN GrupoPregunta GP ON P.IdGrupoPregunta = GP.Id
WHERE IP.IdIntento = @IdIntento;
```

No hay sorteo, no hay `NEWID()`. Devuelve exactamente las preguntas que se fijaron al iniciar el intento.

### 3.3 Obtención de Opciones

**Procedimiento:** `SP_Pregunta_ObtenerOpciones`

Ejecutado por `GET /api/evaluaciones/pregunta/:idPregunta/opciones/:idIntento`. Retorna las opciones de una pregunta indicando cuál fue seleccionada previamente por el alumno (si existe un intento activo):

```sql
SELECT O.Id AS IdOpcion, O.Texto, O.EsCorrecta,
       CASE WHEN RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END AS FueSeleccionada
FROM Opcion O
LEFT JOIN Respuesta R ON R.IdPregunta = O.IdPregunta AND R.IdIntento = @IdIntento
LEFT JOIN RespuestaOpcion RO ON R.Id = RO.IdRespuesta AND RO.IdOpcion = O.Id
WHERE O.IdPregunta = @IdPregunta;
```

La columna `FueSeleccionada` es **calculada en la query**, no existe como columna física en ninguna tabla.

### 3.4 Guardado Atómico de Respuesta con Auditoría

**Procedimiento:** `SP_Respuesta_GuardarOpcion`

Ejecutado por `POST /api/intentos/guardar-respuesta`. Transacción atómica:

1. Busca si ya existe una `Respuesta` para ese `(IdIntento, IdPregunta)`.
2. Si no existe, crea la `Respuesta` y la `RespuestaOpcion`.
3. Si existe y la opción es diferente:
   - Inserta en `HistorialRespuesta` la opción anterior y la nueva.
   - Elimina la `RespuestaOpcion` anterior.
   - Inserta la nueva `RespuestaOpcion`.
4. Si es la misma opción, no hace nada (idempotencia).

### 3.5 Finalización de Examen y Cálculo de Nota

**Procedimiento:** `SP_Intento_FinalizarExamen`

Ejecutado por `POST /api/intentos/:id/finalizar`. Comportamiento detallado:

#### Bloque 1 — Idempotencia

Si el intento ya está en estado `'entregado'`, `'anulado'` o `'vencido'`, el SP **no lanza error**. Simplemente realiza `SELECT` del registro actual y retorna sin modificar nada. Esto elimina los 500 por doble llamado del Frontend.

#### Bloque 2 — Conteo separado por tipo

Se cuentan por separado:
- **`@TotalChoice`**: preguntas de tipo `mc`/`vf` (objetivas, auto-corregibles).
- **`@TotalAbierta`**: preguntas de tipo `abierta` (requieren corrección manual).

#### Bloque 3 — Cálculo de nota parcial

`@NotaParcial = ROUND((CorrectasChoice / TotalChoice) * 10.00, 2)`

Solo considera las preguntas objetivas. Si `@TotalChoice = 0` (examen 100% abierta), `@NotaParcial = NULL`.

#### Bloque 4 — Decisión según composición

| Composición del examen | `Estado` | `NotaFinal` | `NotaAutomatica` | Significado |
|---|---|---|---|---|
| 100% mc/vf (`@TotalAbierta = 0`) | `entregado` | `ISNULL(@NotaParcial, 0.00)` | `@NotaParcial` | Nota definitiva calculada. |
| Al menos 1 abierta (`@TotalAbierta > 0`) | `entregado` | `NULL` | `@NotaParcial` | Pendiente de corrección manual. El docente consulta `NotaAutomatica` como referencia. |

#### Bloque 5 — Retorno

El `SELECT` final devuelve `Id`, `IdAlumno`, `IdPublicacion`, `Estado`, `NotaFinal`, `NotaAutomatica`, `FechaInicio`, `FechaFin`.

---

**Columna `NotaAutomatica`:** Se agregó mediante migración para que el docente tenga visibilidad del rendimiento objetivo del alumno incluso en exámenes con desarrollo. Permite filtrar intentos pendientes con `WHERE NotaFinal IS NULL`.

### 3.6 Telemetría y Antifraude

**Procedimiento:** `SP_Telemetria_RegistrarNavegacion`

Ejecutado por `POST /api/telemetria/navegacion`. Recibe `IdIntento`, `IdPregunta` y `SegundosPermanencia`. Calcula `FechaIngreso` restando los segundos a `GETDATE()` y lo inserta en `MetricasNavegacion`.

**Procedimiento:** `SP_Antifraude_RegistrarAlerta`

Ejecutado por `POST /api/telemetria/alerta`. Inserta en `AlertaFraude` con `TipoIncidentes`, `Detalle` y `Timestamp`. **No modifica el estado del Intento.** Las alertas quedan registradas para auditoría del docente/administrador, sin bloqueo automático.

### 3.7 Inscripción de Alumno a Materia

**Procedimiento:** `SP_Alumno_InscribirMateria`

No expuesto actualmente como endpoint REST. Inserta en `InscripcionMateria` para vincular un alumno a una comisión.

### 3.8 Procedimientos CRUD por Módulo

Cada módulo de negocio expone SPs con el patrón `SP_<Entidad>_<Acción>`:

| Módulo | SPs |
|---|---|
| **Carreras** | `SP_Carrera_ObtenerTodo`, `SP_Carrera_ObtenerPorId`, `SP_Carrera_Crear`, `SP_Carrera_Actualizar`, `SP_Carrera_Eliminar` (baja lógica: `Estado = 0`), `SP_Carrera_VerPlanDeEstudio`, `SP_Carrera_ListarAlumnos` |
| **Materias** | `SP_Materia_ObtenerTodo`, `SP_Materia_ObtenerPorId`, `SP_Materia_Crear`, `SP_Materia_Actualizar`, `SP_Materia_Eliminar` (baja lógica), `SP_Materia_ListarAlumnos`, `SP_Materia_AsignarDivision`, `SP_Materia_ListarComisiones` |
| **Divisiones** | `SP_Division_ObtenerTodo`, `SP_Division_ObtenerPorId`, `SP_Division_Crear` |
| **Docentes** | `SP_Docente_ObtenerTodo`, `SP_Docente_ObtenerPorId`, `SP_Docente_Crear`, `SP_Docente_Actualizar`, `SP_Docente_Eliminar` (baja lógica), `SP_Docente_ObtenerPorEstado`, `SP_Docente_AsignarComision`, `SP_Docente_VerMaterias` |
| **Alumnos** | `SP_Alumno_ObtenerTodo`, `SP_Alumno_ObtenerPorId`, `SP_Alumno_Crear`, `SP_Alumno_Actualizar`, `SP_Alumno_Eliminar` (baja lógica: `Estado = 'inactivo'`), `SP_Alumno_ObtenerPorEstado`, `SP_Alumno_VerMaterias`, `SP_Alumno_InscribirMateria` |
| **Actividades** | `SP_Actividad_Crear` (versión con `CantidadIntentosMaximos INT`) |
| **Comisiones** | `SP_MateriaDivision_ListarComisiones`, `SP_MateriaDivision_ListarAlumnos` |

Todos los SPs de lectura retornan `recordset` con claves en PascalCase. Los SPs de escritura no utilizan `OUTPUT` parameters ni `RETURN` values; los IDs generados se obtienen con `SELECT SCOPE_IDENTITY() AS Id...`.

### 3.9 Sesiones y rotación de refresh tokens

**Migración:** `migrations/20260723_auth_sessions.sql`.

La autenticación persistente usa SQL parametrizado y `sql.Transaction` desde
`auth.service.ts`; no agrega stored procedures. La migración es idempotente y
crea tablas, claves foráneas, checks e índices dentro de una transacción con
`XACT_ABORT ON`.

#### `AuthSession`

| Columna | Tipo | Regla |
|---|---|---|
| `Id` | `UNIQUEIDENTIFIER` | PK y familia de tokens; UUID criptográficamente aleatorio. |
| `IdUsuario` | `INT` | FK a `Usuario(Id)`. |
| `FechaCreacion` | `DATETIME2(3)` | UTC de creación. |
| `FechaExpiracion` | `DATETIME2(3)` | Máximo absoluto; inicialmente creación + 12 horas. |
| `UltimaActividad` | `DATETIME2(3)` | Última rotación exitosa; no extiende expiración. |
| `FechaRevocacion` | `DATETIME2(3)` | NULL mientras la familia permanece activa. |
| `MotivoRevocacion` | `NVARCHAR(50)` | `logout`, `refresh_reuse`, `user_inactive` o `institutional_link_invalid`. |

Índice `IX_AuthSession_Usuario_Estado` sobre usuario, revocación y expiración.

#### `AuthRefreshToken`

| Columna | Tipo | Regla |
|---|---|---|
| `Id` | `UNIQUEIDENTIFIER` | PK e identificador público aleatorio del token. |
| `IdSesion` | `UNIQUEIDENTIFIER` | FK a `AuthSession`; todos los eslabones comparten familia. |
| `TokenHash` | `BINARY(32)` | SHA-256 único del valor opaco completo. |
| `FechaEmision` | `DATETIME2(3)` | UTC de emisión. |
| `FechaExpiracion` | `DATETIME2(3)` | Igual al máximo absoluto de `AuthSession`. |
| `AccessTokenExpiraEn` | `DATETIME2(3)` | Permite reconstruir exactamente una respuesta idempotente. |
| `FechaConsumo` | `DATETIME2(3)` | Primera rotación exitosa; NULL si continúa vigente. |
| `ReemplazadoPor` | `UNIQUEIDENTIFIER` | FK autorreferencial al sucesor. |
| `IdempotencyKey` | `UNIQUEIDENTIFIER` | Clave de la operación que consumió el token. |
| `ClaimsJson` | `NVARCHAR(1000)` | Snapshot de identidad/rol no sensible usado para reproducir el mismo access token; no contiene tokens, hashes ni contraseña. |

`UQ_AuthRefreshToken_TokenHash` impide hashes duplicados.
`UX_AuthRefreshToken_Sesion_IdempotencyKey` impide reutilizar una clave dentro de
la misma sesión. `CHK_AuthRefreshToken_Rotacion` exige que consumo, sucesor y
clave sean todos NULL o todos no NULL.

#### Construcción y validación

El formato opaco es `ert1.<uuid-v4>.<prueba-hmac-base64url>`. El UUID aporta
122 bits aleatorios y la prueba usa HMAC-SHA-256 con
`AUTH_REFRESH_TOKEN_SECRET`, que debe diferir de `JWT_SECRET`. La validación usa
comparación de tiempo constante y contrasta además el hash almacenado.

La reconstrucción determinística se limita al sucesor ya persistido para repetir
una rotación con idéntica `Idempotency-Key`; no se almacena ningún secreto
reutilizable. Conocer la base sin el secreto HMAC no permite construir tokens.

#### Transacciones y concurrencia

Login inserta sesión y primer token en una transacción serializable. Refresh toma
`UPDLOCK, HOLDLOCK` sobre token y sesión:

1. Si está vigente, inserta sucesor, consume el anterior y actualiza actividad.
2. Mismo token + misma clave reconstruye exactamente el sucesor.
3. Otra clave dentro de la gracia devuelve conflicto sin modificar la familia.
4. Reutilización posterior marca `AuthSession` revocada antes de responder.

Logout toma los mismos bloqueos y marca la familia revocada de forma idempotente.
Los bloqueos de SQL Server hacen que la política funcione entre procesos e
instancias diferentes.

No se definió purga automática. La retención y eliminación de sesiones expiradas
o revocadas debe acordarse antes de agregar un job; conservar temporalmente la
cadena es necesario para detectar reutilización y auditar motivos sin secretos.

---

## 4. Ciclo de Vida de Estados

### 4.1 Estados de Actividad (`CHK_Actividad_Estado`)

```
┌──────────┐    publicar    ┌───────────┐    archivar    ┌───────────┐
│ borrador │ ──────────────▶│ publicada │ ──────────────▶│ archivada │
└──────────┘                └───────────┘                └───────────┘
```

- **`borrador`**: estado inicial al crear la actividad manualmente. Solo visible para el creador.
- **`publicada`**: el SP `SP_Actividad_Crear` inserta directamente con este estado. Los alumnos inscriptos pueden ver y rendir dentro de la ventana de `Publicacion.FechaInicio`–`FechaFin`.
- **`archivada`**: la actividad ya no está disponible. No se pueden iniciar nuevos intentos. Las respuestas existentes se conservan.

### 4.2 Estados de Intento (`CHK_Intento_Estado`)

```
                    ┌────────────┐
                    │ en_progreso │
                    └─────┬──────┘
                     ┌────┴────┐
                     │         │
                     ▼         ▼
               ┌──────────┐  ┌────────┐
               │ entregado │  │ anulado │
               └──────────┘  └────────┘
                     ▲
                     │
               ┌──────────┐
               │ vencido   │
               └──────────┘
```

| Estado | Descripción |
|---|---|
| `en_progreso` | El alumno inició el examen y puede guardar respuestas. |
| `entregado` | El alumno finalizó explícitamente (`POST /api/intentos/:id/finalizar`). Se calcula `NotaFinal`. |
| `vencido` | El tiempo máximo (`DuracionMinutos`) se agotó. (No implementado en los SPs actuales; reservado para uso futuro.) |
| `anulado` | Estado reservado para anulación manual por administrador/docente. Ya no se asigna automáticamente desde `SP_Antifraude_RegistrarAlerta`. |

### 4.3 Estados de Acta (`CHK_Acta_Estado`)

```
┌─────────┐   cargar detalles   ┌─────────┐   firmar   ┌─────────┐   cerrar   ┌─────────┐
│ abierta │ ───────────────────▶│ abierta │ ──────────▶│ firmada │ ──────────▶│ cerrada │
└─────────┘  (múltiples veces)  └─────────┘            └─────────┘            └─────────┘
```

- **`abierta`**: se creó el acta (`POST /api/actas/crear-cierre`). Se pueden cargar detalles (`POST /api/actas/cargar-detalle`).
- **`firmada`**: estado intermedio (no implementado en los controladores actuales; reservado para firma digital).
- **`cerrada`**: se ejecutó `PUT /api/actas/:id/cerrar`. No se admiten más modificaciones.

### 4.4 Condición Final del Alumno (`CHK_DetalleActa_Condicion`)

| Valor | Significado |
|---|---|
| `regular` | Aprobó la cursada (nota ≥ 4 en `NotaCursada`), debe rendir examen final. |
| `promocionado` | Aprobó sin necesidad de examen final (nota ≥ 7 en `NotaCursada`). |
| `libre` | No aprobó la cursada; debe recursar o rendir como libre. |

### 4.5 Tipos de Pregunta (`CHK_Pregunta_Tipo`)

| Valor | Significado |
|---|---|
| `mc` | Opción múltiple. Se selecciona una opción de una lista (`RespuestaOpcion`). |
| `vf` | Verdadero/Falso. Dos opciones predefinidas. |
| `abierta` | Desarrollo libre. El texto se almacena en `Respuesta.RtaTexto`. |
| `code` | Ejercicio de código. (Reservado para uso futuro.) |

### 4.6 Estados de Alumno (CHECK en columna `Estado`)

| Valor | Significado |
|---|---|
| `activo` | Habilitado para cursar y rendir exámenes. |
| `suspendido` | Suspendido temporalmente. |
| `inactivo` | Baja lógica (equivalente a eliminado). |

---

## 5. Integridad y Relaciones

### 5.1 Dependencias Funcionales

```
Carrera 1 ── N Materia
Materia N ── N Division  (a través de MateriaDivision)
MateriaDivision 1 ── 1 Docente (opcional)
MateriaDivision 1 ── N InscripcionMateria
                     InscripcionMateria N ── 1 Alumno

Actividad 1 ── N Publicacion
               Publicacion 1 ── N Intento
                                 Intento 1 ── N IntentoPregunta
                                              IntentoPregunta 1 ── 1 Pregunta
                                 Intento 1 ── N Respuesta
                                              Respuesta 1 ── N RespuestaOpcion
                                                              RespuestaOpcion N ── 1 Opcion
                                 Intento 1 ── N AlertaFraude
                                 Intento 1 ── N MetricasNavegacion
               Publicacion N ── 1 Actividad
Actividad 1 ── N GrupoPregunta
               GrupoPregunta 1 ── N Pregunta
                                   Pregunta 1 ── N Opcion

ActaMateria 1 ── N DetalleActa
                  DetalleActa N ── 1 Alumno

Usuario → Docente (opcional, vía IdDocente)
Usuario → Alumno (opcional, vía IdAlumno)
Usuario 1 ── N AuthSession
AuthSession 1 ── N AuthRefreshToken
AuthRefreshToken 0..1 ── 1 AuthRefreshToken (sucesor)
```

### 5.2 Restricciones de Integridad

- `MateriaDivision` tiene `UNIQUE(IdMateria, IdDivision)` — no puede haber dos comisiones iguales.
- `Respuesta` tiene `UNIQUE(IdIntento, IdPregunta)` — una sola respuesta por pregunta por intento.
- `DetalleActa` tiene PK `(IdActa, IdAlumno)` — un solo detalle por alumno por acta.
- `Usuario` tiene CHECK cruzado: si `Rol = 'docente'` entonces `IdDocente IS NOT NULL AND IdAlumno IS NULL`; si `Rol = 'alumno'` entonces `IdAlumno IS NOT NULL AND IdDocente IS NULL`; si `Rol = 'admin'` entonces ambos son NULL.
- `AuthSession.FechaExpiracion > FechaCreacion`; revocación, si existe, no puede anteceder a la creación.
- `AuthRefreshToken.TokenHash` es único y tiene longitud fija de 32 bytes.
- Un refresh consumido debe tener simultáneamente `FechaConsumo`, `ReemplazadoPor` e `IdempotencyKey`.
- `AccessTokenExpiraEn` debe ser posterior a la emisión y no superar la expiración absoluta del refresh.
- Las tablas `Carrera`, `Materia`, `Docente` usan `Estado BIT` para baja lógica. `Alumno` usa `Estado NVARCHAR` con tres valores. `Usuario` usa `Activo BIT`.
- Las notas `NotaCursada` y `NotaFinalExamen` en `DetalleActa` están acotadas al rango `[0.00, 10.00]` por el tipo `DECIMAL(4,2)`. Zod valida además `multipleOf(0.01)` para garantizar exactamente dos decimales.

---

## 6. Notas Técnicas Adicionales

- Todos los SPs retornan `recordset`. La API consume `result.recordset` directamente. No se utilizan `OUTPUT` parameters ni `RETURN` values para datos de negocio.
- Las transacciones se manejan desde la capa de aplicación con `sql.Transaction` (`commit()`/`rollback()` explícitos). Los SPs también usan `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK` internamente (ej. `SP_Intento_IniciarExamen`, `SP_Respuesta_GuardarOpcion`).
- La columna `IdentificadorInstitucional` en la respuesta de login es calculada en la query de `auth.service.ts`: si el rol es `'docente'` devuelve `IdDocente`, si es `'alumno'` devuelve `IdAlumno`.
- Todas las fechas se almacenan como `DATETIME`. La API las recibe como strings ISO 8601 (`z.string().datetime()`) y las convierte con `new Date(FechaInicio)` antes de pasarlas al SP.
