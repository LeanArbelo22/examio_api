/*
 * Harness opt-in de concurrencia y rollback contra SQL Server real.
 *
 * IMPORTANTE:
 * - Crea y elimina datos de prueba.
 * - Rechaza bases cuyo nombre no parezca aislado.
 * - No abre un puerto: carga Express directamente mediante Supertest.
 * - No usar contra la base real/compartida.
 *
 * Ejecución desde la raíz del proyecto (PowerShell):
 *
 *   $env:DB_NAME = 'GestionExamio-Migracion'
 *   $env:HARNESS_EXPECTED_DB = 'GestionExamio-Migracion'
 *   $env:HARNESS_ALLOW_WRITE = 'GestionExamio-Migracion'
 *   $env:HARNESS_DOCENTE_EMAIL = '<docente de prueba>'
 *   $env:HARNESS_DOCENTE_PASSWORD = '<contraseña>'
 *   node scripts/verificar-evaluacion-concurrencia-rollback.js
 *
 * DB_SERVER, DB_PORT, DB_USER, DB_PASSWORD y JWT_SECRET se toman del entorno/.env.
 * Para conservar los datos creados para inspección, definir HARNESS_KEEP_DATA=1.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable obligatoria ${name}.`);
  return value;
}

const expectedDatabase = required('HARNESS_EXPECTED_DB');
const configuredDatabase = required('DB_NAME');
const writeConfirmation = required('HARNESS_ALLOW_WRITE');

if (configuredDatabase !== expectedDatabase || writeConfirmation !== expectedDatabase) {
  throw new Error('DB_NAME, HARNESS_EXPECTED_DB y HARNESS_ALLOW_WRITE deben coincidir exactamente.');
}
if (!/(migracion|migration|test|sandbox|aislad)/i.test(expectedDatabase)) {
  throw new Error(`La base "${expectedDatabase}" no parece un entorno aislado; ejecución cancelada.`);
}

// El proyecto usa TypeScript/CommonJS en desarrollo y el build global continúa pendiente.
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
  verbatimModuleSyntax: false,
  ignoreDeprecations: '6.0',
});
require('ts-node/register/transpile-only');

const request = require('supertest');
const sql = require('mssql');
const { app } = require('../src/app');
const { pool } = require('../src/config/db');

const marker = `HARNESS-${crypto.randomUUID()}`;
const idempotencyKeys = new Set();
let accessToken;
let refreshToken;
let databaseGuardPassed = false;

function uuid() {
  const value = crypto.randomUUID();
  idempotencyKeys.add(value);
  return value;
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? '' : `\nDetalle: ${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function statusSummary(responses) {
  return responses.map(response => ({
    status: response.status,
    code: response.body?.code,
    message: response.body?.message,
  }));
}

async function dbQuery(text, parameters = {}) {
  const req = pool.request();
  for (const [name, value] of Object.entries(parameters)) req.input(name, value);
  return req.query(text);
}

function authenticated(method, url, body, idempotencyKey) {
  let req = request(app)[method](url).set('Authorization', `Bearer ${accessToken}`);
  if (idempotencyKey) req = req.set('Idempotency-Key', idempotencyKey);
  return body === undefined ? req : req.send(body);
}

function dates() {
  const start = new Date(Date.now() + 60 * 60_000);
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  return { FechaInicio: start.toISOString(), FechaFin: end.toISOString() };
}

function draftPayload(title, commissionId, groups = []) {
  return {
    Titulo: title,
    Descripcion: `${marker} datos descartables`,
    Tipo: 'evaluacion',
    CantidadIntentosMaximos: 1,
    DuracionMinutos: 30,
    RecursosPermitidos: '',
    IdMateriaDivision: commissionId,
    ...dates(),
    Estado: 'borrador',
    GuardarTodoEnBanco: false,
    GruposPreguntas: groups,
  };
}

function completeGroups(label) {
  return [{
    TituloReferencia: `${marker} grupo ${label}`,
    Variantes: [{
      Enunciado: `${marker} pregunta ${label}`,
      Tipo: 'mc',
      Opciones: [
        { Texto: 'Respuesta correcta', EsCorrecta: true },
        { Texto: 'Respuesta incorrecta', EsCorrecta: false },
      ],
    }],
  }];
}

function editablePayload(createdPayload, created, title, groups) {
  return {
    Titulo: title,
    Descripcion: createdPayload.Descripcion,
    Tipo: createdPayload.Tipo,
    CantidadIntentosMaximos: createdPayload.CantidadIntentosMaximos,
    DuracionMinutos: createdPayload.DuracionMinutos,
    RecursosPermitidos: createdPayload.RecursosPermitidos,
    IdMateriaDivision: createdPayload.IdMateriaDivision,
    FechaInicio: createdPayload.FechaInicio,
    FechaFin: createdPayload.FechaFin,
    IdPublicacion: created.idPublicacion,
    RevisionEsperada: created.revision,
    GruposPreguntas: groups,
  };
}

async function createDraft(title, commissionId, groups = []) {
  const payload = draftPayload(title, commissionId, groups);
  const response = await authenticated('post', '/api/evaluaciones/guardar-completo', payload, uuid());
  assert(response.status === 201 && response.body?.success, 'No se pudo crear el borrador de preparación.', {
    title,
    response: statusSummary([response]),
  });
  return { payload, data: response.body.data };
}

async function verifyDatabaseGuard() {
  const result = await dbQuery(`SELECT DB_NAME() AS BaseActual,
    OBJECT_ID(N'dbo.OperacionIdempotente', N'U') AS OperacionIdempotente,
    COL_LENGTH(N'dbo.Actividad', N'Revision') AS RevisionLength`);
  const row = result.recordset[0];
  assert(row.BaseActual === expectedDatabase, 'La conexión real no apunta a la base confirmada.', row);
  assert(row.OperacionIdempotente && row.RevisionLength === 4,
    'Falta aplicar o verificar la migración de revisión/idempotencia.', row);
  databaseGuardPassed = true;
  console.log(`OK  Base aislada confirmada: ${row.BaseActual}`);
}

async function loginDocente() {
  const email = required('HARNESS_DOCENTE_EMAIL');
  const password = required('HARNESS_DOCENTE_PASSWORD');
  const response = await request(app).post('/api/auth/login').send({ Email: email, Password: password });
  assert(response.status === 200 && response.body?.data?.accessToken,
    'No se pudo autenticar al docente de prueba.', statusSummary([response]));
  assert(response.body.data.user?.role === 'docente' && response.body.data.user?.idDocente,
    'La cuenta indicada no posee una vinculación docente activa.', response.body.data.user);
  accessToken = response.body.data.accessToken;
  refreshToken = response.body.data.refreshToken;
  return response.body.data.user.idDocente;
}

async function selectCommission(teacherId) {
  const result = await dbQuery(`SELECT TOP (1) md.Id
    FROM dbo.MateriaDivision md
    JOIN dbo.Docente d ON d.Legajo=md.IdDocente
    WHERE md.IdDocente=@Docente AND d.Estado=1
    ORDER BY md.Id`, { Docente: teacherId });
  assert(result.recordset.length === 1,
    'El docente de prueba necesita al menos una MateriaDivision propia.', { teacherId });
  console.log(`OK  Docente ${teacherId}; comisión de prueba ${result.recordset[0].Id}`);
  return result.recordset[0].Id;
}

async function testConcurrentReplay(commissionId) {
  const title = `${marker} replay concurrente`;
  const payload = draftPayload(title, commissionId);
  const key = uuid();
  const responses = await Promise.all([
    authenticated('post', '/api/evaluaciones/guardar-completo', payload, key),
    authenticated('post', '/api/evaluaciones/guardar-completo', payload, key),
  ]);
  assert(responses.every(response => response.status === 201 && response.body?.success),
    'El replay concurrente no devolvió dos respuestas exitosas.', statusSummary(responses));
  const ids = responses.map(response => response.body.data.idActividad);
  assert(ids[0] === ids[1], 'La misma Idempotency-Key creó actividades diferentes.', ids);

  const persisted = await dbQuery(`SELECT COUNT(*) AS Total, MIN(Id) AS Id
    FROM dbo.Actividad WHERE Titulo=@Titulo`, { Titulo: title });
  const idem = await dbQuery(`SELECT Estado,COUNT(*) AS Total
    FROM dbo.OperacionIdempotente WHERE Clave=@Clave GROUP BY Estado`, { Clave: key });
  assert(persisted.recordset[0].Total === 1 && persisted.recordset[0].Id === ids[0],
    'El replay concurrente dejó una cantidad inesperada de actividades.', persisted.recordset);
  assert(idem.recordset.length === 1 && idem.recordset[0].Estado === 'completada' && idem.recordset[0].Total === 1,
    'La reserva idempotente no quedó completada exactamente una vez.', idem.recordset);
  console.log('OK  Misma Idempotency-Key concurrente: una escritura y replay estable');
}

async function testOptimisticRevision(commissionId) {
  const created = await createDraft(`${marker} edición concurrente`, commissionId);
  const left = editablePayload(created.payload, created.data, `${marker} edición A`, []);
  const right = editablePayload(created.payload, created.data, `${marker} edición B`, []);
  const responses = await Promise.all([
    authenticated('put', `/api/evaluaciones/${created.data.idActividad}/modificar-completo`, left),
    authenticated('put', `/api/evaluaciones/${created.data.idActividad}/modificar-completo`, right),
  ]);
  const statuses = responses.map(response => response.status).sort((a, b) => a - b);
  assert(statuses[0] === 200 && statuses[1] === 409,
    'Dos ediciones con la misma revisión no produjeron un ganador y un conflicto.', statusSummary(responses));

  const result = await dbQuery('SELECT Estado,Revision,Titulo FROM dbo.Actividad WHERE Id=@Id', {
    Id: created.data.idActividad,
  });
  const row = result.recordset[0];
  assert(row?.Estado === 'borrador' && row.Revision === 2 && [left.Titulo, right.Titulo].includes(row.Titulo),
    'El estado final de la revisión optimista no es consistente.', row);
  console.log('OK  RevisionEsperada concurrente: un éxito y un conflicto 409');
}

async function testPublishAgainstEdit(commissionId) {
  const groups = completeGroups('publicación');
  const created = await createDraft(`${marker} publicar contra editar`, commissionId, groups);
  const base = editablePayload(created.payload, created.data, `${marker} edición competidora`, groups);
  const publish = { ...base, Titulo: `${marker} publicación ganadora`, GuardarTodoEnBanco: false };
  const publishKey = uuid();
  const responses = await Promise.all([
    authenticated('post', `/api/evaluaciones/${created.data.idActividad}/publicar-completo`, publish, publishKey),
    authenticated('put', `/api/evaluaciones/${created.data.idActividad}/modificar-completo`, base),
  ]);
  const successes = responses.filter(response => response.status === 200);
  const rejected = responses.filter(response => response.status === 400 || response.status === 409);
  assert(successes.length === 1 && rejected.length === 1,
    'Publicación y edición concurrentes no dejaron un único ganador.', statusSummary(responses));

  const result = await dbQuery(`SELECT a.Estado,a.Revision,
      (SELECT COUNT(*) FROM dbo.GrupoPregunta g WHERE g.IdActividad=a.Id) AS Grupos,
      (SELECT COUNT(*) FROM dbo.Pregunta p JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta WHERE g.IdActividad=a.Id) AS Preguntas,
      (SELECT COUNT(*) FROM dbo.Opcion o JOIN dbo.Pregunta p ON p.Id=o.IdPregunta
        JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta WHERE g.IdActividad=a.Id) AS Opciones
    FROM dbo.Actividad a WHERE a.Id=@Id`, { Id: created.data.idActividad });
  const row = result.recordset[0];
  assert(row && ['borrador', 'publicada'].includes(row.Estado) && row.Revision === 2 &&
      row.Grupos === 1 && row.Preguntas === 1 && row.Opciones === 2,
    'La carrera publicación/edición dejó una estructura parcial.', row);
  console.log(`OK  Publicar contra editar: estado final ${row.Estado}, revisión ${row.Revision}`);
  return created.data.idActividad;
}

async function bankCounts() {
  const result = await dbQuery(`SELECT
    (SELECT COUNT_BIG(*) FROM dbo.BancoPregunta) AS Preguntas,
    (SELECT COUNT_BIG(*) FROM dbo.BancoOpcion) AS Opciones,
    (SELECT COUNT_BIG(*) FROM dbo.BancoGrupo) AS Grupos,
    (SELECT COUNT_BIG(*) FROM dbo.BancoGrupoPregunta) AS Relaciones`);
  return Object.fromEntries(Object.entries(result.recordset[0]).map(([key, value]) => [key, String(value)]));
}

async function testRealRollback(activityId) {
  const question = await dbQuery(`SELECT TOP (1) p.Id
    FROM dbo.Pregunta p JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta
    WHERE g.IdActividad=@Actividad ORDER BY p.Id`, { Actividad: activityId });
  assert(question.recordset.length === 1, 'No se encontró la pregunta preparatoria para rollback.');
  const before = await bankCounts();
  const key = uuid();
  const response = await authenticated('post', '/api/banco-preguntas/desde-evaluacion', {
    IdActividad: activityId,
    Preguntas: [question.recordset[0].Id, 2147483647],
    Grupos: [],
  }, key);
  assert(response.status === 404,
    'El fallo inducido a mitad de la copia no devolvió 404.', statusSummary([response]));

  const after = await bankCounts();
  const idem = await dbQuery('SELECT COUNT(*) AS Total FROM dbo.OperacionIdempotente WHERE Clave=@Clave', {
    Clave: key,
  });
  assert(JSON.stringify(after) === JSON.stringify(before),
    'El rollback dejó preguntas, opciones, grupos o relaciones parciales.', { before, after });
  assert(idem.recordset[0].Total === 0,
    'El rollback dejó persistida la reserva idempotente.', idem.recordset[0]);
  console.log('OK  Rollback real: sin contenido de banco ni idempotencia parcial');
}

function publishableGroupsFromDetail(detail) {
  return detail.grupos.map(group => ({
    Id: group.idGrupo,
    TituloReferencia: group.tituloReferencia,
    ...(group.idBancoGrupoOrigen ? {
      ReferenciaBanco: {
        IdGrupo: group.idBancoGrupoOrigen,
        RevisionEsperada: group.revisionBancoOrigen,
      },
    } : {}),
    Variantes: group.preguntas.map(question => ({
      Id: question.idPregunta,
      Enunciado: question.enunciado,
      Tipo: question.tipo,
      ...(question.idBancoPreguntaOrigen ? {
        ReferenciaBanco: {
          IdPregunta: question.idBancoPreguntaOrigen,
          RevisionEsperada: question.revisionBancoOrigen,
        },
      } : {}),
      Opciones: question.opciones.map(option => ({
        Id: option.idOpcion,
        Texto: option.texto,
        EsCorrecta: Boolean(option.esCorrecta),
      })),
    })),
  }));
}

async function testDraftImportPublishReplay(commissionId) {
  const bankKey = uuid();
  const bankResponse = await authenticated('post', '/api/banco-preguntas/preguntas', {
    Titulo: `${marker} pregunta de banco`,
    Enunciado: `${marker} ¿Cuál es la opción correcta?`,
    Tipo: 'mc',
    Estado: 'disponible',
    Opciones: [
      { Texto: 'Opción A', EsCorrecta: true },
      { Texto: 'Opción B', EsCorrecta: false },
    ],
    Etiquetas: [],
  }, bankKey);
  assert(bankResponse.status === 201 && bankResponse.body?.data?.id,
    'No se pudo preparar la pregunta del banco para el smoke test.', statusSummary([bankResponse]));
  const bankQuestion = bankResponse.body.data;

  const created = await createDraft(`${marker} smoke completo`, commissionId);
  const importKey = uuid();
  const importBody = {
    ImportacionesBanco: [{
      Tipo: 'pregunta',
      IdPregunta: bankQuestion.id,
      RevisionEsperada: bankQuestion.revision,
      TituloReferencia: `${marker} grupo importado`,
    }],
  };
  const imported = await authenticated(
    'post',
    `/api/evaluaciones/${created.data.idActividad}/importar-banco`,
    importBody,
    importKey,
  );
  assert(imported.status === 201 && imported.body?.data?.revision === 2,
    'La importación al borrador no incrementó la revisión esperada.', statusSummary([imported]));

  const detailResponse = await authenticated(
    'get',
    `/api/evaluaciones/${created.data.idPublicacion}/detalle`,
  );
  assert(detailResponse.status === 200 && detailResponse.body?.success,
    'No se pudo recuperar el detalle importado.', statusSummary([detailResponse]));
  const detail = detailResponse.body.data;
  assert(detail.estado === 'borrador' && detail.revision === 2 &&
      detail.grupos?.length === 1 && detail.grupos[0].preguntas?.length === 1 &&
      detail.grupos[0].preguntas[0].opciones?.length === 2,
    'El borrador importado no contiene la estructura esperada.', detail);

  const publishGroups = publishableGroupsFromDetail(detail);
  const publishBody = {
    ...editablePayload(
      created.payload,
      { ...created.data, revision: imported.body.data.revision },
      `${marker} smoke publicado`,
      publishGroups,
    ),
    GuardarTodoEnBanco: false,
  };
  const publishKey = uuid();
  const published = await authenticated(
    'post',
    `/api/evaluaciones/${created.data.idActividad}/publicar-completo`,
    publishBody,
    publishKey,
  );
  assert(published.status === 200 && published.body?.data?.estado === 'publicada' &&
      published.body.data.revision === 3,
    'La publicación completa no finalizó con estado publicada y revisión 3.', statusSummary([published]));

  const replay = await authenticated(
    'post',
    `/api/evaluaciones/${created.data.idActividad}/publicar-completo`,
    publishBody,
    publishKey,
  );
  assert(replay.status === 200 && replay.body?.success,
    'El replay de la publicación no fue exitoso.', statusSummary([replay]));
  assert(JSON.stringify(replay.body.data) === JSON.stringify(published.body.data),
    'El replay no devolvió exactamente el resultado persistido.', {
      published: published.body.data,
      replay: replay.body.data,
    });

  const persisted = await dbQuery(`SELECT a.Estado,a.Revision,
      (SELECT COUNT(*) FROM dbo.Publicacion p WHERE p.IdActividad=a.Id) AS Publicaciones,
      (SELECT COUNT(*) FROM dbo.GrupoPregunta g WHERE g.IdActividad=a.Id) AS Grupos,
      (SELECT COUNT(*) FROM dbo.Pregunta p JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta
        WHERE g.IdActividad=a.Id) AS Preguntas,
      (SELECT COUNT(*) FROM dbo.Opcion o JOIN dbo.Pregunta p ON p.Id=o.IdPregunta
        JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta WHERE g.IdActividad=a.Id) AS Opciones
    FROM dbo.Actividad a WHERE a.Id=@Id`, { Id: created.data.idActividad });
  const bankPersisted = await dbQuery(`SELECT p.Estado,p.Revision,
      (SELECT COUNT(*) FROM dbo.BancoOpcion o WHERE o.IdPregunta=p.Id) AS Opciones
    FROM dbo.BancoPregunta p WHERE p.Id=@Id`, { Id: bankQuestion.id });
  const idem = await dbQuery(`SELECT Clave,Estado,COUNT(*) AS Total
    FROM dbo.OperacionIdempotente WHERE Clave IN (@ImportKey,@PublishKey)
    GROUP BY Clave,Estado`, { ImportKey: importKey, PublishKey: publishKey });
  const row = persisted.recordset[0];
  assert(row?.Estado === 'publicada' && row.Revision === 3 && row.Publicaciones === 1 &&
      row.Grupos === 1 && row.Preguntas === 1 && row.Opciones === 2,
    'Publicación o replay dejaron datos duplicados/incompletos.', row);
  assert(bankPersisted.recordset.length === 1 && bankPersisted.recordset[0].Estado === 'disponible' &&
      bankPersisted.recordset[0].Revision === bankQuestion.revision && bankPersisted.recordset[0].Opciones === 2,
    'La importación alteró inesperadamente la pregunta de banco original.', bankPersisted.recordset);
  assert(idem.recordset.length === 2 && idem.recordset.every(item => item.Estado === 'completada' && item.Total === 1),
    'Importación/publicación no dejaron exactamente una operación completada por clave.', idem.recordset);
  console.log('OK  Smoke completo: borrador, importación, publicación y replay sin duplicados');
}

async function cleanup() {
  if (!databaseGuardPassed) return;
  if (process.env.HARNESS_KEEP_DATA === '1') {
    console.log(`AVISO  Se conservaron los datos con marcador ${marker}`);
    return;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const req = tx.request().input('Prefix', `${marker}%`);
    const keys = [...idempotencyKeys];
    const keyNames = keys.map((key, index) => {
      const name = `Key${index}`;
      req.input(name, sql.UniqueIdentifier, key);
      return `@${name}`;
    });
    await req.query(`
      DECLARE @Actividades TABLE (Id INT PRIMARY KEY);
      INSERT INTO @Actividades SELECT Id FROM dbo.Actividad WHERE Titulo LIKE @Prefix;

      DELETE o FROM dbo.Opcion o
      JOIN dbo.Pregunta p ON p.Id=o.IdPregunta
      JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta
      JOIN @Actividades a ON a.Id=g.IdActividad;
      DELETE p FROM dbo.Pregunta p
      JOIN dbo.GrupoPregunta g ON g.Id=p.IdGrupoPregunta
      JOIN @Actividades a ON a.Id=g.IdActividad;
      DELETE g FROM dbo.GrupoPregunta g JOIN @Actividades a ON a.Id=g.IdActividad;
      DELETE p FROM dbo.Publicacion p JOIN @Actividades a ON a.Id=p.IdActividad;
      DELETE a FROM dbo.Actividad a JOIN @Actividades x ON x.Id=a.Id;

      DECLARE @PreguntasBanco TABLE (Id INT PRIMARY KEY);
      INSERT INTO @PreguntasBanco SELECT Id FROM dbo.BancoPregunta WHERE Titulo LIKE @Prefix;
      DELETE e FROM dbo.BancoPreguntaEtiqueta e JOIN @PreguntasBanco p ON p.Id=e.IdPregunta;
      DELETE gp FROM dbo.BancoGrupoPregunta gp JOIN @PreguntasBanco p ON p.Id=gp.IdPregunta;
      DELETE o FROM dbo.BancoOpcion o JOIN @PreguntasBanco p ON p.Id=o.IdPregunta;
      DELETE p FROM dbo.BancoPregunta p JOIN @PreguntasBanco x ON x.Id=p.Id;

      ${keyNames.length ? `DELETE FROM dbo.OperacionIdempotente WHERE Clave IN (${keyNames.join(',')});` : ''}
    `);
    await tx.commit();
    console.log('OK  Datos descartables eliminados');
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

async function logout() {
  if (!refreshToken) return;
  await request(app).post('/api/auth/logout')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ RefreshToken: refreshToken });
}

async function main() {
  console.log(`Marcador de ejecución: ${marker}`);
  await pool.connect();
  await verifyDatabaseGuard();
  const teacherId = await loginDocente();
  const commissionId = await selectCommission(teacherId);
  await testConcurrentReplay(commissionId);
  await testOptimisticRevision(commissionId);
  const activityId = await testPublishAgainstEdit(commissionId);
  await testRealRollback(activityId);
  await testDraftImportPublishReplay(commissionId);
  console.log('\nRESULTADO: todas las pruebas reales finalizaron correctamente.');
}

let failed = false;
main().catch(error => {
  failed = true;
  console.error('\nRESULTADO: FALLÓ EL HARNESS');
  console.error(error instanceof Error ? error.message : error);
}).finally(async () => {
  try {
    if (pool.connected) await cleanup();
  } catch (error) {
    failed = true;
    console.error(`No se pudo limpiar automáticamente. Marcador: ${marker}`);
    console.error(error instanceof Error ? error.message : error);
  }
  try {
    await logout();
  } catch {
    failed = true;
    console.error('No se pudo cerrar la sesión de prueba.');
  }
  if (pool.connected) await pool.close();
  process.exitCode = failed ? 1 : 0;
});
