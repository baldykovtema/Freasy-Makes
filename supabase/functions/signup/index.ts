import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { adminClient, requireEnv, SITE_URL } from '../_shared/common.ts';

// Регистрация Freasy Makes. Проект Supabase общий с играми FreasyGames, где почта подтверждается сама
// (ник@pvz-game.com без настоящей почты), поэтому «Confirm email» для всего проекта не включить.
// Здесь аккаунт создаётся неподтверждённым: Supabase не пускает в такой аккаунт, пока не открыта ссылка из письма.
// Письмо отправляет сам Supabase по шаблону «Confirm signup».
const ORIGINS = ['https://baldykovtema.github.io', 'http://localhost:8771'];
export const ACTIVATED_URL = `${SITE_URL}?activated=1`;

function cors(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function redirectFor(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  return origin.startsWith('http://localhost') ? `${origin}/?activated=1` : ACTIVATED_URL;
}

Deno.serve(async (request) => {
  const headers = { ...cors(request), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Только POST' }, 405);

  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Проверь адрес почты' }, 400);
  if (password.length < 6) return reply({ error: 'Пароль должен быть не короче 6 символов' }, 400);

  const db = adminClient();
  const { error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    app_metadata: { freasy_makes: true },
  });
  if (error) {
    if (error.status === 422 || /already/i.test(error.message)) {
      return reply({ error: 'Такой аккаунт уже есть. Войди в него или отправь письмо ещё раз', code: 'exists' }, 409);
    }
    console.error(error);
    return reply({ error: 'Не удалось создать аккаунт, попробуй позже' }, 500);
  }

  const anon = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { error: mailError } = await anon.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectFor(request) } });
  if (mailError) {
    console.error(mailError);
    return reply({ ok: true, mailError: 'Аккаунт создан, но письмо не ушло. Нажми «Отправить письмо ещё раз» через минуту' });
  }
  return reply({ ok: true });
});
