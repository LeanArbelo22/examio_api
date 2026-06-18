import { Router } from 'express';
import { crearActa, cargarDetalleActa, getAllActas, getActaById, cerrarActa } from '../controllers/actas.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { ActaSchema, DetalleActaSchema } from '../schemas/acta.schema';

const router = Router();

router.get('/', checkRole(['admin', 'docente']), getAllActas);
router.get('/:id', checkRole(['admin', 'docente']), getActaById);
router.put('/:id/cerrar', checkRole(['admin', 'docente']), cerrarActa);
router.post('/crear-cierre', checkRole(['admin', 'docente']), validateRequest(ActaSchema), crearActa);
router.post('/cargar-detalle', checkRole(['admin', 'docente']), validateRequest(DetalleActaSchema), cargarDetalleActa);

export default router;
