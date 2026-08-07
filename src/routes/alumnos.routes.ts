import { Router } from 'express';
import {
  getAllAlumnos,
  getAlumnoById,
  createAlumno,
  updateAlumno,
  deleteAlumno,
  getMateriasByAlumno,
  getEstadisticasAlumno,
  inscribirAlumno
} from '../controllers/alumnos.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { AlumnoSchema, InscripcionAlumnoSchema } from '../schemas/academico.schema';

const router = Router();

router.get('/', checkRole(['admin', 'docente']), getAllAlumnos);
router.get('/:matricula', checkRole(['admin', 'docente', 'alumno']), getAlumnoById);
router.post('/', checkRole(['admin']), validateRequest(AlumnoSchema), createAlumno);
router.put('/:matricula', checkRole(['admin']), validateRequest(AlumnoSchema.partial()), updateAlumno);
router.delete('/:matricula', checkRole(['admin']), deleteAlumno);
router.post(
  '/:matricula/inscripciones',
  checkRole(['admin']),
  validateRequest(InscripcionAlumnoSchema),
  inscribirAlumno
);
router.get('/:matricula/materias', checkRole(['admin', 'docente', 'alumno']), getMateriasByAlumno);
router.get('/:matricula/estadisticas', checkRole(['admin', 'docente', 'alumno']), getEstadisticasAlumno);

export default router;
