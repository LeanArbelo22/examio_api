import { Router } from 'express';
import {
  getAllDocentes,
  getDocenteByLegajo,
  createDocente,
  updateDocente,
  deleteDocente,
  getComisionesByDocente,
  getDocentesByEstado,
  asignarComision,
  getMateriasByDocente,
  getEvaluacionesByDocente
} from '../controllers/docentes.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { DocenteSchema } from '../schemas/academico.schema';
import { AsignarComisionSchema } from '../schemas/comision.schema';

const router = Router();

router.get('/', checkRole(['admin', 'docente']), getAllDocentes);
router.get('/:legajo', checkRole(['admin', 'docente']), getDocenteByLegajo);
router.post('/', checkRole(['admin']), validateRequest(DocenteSchema), createDocente);
router.put('/:legajo', checkRole(['admin']), validateRequest(DocenteSchema.partial()), updateDocente);
router.delete('/:legajo', checkRole(['admin']), deleteDocente);
router.get('/:legajo/comisiones', checkRole(['admin', 'docente']), getComisionesByDocente);
router.get('/estado/:estado', checkRole(['admin']), getDocentesByEstado);
router.post('/:legajo/asignar', checkRole(['admin']), validateRequest(AsignarComisionSchema), asignarComision);
router.get('/:legajo/materias', checkRole(['admin', 'docente']), getMateriasByDocente);
router.get('/:legajo/evaluaciones', checkRole(['admin', 'docente']), getEvaluacionesByDocente);

export default router;
