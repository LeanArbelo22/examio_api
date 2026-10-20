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
| `DECIMAL(5,2)` | Notas de intentos y puntajes configurables (hasta `100.00`). Las notas de actas conservan `DECIMAL(4,2)`. |
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

`GET /api/docentes/:legajo/evaluaciones` recorre la relación real
`Publicacion -> Actividad` y
`Publicacion -> MateriaDivision -> Materia -> Carrera`, además de
`MateriaDivision -> Division`. Por eso puede devolver de forma estable
`idActividad`, `idMateria`, `idMateriaDivision`, materia, división y carrera sin
inferir pertenencia a partir de nombres. La consulta no agrupa: cada fila representa
una publicación.

### 2.3 Tablas del Motor de Evaluaciones

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `Actividad` | `Id INT IDENTITY` | Cabecera de evaluación/tp/tarea. Además de estado y revisión, conserva `EscalaCalificacion`, `NotaAprobacion`, `ModoPuntaje`, `MostrarPuntajePorPregunta` y `CorreccionAutomaticaCerradas`. |
| `Publicacion` | `Id INT IDENTITY` | Instancia publicada de una `Actividad` en una `MateriaDivision`. Define ventana de tiempo (`FechaInicio`, `FechaFin`) y visibilidad (`Visible BIT`). |
| `GrupoPregunta` | `Id INT IDENTITY` | Agrupación lógica de preguntas. FK a `Actividad(Id)`. `PuntajeMaximo DECIMAL(5,2)` pertenece al grupo porque cada intento sortea una variante del grupo. |
| `Pregunta` | `Id INT IDENTITY` | Pregunta individual. FK a `GrupoPregunta(Id)`. `Tipo`: `mc`, `multiple`, `vf`, `abierta` o `code`. Conserva modo de justificación, estrategia, tratamiento y hash de contenido. |
| `Opcion` | `Id INT IDENTITY` | Opciones de respuesta para preguntas `mc`/`vf`. FK a `Pregunta(Id)`. Campos: `Texto NVARCHAR(500)`, `EsCorrecta BIT`. |

### 2.4 Tablas de Seguimiento de Exámenes

| Tabla | Clave Primaria | Rol |
|---|---|---|
| `Intento` | `Id INT IDENTITY` | Intento de examen. `NotaFinal`, `NotaAutomatica`, `NotaFinalCalculada` y `NotaFinalManual` usan `DECIMAL(5,2)` para escalas 10/100. `NotaFinal` es el valor efectivo. |
| **`IntentoPregunta`** | `Id INT IDENTITY` | Congela variante y `PuntajeMaximoSnapshot`. La migración de respuestas múltiples prepara snapshots de tipo, justificación, estrategia, tratamiento, hash y puntaje automático provisional. |
| `IntentoPreguntaOpcionSnapshot` | `Id BIGINT IDENTITY` | Copia inmutable de texto, corrección y posición de cada opción presentada. `IntentoPregunta` congela además enunciado, grupo, tipo y configuración. Los snapshots históricos reconstruidos se identifican mediante `SnapshotReconstruido`. |
| `Respuesta` | `Id INT IDENTITY` | Contenedor único por intento/pregunta. Además del texto y compatibilidad legacy, prepara `Justificacion` y `Revision` optimista para el guardado atómico de la etapa 2. |
| **`RespuestaOpcion`** | `(IdRespuesta, IdOpcion)` | **Junction** entre `Respuesta` y `Opcion`. Almacena qué opción(es) seleccionó el alumno. Permite el JOIN que usan `SP_Pregunta_ObtenerOpciones` y `SP_Intento_FinalizarExamen`. |
| **`HistorialRespuesta`** | `Id INT IDENTITY` | **Auditoría de cambios de opción**. Cada vez que el alumno cambia su respuesta, `SP_Respuesta_GuardarOpcion` inserta aquí la opción anterior y la nueva. Permite reconstruir la secuencia completa de decisiones. |
| `HistorialRespuestaCambio` | `Id BIGINT IDENTITY` | Auditoría preparada para conjuntos de opciones, texto y justificación. Usa UUID por evento y revisiones consecutivas; no almacena claves correctas. |

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
| `OperacionIdempotente` | `Id BIGINT IDENTITY` | Idempotencia general por actor, operación y UUID. Guarda hash determinista, estado, resultado mínimo, status HTTP y fechas UTC; no persiste payload académico ni credenciales. |

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

**Código de referencia anterior a la migración de calificación:**

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
4. **Sorteo por `CROSS APPLY`**: por cada `GrupoPregunta` de la actividad, selecciona UNA pregunta aleatoria (`TOP 1 ... ORDER BY NEWID()`) y la inserta en `IntentoPregunta`.
5. Con la migración `20261011_calificacion_intentos_telemetria.sql`, guarda también
   `PuntajeMaximoSnapshot`; usa el puntaje materializado del grupo y conserva un
   reparto igual determinístico como fallback para contenido histórico.
6. Retorna `(IdIntento, Status)`.

**Nota de timezone:** `FechaInicio` se almacena en **UTC** mediante `SYSUTCDATETIME()`. Todas las comparaciones temporales del sistema deben usar la misma referencia (UTC). El Frontend convierte a la zona horaria del usuario al momento de mostrar.

El sorteo ocurre **exclusivamente aquí**. Cualquier renderizado posterior consulta las variantes ya fijadas en `IntentoPregunta`.

### 3.2 Renderizado de Examen (Solo Lectura)

**Procedimiento:** `SP_Intento_ObtenerExamenDinamico`

Ejecutado por `GET /api/evaluaciones/intento/:idIntento/renderizar`. Es una consulta de **solo lectura** sobre `IntentoPregunta`:

```sql
SELECT IP.Id AS IdIntentoPregunta, P.Id AS IdPregunta,
       P.Enunciado, P.Tipo, GP.TituloReferencia AS GrupoConceptualmente
FROM IntentoPregunta IP
INNER JOIN Pregunta P ON IP.IdPregunta = P.Id
INNER JOIN GrupoPregunta GP ON P.IdGrupoPregunta = GP.Id
WHERE IP.IdIntento = @IdIntento;
```

`IdIntentoPregunta` identifica la instancia congelada y sorteada dentro del intento;
`IdPregunta` conserva la referencia a la pregunta de origen. El frontend no debe inferir
uno desde el otro. La telemetría `question_active` utiliza el primero.

No hay sorteo ni `NEWID()`. Con la etapa 2, el procedimiento usa primero los campos
snapshot de `IntentoPregunta`, devuelve configuración y borrador guardado, además del
máximo congelado y el flag de visibilidad. El controlador elimina el máximo cuando el
flag está apagado.

### 3.3 Obtención de Opciones

**Procedimiento:** `SP_Pregunta_ObtenerOpciones`

Ejecutado por `GET /api/evaluaciones/pregunta/:idPregunta/opciones/:idIntento`. Desde la
etapa 2 consulta `IntentoPreguntaOpcionSnapshot`, conserva el ID original como contrato
y calcula `FueSeleccionada` contra `RespuestaOpcion`. La API elimina `EsCorrecta` para
alumnos; docentes y administradores autorizados pueden recibirla.

```sql
SELECT S.IdOpcionOrigen AS IdOpcion, S.TextoSnapshot AS Texto, S.EsCorrectaSnapshot AS EsCorrecta,
       CASE WHEN RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END AS FueSeleccionada
FROM IntentoPregunta IP
JOIN IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta = IP.Id
LEFT JOIN Respuesta R ON R.IdPregunta = IP.IdPregunta AND R.IdIntento = IP.IdIntento
LEFT JOIN RespuestaOpcion RO ON R.Id = RO.IdRespuesta AND RO.IdOpcion = S.IdOpcionOrigen
WHERE IP.IdPregunta = @IdPregunta AND IP.IdIntento = @IdIntento;
```

La columna `FueSeleccionada` es **calculada en la query**, no existe como columna física en ninguna tabla.

### 3.4 Guardado Atómico de Respuesta con Auditoría

Desde la etapa 2, `POST /api/intentos/guardar-respuesta` usa una transacción serializable
en `intento-respuesta.service.ts`; `SP_Respuesta_GuardarOpcion` queda sólo como legado y
no participa del contrato nuevo. La operación bloquea intento/pregunta, valida titularidad,
estado y revisión, reemplaza atómicamente el conjunto de `RespuestaOpcion`, incrementa
`Respuesta.Revision` y audita en `HistorialRespuestaCambio`. La unicidad
`UX_Respuesta_Intento_Pregunta` protege también la creación concurrente.

Un `EventoId` ya persistido se compara contra el contenido canónico anterior/nuevo. Un
replay idéntico devuelve la revisión original incluso después de la entrega; un UUID
reutilizado con otro contenido o una revisión obsoleta produce conflicto explícito.

### 3.5 Finalización de Examen y Cálculo de Nota

**Procedimiento:** `SP_Intento_FinalizarExamen`

Ejecutado por `POST /api/intentos/:id/finalizar`. Comportamiento detallado:

#### Bloque 1 — Idempotencia

Si el intento ya está en estado `'entregado'`, `'anulado'` o `'vencido'`, el SP **no lanza error**. Simplemente realiza `SELECT` del registro actual y retorna sin modificar nada. Esto elimina los 500 por doble llamado del Frontend.

> Desde `20261011_calificacion_intentos_telemetria.sql`, el procedimiento deja de
> calcular una proporción binaria global. La descripción siguiente se conserva
> únicamente como referencia del comportamiento anterior a esa migración.
> `20261014_runtime_respuestas_multiples.sql` vuelve a actualizarlo para usar snapshots,
> validar justificaciones obligatorias y aplicar las tres estrategias de corrección.

#### Bloque 2 — Conteo separado por tipo (legacy)

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

**Semántica vigente de `NotaAutomatica`:** suma de componentes cerrados corregidos
automáticamente. Es `NULL` cuando no hubo componentes automáticos y nunca representa
una nota final ficticia. `NotaFinalCalculada` sólo se completa cuando todas las
preguntas sorteadas tienen puntaje; `NotaFinal` queda como nota efectiva.

### 3.6 Telemetría y Antifraude

**Procedimiento:** `SP_Telemetria_RegistrarNavegacion`

Ejecutado por `POST /api/telemetria/navegacion`. Recibe `IdIntento`, `IdPregunta` y `SegundosPermanencia`. Calcula `FechaIngreso` restando los segundos a `GETDATE()` y lo inserta en `MetricasNavegacion`.

**Procedimiento:** `SP_Antifraude_RegistrarAlerta`

Ejecutado por `POST /api/telemetria/alerta`. Inserta en `AlertaFraude` con `TipoIncidentes`, `Detalle` y `Timestamp`. **No modifica el estado del Intento.** Las alertas quedan registradas para auditoría del docente/administrador, sin bloqueo automático.

### 3.7 Inscripción de Alumno a Materia

**Procedimiento:** `SP_Alumno_InscribirMateria`

`POST /api/alumnos/:matricula/inscripciones` lo ejecuta para insertar en
`InscripcionMateria` y vincular un alumno a una comisión. El procedimiento
existente realiza únicamente el `INSERT`; la API lo envuelve en una transacción
`SERIALIZABLE` que:

1. valida que `Alumno` exista y tenga `Estado = 'activo'`;
2. valida `MateriaDivision` mediante sus relaciones con `Materia` y `Division`,
   y exige que la materia tenga `Estado = 1`;
3. consulta la PK lógica con `UPDLOCK, HOLDLOCK`;
4. devuelve el recurso existente sin insertar cuando ya está inscripto;
5. ejecuta el SP y confirma la transacción cuando la relación es nueva.

La PK compuesta `(IdMateriaDivision, IdAlumno)` permanece como garantía física
final. Esta combinación evita duplicados incluso con solicitudes concurrentes y
múltiples instancias de la API conectadas a SQL Server. No se agregó ni modificó
esquema, índice, constraint, migración o procedimiento.

La inscripción habilita las lecturas ya relacionadas con
`InscripcionMateria`: materias del alumno, alumnos de la comisión y evaluaciones
pendientes publicadas para esa comisión. No modifica filas de `Publicacion`,
`Intento`, `Respuesta`, `ActaMateria` ni sus detalles.

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
| `mc` | Selección única. Se selecciona exactamente una opción. |
| `multiple` | Selección múltiple real. Puede tener varias opciones correctas y varias seleccionadas. |
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
- Las fechas legacy usan `DATETIME`; auth y banco incorporan `DATETIME2`. La API recibe fechas como strings ISO 8601 (`z.string().datetime()`).

## 7. Banco privado de preguntas

DDL versionado en `migrations/20260908_banco_preguntas.sql`. Es aditivo, transaccional
y requiere ejecución manual; el backend no lo aplica al arrancar. Script de lectura
posterior: `scripts/verificar-banco-preguntas.sql`. No transforma contenido anterior.

| Tabla | Relación y restricciones |
|---|---|
| `BancoPregunta` | Identity; FK `IdDocente → Docente.Legajo`. Título, enunciado, tipo, estado, revisión positiva y auditoría UTC. |
| `BancoOpcion` | Identity; FK `IdPregunta → BancoPregunta.Id`. Texto, EsCorrecta y posición positiva única por pregunta. |
| `BancoGrupo` | Identity; FK a docente. Título de referencia, estado, revisión y auditoría. |
| `BancoGrupoPregunta` | PK `(IdGrupo,IdPregunta)`; posición única por grupo. FKs compuestas con `IdDocente` impiden mezclar propietarios. |
| `BancoEtiqueta` | Identity; FK a docente. Nombre normalizado calculado/persistido, único por docente, sin distinguir mayúsculas ni espacios exteriores. |
| `BancoPreguntaEtiqueta` | PK `(IdPregunta,IdEtiqueta)`; FKs compuestas con propietario. |
| `BancoGrupoEtiqueta` | PK `(IdGrupo,IdEtiqueta)`; FKs compuestas con propietario. |

Estados con CHECK: `borrador`, `disponible`, `archivado`; tipos de pregunta con CHECK:
`mc`, `vf`, `abierta`, `code`. La disponibilidad de `code` está bloqueada en la API v1.
Las reglas de corrección y disponibilidad de grupos se validan en el service, no
mediante triggers. `Revision` es un contador de concurrencia, no una versión histórica.
Auditoría nueva: `FechaCreacion` y `FechaActualizacion`, `DATETIME2(3)` con UTC.
Las transacciones de banco utilizan SERIALIZABLE y coordinan escrituras/copias por
fila docente; las de evaluación coordinan primero por actividad. Contención/deadlocks
deben comprobarse con SQL Server real antes del despliegue.

Índices por propietario/estado/fecha, propietario/tipo, búsqueda inversa de preguntas
en grupos y etiquetas asociadas. La normalización utiliza `Latin1_General_100_CI_AS`:
conserva distinción de acentos. No hay FK obligatoria a materia o carrera.

Procedencia opcional en tablas del motor:

- `GrupoPregunta.IdBancoGrupoOrigen → BancoGrupo.Id`.
- `Pregunta.IdBancoPreguntaOrigen → BancoPregunta.Id`.
- Ambas incluyen `RevisionBancoOrigen` y `FechaIncorporacionBanco` opcionales.
- CHECK exige los tres campos nulos o los tres completos con revisión positiva.

Una pregunta individual importada crea un grupo sin origen de grupo y una pregunta
con origen de pregunta. Los registros anteriores mantienen procedencia nula. La
procedencia no se expone como dato editable ni sincroniza el contenido. Las FKs no
tienen cascada desde el banco al motor. Preguntas/grupos se archivan; no se eliminan
físicamente desde la API. Eliminar una etiqueta solo elimina sus asociaciones e
incrementa revisiones de recursos afectados.

Las copias tienen IDs nuevos de grupo, pregunta y opción, por lo que los SP de
sorteo, respuesta y corrección conservan sus relaciones actuales. `IntentoPregunta`
continúa guardando IDs: la inmutabilidad depende de bloquear edición/reapertura de
evaluaciones publicadas o con intentos, no de una copia adicional por intento.

## 8. Revisión de actividades e idempotencia general

DDL: `migrations/20260926_evaluacion_revision_idempotencia.sql`. Debe ejecutarse
después de la migración del banco. Es aditivo, transaccional, repetible y no se aplica
desde el proceso Node. Su verificación de solo lectura está en
`scripts/verificar-evaluacion-idempotencia.sql`.

`Actividad.Revision` comienza en 1, es obligatoria y positiva. Las operaciones de
edición/publicación bloquean la fila con `UPDLOCK,HOLDLOCK`, comparan
`RevisionEsperada` y actualizan el contador dentro de la misma transacción. Las
importaciones dedicadas también incrementan la revisión y la devuelven. No es un
historial ni permite reconstruir versiones anteriores.

`OperacionIdempotente` contiene:

| Campo | Uso |
|---|---|
| `Actor`, `Operacion`, `Clave` | Identidad lógica única; `Clave` es UUID |
| `RequestHash` | SHA-256 hexadecimal del request canónico |
| `Estado` | `en_progreso` o `completada` |
| `ResultadoJson`, `StatusHttp` | IDs/mappings mínimos para replay; nunca el contenido académico completo |
| `FechaCreacion`, `FechaActualizacion`, `FechaExpiracion` | UTC `DATETIME2(3)`; expiración a siete días |

La lectura usa `UPDLOCK,HOLDLOCK` dentro de una transacción SERIALIZABLE. La constraint
única `(Actor, Operacion, Clave)` impide duplicados entre procesos. Reserva, escritura
de negocio y resultado se confirman o revierten juntos. Una operación completada con
igual hash se reproduce; con otro hash se rechaza. No existe purga automática: la fecha
de expiración habilita una futura limpieza administrada, que debe conservar al menos
siete días y probarse por separado.

La publicación completa actualiza evaluación, estructura, procedencia, banco y estado
en una sola transacción. Las FKs de procedencia siguen siendo informativas: no hay
sincronización ni cascada desde el banco. Al editar, los IDs anidados existentes se
actualizan, los omitidos se eliminan y los nuevos se insertan; un origen persistido no
puede reemplazarse por otro mediante la API.

## 9. Calificación configurable y persistencia de etapas siguientes

DDL: `migrations/20261011_calificacion_intentos_telemetria.sql`, posterior a las
migraciones de banco y revisión/idempotencia. Es transaccional, idempotente, manual y
no recalifica intentos históricos. Su verificación de solo lectura está en
`scripts/verificar-calificacion-intentos-telemetria.sql`.

- Las actividades existentes reciben exclusivamente los defaults aprobados:
  escala 10, umbral 4, modo iguales, puntaje oculto y corrección automática activa.
- `GrupoPregunta.PuntajeMaximo` queda nullable para borradores y contenido histórico.
  El detalle calcula el reparto igual de borrador y la publicación lo materializa sobre
  la estructura final, incluidas importaciones; publicación personalizada exige suma
  exacta. El orden estable es `GrupoPregunta.Id`.
- Las notas del intento se amplían a `DECIMAL(5,2)`; `DetalleActa` no cambia.
- Los intentos nuevos congelan el máximo en `IntentoPregunta`. No se reconstruyen ni
  alteran notas/correcciones históricas durante la migración.
- `HistorialCorreccionIntentoPregunta` audita toda corrección manual, incluso cuando
  reemplaza una autocorrección. `HistorialNotaIntento` audita cada override definitivo.
- `IntentoValidoOverride` y su historial persisten la selección académica de la etapa 3.
- `IncidenteIntento` persiste los intervalos de pérdida de foco de la etapa 6, con
  unicidad por intento/evento y recepción idempotente desde la API.

La migración reemplaza los tres SP existentes de inicio, render y finalización; no crea
procedimientos nuevos. Repetición, constraints, concurrencia y rollback deben validarse
en SQL Server aislado antes de desplegar.

### 9.1 Corrección por puntaje y nota efectiva — etapa 2

La corrección se asocia a `IntentoPregunta`, no a `Respuesta`: una pregunta omitida
continúa siendo corregible. `PuntajeObtenido` admite cero, parciales y el máximo
congelado; al corregir, `OrigenCorreccion` pasa a `manual` y se conservan actor, fecha,
comentario e historial. La fila legacy de `Respuesta`, si existe, se sincroniza para
mantener clientes anteriores, pero no es la fuente autoritativa del puntaje.

Después de cada corrección se recalculan atómicamente:

- `NotaAutomatica`: suma de componentes cuyo origen continúa siendo `automatica`;
- `NotaFinalCalculada`: suma de todos los puntajes sólo cuando no quedan pendientes;
- `NotaFinal`: `NotaFinalManual` si existe; en caso contrario, la calculada.

`PUT /api/intentos/:idIntento/calificar` persiste el override en
`NotaFinalManual`, actualiza `NotaFinal` y agrega `HistorialNotaIntento`. La validación
usa la escala de la actividad y permite `100.00`. Los intentos históricos con
`NotaFinal` previa y sin descomposición no se recalifican automáticamente.

### 9.2 Intento académicamente válido — etapa 3

La selección automática no elimina ni modifica intentos. Para cada par
`(IdPublicacion, IdAlumno)` considera únicamente filas `Intento.Estado='entregado'` y
elige una sola mediante `FechaFin DESC, NumeroIntento DESC, Id DESC`. Los estados
`en_progreso`, `vencido` y `anulado` quedan fuera de la selección.

`IntentoValidoOverride` reemplaza esa decisión automática cuando un docente propietario
de la publicación o un administrador elige manualmente un intento entregado de la misma
publicación y alumno. Su clave primaria garantiza un override por combinación y la
unicidad de `IdIntento` evita reutilizar un intento en otra selección. Una entrega
posterior no reemplaza el override.

Cada alta o cambio efectivo agrega una acción `seleccionado` en
`HistorialIntentoValidoOverride`; eliminar el override agrega `eliminado` con el intento
anterior. La eliminación vuelve a la regla automática. Seleccionar otra vez el mismo
intento o eliminar cuando no existe override es idempotente y no duplica historial.
Las escrituras se realizan en transacción con bloqueos de actualización para evitar
selecciones concurrentes inconsistentes. No se agregaron Stored Procedures.

### 9.3 Historial filtrable del alumno — etapa 4

`GET /api/intentos/mios` es una lectura parametrizada sobre las tablas existentes; no
agrega tablas, columnas ni Stored Procedures. Parte de todos los intentos del alumno
identificado por JWT, calcula primero el intento válido de cada publicación y luego
aplica filtros, resumen y paginación en un único batch SQL.

La consulta une `Intento`, `Publicacion`, `Actividad`, `MateriaDivision`, `Materia` y
`Division`. `IntentoPregunta` se usa sólo para determinar si quedan correcciones
pendientes. No consulta `Respuesta`, `RespuestaOpcion` ni `Opcion`.

El resultado académico compara `Intento.NotaFinal` con
`Actividad.NotaAprobacion`; no usa umbrales hardcodeados. El resumen cuenta todos los
intentos filtrados, publicaciones distintas y, separadamente, resultados académicos de
los intentos válidos que permanecen en el conjunto filtrado. La selección canónica se
resuelve sobre el historial completo antes de filtrar para evitar que fechas, estado o
resultado cambien artificialmente el intento válido.

### 9.4 Reportes académicos consistentes — etapa 5

Los reportes reutilizan `Actividad.EscalaCalificacion`, `Actividad.NotaAprobacion` e
`IntentoValidoOverride`; no agregan tablas, columnas ni Stored Procedures. Los conteos
operativos conservan todos los intentos y estados alcanzados. Las métricas académicas
(calificados, promedio y aprobación) aceptan alcance `todos` o `validos`; este último
resuelve primero el override manual y, en su ausencia, el último intento entregado con
el mismo desempate estable de la etapa 3.

Las filas de una publicación preservan promedio, escala y umbral originales. Los
agregados que combinan actividades convierten cada nota a base 10 mediante
`NotaFinal * 10 / EscalaCalificacion` antes de promediar. La aprobación siempre compara
la nota original con `Actividad.NotaAprobacion`, nunca con un umbral global. El filtro de
pendientes se aplica al conjunto de publicaciones antes de calcular KPIs, gráficos,
total y paginación.

### 9.5 Pérdidas de foco con duración — etapa 6

La API utiliza `IncidenteIntento`, creada por
`20261011_calificacion_intentos_telemetria.sql`. La unicidad
`(IdIntento, EventoId)` permite que el cliente reintente el mismo UUID sin duplicar el
evento. Una fila nace `iniciado` con `FechaInicioCliente` y
`FechaRecepcionInicio`; puede crearse directamente o evolucionar a `completado` con
`FechaFinCliente`, `DuracionMilisegundos` y `FechaRecepcionFin`.

La escritura se serializa y valida que el intento pertenezca al alumno del JWT. Las
lecturas validan la comisión del docente o permiten alcance institucional al
administrador. El resumen cuenta todos los incidentes `focus_lost`, mientras que suma,
promedio y máximo usan sólo duraciones completadas y se convierten de milisegundos a
segundos. Los registros no cambian `Intento.Estado`, no generan alertas legacy ni
dependen de cuál intento sea académicamente válido.

La sincronización nueva o de cierre se acepta hasta siete días después de
`Intento.FechaFin`, con cinco minutos de tolerancia de reloj. Los replays idénticos ya
persistidos siguen siendo idempotentes aun después de esa ventana. No se agregaron
tablas, columnas ni Stored Procedures en esta etapa.

### 9.6 Anulación y confirmación de corrección — etapa previa a telemetría temporal

DDL: `migrations/20261015_anulacion_confirmacion_revision.sql`. Verificación de sólo
lectura: `scripts/verificar-anulacion-confirmacion-revision.sql`.

`Intento` incorpora `CorreccionConfirmada`, actor, fecha y origen. Los intentos
históricos entregados sin puntajes pendientes reciben origen `backfill`; no se modifican
puntajes ni notas. `HistorialEstadoCorreccionIntento` registra confirmación automática,
confirmación manual y reaperturas por pregunta o nota. La finalización confirma
automáticamente sólo cuando todos los `IntentoPregunta` tienen puntaje definitivo.

`AnulacionIntentoIncidente` tiene una fila por intento y una FK compuesta hacia
`IncidenteIntento(IdIntento,EventoId)`. Conserva tipo, motivo autoritativo, usuario y
fecha. La transacción cambia únicamente el estado/fecha del intento y limpia notas; no
elimina `Respuesta`, `RespuestaOpcion`, snapshots ni historiales. `IncidenteIntento`
admite temporalmente `focus_lost` y `fullscreen_exit`; la etapa 3 ampliará el catálogo.

La revisión de alumno exige que el intento esté `entregado` y
`CorreccionConfirmada=1`. Desde la etapa 5, esas condiciones son necesarias pero no
suficientes: además se evalúan política, permiso individual, intento válido y sesión.

### 9.7 Telemetría temporal confiable — etapa 3

DDL: `migrations/20261016_telemetria_temporal.sql`, posterior a
`20261015_anulacion_confirmacion_revision.sql`. Verificación de sólo lectura:
`scripts/verificar-telemetria-temporal.sql`. Es idempotente, transaccional y no crea ni
modifica Stored Procedures.

La etapa reutiliza `IncidenteIntento` y conserva la unicidad histórica
`(IdIntento,EventoId)`. Agrega, de forma nullable para compatibilidad con filas legacy,
`IdIntentoPregunta`, `SesionClienteId`, `SecuenciaCliente` y `Codigo`; agrega también
`VersionContrato` con default 1. El índice único filtrado
`(IdIntento,SesionClienteId,SecuenciaCliente)` impide duplicar un evento reenviado con
otro UUID. La FK de pregunta y la validación de servicio exigen que un
`question_active` refiera una pregunta del mismo intento.

La misma migración redefine aditivamente `SP_Intento_ObtenerExamenDinamico` para incluir
`IP.Id AS IdIntentoPregunta` junto con `IP.IdPregunta`. Esto permite que el cliente
registre tiempos sobre la instancia sorteada sin inferir identificadores.

Si un ambiente aplicó `20261016_telemetria_temporal.sql` antes de incorporarse esa
redefinición, ejecutar únicamente `scripts/aplicar-render-id-intento-pregunta.sql`.
No reaplicar `20261011` ni `20261014` sobre un esquema posterior, porque también
redefinen otros procedimientos con la versión propia de aquella etapa.

`TipoEventoTelemetria` cataloga si cada tipo es intervalo, incidente, requiere pregunta
y admite cierre posterior. Incluye tiempos por pregunta, foco, pantalla completa,
conectividad y falta de sesión como intervalos; reanudación, recarga, error de
sincronización, entrega fallida y finalización como eventos puntuales. Las filas legacy
de foco/pantalla completa quedan admitidas por el mismo catálogo sin exigir sesión ni
secuencia retroactivamente.

La duración informada no se consolida en otra tabla: las lecturas unen intervalos
completados que se superponen antes de sumar. Los intervalos abiertos no aportan tiempo.
Por pregunta, `MetricasNavegacion` sólo funciona como fallback cuando no existen
intervalos nuevos `question_active`. La migración no reinterpreta ni duplica métricas
históricas y los eventos no actualizan estado, notas ni selección del intento válido.

### 9.8 Rendimiento por pregunta y grupo — etapa 4

No se crean tablas de agregación ni Stored Procedures. Los reportes parten de
`IntentoPregunta`, sus puntajes/snapshots, `Respuesta`/`RespuestaOpcion`, la selección
canónica de intentos y la telemetría temporal. Las consultas usan CTEs, tablas temporales
y `PERCENTILE_CONT`; los KPIs se calculan antes de paginar y no realizan N+1.

La unidad histórica de una variante es `IntentoPregunta.ContenidoHashSnapshot`. Un hash
nulo legacy queda aislado mediante `IdPregunta`; `IdBancoPreguntaOrigen` e
`IdBancoGrupoOrigen` sólo informan procedencia y nunca enlazan la copia con cambios
posteriores del banco. La distribución de opciones usa
`IntentoPreguntaOpcionSnapshot`, conservando texto y clave correctos al momento del
intento.

Los tiempos unen intervalos completos `question_active` superpuestos por
`IdIntentoPregunta`. Un intervalo abierto no suma. `MetricasNavegacion` se usa como
fallback únicamente para una pregunta sin telemetría nueva; la ausencia de ambos se
representa como tiempo nulo y queda reflejada en cobertura/muestras.

DDL de soporte: `migrations/20261017_indices_rendimiento_preguntas.sql`, posterior a
`20261016_telemetria_temporal.sql`. Sólo crea índices idempotentes sobre los accesos por
publicación/alumno/estado/fecha, intento/pregunta y fallback de navegación. No cambia
datos ni contratos. Verificación de sólo lectura:
`scripts/verificar-indices-rendimiento-preguntas.sql`; además de estructura muestra uso
y recomendaciones del optimizador para revisar planes con un volumen representativo.

La ampliación docente v1.0.0 no agrega DDL. Calcula en paralelo la población oficial
después de seleccionar el intento válido: entregado, `CorreccionConfirmada=1` y nota o
puntaje definitivo según el bloque. Las presentaciones de preguntas se particionan en
puntaje nulo, luego máximo no positivo y finalmente muestra confirmada. La evidencia de
opciones sigue usando `IntentoPreguntaOpcionSnapshot` y, con `claveContenido`, agrega todas
las copias de la misma identidad histórica sólo si sus formas snapshot son reconciliables.
El contrato exacto está en `docs/CONTRATO_REPORTES_DOCENTE_V1.md`.

### 9.9 Políticas y sesiones de revisión — etapa 5

DDL: `migrations/20261018_revision_examen.sql`, posterior a las migraciones de intentos
y corrección. Verificación de sólo lectura: `scripts/verificar-revision-examen.sql`.
La migración es idempotente, transaccional, usa SQL dinámico para referencias a objetos
nuevos y no crea ni modifica Stored Procedures.

Corrección semántica aditiva: `migrations/20261019_semantica_revision_unica.sql`, que
debe aplicarse después de la anterior. Su verificador de sólo lectura es
`scripts/verificar-semantica-revision-unica.sql`. No editar ni reemplazar la migración de
etapa 5 ya aplicada.

- `PoliticaRevisionPublicacion` mantiene una política versionada por publicación:
  `nunca|al_corregir|ventana|manual`, acceso `unico|libre` y fechas sólo para ventana.
- `PermisoRevisionIntento` mantiene como máximo un override por intento. Su estado
  `activo|revocado`, revisión, fechas y actor permiten autorización individual y
  revocación explícita sin alterar la política general.
- `SesionRevisionIntento` vincula una sesión UUID con intento y usuario, congela modo,
  acceso, revisión de política, permiso y límites efectivos, y registra emisión,
  expiración y consumos.
  `UX_SesionRevision_Intento_ActivaUnica` garantiza una sola sesión única activa por
  intento; el consumo se coordina con bloqueo serializable.
- `ConsumoRevisionUnicaIntento` contiene como máximo una fila por `IdIntento`. Es la
  garantía autoritativa de que ya ocurrió la única apertura real y no se elimina al
  cambiar políticas o permisos. La migración toma el primer consumo único histórico
  como backfill, sin alterar el intento ni sus datos académicos.
- `AuditoriaRevisionIntento` registra backfill/cambios de política, concesiones,
  revocaciones, emisión, reutilización, apertura, consumo, expiración y rechazos por
  política `nunca` o acceso único agotado.

El backfill crea `al_corregir + libre` para toda publicación existente y una auditoría
única, preservando la visibilidad previa bajo una regla explícita. Las publicaciones
nuevas crean su política dentro de la misma transacción que `Publicacion`.

La confirmación de corrección es una precondición independiente. `nunca` prevalece sobre
cualquier permiso; `manual` sólo autoriza mediante permiso individual vigente. La
política general `al_corregir|ventana` sólo aplica al intento válido actual; un permiso
individual se vincula al intento y no migra al cambiar esa selección. Una revocación
invalida las sesiones emitidas del intento.

`FechaExpiracion` se calcula como el mínimo entre emisión + 300 segundos, el final de la
ventana general aplicable y el final del permiso individual aplicable. Los finales son
exclusivos. Vencer una sesión única sin consumirla no crea una fila de consumo y permite
emitir otra. El contenido del alumno se reconstruye desde snapshots y no usa el endpoint
docente `/intentos/:id/completo`.

### 9.10 Políticas configurables de supervisión — etapa 6

DDL: `migrations/20261019_politicas_supervision.sql`, posterior a la telemetría temporal
y a la anulación autoritativa. Verificación de sólo lectura:
`scripts/verificar-politicas-supervision.sql`. La migración es idempotente y usa SQL
dinámico para las referencias a objetos creados dentro del mismo batch.

- `PoliticaSupervisionPublicacion` y `ReglaSupervisionPublicacion` contienen la
  configuración editable y versionada de la publicación.
- `IntentoPoliticaSupervision` e `IntentoReglaSupervision` son snapshots inmutables. La
  FK hacia la regla de origen usa `ON DELETE SET NULL`, por lo que reemplazar reglas no
  invalida intentos existentes.
- `EstadoSupervisionIntento` mantiene el estado operativo y revisión optimista.
- `DecisionSupervisionIntento` tiene unicidad `(IdIntento,EventoId)` y conserva regla,
  valor calculado, acción y resultado de la consecuencia.
- `OverrideSupervisionIntento` audita desbloqueo, reconocimiento o descarte con actor,
  motivo y transición de revisión.

La severidad es autoritativa y prevalece sobre el campo de prioridad:
`anular_intento > bloquear_interfaz > advertir > informar`. `Prioridad` desempata reglas
de igual severidad. La duración acumulada une intervalos completados solapados; los
intervalos abiertos aportan cantidad pero no duración.

`SP_Intento_IniciarExamen` crea los snapshots dentro de la transacción del intento y
completa cualquier snapshot faltante al reanudar un intento en progreso. El backfill
asigna `temporal-v1` a publicaciones existentes y congela la mejor configuración
disponible para intentos preexistentes, sin alterar notas ni respuestas.

`AnulacionIntentoIncidente` admite `ActorTipo=usuario|sistema`; `AnuladoPor` es nullable
únicamente para el actor sistema. Se conservan la FK al evento y la unicidad por intento.
La consecuencia configurada reutiliza el servicio de anulación de la etapa previa.

### 9.11 Revisión operativa de incidentes — etapa 7

DDL: `migrations/20261020_visibilidad_incidentes.sql`, posterior a la política de
supervisión. Verificación de sólo lectura:
`scripts/verificar-visibilidad-incidentes.sql`.

`RevisionIncidenteIntento` conserva un historial append-only por
`IncidenteIntento.Id`. La unicidad `(IdIncidente,Revision)` y la transacción serializable
permiten revisión optimista segura. La fila de mayor revisión es el estado efectivo;
si no existe ninguna, el contrato deriva `pendiente` con revisión `0` sin alterar datos
históricos. Cada fila conserva estado, actor, rol, comentario y fecha UTC.

Sólo se listan eventos cuyo catálogo tenga `EsIncidente=1`. La severidad procede de
`DecisionSupervisionIntento.Accion`; cuando no existe una decisión queda
`sin_clasificar`. Revisión y descarte son clasificaciones operativas: no modifican la
decisión, el estado académico ni la nota. La idempotencia reutiliza
`OperacionIdempotente` y no agrega otra fuente de claves.

Los índices permiten obtener la última revisión por incidente. Los reportes parten de
la publicación y agregan eventos por conjuntos; no crean tablas precalculadas ni hacen
consultas N+1.

## 10. Modelo de selección múltiple y justificación

DDL: `migrations/20261013_respuestas_multiples_justificacion.sql`, posterior a
`20261011_calificacion_intentos_telemetria.sql`. Verificación de sólo lectura:
`scripts/verificar-respuestas-multiples-justificacion.sql`.

`Pregunta` y `BancoPregunta` comparten:

- `ModoJustificacion`: `sin_justificacion|opcional|obligatoria`.
- `EstrategiaCorreccion`: `exacta|parcial_sin_penalizacion|parcial_penalizada`.
- `TratamientoJustificacion`: `informativa|revision_manual`.
- `ContenidoHash CHAR(64)`: SHA-256 de tipo, enunciado, configuración y opciones
  ordenadas. No incluye IDs, puntaje, propietario ni procedencia.

Los datos existentes reciben `sin_justificacion`, `exacta` e `informativa`. La
migración completa snapshots de intentos previos desde el contenido disponible y los
marca como reconstruidos; no modifica respuestas, puntajes ni notas.

La etapa 2 requiere `migrations/20261014_runtime_respuestas_multiples.sql`; su verificador
es `scripts/verificar-runtime-respuestas-multiples.sql`. Agrega `EnunciadoSnapshot` y
`GrupoTituloSnapshot`, garantiza una sola `Respuesta` por intento/pregunta y actualiza
los cuatro SP de runtime existentes. La selección continúa almacenándose en
`RespuestaOpcion` por IDs originales, pero render y corrección resuelven texto y clave
exclusivamente desde `IntentoPreguntaOpcionSnapshot`.

`HistorialRespuestaCambio` contiene el estado anterior/nuevo sin claves correctas,
UUID del cliente y revisiones consecutivas. El guardado serializable reemplaza el
conjunto completo dentro de una transacción. La entrega valida justificaciones y
calcula estrategias exacta/parciales sobre snapshots; `PuntajeAutomaticoOpciones`
conserva el valor provisional cuando la justificación exige revisión manual.
