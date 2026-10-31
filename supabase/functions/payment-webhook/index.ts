import { adminClient, notifyOwner, requireEnv } from '../_shared/common.ts';

async function signatureIsValid(rawBody: string, signature: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(requireEnv('LEMONSQUEEZY_WEBHOOK_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(rawBody));
}

Deno.serve(async (request) => {
  const rawBody = await request.text();
  const signature = request.headers.get('X-Signature') ?? '';
  if (!/^[0-9a-f]{64}$/.test(signature) || !(await signatureIsValid(rawBody, signature))) {
    return new Response('bad signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const jobId = event?.meta?.custom_data?.job_id;
  if (event?.meta?.event_name !== 'order_created' || event?.data?.attributes?.status !== 'paid' || !jobId) {
    return new Response('ignored');
  }

  // Условие по статусу делает повторную доставку вебхука безопасной: письмо уйдёт один раз.
  const db = adminClient();
  const { data: rows, error } = await db.from('jobs')
    .update({ status: 'queued', paid_at: new Date().toISOString(), payment_ref: String(event.data.id) })
    .eq('id', jobId).eq('status', 'awaiting_payment').select('id');
  if (error) return new Response('db error', { status: 500 });
  if (!rows?.length) return new Response('already handled');

  try {
    await notifyOwner(db, jobId);
  } catch (failure) {
    console.error(failure);
    // Возвращаем заказ назад: на ответ 500 Lemon Squeezy пришлёт вебхук повторно.
    await db.from('jobs').update({ status: 'awaiting_payment' }).eq('id', jobId);
    return new Response('notify failed', { status: 500 });
  }
  return new Response('ok');
});
