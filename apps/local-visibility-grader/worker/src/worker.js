import { Worker, QueueEvents } from 'bullmq';

import env from './config.js';
import { updateScan, insertCompetitors, isDuplicateScanError, markScanDuplicate } from './supabase.js';

const queueName = 'local-visibility-scan';

// Log environment info for debugging
console.log('Worker starting up...');
console.log('Node version:', process.version);
console.log('Environment:', process.env.NODE_ENV || 'development');

// Log REDIS_URL (masked) and validate presence before connecting
console.log('Worker REDIS_URL at runtime:', (env.REDIS_URL || '').replace(/\/\/.*@/, '//***@'));
if (!env.REDIS_URL) {
  console.error('REDIS_URL is missing or empty');
  throw new Error('Missing REDIS_URL environment variable');
}

if (!env.GOOGLE_MAPS_API_KEY) {
  console.error('GOOGLE_MAPS_API_KEY is missing or empty');
  throw new Error('Missing GOOGLE_MAPS_API_KEY environment variable');
}

console.log('Environment variables validated successfully');

// Initialize queue components
async function initializeWorker() {
  const queueEvents = new QueueEvents(queueName, {
    connection: {
      url: env.REDIS_URL
    }
  });
  await queueEvents.waitUntilReady();

  return { queueEvents };
}

const PLACES_API_BASE = 'https://places.googleapis.com/v1';
const EARTH_RADIUS_METERS = 6371000;

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
        : undefined,
    editorial_summary: details.editorialSummary
      ? {
          overview: details.editorialSummary.overview ?? null,
          review: details.editorialSummary.review ?? null
        }
      : null
  };
}

function calculateDistanceMeters(origin, target) {
  if (!origin || !target) return null;
  const { lat: lat1, lng: lng1 } = origin;
  const { lat: lat2, lng: lng2 } = target;

  if ([lat1, lng1, lat2, lng2].some((value) => typeof value !== 'number' || Number.isNaN(value))) {
    return null;
  }

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lng2 - lng1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function normalizeNearbyPlace(place, origin) {
  if (!place) return null;
  const latitude = place.location?.latitude ?? null;
  const longitude = place.location?.longitude ?? null;
  const targetLocation =
    typeof latitude === 'number' && typeof longitude === 'number'
      ? { lat: latitude, lng: longitude }
      : null;
  const distance = calculateDistanceMeters(origin, targetLocation);
  return {
    place_id: extractPlaceId(place),
    name: place.displayName?.text ?? place.displayName ?? null,
    rating: place.rating ?? null,
    user_ratings_total: place.userRatingCount ?? null,
    distance_m: Number.isFinite(distance) ? Math.round(distance) : null
  };
}

async function callPlacesApi(endpoint, { method = 'GET', body, query, fieldMask } = {}, signal) {
  const url = new URL(`${PLACES_API_BASE}/${endpoint}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY
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

function parseBusinessInput(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_err) {
    return {};
  }
}

async function resolvePlace(businessInput) {
  const queryParts = [businessInput.businessName, businessInput.city].filter(Boolean);
  const query = queryParts.join(', ');

  if (!query) return null;

  const payload = await callPlacesApi('places:searchText', {
    method: 'POST',
    fieldMask: 'places.id,places.displayName,places.formattedAddress,places.location',
    body: {
      textQuery: query,
      regionCode: 'US',
      languageCode: 'en',
      maxResultCount: 3
    }
  });

  const place = payload.places?.[0];
  if (!place) {
    return null;
  }

  return {
    placeId: extractPlaceId(place),
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    formattedAddress: place.formattedAddress ?? null
  };
}

async function fetchPlaceDetails(placeId) {
  const payload = await callPlacesApi(`places/${placeId}`, {
    fieldMask:
      'id,displayName,formattedAddress,location,types,rating,userRatingCount,websiteUri,googleMapsUri,nationalPhoneNumber,internationalPhoneNumber,regularOpeningHours,addressComponents,priceLevel,reservable,delivery,photos,editorialSummary'
  });

  return normalizePlaceDetails(payload);
}

async function fetchNearbyCompetitors({ lat, lng, excludePlaceId }) {
  if (typeof lat !== 'number' || Number.isNaN(lat) || typeof lng !== 'number' || Number.isNaN(lng)) {
    console.warn('Skipping competitor fetch due to missing coordinates', { lat, lng, excludePlaceId });
    return [];
  }

  const payload = await callPlacesApi('places:searchNearby', {
    method: 'POST',
    fieldMask: 'places.id,places.displayName,places.rating,places.userRatingCount,places.location',
    body: {
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: lat,
            longitude: lng
          },
          radius: 1500
        }
      }
    }
  });

  const origin = { lat, lng };
  const places = Array.isArray(payload.places) ? payload.places : [];
  return places
    .map((place) => normalizeNearbyPlace(place, origin))
    .filter((item) => item && item.place_id && item.place_id !== excludePlaceId);
}

async function fetchPageSpeedInsights(url) {
  if (!url) return null;
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('strategy', 'mobile');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('key', env.PSI_API_KEY);

  const res = await fetch(endpoint);
  if (!res.ok) {
    return null;
  }

  return res.json();
}

function calculateScore({ details, psi, competitors }) {
  const gbpScore = details?.opening_hours ? 20 : 8;
  const reviewScore = details?.rating ? Math.min(Math.round(details.rating * 3), 15) : 4;
  const photoScore = Array.isArray(details?.photos) ? Math.min(details.photos.length / 2, 10) : 3;
  const performanceScore = psi?.lighthouseResult?.categories?.performance?.score
    ? Math.round(psi.lighthouseResult.categories.performance.score * 15)
    : 6;
  const rankingScore = Math.min(competitors.length, 5) * 3;

  const breakdown = {
    gbp: gbpScore,
    reviews: reviewScore,
    photos: photoScore,
    performance: performanceScore,
    rankings: rankingScore
  };

  const rawTotal = Object.values(breakdown).reduce((sum, part) => sum + part, 0);
  const cappedTotal = Math.min(rawTotal, 100);

  return {
    total: Math.round(cappedTotal),
    breakdown,
    rawTotal
  };
}

async function persistCompetitors(scanId, competitors) {
  if (!competitors.length) return;

  const enriched = competitors.slice(0, 10).map((competitor, index) => ({
    scan_id: scanId,
    place_id: competitor.place_id ?? null,
    name: competitor.name ?? null,
    rating: competitor.rating ?? null,
    reviews: competitor.user_ratings_total ?? null,
    distance_m: competitor.distance_m ?? null,
    rank_map_pack: index + 1,
    rank_organic: null
  }));

  await insertCompetitors(enriched);
}

async function processScan(job) {
  const { scanId, businessInput, placeId: existingPlaceId } = job.data;
  const parsedInput = parseBusinessInput(businessInput);

  await updateScan(scanId, { status: 'resolving' });

  const resolved = existingPlaceId
    ? {
        placeId: existingPlaceId,
        lat: null,
        lng: null
      }
    : await resolvePlace(parsedInput);

  if (!resolved) {
    await updateScan(scanId, {
      status: 'failed',
      issues_json: [{ key: 'place_not_found', severity: 'high', label: 'Google Business Profile not found.' }]
    });
    return;
  }

  try {
    await updateScan(scanId, {
      status: 'details',
      place_id: resolved.placeId,
      lat: resolved.lat,
      lng: resolved.lng,
      city: parsedInput.city ?? null
    });
  } catch (error) {
    if (isDuplicateScanError(error)) {
      console.warn(`[scan:${scanId}] duplicate scan detected for place ${resolved.placeId}`);
      await markScanDuplicate(scanId);
      return;
    }
    throw error;
  }

  const details = await fetchPlaceDetails(resolved.placeId).catch((error) => {
    console.error('Failed to fetch place details', {
      message: error?.message,
      status: error?.status,
      detail: error?.detail
    });
    return null;
  });

  const detailLat = details?.geometry?.location?.lat ?? null;
  const detailLng = details?.geometry?.location?.lng ?? null;
  const resolvedLat = typeof resolved.lat === 'number' ? resolved.lat : detailLat;
  const resolvedLng = typeof resolved.lng === 'number' ? resolved.lng : detailLng;

  if (resolvedLat !== resolved.lat || resolvedLng !== resolved.lng) {
    await updateScan(scanId, {
      lat: resolvedLat,
      lng: resolvedLng
    }).catch((error) => console.error('Failed to update coordinates after details', error));
  }

  await updateScan(scanId, {
    status: 'competitors'
  });

  const competitors = await fetchNearbyCompetitors({
    lat: resolvedLat,
    lng: resolvedLng,
    excludePlaceId: resolved.placeId
  }).catch((error) => {
    const detail = error?.detail ? JSON.stringify(error.detail, null, 2) : null;
    console.error('Failed to fetch competitors', {
      payload: { lat: resolvedLat, lng: resolvedLng, excludePlaceId: resolved.placeId },
      message: error?.message,
      status: error?.status,
      detail
    });
    return [];
  });

  await persistCompetitors(scanId, competitors);

  await updateScan(scanId, {
    status: 'performance'
  });

  const psi = await fetchPageSpeedInsights(details?.website).catch((error) => {
    console.error('PSI fetch failed', error);
    return null;
  });

  await updateScan(scanId, {
    status: 'scoring'
  });

  const { total, breakdown } = calculateScore({ details, psi, competitors });

  const issues = [];
  if (!details?.opening_hours) {
    issues.push({ key: 'hours_missing', label: 'Add operating hours to your Google Business Profile.', weight: 8 });
  }
  if (!details?.website) {
    issues.push({ key: 'website_missing', label: 'Add your website to your Google Business Profile.', weight: 10 });
  }

  await updateScan(scanId, {
    status: 'done',
    score: total,
    score_breakdown_json: breakdown,
    issues_json: issues,
    top_issues: issues.slice(0, 3),
    insights_json: {
      psi,
      details
    },
    completed_at: new Date().toISOString()
  });
}

// Start the worker
async function startWorker() {
  try {
    console.log('Initializing worker...');
    
    const { queueEvents } = await initializeWorker();
    console.log('Queue components initialized successfully');
  
  const worker = new Worker(queueName, processScan, {
    connection: {
      url: env.REDIS_URL
    },
    concurrency: env.concurrency
  });

  worker.on('completed', (job) => {
    console.log(`[scan:${job.id}] completed`);
  });

  worker.on('failed', async (job, error) => {
    console.error(`[scan:${job?.id}] failed`, error);
    if (job?.data?.scanId) {
      await updateScan(job.data.scanId, {
        status: 'failed',
        issues_json: [{ key: 'unexpected_error', label: 'We hit a snag while grading. Our team has been notified.' }]
      }).catch((err) => console.error('Failed to mark scan failed', err));
    }
  });

  queueEvents.on('waiting', ({ jobId }) => {
    console.log(`[scan:${jobId}] queued`);
  });

  console.log('Worker started successfully');
  
  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await worker.close();
    await queueEvents.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await worker.close();
    await queueEvents.close();
    process.exit(0);
  });
  
  } catch (error) {
    console.error('Failed to start worker:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Start the worker
startWorker().catch((error) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
