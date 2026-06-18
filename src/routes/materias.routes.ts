import { Router } from 'express';
import {
  getAllMaterias,
  getMateriaById,
  createMateria,
  updateMateria,
  deleteMateria,
  getAlumnosPorMateria,
  asignarDivision,
  getComisionesPorMateria
} from '../controllers/materias.controller';
import { MateriaSchema } from '../schemas/materia.schema';
import { AsignarDivisionSchema } from '../schemas/comision.schema';
import { validateRequest } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', getAllMaterias);
router.get('/:id', getMateriaById);
router.post('/', validateRequest(MateriaSchema), createMateria);
router.put('/:id', validateRequest(MateriaSchema.partial()), updateMateria);
router.delete('/:id', deleteMateria);
router.get('/:id/alumnos', getAlumnosPorMateria);
router.post('/:id/division', validateRequest(AsignarDivisionSchema), asignarDivision);
router.get('/:id/comisiones', getComisionesPorMateria);

export default router;
