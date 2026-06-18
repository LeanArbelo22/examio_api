import { Router } from 'express';
import {
  getAllComisiones,
  getAlumnosPorComision
} from '../controllers/comisiones.controller';

const router = Router();

router.get('/', getAllComisiones);
router.get('/:id/alumnos', getAlumnosPorComision);

export default router;
