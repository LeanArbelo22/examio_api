# Vaciado integral de `GestionExamio-Migracion`

Estos archivos están diseñados exclusivamente para la base de pruebas
`GestionExamio-Migracion`. No son migraciones del producto y no fueron ejecutados
durante su preparación.

## Archivos

- `vaciar-gestionexamio-migracion.sql`: operación destructiva, bloqueada por defecto.
- `inventario-verificacion-vaciado.sql`: inventario y comprobaciones de sólo lectura.

## Uso seguro

1. Realizar un backup si existe cualquier posibilidad de necesitar los datos.
2. Detener la API y cualquier proceso que escriba en la base.
3. Seleccionar manualmente `GestionExamio-Migracion` en SSMS.
4. Ejecutar primero `inventario-verificacion-vaciado.sql` y conservar el resultado.
5. Revisar la lista de tablas y cualquier tabla especial, ciclo o constraint no confiable.
6. Abrir `vaciar-gestionexamio-migracion.sql` y cambiar solamente:

   ```sql
   DECLARE @CONFIRMAR_VACIADO_TOTAL BIT = 1;
   ```

7. Ejecutar el vaciado una sola vez.
8. Volver a ejecutar el inventario. La consulta de tablas con filas debe devolver
   cero registros.

Con la confirmación en `0`, el archivo muestra el manifiesto efectivo y las tablas
opcionales ausentes, y luego aborta antes de iniciar la transacción. Este preflight
no modifica datos. También aborta si `DB_NAME()` no coincide exactamente o si
encuentra una tabla de usuario que no pertenece al manifiesto explícito.

## Tablas incluidas explícitamente

El manifiesto contiene:

- Base académica: `Carrera`, `Materia`, `Division`, `Docente`, `Alumno`,
  `MateriaDivision`, `InscripcionMateria`.
- Evaluaciones: `Actividad`, `Publicacion`, `GrupoPregunta`, `Pregunta`, `Opcion`.
- Intentos y respuestas: `Intento`, `IntentoPregunta`,
  `IntentoPreguntaOpcionSnapshot`, `Respuesta`, `RespuestaOpcion`,
  `IntentoValidoOverride`.
- Historiales y auditoría: `HistorialRespuesta`, `HistorialRespuestaCambio`,
  `HistorialCorreccionIntentoPregunta`, `HistorialNotaIntento`,
  `HistorialIntentoValidoOverride`, `HistorialEstadoCorreccionIntento`,
  `AuditoriaRevisionIntento`, `RevisionIncidenteIntento`,
  `AnulacionIntentoIncidente`.
- Telemetría: `AlertaFraude`, `MetricasNavegacion`, `IncidenteIntento`,
  `TipoEventoTelemetria`.
- Actas: `ActaMateria`, `DetalleActa`.
- Seguridad e infraestructura: `Usuario`, `AuthSession`, `AuthRefreshToken`,
  `OperacionIdempotente`.
- Banco: `BancoPregunta`, `BancoOpcion`, `BancoGrupo`,
  `BancoGrupoPregunta`, `BancoEtiqueta`, `BancoPreguntaEtiqueta`,
  `BancoGrupoEtiqueta`.
- Revisión: `PoliticaRevisionPublicacion`, `PermisoRevisionIntento`,
  `SesionRevisionIntento`, `ConsumoRevisionUnicaIntento`.
- Supervisión: `PoliticaSupervisionPublicacion`,
  `ReglaSupervisionPublicacion`, `IntentoPoliticaSupervision`,
  `IntentoReglaSupervision`, `EstadoSupervisionIntento`,
  `DecisionSupervisionIntento`, `OverrideSupervisionIntento`.
- Auxiliares de pruebas: `ExamioTestDataLote`, `ExamioTestDataEntidad`.
- Herramientas de SQL Server: `sysdiagrams`.

Las tablas del manifiesto que no existan se informan y no producen error. Una tabla
real adicional aborta todo antes del primer `DELETE`, para evitar omisiones
silenciosas. Una history table temporal sólo se acepta cuando pertenece a una tabla
actual inventariada y se muestra en la lista previa.

## Consecuencias

El vaciado elimina todos los datos académicos, usuarios de aplicación, hashes de
contraseña, sesiones, refresh tokens, auditorías, idempotencia, banco privado,
telemetría, actas, políticas, intentos, respuestas y datos sintéticos. No elimina
logins del servidor, usuarios/permisos de la base ni definiciones SQL.

También elimina catálogos y datos técnicos:

- `TipoEventoTelemetria` queda vacío. Antes de usar telemetría/supervisión debe
  restaurarse con la carga idempotente definida por
  `20261016_telemetria_temporal.sql`.
- `ExamioTestDataLote` y `ExamioTestDataEntidad` pierden la identidad de lotes
  sintéticos anteriores. Después podrán crearse lotes nuevos.
- `sysdiagrams` pierde los diagramas de base guardados desde SSMS. Esto no elimina
  tablas, claves foráneas ni procedimientos de soporte; los diagramas visuales
  deberán recrearse manualmente si se necesitaban.
- `OperacionIdempotente` pierde todos los replays registrados.
- Si el inventario detecta una tabla externa de historial de migraciones, el
  manifiesto debe actualizarse de manera explícita. Vaciarla puede hacer que su
  herramienta crea que ninguna migración fue aplicada aunque la estructura siga
  existiendo; no se debe repoblar sin revisar el mecanismo de migración utilizado.

Después del vaciado se necesitan, como mínimo:

1. restaurar los catálogos técnicos requeridos;
2. cargar carreras, materias, divisiones y comisiones;
3. crear usuarios mediante el flujo seguro de la aplicación, incluyendo un admin;
4. cargar docentes, alumnos e inscripciones antes de generar evaluaciones.

## Orden, ciclos y triggers

El orden no está codificado manualmente: se calcula desde `sys.foreign_keys` y
ejecuta `DELETE` hijo → padre. Las FKs autorreferenciales o pertenecientes a un
ciclo real se suspenden temporalmente de manera individual y recuperan exactamente
su estado habilitado/confiable original. El script no deshabilita todas las
constraints.

Los triggers no se deshabilitan. Si un trigger rechaza el borrado o vuelve a crear
datos, la verificación previa al `COMMIT` falla y toda la transacción se revierte.
El estado de triggers, FKs y CHECKs se compara con el estado inicial.

Las tablas se bloquean durante la transacción; ejecutar con la API activa puede
causar esperas o deadlocks.

## Temporales y objetos especiales

Si hay tablas system-versioned, el script suspende `SYSTEM_VERSIONING`, vacía tabla
actual e historial, y lo restablece con la misma history table antes de verificar.
Esto evita dejar historial residual.

Por seguridad, el script aborta antes de modificar datos si detecta FileTables,
tablas graph o ledger. Esos objetos no forman parte del modelo actual y no pueden
tratarse como tablas comunes sin una revisión específica.

## Identidades y secuencias

`@REINICIAR_IDENTIDADES=1` reinicia las columnas `IDENTITY` a su seed original. Se
puede establecer en `0` si se desea conservar la continuidad numérica. El script
no reinicia secuencias independientes porque pueden ser compartidas por varios
objetos y el esquema actual no demuestra que sea seguro hacerlo.

## Limitación de validación

Los archivos fueron revisados estáticamente, pero no fueron ejecutados contra SQL
Server. La conexión TCP configurada para la API no estuvo disponible durante la
generación, por lo que el manifiesto se construyó desde el esquema documentado y
las migraciones del repositorio. La validación estricta de tablas desconocidas es
deliberada: si aparece alguna, no se borrará nada hasta incorporarla conscientemente.
