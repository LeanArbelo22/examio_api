import { Router } from 'express';
import {
  getAllDivisiones,
  getDivisionById,
  createDivision,
  updateDivision,
  deleteDivision
} from '../controllers/divisiones.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { DivisionSchema } from '../schemas/division.schema';

const router = Router();

router.get('/', getAllDivisiones);
router.get('/:id', getDivisionById);
router.post('/', checkRole(['admin']), validateRequest(DivisionSchema), createDivision);
router.put('/:id', checkRole(['admin']), updateDivision);
router.delete('/:id', checkRole(['admin']), deleteDivision);

export default router;
