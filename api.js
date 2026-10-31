import { SITE_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
let client = null;

if (configured) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function need() {
  if (!client) throw new Error('Сайт ещё не подключён к Supabase');
  return client;
}

function russian(error) {
  const known = {
    'Invalid login credentials': 'Неверная почта или пароль',
    'Email not confirmed': 'Сначала подтверди почту: письмо уже отправлено',
    'User already registered': 'Такой аккаунт уже есть, войди в него',
  };
  return new Error(known[error.message] || error.message);
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

  // Возвращает true, если вход выполнен сразу, и false, если нужно подтвердить почту.
  async signUp(email, password) {
    const { data, error } = await need().auth.signUp({ email, password, options: { emailRedirectTo: SITE_URL } });
    if (error) throw russian(error);
    return Boolean(data.session);
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
    if (error) throw new Error('Не удалось загрузить игры');
    return data;
  },

  async isAdmin(user) {
    const { data } = await need().from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
    return Boolean(data);
  },

  async listOrders() {
    const { data, error } = await need().from('jobs')
      .select('id, plan, status, formats, request, customer_email, title, error, created_at')
      .neq('status', 'awaiting_payment').order('created_at', { ascending: false }).limit(200);
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
