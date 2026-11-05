// Единственный источник правды о планах: этот файл импортируют и сайт (app.js), и Edge Function (create-job).
export const FORMATS = ['exe', 'dmg', 'apk'];
// Сайт заказчик получает архивом, поэтому формат у такого заказа один и выбирать его не нужно.
export const SITE_FORMAT = 'zip';

// Пока оплата не подключена, платные планы показываются с пометкой «Скоро» и не принимаются сервером.
export const PAYMENTS_ENABLED = false;

export const PLANS = {
  free: { id: 'free', name: 'Бесплатно', priceRsd: 0, prompts: 1, descriptions: 0, imagePrompts: 0, imageUploads: 0, videos: 0, formats: 1 },
  // Lemon Squeezy берёт около 5% и 0,5 $ с покупки, поэтому цена заметно выше этой комиссии.
  pro: { id: 'pro', name: 'Pro', priceRsd: 400, prompts: 1, descriptions: 3, imagePrompts: 5, imageUploads: 5, videos: 1, formats: 1 },
  max: { id: 'max', name: 'Max', priceRsd: 1000, prompts: 2, descriptions: 5, imagePrompts: 15, imageUploads: 5, videos: 3, formats: 2 },
};

export const LIMITS = {
  textChars: 2000,
  // Готовый файл игры должен пройти в лимит Supabase 50 МБ: 5×2 + 3×8 = 34 МБ плюс оболочка приложения.
  imageBytes: 2 * 1024 * 1024,
  videoBytes: 8 * 1024 * 1024,
  imageTypes: ['image/png', 'image/jpeg', 'image/webp'],
  videoTypes: ['video/mp4', 'video/webm'],
};

const texts = (list) => (Array.isArray(list) ? list : []).map((item) => String(item ?? '').trim()).filter(Boolean);

// Возвращает { order, errors }: order содержит только разрешённые планом поля.
export function validateOrder(planId, input = {}) {
  const plan = PLANS[planId];
  if (!plan) return { order: null, errors: ['Неизвестный план'] };
  const errors = [];
  const prompts = texts(input.prompts);
  const descriptions = texts(input.descriptions);
  const imagePrompts = texts(input.imagePrompts);
  const imageUploads = texts(input.imageUploads);
  const videoPrompts = texts(input.videoPrompts);
  const videoUploads = texts(input.videoUploads);
  const kind = input.kind === 'site' ? 'site' : 'game';
  const formats = kind === 'site' ? [SITE_FORMAT] : [...new Set(texts(input.formats))];

  if (!prompts.length) errors.push(kind === 'site' ? 'Напиши промт сайта' : 'Напиши промт игры');
  if (prompts.length > plan.prompts) errors.push(`Промтов — не больше ${plan.prompts}`);
  if (descriptions.length > plan.descriptions) errors.push(`Описаний — не больше ${plan.descriptions}`);
  if (imagePrompts.length > plan.imagePrompts) errors.push(`Промтов картинок — не больше ${plan.imagePrompts}`);
  if (imageUploads.length > plan.imageUploads) errors.push(`Своих картинок — не больше ${plan.imageUploads}`);
  if (imagePrompts.length && imageUploads.length) errors.push('Выбери что-то одно: промты картинок или свои картинки');
  if (videoPrompts.length > plan.videos) errors.push(`Промтов видео — не больше ${plan.videos}`);
  if (videoUploads.length > plan.videos) errors.push(`Своих видео — не больше ${plan.videos}`);
  if (videoPrompts.length && videoUploads.length) errors.push('Выбери что-то одно: промты видео или свои видео');
  if ([...prompts, ...descriptions, ...imagePrompts, ...videoPrompts].some((text) => text.length > LIMITS.textChars)) {
    errors.push(`Один текст — не длиннее ${LIMITS.textChars} символов`);
  }
  if (kind === 'game') {
    if (!formats.length) errors.push('Выбери формат игры');
    if (formats.length > plan.formats) errors.push(`Форматов — не больше ${plan.formats}`);
    if (formats.some((format) => !FORMATS.includes(format))) errors.push('Неизвестный формат игры');
  }

  return { order: { kind, prompts, descriptions, imagePrompts, imageUploads, videoPrompts, videoUploads, formats }, errors };
}
