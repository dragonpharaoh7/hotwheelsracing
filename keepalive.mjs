// Supabase keepalive — uses the same client and credentials as index.html.
//
// The anon key is public by design: it is already embedded in index.html, which
// anyone loading the page can read. Its blast radius is bounded by RLS policies.
//
// Run:  node keepalive.mjs
// Env overrides (optional): SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from '@supabase/supabase-js';

// Same two constants as the top of index.html. Keep them in sync.
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://icbbcnksulieahxyywwh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljYmJjbmtzdWxpZWFoeHl5d3doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwODYxNzAsImV4cCI6MjA5ODY2MjE3MH0.GOANkeAvqGM_Htx9r1xFWMlT0gzzF-z0tXhPOSqg5wo';

console.log('node       :', process.version);
console.log('project url:', SUPABASE_URL);

// createClient always builds a RealtimeClient, even for pure REST use, and that
// needs a WebSocket. Node only gained a native one in v22. Fail with a readable
// message instead of a stack trace out of realtime-js.
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 22 && typeof globalThis.WebSocket === 'undefined') {
  console.error(
    `\nThis needs Node 22 or newer (running ${process.version}).\n` +
    'supabase-js constructs a realtime client on createClient(), which requires a\n' +
    'native WebSocket. Node added one in v22.\n\n' +
    "Fix: in .github/workflows/keepalive.yml set node-version: '24'."
  );
  process.exit(1);
}

console.log('anon key   :', SUPABASE_ANON_KEY.slice(0, 12) + '...(' + SUPABASE_ANON_KEY.length + ' chars)');

// Fail loudly on the two mistakes that produce a confusing 401 instead of a clear error.
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL)) {
  console.error('URL looks wrong. Expected https://<ref>.supabase.co with no trailing slash or path.');
  process.exit(1);
}
if (SUPABASE_ANON_KEY.split('.').length !== 3) {
  console.error('Anon key is not a JWT (expected three dot-separated parts). Truncated when pasted?');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// PostgREST errors come back in .error rather than being thrown. Surface everything.
function check(label, res) {
  if (res.error) {
    console.error('\nX ' + label + ' FAILED');
    console.error('  status :', res.status, res.statusText || '');
    console.error('  message:', res.error.message);
    console.error('  code   :', res.error.code);
    console.error('  details:', res.error.details);
    console.error('  hint   :', res.error.hint);
    console.error('  raw    :', JSON.stringify(res.error));
    if (res.error.code === 'PGRST205' || /schema cache/i.test(res.error.message || '')) {
      console.error('  >> Table exists but PostgREST has not picked it up.');
      console.error('  >> In the Supabase SQL editor run:  notify pgrst, \'reload schema\';');
    }
    if (res.status === 401 || res.status === 403) {
      console.error('  >> Auth or RLS rejection. Check the anon key and the table policy.');
    }
    throw new Error(label + ' failed: ' + res.error.message);
  }
}

async function main() {
  // 1. A read. This alone resets the inactivity timer.
  const seasons = await sb.from('seasons').select('id,label').order('sort_order');
  check('read seasons', seasons);
  console.log('\nOK read —', seasons.data.map((s) => s.id + ':' + s.label).join(', '));

  // 2. A write, so it counts as database activity and leaves an audit trail.
  const beat = await sb
    .from('heartbeat')
    .upsert({ id: 1, last_ping: new Date().toISOString() })
    .select()
    .single();
  check('write heartbeat', beat);
  console.log('OK heartbeat —', beat.data.last_ping);

  // 3. Report league sync state, so the run log is useful on its own.
  const sync = await sb.from('sync_state').select('*').eq('id', 1).maybeSingle();
  check('read sync_state', sync);
  if (sync.data) {
    console.log('OK league at v' + sync.data.version + ', last saved by ' +
      sync.data.updated_by + ' on ' + sync.data.updated_at);
  }
  console.log('\nkeepalive OK');
}

main().catch((err) => {
  console.error('\nkeepalive FAILED:', err && err.message ? err.message : err);
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
});
