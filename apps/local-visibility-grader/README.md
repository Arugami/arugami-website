# Local Visibility Grader

Execution plan implementation for the restaurant-focused grader that powers `/grader` on arugami.com.

## Apps

- `api/` — Fastify REST API deployed on Railway. Handles scan creation, polling, Twilio Verify, Airtable sync, and report tokenization.
- `worker/` — BullMQ worker deployed on Railway. Pulls Google Business Profile, competitor, and PageSpeed data, then scores the scan.
- `supabase/` — SQL migration for the Supabase project backing the grader.

## Environment variables

Shared between API + worker:

| key | notes |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (API bypasses RLS) |
| `REDIS_URL` | Redis connection string from Railway |
| `GOOGLE_MAPS_API_KEY` | Google Maps Places/Details/Nearby |
| `PSI_API_KEY` | PageSpeed Insights key |
| `SERPAPI_KEY` | Optional. Enables ranking scans in Sprint 2 |

API-only:

| key | notes |
| --- | --- |
| `PORT` | defaults to 3000 locally |
| `HOST` | defaults to `0.0.0.0` |
| `PUBLIC_ORIGIN` | Base URL used when generating report links |
| `CORS_ORIGINS` | CSV allow-list of origins (eg. `https://arugami.com,https://*.pages.dev`) |
| `TWILIO_ACCOUNT_SID` | Twilio Verify |
| `TWILIO_AUTH_TOKEN` | Twilio Verify |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service |
| `RECAPTCHA_SECRET` | reCAPTCHA server-side secret |
| `AIRTABLE_API_KEY` | Airtable API token |
| `AIRTABLE_BASE_ID` | Airtable base (Leads workspace) |
| `AIRTABLE_TABLE_NAME` | Defaults to `Leads` |
| `ENABLE_LOG_REQUESTS` | Optional toggle for verbose request logging |

Worker-only:

| key | notes |
| --- | --- |
| `WORKER_CONCURRENCY` | Defaults to 1. Increase cautiously.

## Local development

1. Create `.env` files inside `api/` and `worker/` (see `.env.example` below).
2. Run Supabase migration against a local instance or the hosted project:
   ```bash
   psql "$SUPABASE_DATABASE_URL" -f supabase/0001_local_visibility_grader.sql
   ```
3. Install dependencies:
   ```bash
   (cd api && npm install)
   (cd worker && npm install)
   ```
4. Start services:
   ```bash
   (cd api && npm run dev)
   (cd worker && npm run dev)
   ```
5. In `arugami-website/.env`, set `PUBLIC_API_BASE=http://localhost:3000` and `PUBLIC_RECAPTCHA_SITE_KEY` (use reCAPTCHA test key if needed).

### `.env.example` (API)

```
PORT=3000
HOST=0.0.0.0
PUBLIC_ORIGIN=https://grader.arugami.com
CORS_ORIGINS=https://arugami.com,https://*.pages.dev
SUPABASE_URL=... 
SUPABASE_SERVICE_ROLE_KEY=...
REDIS_URL=redis://... 
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=...
RECAPTCHA_SECRET=...
AIRTABLE_API_KEY=...
AIRTABLE_BASE_ID=...
AIRTABLE_TABLE_NAME=Leads
GOOGLE_MAPS_API_KEY=...
PSI_API_KEY=...
SERPAPI_KEY=
ENABLE_LOG_REQUESTS=false
```

### `.env.example` (Worker)

```
REDIS_URL=redis://...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_MAPS_API_KEY=...
PSI_API_KEY=...
SERPAPI_KEY=
WORKER_CONCURRENCY=1
```

## Cloudflare Pages configuration

Set the following build-time environment variables for the Astro site:

```
PUBLIC_API_BASE=https://<railway-api-host>
PUBLIC_RECAPTCHA_SITE_KEY=<reCAPTCHA site key>
```

## Remaining work

- Hook SerpApi (Sprint 2) for organic + map ranking scores.
- Replace placeholder HTML report with designed template + optional PDF.
- Wire Sentry/analytics, error reporting, and retry policies.
- Harden Airtable sync with upsert + dedupe strategy.
- Add budgets and usage guardrails (daily caps, radius throttling).
