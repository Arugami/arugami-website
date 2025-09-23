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

const placeSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query is required').max(120),
  limit: z.coerce.number().int().min(1).max(8).optional()
});

const PLACES_API_BASE = 'https://places.googleapis.com/v1';

function parseBusinessInput(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_err) {
    return {};
  }
}

fastify.get('/health', async () => ({ status: 'ok' }));

const HUDSON_BOUNDS = {
  minLat: 40.646,
  maxLat: 40.808,
  minLng: -74.153,
  maxLng: -73.977
};

function isWithinHudsonCounty(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  return lat >= HUDSON_BOUNDS.minLat && lat <= HUDSON_BOUNDS.maxLat && lng >= HUDSON_BOUNDS.minLng && lng <= HUDSON_BOUNDS.maxLng;
}

function pickAddressComponent(components, types) {
  if (!Array.isArray(components)) return null;
  for (const type of types) {
    const match = components.find((component) => component.types?.includes(type));
    if (match) return match.long_name ?? match.longText ?? null;
  }
  return null;
}

function deriveCategory(types = []) {
  if (!Array.isArray(types) || !types.length) return null;
  const preferred = types
    .filter((type) => !['point_of_interest', 'establishment', 'food'].includes(type))
    .slice(0, 2)
    .map((type) => type.replace(/_/g, ' '))
    .map((type) => type.replace(/\b([a-z])/g, (match) => match.toUpperCase()))
    .join(' · ');
  return preferred || null;
}

function normalizeAddressComponents(components) {
  if (!Array.isArray(components)) return [];
  return components.map((component) => ({
    long_name: component.long_name ?? component.longText ?? null,
    short_name: component.short_name ?? component.shortText ?? null,
    types: component.types ?? []
  }));
}

function extractPlaceId(resource) {
  if (!resource) return null;
  if (resource.id) return resource.id;
  if (typeof resource.name === 'string') {
    const parts = resource.name.split('/');
    return parts[parts.length - 1];
  }
  return null;
}

function normalizeSearchPlace(place) {
  if (!place) return null;
  const placeId = extractPlaceId(place);
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;

  return {
    place_id: placeId,
    name: place.displayName?.text ?? place.displayName ?? null,
    formatted_address: place.formattedAddress ?? null,
    address_components: normalizeAddressComponents(place.addressComponents),
    geometry:
      typeof latitude === 'number' && typeof longitude === 'number'
        ? { location: { lat: latitude, lng: longitude } }
        : undefined,
    types: place.types ?? [],
    rating: place.rating ?? null,
    user_ratings_total: place.userRatingCount ?? null,
    website: place.websiteUri ?? null
  };
}

function normalizePlaceDetails(details) {
  if (!details) return {};
  const latitude = details.location?.latitude;
  const longitude = details.location?.longitude;

  return {
    place_id: extractPlaceId(details),
    name: details.displayName?.text ?? details.displayName ?? null,
    formatted_address: details.formattedAddress ?? null,
    formatted_phone_number: details.nationalPhoneNumber ?? details.formattedPhoneNumber ?? null,
    international_phone_number: details.internationalPhoneNumber ?? null,
    website: details.websiteUri ?? details.website ?? null,
    url: details.googleMapsUri ?? details.url ?? null,
    address_components: normalizeAddressComponents(details.addressComponents),
    types: details.types ?? [],
    rating: details.rating ?? null,
    user_ratings_total: details.userRatingCount ?? null,
    price_level: details.priceLevel ?? null,
    opening_hours: details.regularOpeningHours
      ? {
          periods: details.regularOpeningHours.periods ?? null,
          weekday_text: details.regularOpeningHours.weekdayDescriptions ?? []
        }
      : null,
    reservable: details.reservable ?? null,
    delivery: details.delivery ?? null,
    photos: details.photos ?? [],
    geometry:
      typeof latitude === 'number' && typeof longitude === 'number'
        ? { location: { lat: latitude, lng: longitude } }
        : undefined
  };
}

async function callPlacesApi(endpoint, { method = 'GET', body, query, fieldMask } = {}, apiKey, signal) {
  const url = new URL(`${PLACES_API_BASE}/${endpoint}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    'X-Goog-Api-Key': apiKey
  };

  if (fieldMask) {
    headers['X-Goog-FieldMask'] = fieldMask;
  }

  const init = {
    method,
    headers,
    signal
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error('Google Places API request failed');
    error.status = response.status;
    error.detail = payload;
    throw error;
  }

  return payload;
}

async function fetchPlaceDetails(placeId, apiKey) {
  if (!apiKey || !placeId) return {};

  return callPlacesApi(
    `places/${placeId}`,
    {
      fieldMask:
        'id,displayName,formattedAddress,location,types,rating,userRatingCount,websiteUri,googleMapsUri,nationalPhoneNumber,internationalPhoneNumber,regularOpeningHours,addressComponents,priceLevel,reservable,delivery,photos'
    },
    apiKey
  );
}

function mapPlaceResult(rawPlace, rawDetails = {}) {
  const place = normalizeSearchPlace(rawPlace) ?? rawPlace;
  const details = normalizePlaceDetails(rawDetails);

  const addressComponents = details.address_components ?? place.address_components ?? [];
  const city =
    pickAddressComponent(addressComponents, ['locality']) ??
    pickAddressComponent(addressComponents, ['postal_town']) ??
    pickAddressComponent(addressComponents, ['administrative_area_level_2']) ??
    null;
  const neighborhood =
    pickAddressComponent(addressComponents, ['neighborhood']) ??
    pickAddressComponent(addressComponents, ['sublocality_level_1']) ??
    pickAddressComponent(addressComponents, ['sublocality']) ??
    null;

  const lat = place.geometry?.location?.lat ?? null;
  const lng = place.geometry?.location?.lng ?? null;

  return {
    inputValue: city ? `${place.name} ${city}` : place.name,
    name: place.name,
    city,
    neighborhood,
    category: deriveCategory(place.types),
    website: details.website ?? place.website ?? null,
    placeId: place.place_id,
    address: place.formatted_address ?? details.formatted_address ?? null,
    lat,
    lng,
    rating: place.rating ?? details.rating ?? null,
    ratingsTotal: place.user_ratings_total ?? details.user_ratings_total ?? null,
    withinHudsonCounty: isWithinHudsonCounty(lat, lng)
  };
}

const SAMPLE_PLACES = [
  {
    inputValue: 'Ani Ramen Jersey City',
    name: 'Ani Ramen',
    city: 'Jersey City, NJ',
    neighborhood: 'Newark Ave Arts District',
    category: 'Ramen · Japanese',
    website: 'https://aniramen.com',
    placeId: 'sample-ani-ramen-jc',
    address: '218 Newark Ave, Jersey City, NJ 07302',
    lat: 40.7214,
    lng: -74.0446,
    rating: 4.5,
    ratingsTotal: 2412,
    withinHudsonCounty: true
  },
  {
    inputValue: 'Bread & Salt Jersey City',
    name: 'Bread & Salt',
    city: 'Jersey City, NJ',
    neighborhood: 'The Heights',
    category: 'Bakery · Italian',
    website: 'https://breadandsalt.com',
    placeId: 'sample-bread-salt-jc',
    address: '435 Palisade Ave, Jersey City, NJ 07307',
    lat: 40.747,
    lng: -74.0459,
    rating: 4.7,
    ratingsTotal: 682,
    withinHudsonCounty: true
  },
  {
    inputValue: 'Los Cuernos Jersey City',
    name: 'Los Cuernos Mexican Kitchen',
    city: 'Jersey City, NJ',
    neighborhood: 'Harsimus Cove',
    category: 'Mexican · Cantina',
    website: 'https://loscuernos.com',
    placeId: 'sample-los-cuernos-jc',
    address: '499 Washington Blvd, Jersey City, NJ 07310',
    lat: 40.7261,
    lng: -74.0369,
    rating: 4.4,
    ratingsTotal: 1820,
    withinHudsonCounty: true
  }
];

fastify.get(
  '/api/places/search',
  {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute'
      }
    }
  },
  async (request, reply) => {
    const parsedQuery = placeSearchQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'invalid_query',
        details: parsedQuery.error.flatten().fieldErrors
      });
    }

    const { q, limit = 5 } = parsedQuery.data;
    const apiKey = env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return reply.status(200).send({
        results: SAMPLE_PLACES.slice(0, limit),
        fallback: true
      });
    }

    try {
      const maxResultCount = Math.min(limit * 2, 20);

      const payload = await callPlacesApi(
        'places:searchText',
        {
          method: 'POST',
          fieldMask: 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount',
          body: {
            textQuery: q,
            regionCode: 'US',
            languageCode: 'en',
            includedTypes: ['restaurant'],
            maxResultCount
          }
        },
        apiKey
      );

      const results = Array.isArray(payload.places) ? payload.places.slice(0, maxResultCount) : [];

      const mapped = await Promise.all(
        results.slice(0, limit).map(async (place) => {
          try {
            const placeId = extractPlaceId(place);
            if (!placeId) {
              return mapPlaceResult(place);
            }

            const details = await fetchPlaceDetails(placeId, apiKey);
            return mapPlaceResult(place, details);
          } catch (error) {
            request.log.warn(
              {
                error: error?.message,
                placeId: extractPlaceId(place),
                detail: error?.detail?.error ?? null
              },
              'Failed to load place details'
            );
            return mapPlaceResult(place);
          }
        })
      );

      const hudsonResults = mapped.filter((item) => item.withinHudsonCounty);
      const finalResults = (hudsonResults.length ? hudsonResults : mapped).slice(0, limit);

      if (!finalResults.length) {
        return reply.status(200).send({ results: SAMPLE_PLACES.slice(0, limit), fallback: true });
      }

      return reply.status(200).send({ results: finalResults, fallback: false });
    } catch (error) {
      request.log.error(error, 'Failed to search places');
      return reply.status(502).send({ error: 'places_error', message: 'Could not query Google Places.' });
    }
  }
);

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
