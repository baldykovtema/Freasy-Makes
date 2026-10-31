import { adminClient, corsHeaders, json, notifyOwner, requireEnv, SITE_URL } from '../_shared/common.ts';
import { PAYMENTS_ENABLED, PLANS, validateOrder } from '../_shared/plans.js';

async function rsdTo(currency: string, amountRsd: number) {
  const response = await fetch('https://open.er-api.com/v6/latest/RSD');
  const rate = (await response.json())?.rates?.[currency];
  if (!response.ok || !rate) throw new Error('Нет курса валют');
  return amountRsd * rate;
}

// Lemon Squeezy сам показывает покупателю сумму в его валюте, сюда нужна цена в валюте магазина.
async function createCheckout(jobId: string, planName: string, priceRsd: number, email: string) {
  const storeCurrency = Deno.env.get('STORE_CURRENCY') ?? 'USD';
  const customPrice = Math.ceil((await rsdTo(storeCurrency, priceRsd)) * 100);
  const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('LEMONSQUEEZY_API_KEY')}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          custom_price: customPrice,
          product_options: { name: `Freasy Makes ${planName}`, redirect_url: `${SITE_URL}#/games` },
          checkout_data: { email, custom: { job_id: jobId } },
        },
        relationships: {
          store: { data: { type: 'stores', id: requireEnv('LEMONSQUEEZY_STORE_ID') } },
          variant: { data: { type: 'variants', id: requireEnv('LEMONSQUEEZY_VARIANT_ID') } },
        },
      },
    }),
  });
  const payload = await response.json();
  const url = payload?.data?.attributes?.url;
  if (!response.ok || !url) throw new Error(`Lemon Squeezy: ${response.status}`);
  return url as string;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Только POST' }, 405);

  const db = adminClient();
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const { data: auth } = await db.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: 'Войди в аккаунт' }, 401);

  const body = await request.json().catch(() => null);
  const { order, errors } = validateOrder(body?.plan, body?.order);
  if (errors.length) return json({ error: errors.join('. ') }, 400);
  const paths = [...order.imageUploads, ...order.videoUploads];
  if (paths.some((path: string) => !path.startsWith(`${user.id}/`) || path.includes('..'))) {
    return json({ error: 'Файл не принадлежит этому аккаунту' }, 403);
  }

  const plan = PLANS[body.plan as keyof typeof PLANS];
  if (plan.priceRsd && !PAYMENTS_ENABLED) return json({ error: 'Этот план скоро появится' }, 403);
  const { data: job, error } = await db.from('jobs').insert({
    user_id: user.id,
    customer_email: user.email,
    plan: plan.id,
    status: plan.priceRsd ? 'awaiting_payment' : 'queued',
    request: order,
    formats: order.formats,
  }).select('id').single();
  if (error?.code === '23505') return json({ error: 'Бесплатная игра доступна один раз в сутки' }, 429);
  if (error) return json({ error: 'Не удалось создать заказ' }, 500);

  try {
    if (!plan.priceRsd) {
      await notifyOwner(db, job.id);
      return json({ job_id: job.id });
    }
    const checkoutUrl = await createCheckout(job.id, plan.name, plan.priceRsd, user.email ?? '');
    await db.from('jobs').update({ checkout_url: checkoutUrl }).eq('id', job.id);
    return json({ job_id: job.id, checkout_url: checkoutUrl });
  } catch (failure) {
    console.error(failure);
    await db.from('jobs').update({ status: 'failed', error: 'Не удалось запустить заказ' }).eq('id', job.id);
    return json({ error: 'Сервис временно недоступен, попробуй позже' }, 502);
  }
});
