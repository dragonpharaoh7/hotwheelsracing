// Supabase keepalive — uses the exact same client and credentials as index.html.
//
// The anon key is a public key by design: it is already embedded in index.html,
// which anyone who loads the page can read. Putting it here is no more exposed
// than it already is. Everything it can do is bounded by your RLS policies.
//
// Run:  node keepalive.js
// Env overrides (optional): SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from '@supabase/supabase-js';

// Same two constants as the top of index.html. Keep them in sync.
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://icbbcnksulieahxyywwh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljYmJjbmtzdWxpZWFoeHl5d3doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwODYxNzAsImV4cCI6MjA5ODY2MjE3MH0.GOANkeAvqGM_Htx9r1xFWMlT0gzzF-z0tXhPOSqg5wo';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  // 1. A read. This alone resets the inactivity timer.
  const seasons = await sb.from('seasons').select('id,label').order('sort_order');
  if (seasons.error) throw seasons.error;
  console.log('read ok —', seasons.data.map((s) => `${s.id}:${s.label}`).join(', '));

  // 2. A write, so it counts as database activity too and leaves an audit trail.
  const beat = await sb
    .from('heartbeat')
    .upsert({ id: 1, last_ping: new Date().toISOString() })
    .select()
    .single();
  if (beat.error) throw beat.error;
  console.log('heartbeat ok —', beat.data.last_ping);

  // 3. Report league sync state, so a failed run tells you something useful.
  const sync = await sb.from('sync_state').select('*').eq('id', 1).maybeSingle();
  if (sync.error) throw sync.error;
  if (sync.data) {
    console.log(
      `league at v${sync.data.version}, last saved by ${sync.data.updated_by} on ${sync.data.updated_at}`
    );
  }
}

main().catch((err) => {
  console.error('keepalive FAILED:', err.message || err);
  process.exit(1);
});
