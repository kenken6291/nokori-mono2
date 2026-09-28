/* のこりものレシピ — app.js（SPA / vanilla JS） */
'use strict';

/* ===== 設定：GASのウェブアプリURL（…/exec）に置き換えてください ===== */
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxns2T5Ic1C5EGkW33jKfPR4j258w572kTaIFqm_0BTnobtze8Hbnkl_7l1R17kcnWS/exec',
  TIMEOUT_MS: 90000,
};

const SESSION_KEY = 'nokori.session.v1';
const PREFS_KEY = 'nokori.prefs.v1';
const MAX_INGREDIENTS = 20;

const QUICK_INGREDIENTS = ['卵', '玉ねぎ', 'にんじん', 'キャベツ', 'じゃがいも', '長ねぎ', 'もやし', 'ピーマン', '大根', 'トマト', '豆腐', '豚こま肉', '鶏むね肉', 'ひき肉', 'ベーコン', 'ツナ缶', 'ちくわ', 'ごはん'];
const SEASONINGS = ['塩', 'こしょう', '醤油', '砂糖', 'みりん', '酒', '酢', '味噌', 'サラダ油', 'ごま油', 'オリーブ油', 'バター', 'マヨネーズ', 'ケチャップ', 'ソース', 'ポン酢', 'めんつゆ', 'だしの素', '鶏ガラスープの素', 'コンソメ', 'オイスターソース', 'にんにく', 'しょうが', '片栗粉', '小麦粉', 'カレー粉', '豆板醤', '白ごま'];
const BASIC_SEASONINGS = ['塩', 'こしょう', '醤油', '砂糖', 'みりん', '酒', 'サラダ油'];
const TIME_OPTIONS = [[0, '指定なし'], [10, '10分'], [20, '20分'], [30, '30分'], [60, '60分']];
const GENRES = ['おまかせ', '和食', '洋食', '中華', '韓国風', 'エスニック', '汁物・スープ', 'おつまみ', 'お弁当向き'];
const MAGNET_COLORS = ['#F2C84B', '#8CC3EC', '#86C997', '#F5A97F', '#C7A3E6', '#F29C94'];
const MAGNET_TILT = [-3, -1.5, 1, 2.5, -2, 0.5, 3];
const LOADING_LINES = ['冷蔵庫の中身を確認しています…', '食材の組み合わせを考えています…', '調味料と相談しています…', '作り方をまとめています…'];

const ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/></svg>';

const PW_RULE = /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7E]{8,64}$/;

const state = {
  token: '',
  user: null,
  tempPassword: '',
  ingredients: [],
  seasonings: new Set(),
  recipes: new Map(),     // id -> { id, title, favorite, imageUrl, imageData, createdAt, recipe, input }
  results: [],
  history: [],
  favorites: [],
  loaded: { history: false, favorites: false },
  currentTab: 'make',
  openRecipeId: null,
};

/* ========== 小道具 ========== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hashCode(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === new Date().getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}年${md}`;
}

let toastTimer = null;
function toast(message, type = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast show' + (type === 'error' ? ' is-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), type === 'error' ? 5000 : 3200);
}

function showLoading(lines) {
  const box = $('#loading');
  const text = $('#loading-text');
  let i = 0;
  text.textContent = lines[0];
  box.hidden = false;
  const timer = setInterval(() => { i = (i + 1) % lines.length; text.textContent = lines[i]; }, 2600);
  return () => { clearInterval(timer); box.hidden = true; };
}

function setBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = 'お待ちください…';
    btn.disabled = true;
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = false;
  }
}

function formMsg(form, message, type = 'error') {
  const p = $('.form-msg', form);
  if (!p) return;
  p.textContent = message || '';
  p.className = 'form-msg' + (message ? ` is-${type}` : '');
}

function checkNewPassword(current, next, confirm) {
  if (!PW_RULE.test(next)) return '新しいパスワードは英字と数字を両方含む8〜64文字（半角）にしてください';
  if (next !== confirm) return '確認用のパスワードが一致しません';
  if (current === next) return '新しいパスワードは、今のパスワードと別のものにしてください';
  return '';
}

/* ========== 通信 ========== */

async function api(action, payload = {}) {
  if (CONFIG.GAS_URL.includes('XXXXXXXX')) {
    throw new Error('app.js の GAS_URL が未設定です（GASのウェブアプリURLを入れてください）');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
  let res;
  try {
    res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      // text/plain にするとプリフライト（OPTIONS）が発生せず、GASでもCORSエラーになりません
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: state.token || undefined, ...payload }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? '時間がかかりすぎたため中断しました。もう一度お試しください'
      : '通信できませんでした。電波の状態を確認してください');
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('サーバーの応答を読み取れませんでした（GASのデプロイ設定「アクセス：全員」を確認してください）');
  }
  if (!data.ok) {
    const err = new Error(data.error || 'エラーが発生しました');
    err.code = data.code || '';
    if (err.code === 'AUTH' && action !== 'login') handleAuthExpired(err.message);
    if (err.code === 'MUST_CHANGE' && state.user) {
      state.user.mustChangePassword = true;
      showView('change');
    }
    throw err;
  }
  return data;
}

/* ========== セッション ========== */

function saveSession(remember) {
  const data = JSON.stringify({ token: state.token, user: state.user });
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, data);
  } catch (e) { /* プライベートモード等 */ }
}

function updateSession() {
  try {
    const store = localStorage.getItem(SESSION_KEY) ? localStorage : sessionStorage;
    store.setItem(SESSION_KEY, JSON.stringify({ token: state.token, user: state.user }));
  } catch (e) { /* noop */ }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !d.token) return false;
    state.token = d.token;
    state.user = d.user || null;
    return true;
  } catch (e) {
    return false;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) { /* noop */ }
  state.token = '';
  state.user = null;
  state.tempPassword = '';
  state.recipes.clear();
  state.results = [];
  state.history = [];
  state.favorites = [];
  state.loaded = { history: false, favorites: false };
  state.currentTab = 'make';
}

function handleAuthExpired(message) {
  closeDialog();
  clearSession();
  $('#results').innerHTML = '';
  showView('auth');
  setAuthTab('login');
  toast(message || 'もう一度ログインしてください', 'error');
}

function logout() {
  closeDialog();
  clearSession();
  $('#results').innerHTML = '';
  showView('auth');
  setAuthTab('login');
  toast('ログアウトしました');
}

/* ========== 画面切り替え ========== */

function showView(name) {
  ['auth', 'change', 'main'].forEach((v) => { $(`#view-${v}`).hidden = v !== name; });
  $('#tabbar').hidden = name !== 'main';
  if (name === 'change') {
    const f = $('#form-change-forced');
    if (state.tempPassword && !f.currentPassword.value) f.currentPassword.value = state.tempPassword;
  }
  renderHeader();
  window.scrollTo(0, 0);
}

function renderHeader() {
  const box = $('#topbar-user');
  if (state.user && state.token) {
    box.hidden = false;
    $('#topbar-nickname').textContent = `${state.user.nickname} さん`;
  } else {
    box.hidden = true;
  }
}

function enterApp() {
  if (state.user && state.user.mustChangePassword) {
    showView('change');
    return;
  }
  showView('main');
  switchTab(state.currentTab || 'make');
}

function switchTab(tab) {
  state.currentTab = tab;
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  $$('.tabbar [data-tab]').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (tab === 'history' || tab === 'favorites') loadList(tab);
  if (tab === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function setAuthTab(name) {
  $$('[data-auth-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.authTab === name)));
  $$('[data-auth-panel]').forEach((p) => {
    p.hidden = p.dataset.authPanel !== name;
    formMsg(p, '');
  });
}

/* ========== パスワード表示切り替え ========== */

function setupPasswordToggles() {
  $$('input[type="password"]').forEach((input) => {
    if (input.parentElement.classList.contains('pw-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'パスワードを表示');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = ICON_EYE;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? ICON_EYE_OFF : ICON_EYE;
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示');
    });
    wrap.appendChild(btn);
  });
}

function hidePasswords(form) {
  $$('.pw-wrap', form).forEach((wrap) => {
    const input = $('input', wrap);
    const btn = $('.pw-toggle', wrap);
    input.type = 'password';
    btn.innerHTML = ICON_EYE;
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'パスワードを表示');
  });
}

/* ========== 認証フォーム ========== */

function bindAuthForms() {
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = $('[type="submit"]', f);
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!email || !password) return formMsg(f, 'メールアドレスとパスワードを入力してください');
    formMsg(f, '');
    setBusy(btn, true);
    try {
      const d = await api('login', { email, password });
      state.token = d.token;
      state.user = d.user;
      state.tempPassword = d.user.mustChangePassword ? password : '';
      saveSession(f.remember.checked);
      f.password.value = '';
      hidePasswords(f);
      enterApp();
      if (!d.user.mustChangePassword) toast(`${d.user.nickname}さん、おかえりなさい`);
    } catch (err) {
      formMsg(f, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  $('#form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = $('[type="submit"]', f);
    const email = f.email.value.trim();
    const nickname = f.nickname.value.trim();
    if (!email || !nickname) return formMsg(f, 'メールアドレスとニックネームを入力してください');
    formMsg(f, '');
    setBusy(btn, true);
    try {
      await api('register', { email, nickname });
      f.reset();
      setAuthTab('login');
      const login = $('#form-login');
      login.email.value = email;
      formMsg(login, `${email} に仮パスワードを送りました。メールに書かれた仮パスワードでログインしてください。`, 'success');
      login.password.focus();
    } catch (err) {
      formMsg(f, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  $('#form-reset').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = $('[type="submit"]', f);
    const email = f.email.value.trim();
    if (!email) return formMsg(f, 'メールアドレスを入力してください');
    formMsg(f, '');
    setBusy(btn, true);
    try {
      const d = await api('resetPassword', { email });
      f.reset();
      setAuthTab('login');
      const login = $('#form-login');
      login.email.value = email;
      formMsg(login, `${d.message}。届いた仮パスワードでログインしてください。`, 'success');
    } catch (err) {
      formMsg(f, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  const changeHandler = (isForced) => async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = $('[type="submit"]', f);
    const cur = f.currentPassword.value;
    const next = f.newPassword.value;
    const conf = f.confirmPassword.value;
    if (!cur) return formMsg(f, isForced ? '仮パスワードを入力してください' : '今のパスワードを入力してください');
    const problem = checkNewPassword(cur, next, conf);
    if (problem) return formMsg(f, problem);
    formMsg(f, '');
    setBusy(btn, true);
    try {
      const d = await api('changePassword', { currentPassword: cur, newPassword: next });
      state.token = d.token;
      state.user = d.user;
      state.tempPassword = '';
      updateSession();
      f.reset();
      hidePasswords(f);
      if (isForced) {
        toast('パスワードを設定しました');
        enterApp();
      } else {
        formMsg(f, 'パスワードを変更しました', 'success');
      }
    } catch (err) {
      if (err.code !== 'AUTH') formMsg(f, err.message);
    } finally {
      setBusy(btn, false);
    }
  };
  $('#form-change-forced').addEventListener('submit', changeHandler(true));
  $('#form-change').addEventListener('submit', changeHandler(false));

  $('#form-nickname').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = $('[type="submit"]', f);
    const nickname = f.nickname.value.trim();
    if (!nickname) return formMsg(f, 'ニックネームを入力してください');
    setBusy(btn, true);
    try {
      const d = await api('updateNickname', { nickname });
      state.user = d.user;
      updateSession();
      renderHeader();
      formMsg(f, 'ニックネームを保存しました', 'success');
    } catch (err) {
      if (err.code !== 'AUTH') formMsg(f, err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}

function renderSettings() {
  if (!state.user) return;
  $('#set-email').textContent = state.user.email;
  $('#set-nickname').value = state.user.nickname;
  $$('[data-panel="settings"] .form-msg').forEach((p) => { p.textContent = ''; p.className = 'form-msg'; });
}

/* ========== 食材・条件入力 ========== */

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function savePrefs() {
  const f = $('#form-make');
  const prefs = {
    seasonings: [...state.seasonings],
    maxMinutes: f.maxMinutes.value,
    genre: f.genre.value,
    servings: f.servings.value,
    allowShopping: f.allowShopping.checked,
  };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* noop */ }
}

function buildMakeForm() {
  const prefs = loadPrefs();
  const f = $('#form-make');

  state.seasonings = new Set(Array.isArray(prefs.seasonings) ? prefs.seasonings : BASIC_SEASONINGS);
  $('#seasoning-list').innerHTML = SEASONINGS
    .map((s) => `<button type="button" class="toggle" data-season-toggle="${esc(s)}" aria-pressed="false">${esc(s)}</button>`)
    .join('');
  renderSeasonings();

  $('#time-list').innerHTML = TIME_OPTIONS
    .map(([v, label]) => `<label class="seg"><input type="radio" name="maxMinutes" value="${v}"><span>${label}</span></label>`)
    .join('');
  const minutes = String(prefs.maxMinutes ?? '0');
  const radio = $(`input[name="maxMinutes"][value="${minutes}"]`) || $('input[name="maxMinutes"]');
  radio.checked = true;

  f.genre.innerHTML = GENRES.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  f.genre.value = GENRES.includes(prefs.genre) ? prefs.genre : 'おまかせ';
  f.servings.innerHTML = [1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}人分</option>`).join('');
  f.servings.value = String(prefs.servings || 2);
  f.allowShopping.checked = !!prefs.allowShopping;

  f.addEventListener('change', savePrefs);
  f.addEventListener('submit', (e) => { e.preventDefault(); generate(); });

  const input = $('#ing-input');
  input.addEventListener('keydown', (e) => {
    // 日本語入力の変換確定のEnterでは追加しない
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      addFromInput();
    }
  });
  const splitIfNeeded = (e) => {
    if (e.isComposing) return;
    if (/[,、，]/.test(input.value)) addFromInput();
  };
  input.addEventListener('input', splitIfNeeded);
  input.addEventListener('compositionend', splitIfNeeded);
  $('#ing-add').addEventListener('click', () => addFromInput());

  renderMagnets();
}

function addFromInput() {
  const input = $('#ing-input');
  const text = input.value;
  if (!text.trim()) { input.focus(); return; }
  addIngredients(text);
  input.value = '';
  input.focus();
}

function addIngredients(text) {
  const names = String(text)
    .split(/[,、，\n]+/)
    .map((s) => s.trim().replace(/\s+/g, ' ').slice(0, 30))
    .filter(Boolean);
  const added = [];
  for (const name of names) {
    if (state.ingredients.includes(name)) continue;
    if (state.ingredients.length >= MAX_INGREDIENTS) {
      toast(`食材は${MAX_INGREDIENTS}個まで入れられます`);
      break;
    }
    state.ingredients.push(name);
    added.push(name);
  }
  renderMagnets(added);
  return added;
}

function removeIngredient(name) {
  state.ingredients = state.ingredients.filter((x) => x !== name);
  renderMagnets();
}

function renderMagnets(newOnes = []) {
  const ul = $('#magnets');
  if (!state.ingredients.length) {
    ul.innerHTML = '<li class="magnets-empty">まだ食材がありません。下の欄に入力するか、「よく余るもの」から選んでください。</li>';
  } else {
    ul.innerHTML = state.ingredients.map((name) => {
      const h = hashCode(name);
      const color = MAGNET_COLORS[h % MAGNET_COLORS.length];
      const tilt = MAGNET_TILT[h % MAGNET_TILT.length];
      const cls = newOnes.includes(name) ? 'magnet is-new' : 'magnet';
      return `<li class="${cls}" style="--c:${color};--r:${tilt}deg"><span>${esc(name)}</span>`
        + `<button type="button" class="magnet-x" data-remove="${esc(name)}" aria-label="${esc(name)}を外す">×</button></li>`;
    }).join('');
  }
  renderQuick();
}

function renderQuick() {
  $('#quick-list').innerHTML = QUICK_INGREDIENTS
    .map((n) => `<button type="button" class="quick-btn" data-quick="${esc(n)}" aria-pressed="${state.ingredients.includes(n)}">${esc(n)}</button>`)
    .join('');
}

function renderSeasonings() {
  $$('[data-season-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(state.seasonings.has(b.dataset.seasonToggle))));
}

/* ========== レシピ生成 ========== */

async function generate() {
  if (!state.ingredients.length) {
    toast('冷蔵庫にある食材を1つ以上入れてください');
    $('#ing-input').focus();
    return;
  }
  const f = $('#form-make');
  const btn = $('[type="submit"]', f);
  savePrefs();
  setBusy(btn, true);
  const stop = showLoading(LOADING_LINES);
  try {
    const d = await api('generateRecipe', {
      ingredients: state.ingredients,
      seasonings: [...state.seasonings],
      maxMinutes: Number(f.maxMinutes.value),
      genre: f.genre.value,
      servings: Number(f.servings.value),
      allowShopping: f.allowShopping.checked,
      note: f.note.value.trim(),
      count: 3,
    });
    d.recipes.forEach(cacheRecipe);
    state.results = d.recipes.map((r) => r.id);
    if (state.loaded.history) state.history = [...state.results, ...state.history];
    renderResults();
    requestAnimationFrame(() => $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (err) {
    if (err.code !== 'AUTH') toast(err.message, 'error');
  } finally {
    stop();
    setBusy(btn, false);
  }
}

function cacheRecipe(item) {
  const prev = state.recipes.get(item.id);
  if (prev && prev.imageData && prev.imageUrl === item.imageUrl) item.imageData = prev.imageData;
  state.recipes.set(item.id, item);
}

function favButton(item) {
  return `<button type="button" class="fav" data-fav="${esc(item.id)}" aria-pressed="${item.favorite}" `
    + `aria-label="${item.favorite ? 'お気に入りから外す' : 'お気に入りに追加'}">${ICON_STAR}</button>`;
}

function renderResults() {
  const box = $('#results');
  const items = state.results.map((id) => state.recipes.get(id)).filter(Boolean);
  if (!items.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<h2 class="results-title">こんなレシピはどうでしょう</h2>`
    + `<div class="cards">${items.map(recipeCard).join('')}</div>`
    + `<p class="results-note">提案したレシピは「履歴」にも残ります。</p>`;
}

function recipeCard(item) {
  const r = item.recipe;
  const fromFridge = r.ingredients.filter((x) => x.fromFridge).length;
  const extra = r.ingredients.filter((x) => !x.fromFridge).length;
  return `<article class="card">
    <button type="button" class="card-open" data-open="${esc(item.id)}">
      <span class="card-title">${esc(r.title)}</span>
      ${r.summary ? `<span class="card-summary">${esc(r.summary)}</span>` : ''}
      <span class="pills">
        <span class="pill">${r.cookingTimeMinutes}分</span>
        <span class="pill">${esc(r.difficulty)}</span>
        <span class="pill pill-mint">冷蔵庫から${fromFridge}品</span>
        ${extra ? `<span class="pill pill-butter">買い足し${extra}品</span>` : ''}
      </span>
      <span class="card-cta">作り方を見る</span>
    </button>
    ${favButton(item)}
  </article>`;
}

/* ========== 履歴・お気に入り ========== */

async function loadList(kind) {
  const box = $(`#${kind}-list`);
  if (state.loaded[kind]) renderList(kind);
  else box.innerHTML = '<p class="list-status">読み込んでいます…</p>';
  try {
    const d = await api(kind === 'history' ? 'getHistory' : 'getFavorites', { limit: 60 });
    d.recipes.forEach(cacheRecipe);
    state[kind] = d.recipes.map((r) => r.id);
    state.loaded[kind] = true;
    if (state.currentTab === kind) renderList(kind);
  } catch (err) {
    if (err.code === 'AUTH') return;
    if (!state.loaded[kind]) box.innerHTML = `<p class="list-status">${esc(err.message)}</p>`;
    else toast(err.message, 'error');
  }
}

function renderList(kind) {
  const box = $(`#${kind}-list`);
  let items = state[kind].map((id) => state.recipes.get(id)).filter(Boolean);
  if (kind === 'favorites') items = items.filter((x) => x.favorite);
  if (!items.length) {
    box.innerHTML = kind === 'history'
      ? `<div class="empty"><strong>まだレシピがありません</strong><p>冷蔵庫の食材を入れて、最初のレシピを考えてもらいましょう。</p><button type="button" class="btn btn-outline" data-go="make">食材を入れる</button></div>`
      : `<div class="empty"><strong>お気に入りはまだありません</strong><p>レシピの星のボタンを押すと、ここに集まります。</p></div>`;
    return;
  }
  box.innerHTML = items.map(listRow).join('');
}

function listRow(item) {
  const r = item.recipe;
  const src = item.imageData || item.imageUrl;
  const thumb = src
    ? `<img src="${esc(src)}" alt="" loading="lazy" data-rid="${esc(item.id)}">`
    : '<span aria-hidden="true">🍳</span>';
  return `<article class="row">
    <button type="button" class="row-open" data-open="${esc(item.id)}">
      <span class="row-thumb">${thumb}</span>
      <span class="row-text">
        <span class="row-title">${esc(r.title || item.title)}</span>
        <span class="row-sub"><span>${esc(formatDate(item.createdAt))}</span><span>${r.cookingTimeMinutes}分</span></span>
      </span>
    </button>
    ${favButton(item)}
  </article>`;
}

function refreshAll(id) {
  renderResults();
  if (state.loaded.history) renderList('history');
  if (state.loaded.favorites) renderList('favorites');
  const dlg = $('#recipe-dialog');
  if (dlg.open && state.openRecipeId === id) {
    const top = dlg.scrollTop;
    renderDialog(state.recipes.get(id));
    dlg.scrollTop = top;
  }
}

async function toggleFavorite(id) {
  const item = state.recipes.get(id);
  if (!item) return;
  const next = !item.favorite;
  item.favorite = next;
  if (next && !state.favorites.includes(id)) state.favorites.unshift(id);
  refreshAll(id);
  try {
    await api('toggleFavorite', { recipeId: id, favorite: next });
    toast(next ? 'お気に入りに追加しました' : 'お気に入りから外しました');
  } catch (err) {
    item.favorite = !next;
    refreshAll(id);
    if (err.code !== 'AUTH') toast(err.message, 'error');
  }
}

async function deleteRecipe(id) {
  if (!confirm('このレシピを削除しますか？\n写真も一緒に削除され、元に戻せません。')) return;
  try {
    await api('deleteRecipe', { recipeId: id });
    state.recipes.delete(id);
    ['results', 'history', 'favorites'].forEach((k) => { state[k] = state[k].filter((x) => x !== id); });
    closeDialog();
    refreshAll(null);
    toast('レシピを削除しました');
  } catch (err) {
    if (err.code !== 'AUTH') toast(err.message, 'error');
  }
}

/* ========== レシピ詳細（ダイアログ） ========== */

function openRecipe(id) {
  const item = state.recipes.get(id);
  if (!item) return;
  state.openRecipeId = id;
  renderDialog(item);
  const dlg = $('#recipe-dialog');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

function closeDialog() {
  const dlg = $('#recipe-dialog');
  if (dlg.open) dlg.close();
  state.openRecipeId = null;
}

function renderDialog(item) {
  if (!item) return;
  const r = item.recipe;
  const src = item.imageData || item.imageUrl;
  const servings = r.servings || (item.input && item.input.servings) || '';
  const ingItem = (x, showTag) => `<li>
      <span class="ing-name">${esc(x.name)}${showTag && !x.fromFridge ? '<em class="tag-buy">買い足し</em>' : ''}</span>
      <span class="leader" aria-hidden="true"></span>
      <span class="ing-amt">${esc(x.amount)}</span>
    </li>`;

  $('#recipe-dialog').innerHTML = `<div class="sheet">
    <div class="sheet-bar">
      <button type="button" class="sheet-close" data-close>閉じる</button>
      ${favButton(item)}
    </div>

    <figure class="dish">
      ${src
        ? `<img src="${esc(src)}" alt="${esc(r.title)}の写真" data-rid="${esc(item.id)}">`
        : '<div class="dish-empty" aria-hidden="true">🍽️</div>'}
      <label class="btn btn-outline dish-upload">
        <input type="file" accept="image/*" class="sr-only" data-photo="${esc(item.id)}">
        <span>${src ? '写真を変える' : '作った料理の写真を追加'}</span>
      </label>
    </figure>

    <h2 id="dlg-title" class="sheet-title">${esc(r.title)}</h2>
    ${r.summary ? `<p class="sheet-summary">${esc(r.summary)}</p>` : ''}
    <div class="pills">
      <span class="pill">${r.cookingTimeMinutes}分</span>
      ${servings ? `<span class="pill">${esc(servings)}人分</span>` : ''}
      <span class="pill">${esc(r.difficulty)}</span>
      ${r.genre ? `<span class="pill pill-mint">${esc(r.genre)}</span>` : ''}
    </div>

    <section class="sec">
      <h3>材料${servings ? `<small>${esc(servings)}人分</small>` : ''}</h3>
      <ul class="ing-list">${r.ingredients.map((x) => ingItem(x, true)).join('')}</ul>
      ${r.seasonings.length ? `<h4>調味料</h4><ul class="ing-list">${r.seasonings.map((x) => ingItem(x, false)).join('')}</ul>` : ''}
    </section>

    <section class="sec">
      <h3>作り方</h3>
      <ol class="steps">${r.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol>
    </section>

    ${r.tips ? `<section class="sec tips"><h3>おいしく作るコツ</h3><p>${esc(r.tips)}</p></section>` : ''}

    ${r.substitutions.length ? `<section class="sec">
      <h3>材料がないときは</h3>
      <ul class="subs">${r.substitutions.map((s) => `<li><strong>${esc(s.from)}</strong>の代わりに：${esc(s.to)}</li>`).join('')}</ul>
    </section>` : ''}

    <p class="sheet-date">${esc(formatDate(item.createdAt))} に提案</p>
    <div class="sheet-actions">
      <button type="button" class="btn btn-outline" data-copy="${esc(item.id)}">テキストでコピー</button>
      <button type="button" class="btn btn-danger-text" data-delete="${esc(item.id)}">このレシピを削除</button>
    </div>
  </div>`;
}

function recipeText(item) {
  const r = item.recipe;
  const lines = [`【${r.title}】`];
  if (r.summary) lines.push(r.summary);
  lines.push(`調理時間 ${r.cookingTimeMinutes}分${r.servings ? `／${r.servings}人分` : ''}`, '', '■材料');
  r.ingredients.forEach((x) => lines.push(`・${x.name}　${x.amount}`));
  r.seasonings.forEach((x) => lines.push(`・${x.name}　${x.amount}`));
  lines.push('', '■作り方');
  r.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  if (r.tips) lines.push('', '■コツ', r.tips);
  return lines.join('\n');
}

async function copyRecipe(id) {
  const item = state.recipes.get(id);
  if (!item) return;
  const text = recipeText(item);
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    $('#recipe-dialog').appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('レシピをコピーしました');
}

/* ========== 写真 ========== */

function compressImage(file, maxSize = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('この画像は読み込めませんでした。別の写真をお試しください'));
    };
    img.src = url;
  });
}

async function uploadPhoto(id, file, label) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    toast('画像ファイルを選んでください', 'error');
    return;
  }
  label && label.classList.add('is-busy');
  const stop = showLoading(['写真を小さくしています…', '写真を保存しています…']);
  try {
    const dataUrl = await compressImage(file);
    const d = await api('uploadImage', { recipeId: id, image: dataUrl });
    const item = state.recipes.get(id);
    if (item) {
      item.imageUrl = d.imageUrl;
      item.imageData = dataUrl; // 手元の画像をすぐ表示
    }
    refreshAll(id);
    toast('写真を保存しました');
  } catch (err) {
    if (err.code !== 'AUTH') toast(err.message, 'error');
  } finally {
    stop();
    label && label.classList.remove('is-busy');
  }
}

// Driveの共有リンクで表示できないときは、GAS経由で画像を取得する
async function imageFallback(img) {
  const id = img.dataset.rid;
  if (!id || img.dataset.fallback) return;
  img.dataset.fallback = '1';
  const item = state.recipes.get(id);
  try {
    const d = await api('getImage', { recipeId: id });
    if (item) item.imageData = d.image;
    img.src = d.image;
  } catch (e) {
    img.replaceWith(Object.assign(document.createElement('span'), { textContent: '🍳' }));
  }
}

/* ========== イベント（まとめて委譲） ========== */

function bindGlobalEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-open]');
    if (!t) return;
    const d = t.dataset;

    if (d.authTab) return setAuthTab(d.authTab);
    if (d.tab) return switchTab(d.tab);
    if (d.go) return switchTab(d.go);
    if (d.action === 'logout') return logout();
    if (d.open) return openRecipe(d.open);
    if (d.fav) return toggleFavorite(d.fav);
    if (d.close !== undefined) return closeDialog();
    if (d.copy) return copyRecipe(d.copy);
    if (d.delete) return deleteRecipe(d.delete);
    if (d.remove) return removeIngredient(d.remove);
    if (d.quick) {
      if (state.ingredients.includes(d.quick)) removeIngredient(d.quick);
      else addIngredients(d.quick);
      return;
    }
    if (d.seasonToggle) {
      if (state.seasonings.has(d.seasonToggle)) state.seasonings.delete(d.seasonToggle);
      else state.seasonings.add(d.seasonToggle);
      renderSeasonings();
      savePrefs();
      return;
    }
    if (d.season) {
      state.seasonings = new Set(d.season === 'all' ? SEASONINGS : d.season === 'basic' ? BASIC_SEASONINGS : []);
      renderSeasonings();
      savePrefs();
    }
  });

  const dlg = $('#recipe-dialog');
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(); });
  dlg.addEventListener('close', () => { state.openRecipeId = null; });
  dlg.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-photo]');
    if (!input) return;
    const file = input.files && input.files[0];
    uploadPhoto(input.dataset.photo, file, input.closest('label'));
    input.value = '';
  });

  document.addEventListener('error', (e) => {
    const el = e.target;
    if (el instanceof HTMLImageElement && el.dataset.rid) imageFallback(el);
  }, true);
}

/* ========== 起動 ========== */

function init() {
  setupPasswordToggles();
  bindAuthForms();
  buildMakeForm();
  bindGlobalEvents();

  if (loadSession()) {
    enterApp();
    // トークンがまだ有効か、最新のユーザー情報を確認
    api('me').then((d) => {
      state.user = d.user;
      updateSession();
      renderHeader();
      if (d.user.mustChangePassword) showView('change');
    }).catch(() => { /* 通信エラー時はそのまま。期限切れならapi()内でログイン画面へ */ });
  } else {
    showView('auth');
    setAuthTab('login');
  }
}

document.addEventListener('DOMContentLoaded', init);
