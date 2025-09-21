import Airtable from 'airtable';
import env from './config.js';

const base = new Airtable({ apiKey: env.AIRTABLE_API_KEY }).base(env.AIRTABLE_BASE_ID);

export async function upsertLeadToAirtable(lead) {
  const table = base(env.AIRTABLE_TABLE_NAME);

  const payload = {
    ScanId: lead.scan_id,
    Name: lead.name,
    Business: lead.business,
    Phone: lead.phone,
    Verified: lead.verified,
    Score: lead.score ?? null,
    City: lead.city ?? null,
    Cuisine: lead.cuisine ?? null,
    TopIssues: Array.isArray(lead.top_issues) ? lead.top_issues.join(', ') : lead.top_issues ?? null,
    ReportUrl: lead.report_url ?? null,
    CreatedAt: lead.created_at
  };

  const fields = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== null && value !== undefined)
  );

  const [record] = await table.create([{ fields }], { typecast: true });
  return record.getId();
}
