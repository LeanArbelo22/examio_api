import { Router } from 'express';
import { 
  guardarEvaluacionCompleta, 
  modificarEvaluacionCompleta,
  publicarEvaluacionCompleta,
  obtenerExamenSorteado, 
  obtenerOpcionesPregunta,
  actualizarEstadoEvaluacion,
  obtenerPendientesPorAlumno,
  obtenerPublicacionPorId,
  getDetallePublicacion,
  getAlumnosByPublicacion,
  listarIntentosAlumnoPublicacion,
  seleccionarIntentoValidoAlumno,
  eliminarIntentoValidoAlumno
} from '../controllers/evaluaciones.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { ActividadSchema, ActividadUpdateSchema, PublicarActividadSchema, SeleccionarIntentoValidoSchema } from '../schemas/evaluacion.schema';
import { ImportarBancoSchema } from '../schemas/banco.schema';
import { importarBanco } from '../controllers/banco.controller';

const router = Router();
router.post('/:id/importar-banco', checkRole(['docente']), validateRequest(ImportarBancoSchema), importarBanco);

router.put('/:id/modificar-completo', checkRole(['admin', 'docente']), validateRequest(ActividadUpdateSchema), modificarEvaluacionCompleta);
router.post('/guardar-completo', checkRole(['admin', 'docente']), validateRequest(ActividadSchema), guardarEvaluacionCompleta);
router.post('/:idActividad/publicar-completo', checkRole(['admin', 'docente']), validateRequest(PublicarActividadSchema), publicarEvaluacionCompleta);
router.put('/:id/estado', checkRole(['admin', 'docente']), actualizarEstadoEvaluacion);
router.get('/intento/:idIntento/renderizar', checkRole(['alumno', 'admin', 'docente']), obtenerExamenSorteado);
router.get('/pregunta/:idPregunta/opciones/:idIntento', checkRole(['alumno', 'admin', 'docente']), obtenerOpcionesPregunta);
router.get('/publicacion/:id', checkRole(['alumno', 'admin', 'docente']), obtenerPublicacionPorId);
router.get('/pendientes/:matricula', checkRole(['alumno', 'admin', 'docente']), obtenerPendientesPorAlumno);
router.get('/publicaciones/:idPublicacion/alumnos/:matricula/intentos', checkRole(['alumno', 'admin', 'docente']), listarIntentosAlumnoPublicacion);
router.put('/publicaciones/:idPublicacion/alumnos/:matricula/intento-valido', checkRole(['admin', 'docente']), validateRequest(SeleccionarIntentoValidoSchema), seleccionarIntentoValidoAlumno);
router.delete('/publicaciones/:idPublicacion/alumnos/:matricula/intento-valido', checkRole(['admin', 'docente']), eliminarIntentoValidoAlumno);
router.get('/:id/detalle', checkRole(['admin', 'docente']), getDetallePublicacion);
router.get('/:id/alumnos', checkRole(['admin', 'docente']), getAlumnosByPublicacion);

export default router;
