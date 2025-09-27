if (process.env.NODE_ENV !== 'production') {
  await import('dotenv/config');
}
import { z } from 'zod';

const bool = (value) => value === 'true' || value === '1';

const envSchema = z.object({
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_ORIGIN: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  RECAPTCHA_SECRET: z.string().optional(),
  AIRTABLE_API_KEY: z.string().optional(),
  AIRTABLE_BASE_ID: z.string().optional(),
  AIRTABLE_TABLE_NAME: z.string().default('Leads'),
  SERPAPI_KEY: z.string().optional(),
  PSI_API_KEY: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  ENABLE_LOG_REQUESTS: z.string().optional(),
  VERIFY_DISABLED: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Missing or invalid environment variables.');
}

const env = {
  ...parsed.data,
  port: parseInt(parsed.data.PORT, 10),
  host: parsed.data.HOST,
  corsOrigins: parsed.data.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [],
  enableLogRequests: bool(parsed.data.ENABLE_LOG_REQUESTS ?? 'false'),
  verifyDisabled: bool(parsed.data.VERIFY_DISABLED ?? 'false')
};

export default env;
