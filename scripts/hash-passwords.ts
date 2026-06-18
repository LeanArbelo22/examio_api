// @ts-nocheck
const dotenv = require('dotenv');
dotenv.config();

const sql = require('mssql');
const bcrypt = require('bcryptjs');

const dbConfig = {
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const BCRYPT_REGEX = /^\$2[aby]\$\d{2}\$/;
const SALT_ROUNDS = 10;

async function hashPasswords() {
  const pool = new sql.ConnectionPool(dbConfig);

  try {
    await pool.connect();
    console.log("▲ Conectado a SQL Server.\n");

    const result = await pool.request().query(`
      SELECT Id, Email, PasswordHash FROM Usuario ORDER BY Id
    `);

    const users = result.recordset;
    console.log(`→ ${users.length} usuario(s) encontrado(s).\n`);

    let hasheadas = 0;
    let omitidas = 0;

    for (const user of users) {
      const { Id, Email, PasswordHash } = user;

      if (BCRYPT_REGEX.test(PasswordHash)) {
        console.log(`  ⏭  [${Id}] ${Email} — ya es hash bcrypt, se omite.`);
        omitidas++;
        continue;
      }

      console.log(`  🔐 [${Id}] ${Email} — texto plano detectado, hasheando...`);

      const hash = bcrypt.hashSync(PasswordHash, SALT_ROUNDS);

      await pool.request()
        .input('Id', sql.Int, Id)
        .input('PasswordHash', sql.NVarChar, hash)
        .query('UPDATE Usuario SET PasswordHash = @PasswordHash WHERE Id = @Id');

      console.log(`  ✅ → hash actualizado.`);
      hasheadas++;
    }

    console.log(`\n── Resumen ──`);
    console.log(`  Hasheadas:  ${hasheadas}`);
    console.log(`  Omitidas:   ${omitidas}`);
    console.log(`  Total:      ${users.length}`);

    if (hasheadas > 0) {
      console.log(`\n✓ Listo. Las contraseñas en texto plano fueron reemplazadas por sus hashes bcrypt.`);
    } else {
      console.log(`\n✓ No había contraseñas en texto plano. Todo en orden.`);
    }
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  } finally {
    await pool.close();
  }
}

hashPasswords();
