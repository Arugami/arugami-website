import { createClient } from '@supabase/supabase-js';
import env from './config.js';

export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export async function updateScan(scanId, payload) {
  const { error } = await supabaseAdmin
    .from('scan')
    .update(payload)
    .eq('id', scanId);

  if (error) {
    throw error;
  }
}

export function isDuplicateScanError(error) {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === '23505' && message.includes('scan_place_id_daily_idx');
}

export async function markScanDuplicate(scanId) {
  await updateScan(scanId, {
    status: 'duplicate',
    issues_json: [
      {
        key: 'duplicate_scan',
        label: 'Looks like we already graded this profile today. Check your existing report or try again tomorrow.'
      }
    ],
    top_issues: [],
    completed_at: new Date().toISOString()
  });
}

export async function insertCompetitors(records) {
  if (!records.length) return;

  const { error } = await supabaseAdmin
    .from('competitor')
    .insert(records, { defaultToNull: true });

  if (error) {
    throw error;
  }
}
