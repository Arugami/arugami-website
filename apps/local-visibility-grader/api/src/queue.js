import { Queue } from 'bullmq';
import env from './config.js';

const queueName = 'local-visibility-scan';

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
