import { createClient } from '@supabase/supabase-js';
import env from './config.js';

export const supabaseAdmin = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

export async function insertScan(data) {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }
  
  const { data: row, error } = await supabaseAdmin
    .from('scan')
    .insert(data)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return row;
}

export async function updateScan(scanId, payload) {
  const { data: row, error } = await supabaseAdmin
    .from('scan')
    .update(payload)
    .eq('id', scanId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return row;
}

export async function getScan(scanId) {
  const { data: row, error } = await supabaseAdmin
    .from('scan')
    .select('*')
    .eq('id', scanId)
    .single();

  if (error) {
    throw error;
  }

  return row;
}

export async function upsertLead(data) {
  const { data: rows, error } = await supabaseAdmin
    .from('lead')
    .upsert(data, { onConflict: 'scan_id' })
    .select()
    .limit(1);

  if (error) {
    throw error;
  }

  return rows?.[0] ?? null;
}

export async function getLeadByScan(scanId) {
  const { data: row, error } = await supabaseAdmin
    .from('lead')
    .select('*')
    .eq('scan_id', scanId)
    .single();

  if (error) {
    throw error;
  }

  return row;
}

export async function markLeadVerified(scanId, payload) {
  const { data: row, error } = await supabaseAdmin
    .from('lead')
    .update(payload)
    .eq('scan_id', scanId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return row;
}
