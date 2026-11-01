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

const LINK_LIFETIME_SECONDS = 7 * 24 * 3600;

function section(title: string, items: string[]) {
  return items.length ? [`${title}:`, ...items.map((item) => `- ${item}`), ''] : [];
}

// Письмо автору с заявкой. Письмо только текстовое: промты пишут пользователи, поэтому HTML из них не собираем.
export async function notifyOwner(db: ReturnType<typeof adminClient>, jobId: string) {
  const { data: job, error } = await db.from('jobs').select('id, user_id, plan, request, formats').eq('id', jobId).single();
  if (error) throw new Error('Заказ не найден');
  const { data: account } = await db.auth.admin.getUserById(job.user_id);
  const email = account?.user?.email ?? 'неизвестна';
  const order = job.request;
  const product = order.kind === 'site' ? 'сайт' : 'игру';

  const links = async (paths: string[]) => {
    if (!paths.length) return [];
    const { data, error: linkError } = await db.storage.from('uploads').createSignedUrls(paths, LINK_LIFETIME_SECONDS);
    if (linkError) throw new Error('Не удалось сделать ссылки на файлы');
    return data.map((item) => item.signedUrl);
  };

  const text = [
    `Заказ: ${product}`,
    `План: ${job.plan}`,
    `Формат: ${job.formats.join(', ')}`,
    `Почта заказчика: ${email}`,
    `Номер заказа: ${job.id}`,
    '',
    ...section(order.kind === 'site' ? 'Промт сайта' : 'Промт игры', order.prompts),
    ...section('Описания', order.descriptions),
    ...section('Промты картинок', order.imagePrompts),
    ...section('Картинки заказчика (ссылки работают 7 дней)', await links(order.imageUploads)),
    ...section('Промты видео', order.videoPrompts),
    ...section('Видео заказчика (ссылки работают 7 дней)', await links(order.videoUploads)),
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Freasy Makes <onboarding@resend.dev>',
      to: [requireEnv('ORDER_EMAIL')],
      subject: `Новая заявка на ${product}: ${job.plan}, ${job.formats.join(', ')}`,
      text,
    }),
  });
  if (!response.ok) throw new Error(`Resend: ${response.status}`);
}
