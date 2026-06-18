import { Router } from 'express';
import { registrarAlerta, registrarNavegacion, getAlertasByIntento } from '../controllers/telemetria.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { AlertaSchema, NavegacionSchema } from '../schemas/telemetria.schema';

const router = Router();

router.post('/alerta', checkRole(['alumno', 'admin']), validateRequest(AlertaSchema), registrarAlerta);
router.get('/alerta/:idIntento', checkRole(['docente', 'admin']), getAlertasByIntento);
router.post('/navegacion', checkRole(['alumno', 'admin']), validateRequest(NavegacionSchema), registrarNavegacion);

export default router;
