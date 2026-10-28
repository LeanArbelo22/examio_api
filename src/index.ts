import dotenv from 'dotenv';
dotenv.config();
import { Server } from 'http';
import { app } from './app';
import { connectDB } from './config/db';
import { validateAuthConfig } from './config/auth.config';

const PORT = Number(process.env.PORT || 3000);

export const startServer = async (): Promise<Server> => {
  validateAuthConfig();
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`No se pudo iniciar Examio API: el puerto ${PORT} ya está ocupado.`);
    } else {
      console.error('No se pudo iniciar Examio API:', error);
    }
    process.exitCode = 1;
  });

  return server;
};

if (require.main === module) {
  void startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`No se pudo iniciar Examio API: ${message}`);
    process.exitCode = 1;
  });
}

export { app };
