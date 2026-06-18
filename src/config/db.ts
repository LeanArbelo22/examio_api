import * as sql from 'mssql';

const dbConfig = {
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER || "localhost",
  port: parseInt(process.env.DB_PORT || "1433"),
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

export const pool = new sql.ConnectionPool(dbConfig);

export const connectDB = async () => {
  try {
    if (!pool.connected && !pool.connecting) {
      await pool.connect();
      console.log("▲ [SQL Server] Conexión exitosa y Pool inicializado correctamente.");
    }
    return pool;
  } catch (error) {
    console.error("❌ Error crítico en la conexión a la base de datos:", error);
    process.exit(1);
  }
};
