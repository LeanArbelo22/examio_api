import { Router } from 'express';
import {
  registrarAlerta,
  registrarNavegacion,
  getAlertasByIntento,
  registrarIncidenteFoco,
  getResumenIncidentes,
  getIncidentesByIntento,
  registrarEventoTemporal,
  registrarEventosTemporalesLote,
  getEventosTemporales,
} from '../controllers/telemetria.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { AlertaSchema, IncidenteFocoSchema, NavegacionSchema } from '../schemas/telemetria.schema';

const router = Router();

router.post('/alerta', checkRole(['alumno', 'admin']), validateRequest(AlertaSchema), registrarAlerta);
router.get('/alerta/:idIntento', checkRole(['docente', 'admin']), getAlertasByIntento);
router.post('/navegacion', checkRole(['alumno', 'admin']), validateRequest(NavegacionSchema), registrarNavegacion);
router.put(
  '/intentos/:idIntento/incidentes/:eventoId',
  checkRole(['alumno', 'admin']),
  validateRequest(IncidenteFocoSchema),
  registrarIncidenteFoco,
);
router.get('/intentos/:idIntento/resumen', checkRole(['docente', 'admin']), getResumenIncidentes);
router.get('/intentos/:idIntento/incidentes', checkRole(['docente', 'admin']), getIncidentesByIntento);
router.put('/intentos/:idIntento/eventos/:eventoId', checkRole(['alumno', 'admin']), registrarEventoTemporal);
router.post('/intentos/:idIntento/eventos/lote', checkRole(['alumno', 'admin']), registrarEventosTemporalesLote);
router.get('/intentos/:idIntento/eventos', checkRole(['docente', 'admin']), getEventosTemporales);

export default router;
