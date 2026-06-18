import { Router } from 'express';
import {
  getAllUsuarios,
  createUsuario,
  updateUsuario,
  deleteUsuario
} from '../controllers/usuarios.controller';
import { checkRole, validateRequest } from '../middlewares/auth.middleware';
import { UsuarioSchema, UsuarioUpdateSchema } from '../schemas/usuario.schema';

const router = Router();

router.get('/', checkRole(['admin']), getAllUsuarios);
router.post('/', checkRole(['admin']), validateRequest(UsuarioSchema), createUsuario);
router.put('/:id', checkRole(['admin']), validateRequest(UsuarioUpdateSchema), updateUsuario);
router.delete('/:id', checkRole(['admin']), deleteUsuario);

export default router;
