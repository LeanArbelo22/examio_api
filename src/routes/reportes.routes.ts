import { Router } from 'express';
import {
  getRendimiento,
  getRendimientoEvaluaciones,
  getRendimientoGrupos,
  getRendimientoOpciones,
  getRendimientoPreguntas,
} from '../controllers/reportes.controller';
import { checkRole } from '../middlewares/auth.middleware';

const router = Router();

router.get('/rendimiento', checkRole(['admin', 'docente']), getRendimiento);
router.get('/rendimiento-evaluaciones', checkRole(['admin', 'docente']), getRendimientoEvaluaciones);
router.get('/rendimiento-preguntas', checkRole(['admin', 'docente']), getRendimientoPreguntas);
router.get('/rendimiento-grupos', checkRole(['admin', 'docente']), getRendimientoGrupos);
router.get('/rendimiento-preguntas/:idPregunta/opciones', checkRole(['admin', 'docente']), getRendimientoOpciones);

export default router;
