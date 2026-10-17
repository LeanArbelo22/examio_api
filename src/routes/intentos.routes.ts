import { Router } from 'express';
import { iniciarExamen, guardarRespuesta, finalizarExamen, getHistorialPorAlumno, getMisIntentos, getIntentosDetallados, getHistorialCorregido, getIntentoCompleto, calificarIntento, corregirRespuesta, anularPorIncidente, confirmarCorreccion } from '../controllers/intentos.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { IniciarExamenSchema, GuardarRespuestaSchema, CalificarSchema, CorregirRespuestaSchema } from '../schemas/intento.schema';
import { deletePermisoRevision, getRevisionDisponible, putPermisoRevision } from '../controllers/revision.controller';

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
router.get('/:idIntento/revision-disponible', checkRole(['admin', 'docente', 'alumno']), getRevisionDisponible);
router.put('/:idIntento/permiso-revision', checkRole(['admin', 'docente']), putPermisoRevision);
router.delete('/:idIntento/permiso-revision', checkRole(['admin', 'docente']), deletePermisoRevision);
router.put('/:idIntento/calificar', checkRole(['admin', 'docente']), validateRequest(CalificarSchema), calificarIntento);
router.put('/:idIntento/confirmar-correccion', checkRole(['admin', 'docente']), confirmarCorreccion);
router.put('/:idIntento/preguntas/:idPregunta/corregir', checkRole(['docente']), validateRequest(CorregirRespuestaSchema), corregirRespuesta);

export default router;
