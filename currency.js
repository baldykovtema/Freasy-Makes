const STORAGE_KEY = 'freasy-currency';

export const CURRENCIES = ['USD', 'EUR', 'RSD', 'GBP', 'RUB', 'UAH', 'KZT', 'BYN', 'TRY', 'PLN', 'CHF', 'BAM', 'MKD', 'HUF', 'RON', 'BGN', 'CZK', 'GEL', 'AMD', 'AZN'];

// Язык браузера не говорит, где человек находится, поэтому сначала смотрим часовой пояс.
const BY_TIME_ZONE = {
  'Europe/Belgrade': 'RSD', 'Europe/Moscow': 'RUB', 'Europe/Kaliningrad': 'RUB', 'Europe/Samara': 'RUB', 'Asia/Yekaterinburg': 'RUB',
  'Asia/Novosibirsk': 'RUB', 'Asia/Vladivostok': 'RUB', 'Europe/Kyiv': 'UAH', 'Europe/Kiev': 'UAH', 'Europe/Minsk': 'BYN',
  'Asia/Almaty': 'KZT', 'Europe/Istanbul': 'TRY', 'Europe/Warsaw': 'PLN', 'Europe/London': 'GBP', 'Europe/Zurich': 'CHF',
  'Europe/Sarajevo': 'BAM', 'Europe/Skopje': 'MKD', 'Europe/Budapest': 'HUF', 'Europe/Bucharest': 'RON', 'Europe/Sofia': 'BGN',
  'Europe/Prague': 'CZK', 'Asia/Tbilisi': 'GEL', 'Asia/Yerevan': 'AMD', 'Asia/Baku': 'AZN',
};

function remembered() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function rememberCurrency(code) {
  try { localStorage.setItem(STORAGE_KEY, code); } catch {}
}

export function detectCurrency() {
  const saved = remembered();
  if (CURRENCIES.includes(saved)) return saved;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (BY_TIME_ZONE[zone]) return BY_TIME_ZONE[zone];
  if (zone.startsWith('Europe/')) return 'EUR';
  return 'USD';
}

export async function loadRates() {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await response.json();
    return data.rates ?? null;
  } catch {
    return null;
  }
}

// Цены планов — в долларах, как в Gumroad. Валюта нужна только для подсказки «≈ столько-то в твоих деньгах».
export const usd = (amount) => `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;

export function formatPrice(amountUsd, currency, rates) {
  const main = usd(amountUsd);
  if (!amountUsd || currency === 'USD' || !rates?.[currency]) return { main, note: '' };
  const local = amountUsd * rates[currency];
  const converted = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: local >= 100 ? 0 : 2 }).format(local);
  return { main, note: `≈ ${converted}` };
}
