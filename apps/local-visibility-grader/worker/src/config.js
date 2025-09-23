import { z } from 'zod';

// Load dotenv in non-production environments
if (process.env.NODE_ENV !== 'production') {
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch (error) {
    console.warn('Failed to load dotenv:', error.message);
  }
}

const envSchema = z.object({
  REDIS_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GOOGLE_MAPS_API_KEY: z.string().min(1),
  PSI_API_KEY: z.string().min(1),
  SERPAPI_KEY: z.string().optional(),
  WORKER_CONCURRENCY: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid worker environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Missing or invalid worker environment variables.');
}

const env = {
  ...parsed.data,
  concurrency: parsed.data.WORKER_CONCURRENCY ? parseInt(parsed.data.WORKER_CONCURRENCY, 10) : 1
};

export default env;
