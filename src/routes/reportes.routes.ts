import { Router } from 'express';
import { getRendimiento } from '../controllers/reportes.controller';
import { checkRole } from '../middlewares/auth.middleware';

const router = Router();

router.get('/rendimiento', checkRole(['admin', 'docente']), getRendimiento);

export default router;
