import { adminClient, notifyOwner, requireEnv } from '../_shared/common.ts';
import { PLANS } from '../_shared/plans.js';

// Уведомление об оплате от Gumroad (Settings → Advanced → Ping). У Ping нет подписи, поэтому
// данным из него не верим: покупку заново запрашиваем у Gumroad API по sale_id и сверяем товар.
const API = 'https://api.gumroad.com/v2';

async function gumroad(path: string) {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`${API}${path}${separator}access_token=${encodeURIComponent(requireEnv('GUMROAD_ACCESS_TOKEN'))}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(`Gumroad ${path.split('?')[0]}: ${response.status}`);
  return data;
}

// id товара Gumroad для плана: ищем свой товар по адресу chezyxa.gumroad.com/l/<permalink>.
async function productIdFor(permalink: string) {
  const { products } = await gumroad('/products');
  const product = (products ?? []).find((item: Record<string, unknown>) =>
    item.custom_permalink === permalink || item.permalink === permalink || String(item.short_url ?? '').endsWith(`/l/${permalink}`));
  return product?.id as string | undefined;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('ok');
  const ping = new URLSearchParams(await request.text());
  const saleId = ping.get('sale_id') ?? '';
  const jobId = ping.get('url_params[job_id]') ?? '';
  if (!/^[A-Za-z0-9_=-]{4,100}$/.test(saleId) || !/^[0-9a-f-]{36}$/i.test(jobId)) return new Response('ignored');

  const db = adminClient();
  const { data: job, error: jobError } = await db.from('jobs').select('id, plan, status').eq('id', jobId).maybeSingle();
  if (jobError) return new Response('db error', { status: 500 });
  if (!job) return new Response('no such job');
  if (job.status !== 'awaiting_payment') return new Response('already handled');
  const plan = PLANS[job.plan as keyof typeof PLANS] as { gumroad?: string } | undefined;
  if (!plan?.gumroad) return new Response('free plan');

  let sale;
  try {
    ({ sale } = await gumroad(`/sales/${encodeURIComponent(saleId)}`));
    const productId = await productIdFor(plan.gumroad);
    if (!sale || !productId || sale.product_id !== productId) return new Response('wrong product');
    if (sale.refunded || sale.partially_refunded || sale.chargedback || sale.disputed) return new Response('not paid');
  } catch (failure) {
    console.error(failure);
    return new Response('gumroad unavailable', { status: 502 });
  }

  // Одна покупка оплачивает только один заказ.
  const { data: used } = await db.from('jobs').select('id').eq('payment_ref', `gumroad:${sale.id}`).neq('id', jobId).limit(1);
  if (used?.length) return new Response('sale already used');

  // Условие по статусу делает повторную доставку безопасной: письмо уйдёт один раз.
  const { data: rows, error } = await db.from('jobs')
    .update({ status: 'queued', paid_at: new Date().toISOString(), payment_ref: `gumroad:${sale.id}` })
    .eq('id', jobId).eq('status', 'awaiting_payment').select('id');
  if (error) return new Response('db error', { status: 500 });
  if (!rows?.length) return new Response('already handled');

  try {
    await notifyOwner(db, jobId);
  } catch (failure) {
    console.error(failure);
    // Возвращаем заказ назад, чтобы повторное уведомление обработало его снова.
    await db.from('jobs').update({ status: 'awaiting_payment', payment_ref: null, paid_at: null }).eq('id', jobId);
    return new Response('notify failed', { status: 500 });
  }
  return new Response('ok');
});
