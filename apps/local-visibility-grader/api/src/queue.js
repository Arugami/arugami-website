import { Queue } from 'bullmq';
import env from './config.js';

const queueName = 'local-visibility-scan';

// Add logging to verify Redis URL at runtime
console.log('REDIS_URL at runtime:', (env.REDIS_URL || '').replace(/\/\/.*@/, '//***@'));

if (!env.REDIS_URL) {
  throw new Error('Missing REDIS_URL environment variable');
}

export const scanQueue = new Queue(queueName, {
  connection: {
    url: env.REDIS_URL
  }
});

export async function enqueueScanJob(scan) {
  return scanQueue.add('scan', {
    scanId: scan.id,
    businessInput: scan.business_input,
    placeId: scan.place_id ?? null,
    city: scan.city ?? null,
    cuisine: scan.cuisine ?? null
  }, {
    jobId: scan.id,
    removeOnComplete: true,
    removeOnFail: false
  });
}
