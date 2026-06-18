import { Router } from 'express';
import {
  getAllCarreras,
  getCarreraById,
  createCarrera,
  updateCarrera,
  deleteCarrera,
  getPlanDeEstudios,
  getAlumnosInscriptos
} from '../controllers/carreras.controller';
import { CarreraSchema } from '../schemas/academico.schema';
import { validateRequest } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', getAllCarreras);
router.get('/:id', getCarreraById);
router.post('/', validateRequest(CarreraSchema), createCarrera);
router.put('/:id', validateRequest(CarreraSchema.partial()), updateCarrera);
router.delete('/:id', deleteCarrera);
router.get('/:id/plan', getPlanDeEstudios);
router.get('/:id/alumnos', getAlumnosInscriptos);

export default router;
