import { z } from 'zod';

export const LoginSchema = z.object({
  Email: z.string().email().max(150),
  Password: z.string().min(1),
});

export const RefreshSchema = z.object({
  RefreshToken: z.string().min(1),
});

export const LogoutSchema = z.object({
  RefreshToken: z.string().min(1),
});

export const IdempotencyKeySchema = z.string().uuid();
