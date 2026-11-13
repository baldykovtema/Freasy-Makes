import { SITE_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Адрес, с которым открыли сайт. Supabase сразу убирает из него данные ссылки из письма, поэтому запоминаем заранее.
export const landing = { search: location.search, hash: location.hash };
let client = null;

if (configured) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function need() {
  if (!client) throw new Error('Сайт ещё не подключён к Supabase');
  return client;
}

// Ссылка из письма ведёт сюда. Локально — на тот же адрес, с которого открыт сайт.
const ACTIVATED_URL = location.hostname === 'localhost' ? `${location.origin}/?activated=1` : `${SITE_URL}?activated=1`;

function russian(error) {
  const known = {
    'Invalid login credentials': 'Неверная почта или пароль',
    'Email not confirmed': 'Аккаунт ещё не активирован. Открой ссылку из письма, которое мы отправили на твою почту',
    'User already registered': 'Такой аккаунт уже есть, войди в него',
    'Email rate limit exceeded': 'Слишком много писем подряд. Попробуй через час',
  };
  const waiting = /after (\d+) seconds/.exec(error.message);
  const badAddress = /^Email address .* (is invalid|not authorized)/.test(error.message);
  const text = badAddress ? 'Не удалось отправить письмо на этот адрес. Проверь почту и попробуй ещё раз'
    : waiting ? `Письмо уже отправлено. Ещё одно можно попросить через ${waiting[1]} с` : known[error.message] || error.message;
  const result = new Error(text);
  result.code = error.message === 'Email not confirmed' ? 'email_not_confirmed' : error.code;
  return result;
}

export const api = {
  configured,

  async user() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.user ?? null;
  },

  onAuthChange(callback) {
    client?.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
  },

  async signIn(email, password) {
    const { error } = await need().auth.signInWithPassword({ email, password });
    if (error) throw russian(error);
  },

  // Аккаунт создаёт функция signup: он неактивен, пока человек не откроет ссылку из письма.
  // Возвращает текст предупреждения, если аккаунт создан, а письмо не ушло.
  async signUp(email, password) {
    const { data, error } = await need().functions.invoke('signup', { body: { email, password } });
    if (error) {
      const details = await error.context?.json?.().catch(() => null);
      const failure = new Error(details?.error || 'Сервис временно недоступен, попробуй позже');
      failure.code = details?.code;
      throw failure;
    }
    return data?.mailError || '';
  },

  async resendConfirmation(email) {
    const { error } = await need().auth.resend({ type: 'signup', email, options: { emailRedirectTo: ACTIVATED_URL } });
    if (error) throw russian(error);
  },

  async signOut() {
    await need().auth.signOut();
  },

  async uploadFile(user, file) {
    const extension = file.name.includes('.') ? file.name.split('.').pop().replace(/[^a-z0-9]/gi, '').toLowerCase() : 'bin';
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await need().storage.from('uploads').upload(path, file, { contentType: file.type });
    if (error) throw new Error(`Не удалось загрузить ${file.name}: ${error.message}`);
    return path;
  },

  async createJob(plan, order) {
    const { data, error } = await need().functions.invoke('create-job', { body: { plan, order } });
    if (error) {
      const details = await error.context?.json?.().catch(() => null);
      throw new Error(details?.error || 'Сервис временно недоступен, попробуй позже');
    }
    return data;
  },

  // Фильтр по user_id нужен владельцу: политика доступа показывает ему заказы всех людей.
  async listJobs(user) {
    const { data, error } = await need().from('jobs')
      .select('id, plan, status, formats, title, artifacts, error, checkout_url, created_at')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
    if (error) throw new Error('Не удалось загрузить заказы. Обнови страницу');
    return data;
  },

  async isAdmin(user) {
    const { data } = await need().from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
    return Boolean(data);
  },

  async listOrders() {
    const { data, error } = await need().from('jobs')
      .select('id, plan, status, formats, request, customer_email, title, error, created_at')
      .neq('status', 'awaiting_payment').eq('hidden', false).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error('Не удалось загрузить заявки');
    return data;
  },

  async uploadUrl(path) {
    const { data, error } = await need().storage.from('uploads').createSignedUrl(path, 3600);
    if (error) throw new Error('Не удалось открыть файл');
    return data.signedUrl;
  },

  async downloadUrl(path, name) {
    const { data, error } = await need().storage.from('games').createSignedUrl(path, 3600, { download: name });
    if (error) throw new Error('Не удалось подготовить файл');
    return data.signedUrl;
  },
};
