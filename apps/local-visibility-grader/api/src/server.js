import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';

import env from './config.js';
import { validateRecaptcha } from './recaptcha.js';
import {
  insertScan,
  getScan,
  upsertLead,
  markLeadVerified,
  getLeadByScan,
  updateScan
} from './supabase.js';
import { enqueueScanJob } from './queue.js';
import { startPhoneVerification, checkPhoneVerification } from './twilio.js';
import { upsertLeadToAirtable } from './airtable.js';
import { z } from 'zod';

const fastify = Fastify({
  logger: true
});

await fastify.register(helmet, {
  crossOriginResourcePolicy: false
});

await fastify.register(cors, {
  origin: env.corsOrigins.length ? env.corsOrigins : true
});

await fastify.register(rateLimit, {
  global: false,
  max: 60,
  timeWindow: '1 minute'
});

const scanStartSchema = z.object({
  businessName: z.string().min(2, 'Business name is required').max(120),
  city: z.string().max(80).optional(),
  address: z.string().max(255).optional(),
  cuisine: z.string().max(60).optional(),
  website: z.string().url().optional(),
  recaptchaToken: z.string().min(10, 'reCAPTCHA token is required'),
  contactName: z.string().max(120).optional(),
  email: z.string().email().optional()
});

const verifyStartSchema = z.object({
  scanId: z.string().uuid(),
  phone: z.string().min(7).max(20),
  name: z.string().max(120).optional(),
  business: z.string().max(120).optional()
});

const verifyCheckSchema = z.object({
  scanId: z.string().uuid(),
  phone: z.string().min(7).max(20),
  code: z.string().min(4).max(10)
});

function parseBusinessInput(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_err) {
    return {};
  }
}

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.post('/api/scan/start', async (request, reply) => {
  const payload = scanStartSchema.safeParse(request.body);

  if (!payload.success) {
    return reply.status(400).send({
      error: 'invalid_payload',
      details: payload.error.flatten().fieldErrors
    });
  }

  const body = payload.data;

  const recaptchaPassed = await validateRecaptcha(body.recaptchaToken);
  if (!recaptchaPassed) {
    return reply.status(400).send({ error: 'recaptcha_failed' });
  }

  const now = new Date().toISOString();
  const businessInput = {
    businessName: body.businessName,
    city: body.city ?? null,
    address: body.address ?? null,
    cuisine: body.cuisine ?? null,
    website: body.website ?? null,
    contactName: body.contactName ?? null,
    email: body.email ?? null
  };

  const scan = await insertScan({
    business_input: JSON.stringify(businessInput),
    place_id: null,
    lat: null,
    lng: null,
    city: body.city ?? null,
    cuisine: body.cuisine ?? null,
    status: 'queued',
    score: null,
    dollar_impact: null,
    issues_json: null,
    insights_json: null,
    score_breakdown_json: null,
    top_issues: null,
    created_at: now
  });

  await upsertLead({
    scan_id: scan.id,
    name: body.contactName ?? null,
    business: body.businessName,
    phone: null,
    verified: false,
    airtable_id: null,
    created_at: now
  });

  await enqueueScanJob(scan);

  return reply.status(202).send({
    scanId: scan.id,
    status: 'queued'
  });
});

fastify.get('/api/scan/:id', async (request, reply) => {
  const { id } = request.params;

  try {
    const scan = await getScan(id);
    const lead = await getLeadByScan(id).catch(() => null);

    return {
      scanId: scan.id,
      status: scan.status,
      score: scan.score,
      dollarImpact: scan.dollar_impact,
      issues: scan.issues_json,
      insights: scan.insights_json,
      scoreBreakdown: scan.score_breakdown_json,
      topIssues: scan.top_issues,
      completedAt: scan.completed_at ?? null,
      verified: Boolean(lead?.verified)
    };
  } catch (error) {
    request.log.error(error, 'Failed to load scan');
    return reply.status(404).send({ error: 'not_found' });
  }
});

fastify.post('/api/verify/start', async (request, reply) => {
  const payload = verifyStartSchema.safeParse(request.body);

  if (!payload.success) {
    return reply.status(400).send({
      error: 'invalid_payload',
      details: payload.error.flatten().fieldErrors
    });
  }

  const body = payload.data;

  try {
    const scan = await getScan(body.scanId);
    const business = parseBusinessInput(scan.business_input);

    await upsertLead({
      scan_id: scan.id,
      phone: body.phone,
      name: body.name ?? business.contactName ?? null,
      business: body.business ?? business.businessName ?? null,
      verified: false
    });

    const status = await startPhoneVerification(body.phone);

    return reply.send({ status });
  } catch (error) {
    request.log.error(error, 'Failed to start verification');
    return reply.status(400).send({ error: 'verification_failed' });
  }
});

fastify.post('/api/verify/check', async (request, reply) => {
  const payload = verifyCheckSchema.safeParse(request.body);

  if (!payload.success) {
    return reply.status(400).send({
      error: 'invalid_payload',
      details: payload.error.flatten().fieldErrors
    });
  }

  const body = payload.data;

  try {
    const approved = await checkPhoneVerification(body.phone, body.code);

    if (!approved) {
      return reply.status(401).send({ error: 'code_invalid' });
    }

    const scan = await getScan(body.scanId);
    const lead = await markLeadVerified(scan.id, {
      phone: body.phone,
      verified: true
    });

    const token = crypto.randomBytes(24).toString('base64url');
    const tokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString();

    const reportBase = env.PUBLIC_ORIGIN ?? 'https://arugami.com';
    const reportUrl = `${reportBase.replace(/\/$/, '')}/report/${scan.id}?t=${token}`;

    await upsertLeadToAirtable({
      ...lead,
      report_url: reportUrl
    }).catch((err) => {
      request.log.warn(err, 'Failed to sync Airtable');
    });

    await updateScan(scan.id, {
      status: scan.status === 'done' ? 'done' : 'awaiting_report_access',
      report_token: token,
      report_token_expires_at: tokenExpiresAt
    }).catch((err) => {
      request.log.warn(err, 'Failed to update scan status after verification');
    });

    return reply.send({
      accessToken: token,
      reportUrl,
      expiresAt: tokenExpiresAt
    });
  } catch (error) {
    request.log.error(error, 'Failed to verify code');
    return reply.status(400).send({ error: 'verification_failed' });
  }
});

fastify.get('/report/:id', async (request, reply) => {
  const { id } = request.params;
  const token = request.query?.t;

  try {
    const scan = await getScan(id);

    if (!token || scan.report_token !== token) {
      return reply.status(401).send('Unauthorized');
    }

    if (scan.report_token_expires_at && new Date(scan.report_token_expires_at) < new Date()) {
      return reply.status(401).send('Link expired');
    }

    return reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8" /><title>Local Visibility Report</title></head><body><pre>${JSON.stringify({
      score: scan.score,
      issues: scan.issues_json,
      insights: scan.insights_json
    }, null, 2)}</pre></body></html>`);
  } catch (error) {
    request.log.error(error, 'Failed to render report');
    return reply.status(404).send('Report not found');
  }
});

fastify.listen({
  host: env.host,
  port: env.port
}).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
