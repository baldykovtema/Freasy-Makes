import { adminClient, corsHeaders, json, notifyOwner } from '../_shared/common.ts';
import { GUMROAD_STORE, PAYMENTS_ENABLED, PLANS, validateOrder } from '../_shared/plans.js';

const LEGACY_ACCOUNTS_BEFORE = '2026-11-13T09:15:00Z';

// Покупатель платит на странице товара Gumroad. Номер заказа уходит в ссылке и возвращается
// в уведомлении об оплате (url_params), по нему payment-webhook находит заказ.
function checkoutUrl(jobId: string, permalink: string) {
  return `${GUMROAD_STORE}/l/${permalink}?wanted=true&job_id=${encodeURIComponent(jobId)}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Только POST' }, 405);

  const db = adminClient();
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const { data: auth } = await db.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: 'Войди в аккаунт' }, 401);
  // Проект общий с играми, где почта подтверждается сама. Заказывать можно с аккаунта, созданного через
  // функцию signup (почта подтверждена по ссылке), или с аккаунта, который был до проверки почты.
  const verified = user.email_confirmed_at && (user.app_metadata?.freasy_makes === true || user.created_at < LEGACY_ACCOUNTS_BEFORE);
  if (!verified) return json({ error: 'Создай аккаунт Freasy Makes с настоящей почтой и подтверди её по ссылке из письма' }, 403);

  const body = await request.json().catch(() => null);
  const { order, errors } = validateOrder(body?.plan, body?.order);
  if (errors.length) return json({ error: errors.join('. ') }, 400);
  const paths = [...order.imageUploads, ...order.videoUploads];
  if (paths.some((path: string) => !path.startsWith(`${user.id}/`) || path.includes('..'))) {
    return json({ error: 'Файл не принадлежит этому аккаунту' }, 403);
  }

  const plan = PLANS[body.plan as keyof typeof PLANS];
  if (plan.priceUsd && !PAYMENTS_ENABLED) return json({ error: 'Этот план скоро появится' }, 403);
  const { data: job, error } = await db.from('jobs').insert({
    user_id: user.id,
    customer_email: user.email,
    plan: plan.id,
    status: plan.priceUsd ? 'awaiting_payment' : 'queued',
    request: order,
    formats: order.formats,
  }).select('id').single();
  if (error?.code === '23505') return json({ error: 'Бесплатный заказ доступен один раз в сутки' }, 429);
  if (error) return json({ error: 'Не удалось создать заказ' }, 500);

  try {
    if (!plan.priceUsd) {
      await notifyOwner(db, job.id);
      return json({ job_id: job.id });
    }
    const url = checkoutUrl(job.id, plan.gumroad);
    const { error: saveError } = await db.from('jobs').update({ checkout_url: url }).eq('id', job.id);
    if (saveError) throw saveError;
    return json({ job_id: job.id, checkout_url: url });
  } catch (failure) {
    console.error(failure);
    await db.from('jobs').update({ status: 'failed', error: 'Не удалось запустить заказ' }).eq('id', job.id);
    return json({ error: 'Сервис временно недоступен, попробуй позже' }, 502);
  }
});
