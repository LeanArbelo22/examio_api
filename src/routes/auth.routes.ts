import { Router } from 'express';
import { login, logout, refresh } from '../controllers/auth.controller';
import { validateRequest } from '../middlewares/auth.middleware';
import { loginRateLimit, refreshRateLimit } from '../middlewares/auth-rate-limit.middleware';
import { LoginSchema, LogoutSchema, RefreshSchema } from '../schemas/auth.schema';

const router = Router();

router.post('/login', loginRateLimit, validateRequest(LoginSchema), login);
router.post('/refresh', refreshRateLimit, validateRequest(RefreshSchema), refresh);
router.post('/logout', validateRequest(LogoutSchema), logout);

export default router;
