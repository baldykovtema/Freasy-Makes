import { api } from './api.js';
import { CURRENCIES, detectCurrency, formatPrice, loadRates, rememberCurrency } from './currency.js';
import { FORMATS, LIMITS, PAYMENTS_ENABLED, PLANS, validateOrder } from './supabase/functions/_shared/plans.js';

const root = document.getElementById('app');
const nav = document.getElementById('nav');
const FORMAT_LABELS = { exe: 'Windows', dmg: 'macOS', apk: 'Android' };
const STATUS = {
  awaiting_payment: ['Ждёт оплаты', ''],
  queued: ['Делаем игру', 'work'],
  done: ['Готово', 'done'],
  failed: ['Ошибка', 'failed'],
};

const state = { user: null, admin: false, currency: detectCurrency(), rates: null };
let pollTimer = null;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined));
  return node;
}

function message(kind, text) {
  return el('p', { class: `message ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
}

function setupBanner() {
  return api.configured ? null : el('div', { class: 'banner' }, 'Сайт ещё не подключён к Supabase, поэтому вход и создание игр пока не работают.');
}

async function setUser(user) {
  state.user = user;
  state.admin = user ? await api.isAdmin(user) : false;
  renderNav();
}

function renderNav() {
  nav.replaceChildren();
  if (state.user) {
    if (state.admin) nav.append(el('a', { class: 'nav-link', href: '#/orders' }, 'Заявки'));
    nav.append(
      el('a', { class: 'nav-link', href: '#/games' }, 'Мои игры'),
      el('button', { class: 'nav-link', type: 'button', onclick: async () => { await api.signOut(); await setUser(null); location.hash = '#/'; } }, 'Выйти'),
    );
  } else {
    nav.append(el('a', { class: 'nav-link', href: '#/login' }, 'Войти'));
  }
}

function planFeatures(plan) {
  const list = [plan.prompts === 1 ? '1 промт игры' : `${plan.prompts} промта игры`];
  if (plan.descriptions) list.push(`До ${plan.descriptions} описаний игры`);
  if (plan.imagePrompts) list.push(`${plan.imagePrompts} промтов картинок или ${plan.imageUploads} своих картинок`);
  if (plan.videos) list.push(plan.videos === 1 ? '1 промт видео или своё видео' : `${plan.videos} промта видео или ${plan.videos} своих видео`);
  list.push(plan.formats === 1 ? '1 формат: exe, dmg или apk' : `${plan.formats} формата: exe, dmg или apk`);
  list.push('Файл игры и инструкция по запуску');
  return list;
}

function priceBlock(plan) {
  if (!plan.priceRsd) return [el('div', { class: 'price' }, '0 дин'), el('div', { class: 'price-note' }, 'Одна игра в сутки')];
  const { main, note } = formatPrice(plan.priceRsd, state.currency, state.rates);
  return [el('div', { class: 'price' }, main), el('div', { class: 'price-note' }, note)];
}

function planCard(plan) {
  const label = plan.priceRsd ? `${plan.name} ${plan.priceRsd} дин` : 'Попробовать бесплатно';
  return el('article', { class: `card${plan.id === 'pro' ? ' featured' : ''}` },
    el('div', { class: 'meta' }, plan.priceRsd ? 'За одну игру' : 'Без оплаты'),
    el('h3', {}, plan.name),
    priceBlock(plan),
    el('ul', { class: 'features' }, planFeatures(plan).map((text) => el('li', {}, text))),
    plan.priceRsd && !PAYMENTS_ENABLED
      ? el('span', { class: 'play soon' }, `${plan.name}: скоро`)
      : el('a', { class: 'play', href: `#/studio/${plan.id}` }, `${label} ↗`),
  );
}

function currencySelect(onChange) {
  return el('label', { class: 'currency' }, 'Валюта',
    el('select', {
      'aria-label': 'Валюта для показа цены',
      onchange: (event) => { state.currency = event.target.value; rememberCurrency(state.currency); onChange(); },
    }, CURRENCIES.map((code) => el('option', { value: code, selected: code === state.currency }, code))));
}

function viewHome() {
  const plans = el('div', { class: 'plans' }, Object.values(PLANS).map(planCard));
  const redraw = () => plans.replaceChildren(...Object.values(PLANS).map(planCard));
  if (!state.rates) loadRates().then((rates) => { state.rates = rates; if (plans.isConnected) redraw(); });
  const steps = [
    ['Опиши игру', 'Напиши, во что хочешь играть. На Pro и Max можно добавить описания, картинки и видео.'],
    ['Выбери формат', 'exe для Windows, dmg для Mac или apk для Android.'],
    ['Скачай на сайте', 'Мы сделаем игру вручную, а на сайте появятся её файл и инструкция, как её запустить.'],
  ];
  return [
    el('section', { class: 'hero wrap', 'aria-labelledby': 'welcome-title' },
      el('div', { class: 'eyebrow' }, 'Игры по твоему описанию'),
      el('h1', { id: 'welcome-title' }, 'Придумай игру, а ', el('span', {}, 'мы'), ' её сделаем'),
      el('p', {}, 'Опиши идею обычными словами и получи готовую игру для Windows, macOS или Android.'),
      el('a', { class: 'hero-action', href: '#plans', onclick: (event) => { event.preventDefault(); document.getElementById('plans').scrollIntoView(); } }, 'Выбрать план ', el('span', { 'aria-hidden': 'true' }, '↗')),
    ),
    el('section', { class: 'wrap', id: 'plans', 'aria-labelledby': 'plans-title' },
      setupBanner(),
      el('div', { class: 'section-heading' },
        el('div', {}, el('div', { class: 'section-kicker' }, 'Твоя игра'), el('h2', { id: 'plans-title' }, 'Выбирай план')),
        currencySelect(redraw)),
      plans,
    ),
    el('section', { class: 'wrap', 'aria-labelledby': 'how-title' },
      el('div', { class: 'section-heading' }, el('div', {}, el('div', { class: 'section-kicker' }, 'Как это работает'), el('h2', { id: 'how-title' }, 'Три шага до игры'))),
      el('div', { class: 'steps' }, steps.map(([title, text], index) => el('div', { class: 'step' },
        el('span', { class: 'step-number' }, `Шаг ${index + 1}`), el('strong', {}, title), el('p', {}, text)))),
    ),
  ];
}

function viewLogin(next) {
  let mode = 'in';
  const email = el('input', { id: 'email', type: 'email', autocomplete: 'email', required: true });
  const password = el('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true, minLength: 6 });
  const submit = el('button', { class: 'play', type: 'submit' }, 'Войти');
  const notice = el('div', { 'aria-live': 'polite' });
  const signIn = el('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setMode('in') }, 'Вход');
  const signUp = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setMode('up') }, 'Создать аккаунт');

  function setMode(value) {
    mode = value;
    signIn.setAttribute('aria-pressed', String(mode === 'in'));
    signUp.setAttribute('aria-pressed', String(mode === 'up'));
    submit.textContent = mode === 'in' ? 'Войти' : 'Создать аккаунт';
    password.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
    notice.replaceChildren();
  }

  async function onSubmit(event) {
    event.preventDefault();
    notice.replaceChildren();
    submit.disabled = true;
    try {
      if (mode === 'in') {
        await api.signIn(email.value.trim(), password.value);
      } else if (!(await api.signUp(email.value.trim(), password.value))) {
        setMode('in');
        notice.append(message('info', 'Мы отправили письмо. Подтверди почту, а потом войди здесь.'));
        return;
      }
      await setUser(await api.user());
      location.hash = next || '#/';
    } catch (failure) {
      notice.append(message('error', failure.message));
    } finally {
      submit.disabled = false;
    }
  }

  return el('section', { class: 'narrow page' },
    setupBanner(),
    el('h1', {}, 'Войди в аккаунт'),
    el('p', { class: 'lead' }, 'Аккаунт нужен, чтобы сохранить твои игры и выдать файлы только тебе.'),
    el('form', { class: 'panel', onsubmit: onSubmit },
      el('div', { class: 'tabs' }, signIn, signUp),
      el('div', { class: 'field' }, el('label', { htmlFor: 'email' }, 'Почта'), email),
      el('div', { class: 'field' }, el('label', { htmlFor: 'password' }, 'Пароль'), password),
      submit, notice),
  );
}

// Список полей с кнопкой «добавить». required: сколько строк показано сразу.
function textList({ label, max, placeholder, required = 0 }) {
  const rows = el('div', {});
  const counter = el('span', { class: 'counter' });
  const add = el('button', { class: 'ghost', type: 'button', onclick: () => { addRow(); update(); rows.lastChild.querySelector('textarea').focus(); } }, '+ Добавить');
  function update() {
    counter.textContent = `${rows.children.length} из ${max}`;
    add.hidden = rows.children.length >= max;
    [...rows.children].forEach((row, index) => {
      row.querySelector('.remove').hidden = index < required;
      row.querySelector('textarea').setAttribute('aria-label', `${label} ${index + 1}`);
    });
  }
  function addRow() {
    const row = el('div', { class: 'row' },
      el('textarea', { placeholder, maxLength: LIMITS.textChars }),
      el('button', { class: 'remove', type: 'button', 'aria-label': 'Убрать', onclick: () => { row.remove(); update(); } }, '×'));
    rows.append(row);
  }
  for (let index = 0; index < required; index += 1) addRow();
  update();
  return {
    node: el('div', { class: 'group' }, el('div', { class: 'group-head' }, el('span', { class: 'group-title' }, label), counter), rows, add),
    bare: { rows, counter, add },
    values: () => [...rows.querySelectorAll('textarea')].map((item) => item.value),
  };
}

function fileList({ max, accept, types, maxBytes, label, onError }) {
  const files = [];
  const list = el('div', {});
  const input = el('input', { type: 'file', accept, multiple: max > 1 });
  const drop = el('label', { class: 'drop' }, input, label);
  function redraw() {
    list.replaceChildren(...files.map((file, index) => el('div', { class: 'file' }, el('span', {}, file.name),
      el('button', { class: 'remove', type: 'button', 'aria-label': `Убрать ${file.name}`, onclick: () => { files.splice(index, 1); redraw(); } }, '×'))));
    drop.hidden = files.length >= max;
  }
  input.addEventListener('change', () => {
    for (const file of input.files) {
      if (files.length >= max) { onError(`Можно загрузить не больше ${max}`); break; }
      if (!types.includes(file.type)) onError(`${file.name}: этот тип файла не подходит`);
      else if (file.size > maxBytes) onError(`${file.name}: файл больше ${maxBytes / 1024 / 1024} МБ`);
      else files.push(file);
    }
    input.value = '';
    redraw();
  });
  return { node: el('div', {}, drop, list), files };
}

// Блок «промты или свои файлы» для картинок и видео.
function mediaGroup({ title, promptLabel, placeholder, promptMax, fileMax, fileOptions, hint, onError }) {
  const prompts = textList({ label: promptLabel, max: promptMax, placeholder, required: 0 });
  const uploads = fileList({ max: fileMax, onError, ...fileOptions });
  let mode = 'prompts';
  const promptBody = el('div', {}, prompts.bare.rows, prompts.bare.add);
  const uploadBody = el('div', { hidden: true }, uploads.node);
  const promptButton = el('button', { type: 'button', 'aria-pressed': 'true', onclick: () => pick('prompts') }, 'Написать промты');
  const uploadButton = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => pick('uploads') }, 'Загрузить свои');
  const counter = el('span', { class: 'counter' }, `до ${promptMax}`);
  function pick(value) {
    mode = value;
    promptButton.setAttribute('aria-pressed', String(mode === 'prompts'));
    uploadButton.setAttribute('aria-pressed', String(mode === 'uploads'));
    promptBody.hidden = mode !== 'prompts';
    uploadBody.hidden = mode !== 'uploads';
    counter.textContent = `до ${mode === 'prompts' ? promptMax : fileMax}`;
  }
  return {
    node: el('div', { class: 'group' },
      el('div', { class: 'group-head' }, el('span', { class: 'group-title' }, title), counter),
      el('p', { class: 'hint' }, hint),
      el('div', { class: 'switch' }, promptButton, uploadButton),
      promptBody, uploadBody),
    prompts: () => (mode === 'prompts' ? prompts.values() : []),
    files: () => (mode === 'uploads' ? uploads.files : []),
  };
}

function formatPicker(max) {
  const chosen = [];
  const buttons = FORMATS.map((format) => el('button', {
    class: 'format', type: 'button', 'aria-pressed': 'false',
    onclick: () => {
      const index = chosen.indexOf(format);
      if (index >= 0) chosen.splice(index, 1);
      else { if (chosen.length >= max) chosen.shift(); chosen.push(format); }
      buttons.forEach((button, position) => button.setAttribute('aria-pressed', String(chosen.includes(FORMATS[position]))));
    },
  }, el('strong', {}, `.${format}`), el('small', {}, FORMAT_LABELS[format])));
  return {
    node: el('div', { class: 'group' },
      el('div', { class: 'group-head' }, el('span', { class: 'group-title' }, max === 1 ? 'Формат игры' : `Форматы игры`), el('span', { class: 'counter' }, max === 1 ? 'выбери один' : `выбери до ${max}`)),
      el('div', { class: 'formats' }, buttons)),
    values: () => [...chosen],
  };
}

function viewStudio(planId) {
  const plan = PLANS[planId];
  if (!plan || (plan.priceRsd && !PAYMENTS_ENABLED)) { location.hash = '#/'; return []; }
  const notice = el('div', { 'aria-live': 'polite' });
  const showError = (text) => { notice.replaceChildren(message('error', text)); };

  const prompts = textList({ label: 'Промт игры', max: plan.prompts, placeholder: 'Например: платформер про кота, который собирает рыбу на крышах', required: 1 });
  const descriptions = plan.descriptions ? textList({ label: 'Описание игры', max: plan.descriptions, placeholder: 'Правила, герои, уровни, настроение' }) : null;
  const images = plan.imagePrompts ? mediaGroup({
    title: 'Картинки', promptLabel: 'Промт картинки', placeholder: 'Что должно быть на картинке', promptMax: plan.imagePrompts, fileMax: plan.imageUploads,
    hint: `Свои картинки: PNG, JPG или WEBP, до ${LIMITS.imageBytes / 1024 / 1024} МБ каждая.`, onError: showError,
    fileOptions: { accept: LIMITS.imageTypes.join(','), types: LIMITS.imageTypes, maxBytes: LIMITS.imageBytes, label: 'Выбрать картинки' },
  }) : null;
  const videos = plan.videos ? mediaGroup({
    title: 'Видео', promptLabel: 'Промт видео', placeholder: 'Что должно происходить в видео', promptMax: plan.videos, fileMax: plan.videos,
    hint: `Своё видео: MP4 или WEBM, до ${LIMITS.videoBytes / 1024 / 1024} МБ каждое.`, onError: showError,
    fileOptions: { accept: LIMITS.videoTypes.join(','), types: LIMITS.videoTypes, maxBytes: LIMITS.videoBytes, label: 'Выбрать видео' },
  }) : null;
  const formats = formatPicker(plan.formats);
  const submit = el('button', { class: 'play', type: 'submit' }, plan.priceRsd ? `Оплатить ${plan.priceRsd} дин ↗` : 'Создать игру ↗');

  async function onSubmit(event) {
    event.preventDefault();
    notice.replaceChildren();
    const draft = {
      prompts: prompts.values(),
      descriptions: descriptions?.values() ?? [],
      imagePrompts: images?.prompts() ?? [],
      videoPrompts: videos?.prompts() ?? [],
      formats: formats.values(),
    };
    const imageFiles = images?.files() ?? [];
    const videoFiles = videos?.files() ?? [];
    const { errors } = validateOrder(plan.id, draft);
    if (errors.length) { showError(errors.join('. ')); return; }
    submit.disabled = true;
    try {
      notice.replaceChildren(message('info', imageFiles.length + videoFiles.length ? 'Загружаем файлы…' : 'Создаём заказ…'));
      const upload = (file) => api.uploadFile(state.user, file);
      draft.imageUploads = await Promise.all(imageFiles.map(upload));
      draft.videoUploads = await Promise.all(videoFiles.map(upload));
      const result = await api.createJob(plan.id, draft);
      if (result.checkout_url) location.href = result.checkout_url;
      else location.hash = '#/games';
    } catch (failure) {
      showError(failure.message);
      submit.disabled = false;
    }
  }

  const { note } = formatPrice(plan.priceRsd, state.currency, state.rates);
  return el('section', { class: 'narrow page' },
    setupBanner(),
    el('div', { class: 'section-kicker' }, `План ${plan.name}`),
    el('h1', {}, plan.priceRsd ? 'Опиши свою игру' : 'Попробуй бесплатно'),
    el('p', { class: 'lead' }, plan.priceRsd
      ? 'Заполни форму и оплати. После оплаты мы сделаем игру вручную, а файл и инструкция появятся в разделе «Мои игры».'
      : 'Напиши промт и выбери формат. Мы сделаем игру вручную, а файл и инструкция появятся в разделе «Мои игры».'),
    el('form', { class: 'panel', onsubmit: onSubmit, novalidate: true },
      prompts.node, descriptions?.node ?? null, images?.node ?? null, videos?.node ?? null, formats.node,
      el('div', { class: 'submit' },
        plan.priceRsd ? el('div', { class: 'total' }, 'К оплате: ', el('strong', {}, `${plan.priceRsd} дин`), note ? ` ${note}` : '') : el('span'),
        submit),
      notice),
  );
}

function jobCard(job) {
  const [label, tone] = STATUS[job.status] ?? [job.status, ''];
  const notes = {
    queued: 'Заявка принята. Игру делают вручную, файл и инструкция появятся здесь, когда она будет готова.',
    failed: job.error || 'Что-то пошло не так.',
  };
  const download = (path, name, text, className) => el('button', {
    class: className, type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try { location.href = await api.downloadUrl(path, name); } catch (failure) { button.after(message('error', failure.message)); }
      button.disabled = false;
    },
  }, text);
  return el('article', { class: 'panel job' },
    el('div', { class: 'job-head' },
      el('div', {}, el('div', { class: 'meta' }, `${PLANS[job.plan]?.name ?? job.plan} · ${job.formats.map((f) => `.${f}`).join(', ')}`), el('h3', {}, job.title || 'Новая игра')),
      el('span', { class: `badge ${tone}` }, label)),
    notes[job.status] ? el('p', { class: 'job-note' }, notes[job.status]) : null,
    job.status === 'awaiting_payment' && job.checkout_url ? el('div', { class: 'downloads' }, el('a', { class: 'play', href: job.checkout_url }, 'Оплатить ↗')) : null,
    job.artifacts.map((item) => el('div', { class: 'downloads' },
      download(item.file, item.file_name, `Скачать .${item.format} ↓`, 'play'),
      download(item.guide, 'КАК_ЗАПУСТИТЬ.txt', 'Как запустить ↓', 'ghost'))),
  );
}

function viewGames() {
  const list = el('div', {}, message('info', 'Загружаем…'));
  async function refresh() {
    if (!list.isConnected) return;
    try {
      const jobs = await api.listJobs(state.user);
      list.replaceChildren(...(jobs.length ? jobs.map(jobCard) : [el('div', { class: 'panel empty' }, 'Здесь появятся твои игры.', el('br'), el('a', { class: 'play', href: '#/' }, 'Выбрать план ↗'))]));
      if (jobs.some((job) => ['queued', 'awaiting_payment'].includes(job.status))) pollTimer = setTimeout(refresh, 6000);
    } catch (failure) {
      list.replaceChildren(message('error', failure.message));
    }
  }
  queueMicrotask(refresh);
  return el('section', { class: 'narrow page' },
    el('div', { class: 'section-kicker' }, 'Твоя коллекция'), el('h1', {}, 'Мои игры'),
    el('p', { class: 'lead' }, 'Готовые файлы появятся здесь, страница обновляется сама.'), list);
}

function fileLinks(paths, label) {
  return paths.map((path, index) => el('button', {
    class: 'ghost', type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      // Вкладку открываем сразу: после await браузер посчитал бы её всплывающим окном.
      const tab = window.open('', '_blank');
      try {
        const url = await api.uploadUrl(path);
        if (tab) tab.location.href = url;
        else location.href = url;
      } catch (failure) {
        tab?.close();
        button.after(message('error', failure.message));
      }
    },
  }, `${label} ${index + 1} ↗`));
}

function orderSection(title, items) {
  return items.length ? el('div', { class: 'order-section' }, el('strong', {}, title), items.map((text) => el('p', {}, text))) : null;
}

function orderCard(job) {
  const [label, tone] = STATUS[job.status] ?? [job.status, ''];
  const order = job.request;
  const files = [...fileLinks(order.imageUploads, 'Картинка'), ...fileLinks(order.videoUploads, 'Видео')];
  const copy = el('button', {
    class: 'ghost', type: 'button',
    onclick: async () => { await navigator.clipboard.writeText(job.id); copy.textContent = 'Скопировано'; },
  }, 'Скопировать номер');
  return el('article', { class: 'panel job' },
    el('div', { class: 'job-head' },
      el('div', {}, el('div', { class: 'meta' }, `${PLANS[job.plan]?.name ?? job.plan} · ${job.formats.map((f) => `.${f}`).join(', ')}`),
        el('h3', {}, new Date(job.created_at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }))),
      el('span', { class: `badge ${tone}` }, label)),
    el('p', { class: 'job-note' }, `Заказчик: ${job.customer_email || 'неизвестен'}`),
    el('p', { class: 'job-note order-id' }, job.id),
    orderSection('Промт игры', order.prompts),
    orderSection('Описания', order.descriptions),
    orderSection('Промты картинок', order.imagePrompts),
    orderSection('Промты видео', order.videoPrompts),
    el('div', { class: 'downloads' }, copy, files),
  );
}

function viewOrders() {
  const list = el('div', {}, message('info', 'Загружаем…'));
  const count = el('p', { class: 'lead' }, 'Новые заявки появятся здесь сами.');
  async function refresh() {
    if (!list.isConnected) return;
    try {
      const orders = await api.listOrders();
      const waiting = orders.filter((job) => job.status === 'queued').length;
      count.textContent = `Ждут выполнения: ${waiting}. Новые заявки появятся здесь сами.`;
      list.replaceChildren(...(orders.length ? orders.map(orderCard) : [el('div', { class: 'panel empty' }, 'Заявок пока нет.')]));
      pollTimer = setTimeout(refresh, 30000);
    } catch (failure) {
      list.replaceChildren(message('error', failure.message));
    }
  }
  queueMicrotask(refresh);
  return el('section', { class: 'narrow page' },
    el('div', { class: 'section-kicker' }, 'Только для владельца'), el('h1', {}, 'Заявки'), count, list);
}

async function route() {
  clearTimeout(pollTimer);
  const [, page, param] = (location.hash || '#/').split('/');
  const needsAccount = page === 'studio' || page === 'games' || page === 'orders';
  if (needsAccount && !state.user) {
    location.hash = `#/login/${encodeURIComponent(location.hash)}`;
    return;
  }
  if (page === 'orders' && !state.admin) {
    location.hash = '#/';
    return;
  }
  const view = page === 'studio' ? viewStudio(param)
    : page === 'orders' ? viewOrders()
    : page === 'games' ? viewGames()
    : page === 'login' ? viewLogin(location.hash.split('/').slice(2).join('/') ? decodeURIComponent(location.hash.split('/').slice(2).join('/')) : '')
    : viewHome();
  root.replaceChildren(...[view].flat());
  if (location.hash !== '#plans') window.scrollTo(0, 0);
}

// Запрос к базе внутри этого обработчика заблокировал бы клиент Supabase, поэтому откладываем его.
api.onAuthChange((user) => { setTimeout(() => setUser(user)); });
window.addEventListener('hashchange', route);
await setUser(await api.user());
loadRates().then((rates) => { state.rates = rates; });
route();
