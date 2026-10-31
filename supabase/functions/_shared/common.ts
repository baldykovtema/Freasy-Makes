import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const SITE_URL = 'https://baldykovtema.github.io/Freasy-Makes/';
const SITE_ORIGIN = 'https://baldykovtema.github.io';

export const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Не задан секрет ${name}`);
  return value;
}

export function adminClient() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

// Запускает .github/workflows/build-game.yml. В логи Actions попадает только id заказа.
export async function dispatchBuild(jobId: string) {
  const response = await fetch(`https://api.github.com/repos/${requireEnv('GITHUB_REPO')}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('GITHUB_DISPATCH_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'freasy-makes',
    },
    body: JSON.stringify({ event_type: 'build-game', client_payload: { job_id: jobId } }),
  });
  if (!response.ok) throw new Error(`GitHub dispatch: ${response.status}`);
}
