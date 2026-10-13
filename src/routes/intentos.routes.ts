import { Router } from 'express';
import { iniciarExamen, guardarRespuesta, finalizarExamen, getHistorialPorAlumno, getMisIntentos, getIntentosDetallados, getHistorialCorregido, getIntentoCompleto, calificarIntento, corregirRespuesta, anularPorIncidente, confirmarCorreccion } from '../controllers/intentos.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { IniciarExamenSchema, GuardarRespuestaSchema, CalificarSchema, CorregirRespuestaSchema } from '../schemas/intento.schema';

const router = Router();

router.post('/iniciar', checkRole(['alumno', 'admin']), validateRequest(IniciarExamenSchema), iniciarExamen);
router.post('/guardar-respuesta', checkRole(['alumno', 'admin']), validateRequest(GuardarRespuestaSchema), guardarRespuesta);
router.post('/:id/finalizar', checkRole(['alumno', 'admin']), finalizarExamen);
router.put('/:idIntento/anular-por-incidente/:eventoId', checkRole(['alumno', 'admin']), anularPorIncidente);
router.get('/mios', checkRole(['alumno']), getMisIntentos);
router.get('/alumno/:idAlumno', checkRole(['alumno', 'admin', 'docente']), getHistorialPorAlumno);
router.get('/alumno/:idAlumno/detallados', checkRole(['alumno', 'admin', 'docente']), getIntentosDetallados);
router.get('/alumno/:idAlumno/historial-corregido', checkRole(['alumno', 'admin', 'docente']), getHistorialCorregido);
router.get('/:idIntento/completo', checkRole(['admin', 'docente', 'alumno']), getIntentoCompleto);
router.put('/:idIntento/calificar', checkRole(['admin', 'docente']), validateRequest(CalificarSchema), calificarIntento);
router.put('/:idIntento/confirmar-correccion', checkRole(['admin', 'docente']), confirmarCorreccion);
router.put('/:idIntento/preguntas/:idPregunta/corregir', checkRole(['docente']), validateRequest(CorregirRespuestaSchema), corregirRespuesta);

export default router;
