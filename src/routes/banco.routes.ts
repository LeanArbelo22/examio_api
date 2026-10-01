import { Router } from 'express';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { recursoBanco, etiquetasBanco, guardarDesdeEvaluacion, guardarGrupoDesdeContenido } from '../controllers/banco.controller';
import { PreguntaBancoSchema, PreguntaBancoUpdateSchema, GrupoBancoSchema, GrupoBancoUpdateSchema,
  EstadoBancoUpdateSchema, EtiquetaBancoSchema, DesdeEvaluacionSchema, GrupoDesdeContenidoSchema } from '../schemas/banco.schema';

const router = Router();
for (const recurso of ['preguntas','grupos'] as const) {
  router.get(`/${recurso}`, checkRole(['docente','admin']), recursoBanco(recurso,'listar'));
  router.get(`/${recurso}/:id`, checkRole(['docente','admin']), recursoBanco(recurso,'detalle'));
  router.post(`/${recurso}`, checkRole(['docente']), validateRequest(recurso === 'preguntas' ? PreguntaBancoSchema : GrupoBancoSchema), recursoBanco(recurso,'crear'));
  router.put(`/${recurso}/:id`, checkRole(['docente']), validateRequest(recurso === 'preguntas' ? PreguntaBancoUpdateSchema : GrupoBancoUpdateSchema), recursoBanco(recurso,'editar'));
  router.patch(`/${recurso}/:id/estado`, checkRole(['docente']), validateRequest(EstadoBancoUpdateSchema), recursoBanco(recurso,'estado'));
}
router.post('/grupos/desde-contenido', checkRole(['docente']), validateRequest(GrupoDesdeContenidoSchema), guardarGrupoDesdeContenido);
router.get('/etiquetas', checkRole(['docente','admin']), etiquetasBanco('listar'));
router.post('/etiquetas', checkRole(['docente']), validateRequest(EtiquetaBancoSchema), etiquetasBanco('crear'));
router.put('/etiquetas/:id', checkRole(['docente']), validateRequest(EtiquetaBancoSchema), etiquetasBanco('editar'));
router.delete('/etiquetas/:id', checkRole(['docente']), etiquetasBanco('eliminar'));
router.post('/desde-evaluacion', checkRole(['docente']), validateRequest(DesdeEvaluacionSchema), guardarDesdeEvaluacion);
export default router;
