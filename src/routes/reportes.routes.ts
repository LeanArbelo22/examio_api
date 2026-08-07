import { Router } from 'express';
import { getRendimiento, getRendimientoEvaluaciones } from '../controllers/reportes.controller';
import { checkRole } from '../middlewares/auth.middleware';

const router = Router();

router.get('/rendimiento', checkRole(['admin', 'docente']), getRendimiento);
router.get('/rendimiento-evaluaciones', checkRole(['admin', 'docente']), getRendimientoEvaluaciones);

export default router;
