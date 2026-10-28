import { Router } from 'express';
import { getContenidoRevision, postSesionRevision } from '../controllers/revision.controller';
import { checkRole } from '../middlewares/auth.middleware';

const router = Router();

router.post('/intentos/:idIntento/sesiones', checkRole(['alumno']), postSesionRevision);
router.get('/sesiones/:idSesion/contenido', checkRole(['alumno']), getContenidoRevision);

export default router;
