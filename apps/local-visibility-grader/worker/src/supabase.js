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

export async function insertCompetitors(records) {
  if (!records.length) return;

  const { error } = await supabaseAdmin
    .from('competitor')
    .insert(records, { defaultToNull: true });

  if (error) {
    throw error;
  }
}
