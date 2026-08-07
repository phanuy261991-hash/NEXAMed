import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL là bắt buộc'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET phải có ít nhất 16 ký tự'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY phải có ít nhất 32 ký tự'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Cấu hình biến môi trường không hợp lệ:\n${details}`);
  }
  return result.data;
}