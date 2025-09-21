import { Worker, QueueEvents, QueueScheduler } from 'bullmq';
import { Client as MapsClient } from '@googlemaps/google-maps-services-js';

import env from './config.js';
import { updateScan, insertCompetitors } from './supabase.js';

const queueName = 'local-visibility-scan';

const queueScheduler = new QueueScheduler(queueName, {
  connection: {
    url: env.REDIS_URL
  }
});
await queueScheduler.waitUntilReady();

const queueEvents = new QueueEvents(queueName, {
  connection: {
    url: env.REDIS_URL
  }
});
await queueEvents.waitUntilReady();

const mapsClient = new MapsClient({});

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

  const response = await mapsClient.textSearch({
    params: {
      query,
      key: env.GOOGLE_MAPS_API_KEY
    }
  });

  const place = response.data.results?.[0];
  if (!place) {
    return null;
  }

  return {
    placeId: place.place_id,
    lat: place.geometry?.location?.lat ?? null,
    lng: place.geometry?.location?.lng ?? null,
    formattedAddress: place.formatted_address ?? null
  };
}

async function fetchPlaceDetails(placeId) {
  const response = await mapsClient.placeDetails({
    params: {
      place_id: placeId,
      fields: ['name', 'formatted_address', 'formatted_phone_number', 'international_phone_number', 'website', 'opening_hours', 'rating', 'user_ratings_total', 'price_level', 'types', 'reservable', 'delivery', 'photos', 'editorial_summary'],
      key: env.GOOGLE_MAPS_API_KEY
    }
  });

  return response.data.result;
}

async function fetchNearbyCompetitors(placeId) {
  const response = await mapsClient.placeNearby({
    params: {
      place_id: placeId,
      radius: 1500,
      type: 'restaurant',
      key: env.GOOGLE_MAPS_API_KEY
    }
  });

  return response.data.results ?? [];
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

  const total = Object.values(breakdown).reduce((sum, part) => sum + part, 0);
  return { total: Math.min(total, 100), breakdown };
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

  await updateScan(scanId, {
    status: 'details',
    place_id: resolved.placeId,
    lat: resolved.lat,
    lng: resolved.lng,
    city: parsedInput.city ?? null
  });

  const details = await fetchPlaceDetails(resolved.placeId).catch((error) => {
    console.error('Failed to fetch place details', error);
    return null;
  });

  await updateScan(scanId, {
    status: 'competitors'
  });

  const competitors = await fetchNearbyCompetitors(resolved.placeId).catch((error) => {
    console.error('Failed to fetch competitors', error);
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
