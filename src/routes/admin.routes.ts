import { Router } from 'express';
import { getDashboardAnalitica } from '../controllers/admin.controller';
import { checkRole } from '../middlewares/auth.middleware';

const router = Router();

router.get('/dashboard/analitica', checkRole(['admin']), getDashboardAnalitica);

export default router;
