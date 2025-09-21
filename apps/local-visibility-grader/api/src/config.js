import 'dotenv/config';
import { z } from 'zod';

const bool = (value) => value === 'true' || value === '1';

const envSchema = z.object({
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_ORIGIN: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().url(),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_VERIFY_SERVICE_SID: z.string().min(1),
  RECAPTCHA_SECRET: z.string().min(1),
  AIRTABLE_API_KEY: z.string().min(1),
  AIRTABLE_BASE_ID: z.string().min(1),
  AIRTABLE_TABLE_NAME: z.string().default('Leads'),
  SERPAPI_KEY: z.string().optional(),
  PSI_API_KEY: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  ENABLE_LOG_REQUESTS: z.string().optional()
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
  enableLogRequests: bool(parsed.data.ENABLE_LOG_REQUESTS ?? 'false')
};

export default env;
