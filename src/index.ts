import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db';

import adminRoutes from './routes/admin.routes';
import alumnosRoutes from './routes/alumnos.routes';
import authRoutes from './routes/auth.routes';
import carrerasRoutes from './routes/carreras.routes';
import comisionesRoutes from './routes/comisiones.routes';
import divisionesRoutes from './routes/divisiones.routes';
import docentesRoutes from './routes/docentes.routes';
import materiasRoutes from './routes/materias.routes';
import actasRoutes from './routes/actas.routes';
import evaluacionesRoutes from './routes/evaluaciones.routes';
import intentosRoutes from './routes/intentos.routes';
import telemetriaRoutes from './routes/telemetria.routes';
import usuariosRoutes from './routes/usuarios.routes';


const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ message: 'API Node.js Online' }));
app.use('/api/admin', adminRoutes);
app.use('/api/alumnos', alumnosRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/carreras', carrerasRoutes);
app.use('/api/comisiones', comisionesRoutes);
app.use('/api/divisiones', divisionesRoutes);
app.use('/api/docentes', docentesRoutes);
app.use('/api/materias', materiasRoutes);
app.use('/api/actas', actasRoutes);
app.use('/api/evaluaciones', evaluacionesRoutes);
app.use('/api/intentos', intentosRoutes);
app.use('/api/telemetria', telemetriaRoutes);
app.use('/api/usuarios', usuariosRoutes);

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});

export { app };
