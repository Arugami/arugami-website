import { Queue } from 'bullmq';
import env from './config.js';

const queueName = 'local-visibility-scan';

// Add logging to verify Redis URL at runtime
console.log('REDIS_URL at runtime:', (env.REDIS_URL || '').replace(/\/\/.*@/, '//***@'));

let scanQueue = null;

// Try to initialize Redis queue, but don't crash if it fails
try {
  if (!env.REDIS_URL) {
    console.warn('Missing REDIS_URL environment variable - queue functionality disabled');
  } else {
    scanQueue = new Queue(queueName, {
      connection: {
        url: env.REDIS_URL
      }
    });
    console.log('Redis queue initialized successfully');
  }
} catch (error) {
  console.error('Failed to initialize Redis queue:', error.message);
  console.warn('Queue functionality disabled - server will continue without Redis');
}

export { scanQueue };

export async function enqueueScanJob(scan) {
  if (!scanQueue) {
    console.warn('Queue not available - skipping job enqueue for scan:', scan.id);
    return null;
  }
  
  try {
    return await scanQueue.add('scan', {
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
  } catch (error) {
    console.error('Failed to enqueue scan job:', error.message);
    return null;
  }
}
