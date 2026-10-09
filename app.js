/* のこりものレシピ — app.js（SPA / vanilla JS）
   機能: 会員認証 / 残り物からレシピ提案 / 外部レシピの取り込み（URL・文章・写真・まとめて） / レシピ一覧・お気に入り
         家族構成とアレルギーチェック / 1週間の献立づくり / 期間を指定した買い物リスト */
'use strict';

/* ===== バージョン（更新したらここと index.html の ?v= をそろえて上げる） ===== */
const APP_VERSION = '2.1.0';
const APP_BUILD_DATE = '2026-10-10';

/* ===== 設定：GASのURLなどは config.js で指定します ===== */
const CONFIG = {
  GAS_URL: String((window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '').trim(),
  TIMEOUT_MS: Number(window.APP_CONFIG && window.APP_CONFIG.TIMEOUT_MS) || 90000,
};

const SESSION_KEY = 'nokori.session.v1';
const PREFS_KEY = 'nokori.prefs.v1';
const FRIDGE_KEY = 'nokori.fridge.v1';
const MAX_INGREDIENTS = 40;

const QUICK_INGREDIENTS = ['卵', '玉ねぎ', 'にんじん', 'キャベツ', 'じゃがいも', '長ねぎ', 'もやし', 'ピーマン', '大根', 'トマト', '豆腐', '豚こま肉', '鶏むね肉', 'ひき肉', 'ベーコン', 'ツナ缶', 'ちくわ', 'ごはん'];
const SEASONINGS = ['塩', 'こしょう', '醤油', '砂糖', 'みりん', '酒', '酢', '味噌', 'サラダ油', 'ごま油', 'オリーブ油', 'バター', 'マヨネーズ', 'ケチャップ', 'ソース', 'ポン酢', 'めんつゆ', 'だしの素', '鶏ガラスープの素', 'コンソメ', 'オイスターソース', 'にんにく', 'しょうが', '片栗粉', '小麦粉', 'カレー粉', '豆板醤', '白ごま'];
const BASIC_SEASONINGS = ['塩', 'こしょう', '醤油', '砂糖', 'みりん', '酒', 'サラダ油'];
const TIME_OPTIONS = [[0, '指定なし'], [10, '10分'], [20, '20分'], [30, '30分'], [60, '60分']];
const GENRES = ['おまかせ', '和食', '洋食', '中華', '韓国風', 'エスニック', '汁物・スープ', 'おつまみ', 'お弁当向き'];
const MAGNET_COLORS = ['#F2C84B', '#8CC3EC', '#86C997', '#F5A97F', '#C7A3E6', '#F29C94'];
const MAGNET_TILT = [-3, -1.5, 1, 2.5, -2, 0.5, 3];
const MAX_IMPORT_IMAGES = 3;
const IMPORT_LOADING = {
  url: ['ページを読み込んでいます…', '材料と作り方を探しています…', 'レシピを整理しています…'],
  text: ['文章を読んでいます…', 'レシピを整理しています…'],
  image: ['写真の文字を読んでいます…', '材料と作り方を探しています…', 'レシピを整理しています…'],
};
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
  importImages: [],       // 取り込み用に縮小した写真（dataURL）
  pendingImport: '',      // ?import= で渡されたURLや文章
  recipeFilter: 'all',    // レシピ一覧の絞り込み: all / fav / imported / menu
  recipeQuery: '',
  bulkImages: [],         // まとめて取り込む写真
  bulk: { items: [], running: false, stop: false, skipDuplicate: true },
  settings: { household: { members: [], commonAvoid: '' }, menuPrefs: null },
  settingsLoaded: false,
  settingsLoading: null,
  fridgeDirty: false,
  seasoningsDirty: false,
  menu: null,             // 表示中の献立
  menuList: [],
  menuListLoaded: false,
  menuView: 'plan',       // plan / shopping / family
  menuCreating: false,
  menuStart: '',
  menuOverrides: {},      // 'YYYY-MM-DD|dinner' -> 食べる人のID（日ごとの調整）
  famDraft: null,         // 編集中の家族設定
  famDirty: false,
  shopRange: null,
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

let loadingLines = [];
function showLoading(lines) {
  const box = $('#loading');
  const text = $('#loading-text');
  let i = 0;
  loadingLines = lines;
  text.textContent = lines[0];
  box.hidden = false;
  const timer = setInterval(() => { i += 1; text.textContent = loadingLines[i % loadingLines.length]; }, 2600);
  return () => { clearInterval(timer); box.hidden = true; };
}

function setLoadingLines(lines) {
  loadingLines = lines;
  $('#loading-text').textContent = lines[0];
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
  if (!window.APP_CONFIG) {
    throw new Error('config.js が読み込めません（config.js を index.html と同じ場所に置いてください）');
  }
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(CONFIG.GAS_URL)) {
    throw new Error('config.js の GAS_URL が未設定か、形式が正しくありません（…/exec で終わるURLを入れてください）');
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
  state.importImages = [];
  state.bulkImages = [];
  state.bulk = { items: [], running: false, stop: true, skipDuplicate: true };
  state.settings = { household: { members: [], commonAvoid: '' }, menuPrefs: null };
  state.settingsLoaded = false;
  state.fridgeDirty = false;
  state.seasoningsDirty = false;
  state.menu = null;
  state.menuList = [];
  state.menuListLoaded = false;
  state.menuView = 'plan';
  state.menuCreating = false;
  state.menuOverrides = {};
  state.famDraft = null;
  state.famDirty = false;
  state.shopRange = null;
  // 冷蔵庫の中身はアカウントごとにサーバーへ保存しているので、この端末からは消す
  state.ingredients = [];
  try { localStorage.removeItem(FRIDGE_KEY); } catch (e) { /* noop */ }
  clearTimeout(settingsTimer);
  clearTimeout(menuSaveTimer);
  renderMagnets();
  renderImportPhotos();
  renderBulkPhotos();
  renderBulk();
  renderAvoidNotice();
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
  applyPendingImport();
  loadSettings();
}

function switchTab(tab) {
  state.currentTab = tab;
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  $$('.tabbar [data-tab]').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (tab === 'recipes') loadRecipes();
  if (tab === 'menu') openMenuTab();
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
  renderVersion();
  loadServerVersion();
}

/* ========== バージョン情報 ========== */

let serverVersion = null; // { version, build, error }

function renderVersion() {
  $$('[data-app-version]').forEach((el) => { el.textContent = `v${APP_VERSION}`; });
  const box = $('#version-info');
  if (!box) return;
  const sv = serverVersion;
  let server = '確認中…';
  if (sv && sv.error) server = `<span class="ver-warn">確認できませんでした</span>`;
  else if (sv && !sv.version) server = '<span class="ver-warn">古い版です（新しい Code.gs をデプロイしてください）</span>';
  else if (sv) server = `v${esc(sv.version)}${sv.build ? `（${esc(sv.build)}）` : ''}`;
  const mismatch = sv && sv.version && sv.version !== APP_VERSION;
  box.innerHTML = `<dl class="ver-list">
      <dt>アプリ</dt><dd>v${esc(APP_VERSION)}（${esc(APP_BUILD_DATE)}）</dd>
      <dt>サーバー（GAS）</dt><dd>${server}</dd>
      <dt>接続先</dt><dd class="ver-url">${esc(CONFIG.GAS_URL ? CONFIG.GAS_URL.replace(/^(https:\/\/[^/]+\/macros\/s\/)(.{6}).*(.{6})(\/exec)$/, '$1$2…$3$4') : '未設定')}</dd>
    </dl>
    ${mismatch ? '<p class="ver-warn">アプリとサーバーのバージョンが違います。Code.gs を新バージョンでデプロイしたか、ブラウザの再読み込みで最新の画面になっているか確認してください。</p>' : ''}`;
}

async function loadServerVersion(force = false) {
  if (serverVersion && !serverVersion.error && !force) return;
  try {
    const d = await api('version');
    serverVersion = { version: d.version || '', build: d.build || '' };
  } catch (err) {
    // 古いCode.gsは version を知らないので「不明な操作です」になる
    serverVersion = /不明な操作/.test(err.message) ? { version: '' } : { error: err.message };
  }
  renderVersion();
}

/* ========== 食材・条件入力 ========== */

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function savePrefs(sync = true) {
  const f = $('#form-make');
  const prefs = {
    seasonings: [...state.seasonings],
    maxMinutes: f.maxMinutes.value,
    genre: f.genre.value,
    servings: f.servings.value,
    allowShopping: f.allowShopping.checked,
  };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* noop */ }
  if (sync) queueSettingsSave();
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

  f.addEventListener('change', (e) => { if (e.target.name !== 'useFamilyAvoid') savePrefs(); });
  f.addEventListener('submit', (e) => { e.preventDefault(); generate(); });

  // 冷蔵庫の中身（この端末に保存。ログイン後はサーバーの内容に合わせる）
  try {
    const saved = JSON.parse(localStorage.getItem(FRIDGE_KEY) || '[]');
    if (Array.isArray(saved)) state.ingredients = saved.map(String).slice(0, MAX_INGREDIENTS);
  } catch (e) { /* noop */ }

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
  if (added.length) fridgeChanged();
  return added;
}

function removeIngredient(name) {
  state.ingredients = state.ingredients.filter((x) => x !== name);
  renderMagnets();
  fridgeChanged();
}

function clearFridge() {
  if (!state.ingredients.length) return;
  if (!confirm('冷蔵庫の食材をすべて外しますか？')) return;
  state.ingredients = [];
  renderMagnets();
  fridgeChanged();
}

function fridgeChanged() {
  state.fridgeDirty = true;
  try { localStorage.setItem(FRIDGE_KEY, JSON.stringify(state.ingredients)); } catch (e) { /* noop */ }
  queueSettingsSave();
  if (state.currentTab === 'menu' && state.menuView === 'shopping') renderShopFridge();
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
      useFamilyAvoid: hasFamilyRules() && f.useFamilyAvoid.checked,
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
    + `<p class="results-note">提案したレシピは「レシピ」にも残ります。</p>`;
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
        ${ngPill(checkRecipe(r))}
      </span>
      <span class="card-cta">作り方を見る</span>
    </button>
    ${favButton(item)}
  </article>`;
}

function refreshAll(id) {
  renderResults();
  renderRecipes();
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
  const imported = isImported(item);
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
      ${imported ? '<span class="pill pill-sky">取り込み</span>' : ''}
      ${isMenuRecipe(item) ? '<span class="pill pill-butter">献立</span>' : ''}
    </div>
    ${sourceHtml(item)}
    ${hasFamilyRules() ? ngBoxHtml(checkRecipe(r), true) : ''}

    <section class="sec">
      <h3>材料${servings ? `<small>${esc(servings)}人分</small>` : ''}</h3>
      <ul class="ing-list">${r.ingredients.map((x) => ingItem(x, !imported)).join('')}</ul>
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

    <p class="sheet-date">${esc(formatDate(item.createdAt))} に${imported ? '取り込み' : isMenuRecipe(item) ? '献立から作成' : '提案'}</p>
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
  const src = item.source || {};
  if (src.type === 'url' && src.url) lines.push('', `出典：${src.siteName ? src.siteName + ' ' : ''}${src.url}`);
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

/* ========== 外部レシピの取り込み ========== */

function isImported(item) {
  return !!(item && item.source && ['url', 'text', 'image'].includes(item.source.type));
}

function isMenuRecipe(item) {
  return !!(item && item.source && item.source.type === 'menu');
}

function sourceHtml(item) {
  const src = item.source || {};
  if (src.type === 'url' && /^https?:\/\//i.test(src.url || '')) {
    return `<p class="source-line"><span>取り込み元</span>`
      + `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.siteName || src.url)}</a></p>`;
  }
  if (src.type === 'text') return '<p class="source-line">貼り付けた文章から取り込み</p>';
  if (src.type === 'image') return '<p class="source-line">写真から取り込み</p>';
  if (src.type === 'menu' && src.date) {
    return `<p class="source-line">${esc(dayLabel(src.date))}の${esc(MEAL_LABELS[src.meal] || '')}の献立から作成</p>`;
  }
  return '';
}

function setImportMode(mode) {
  const radio = $(`#form-import input[name="importMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  $$('[data-import-mode]').forEach((el) => { el.hidden = el.dataset.importMode !== mode; });
  const btn = $('#form-import [type="submit"]');
  if (!btn.disabled) btn.textContent = mode === 'bulk' ? 'まとめて取り込む' : '取り込む';
  formMsg($('#form-import'), '');
  if (mode === 'bulk') updateBulkCount();
}

function renderImportPhotos() {
  const box = $('#import-photos');
  if (!box) return;
  box.innerHTML = state.importImages.map((src, i) => `<div class="photo-thumb">
      <img src="${src}" alt="${i + 1}枚目の写真">
      <button type="button" data-remove-photo="${i}" aria-label="${i + 1}枚目の写真を外す">×</button>
    </div>`).join('');
}

async function addImportPhotos(files) {
  for (const file of Array.from(files || [])) {
    if (state.importImages.length >= MAX_IMPORT_IMAGES) {
      toast(`写真は${MAX_IMPORT_IMAGES}枚までです`);
      break;
    }
    try {
      // 文字を読み取れるよう、料理写真より大きめ・高画質で縮小
      state.importImages.push(await compressImage(file, 1600, 0.86));
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  renderImportPhotos();
}

function bindImport() {
  const f = $('#form-import');
  f.addEventListener('change', (e) => {
    if (e.target.name === 'importMode') setImportMode(e.target.value);
  });
  $('#import-image').addEventListener('change', async (e) => {
    await addImportPhotos(e.target.files);
    e.target.value = '';
  });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('[type="submit"]', f);
    const mode = f.importMode.value;
    if (mode === 'bulk') return startBulk();
    const payload = { mode };

    if (mode === 'url') {
      payload.url = f.url.value.trim();
      if (!/^https?:\/\/\S+$/i.test(payload.url)) return formMsg(f, 'http:// または https:// で始まるURLを貼り付けてください');
    } else if (mode === 'text') {
      payload.text = f.text.value.trim();
      if (payload.text.length < 20) return formMsg(f, '材料や作り方を含めて、レシピの文章を貼り付けてください');
    } else {
      if (!state.importImages.length) return formMsg(f, '写真を選んでください');
      payload.images = state.importImages;
    }

    formMsg(f, '');
    setBusy(btn, true);
    const stop = showLoading(IMPORT_LOADING[mode] || LOADING_LINES);
    try {
      const d = await api('importRecipe', payload);
      cacheRecipe(d.recipe);
      if (state.loaded.history) state.history.unshift(d.recipe.id);
      f.url.value = '';
      f.text.value = '';
      state.importImages = [];
      renderImportPhotos();
      openRecipe(d.recipe.id);
      toast('レシピを取り込みました');
    } catch (err) {
      if (err.code !== 'AUTH') formMsg(f, err.message);
    } finally {
      stop();
      setBusy(btn, false);
    }
  });
}

/* 他のアプリやブックマークから ?import=URL（または文章）で開かれたときの受け取り */
function readSharedImport() {
  const q = new URLSearchParams(location.search);
  const value = (q.get('import') || q.get('url') || q.get('text') || '').trim();
  if (!value) return;
  state.pendingImport = value;
  history.replaceState(null, '', location.pathname + location.hash);
}

function applyPendingImport() {
  if (!state.pendingImport || !state.user || state.user.mustChangePassword) return;
  const value = state.pendingImport;
  state.pendingImport = '';
  switchTab('import');
  const urls = extractUrls(value);
  if (urls.length >= 2) {
    setImportMode('bulk');
    $('#bulk-text').value = urls.join('\n');
    updateBulkCount();
    toast('URLを確かめて「まとめて取り込む」を押してください');
    return;
  }
  const m = value.match(/https?:\/\/[^\s<>"']+/);
  if (m && value.replace(m[0], '').trim().length < 80) {
    setImportMode('url');
    $('#import-url').value = m[0];
  } else {
    setImportMode('text');
    $('#import-text').value = value;
  }
  toast('内容を確かめて「取り込む」を押してください');
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

/* ========== 日付の小道具 ========== */

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_LABELS = { breakfast: '朝食', lunch: '昼食', dinner: '夕食' };
const MEAL_STYLES = ['おまかせ', '一品（丼・麺など）', 'ワンプレート', 'お弁当', '主菜＋副菜', '主菜＋副菜＋汁物', '主食＋汁物（朝食向き）'];
const MINUTE_OPTIONS = [[0, '指定なし'], [15, '15分'], [20, '20分'], [30, '30分'], [45, '45分'], [60, '60分']];
const MAX_MEALS_PER_CALL = 6;

const pad2 = (n) => String(n).padStart(2, '0');
function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function todayYmd() { return ymd(new Date()); }
function isWeekend(s) { const w = parseYmd(s).getDay(); return w === 0 || w === 6; }
function dayLabel(s) {
  if (!s) return '';
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
}
function shortDate(s) { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; }

/* ========== アレルギー・食べられないもののチェック ========== */

// 表示名: [使えない食材の言葉, 原材料の確認が必要な言葉, 除外する言葉（誤判定を防ぐ）]
const ALLERGEN_DICT = {
  '卵': [['卵', 'たまご', '玉子', 'マヨネーズ', 'マヨ', 'エッグ', 'オムレツ', 'カステラ', 'メレンゲ', 'タルタル', 'カルボナーラ'],
    ['練り物', 'かまぼこ', 'ちくわ', 'はんぺん', '天ぷら粉', 'ホットケーキミックス', 'パン粉', '中華麺', 'ラーメン', 'ドレッシング'], ['エッグプラント']],
  '乳': [['牛乳', 'ミルク', 'バター', 'チーズ', '生クリーム', 'クリーム', 'ヨーグルト', '練乳', 'スキムミルク', '脱脂粉乳', 'ホワイトソース', 'ラクト', 'ギー'],
    ['カレールウ', 'シチュー', 'ルウ', '食パン', 'ホットケーキミックス', 'グラタン', 'コンソメ'],
    ['ココナッツミルク', 'アーモンドミルク', 'オーツミルク', 'ライスミルク', '豆乳', 'ピーナッツバター', 'カカオバター', 'ごまクリーム', 'パンプキン', 'フライパン']],
  '小麦': [['小麦', '薄力粉', '強力粉', '中力粉', 'パン', 'うどん', 'パスタ', 'スパゲッティ', 'スパゲティ', 'マカロニ', 'ラーメン', '中華麺', '焼きそば', 'そうめん', 'ひやむぎ', '冷や麦', '餃子の皮', 'ぎょうざの皮', '春巻きの皮', 'ワンタン', '天ぷら粉', 'から揚げ粉', '唐揚げ粉', 'お好み焼き粉', 'たこ焼き粉', 'ホットケーキミックス', '麩', 'ルウ', 'ピザ', 'トルティーヤ', 'クラッカー', 'バゲット', 'ペンネ', 'ニョッキ', 'クルトン'],
    ['醤油', 'しょうゆ', 'めんつゆ', '麺つゆ', 'ソース', 'カレー粉', 'ポン酢', 'すき焼きのたれ', '焼肉のたれ', 'コンソメ', 'ブイヨン', '味噌', '麦'],
    ['パンプキン', 'パンチェッタ', 'フライパン', 'パンダ', '米粉', 'ライスペーパー', '十割', 'ビーフン', 'フォー']],
  'えび': [['えび', '海老', '蝦', 'シュリンプ', 'エビ'], ['かにかま', 'かに風味', 'ちくわ', 'かまぼこ', 'えびせん', 'オイスターソース'], ['えびす']],
  'かに': [['かに', '蟹'], ['かにかま', 'かに風味'], ['かにかま', 'かに風味', 'カニカマ']],
  'そば': [['そば', '蕎麦'], [], ['焼きそば', 'やきそば', '中華そば', 'ちゅうかそば', '沖縄そば', 'そばめし', 'カップそば']],
  '落花生': [['落花生', 'らっかせい', 'ピーナッツ', 'ピーナツ'], ['ミックスナッツ', '担々', '坦々', 'サテ', 'カレールウ'], []],
  'くるみ': [['くるみ', '胡桃', 'ウォールナッツ'], ['ミックスナッツ'], []],
  '大豆': [['大豆', '豆腐', 'とうふ', '納豆', 'なっとう', '豆乳', '油揚げ', '厚揚げ', 'がんもどき', '高野豆腐', 'おから', 'きな粉', 'きなこ', '枝豆', '湯葉', 'ゆば', '味噌', 'みそ', '醤油', 'しょうゆ', '大豆ミート', 'テンペ', '豆板醤', 'テンメンジャン'],
    ['めんつゆ', '麺つゆ', 'ポン酢', '焼肉のたれ', 'すき焼きのたれ', 'オイスターソース', 'だしの素', 'サラダ油', 'マヨネーズ', 'カレールウ'], []],
  'ごま': [['ごま', '胡麻', 'セサミ', 'タヒニ'], ['ドレッシング', 'ふりかけ', '担々', '坦々'], []],
  'さば': [['さば', '鯖'], ['だしの素', '削り節'], []],
  'いか': [['いか', '烏賊', 'するめ'], ['シーフードミックス', '塩辛'], ['いかなご', 'スイカ', 'ライカ']],
  'さけ': [['鮭', 'さけ', 'しゃけ', 'サーモン'], [], ['酒']],
  'いくら': [['いくら'], [], []],
  '牛肉': [['牛肉', '牛こま', '牛ひき', '牛薄切り', '牛もも', '牛バラ', '牛すじ', 'ビーフ', '合いびき', '合挽', 'あいびき', 'ステーキ', '牛タン', '牛脂'],
    ['ひき肉', '挽き肉', 'ミンチ', 'コンソメ', 'ブイヨン', 'ゼラチン', 'ハンバーグ', 'デミグラス'], ['牛乳', '牛蒡']],
  '豚肉': [['豚', 'ぶた', 'ポーク', 'ベーコン', 'ハム', 'ソーセージ', 'ウインナー', 'チャーシュー', 'ラード', 'パンチェッタ', '合いびき', '合挽', 'あいびき', 'とんかつ'],
    ['ひき肉', '挽き肉', 'ミンチ', '餃子', 'ぎょうざ', 'シュウマイ', 'ゼラチン', 'コンソメ'], []],
  '鶏肉': [['鶏', 'とり肉', '鳥肉', 'チキン', 'ささみ', '手羽', '砂肝', '鶏ガラ', 'つくね'],
    ['ひき肉', '挽き肉', 'ミンチ', 'コンソメ', 'ブイヨン', 'レバー'], ['鶏卵']],
  'キウイ': [['キウイ'], [], []],
  'バナナ': [['バナナ'], [], []],
  'もも': [['もも', '桃', 'ピーチ'], [], ['もも肉', '鶏もも', 'とりもも', '牛もも', '豚もも']],
  'りんご': [['りんご', '林檎', 'アップル'], [], ['パイナップル']],
  'オレンジ': [['オレンジ'], [], []],
  'やまいも': [['やまいも', '山芋', '長芋', 'ながいも', 'とろろ', '大和芋', '自然薯'], ['お好み焼き粉'], []],
  'アーモンド': [['アーモンド'], ['ミックスナッツ'], []],
  'カシューナッツ': [['カシューナッツ'], ['ミックスナッツ'], []],
  'マカダミアナッツ': [['マカダミア'], ['ミックスナッツ'], []],
  'ゼラチン': [['ゼラチン'], ['ゼリー'], []],
  'あわび': [['あわび', '鮑'], [], []],
  'まつたけ': [['まつたけ', '松茸'], [], []],
};
const ALLERGENS_MAIN = ['卵', '乳', '小麦', 'えび', 'かに', 'そば', '落花生', 'くるみ'];
const ALLERGENS_MORE = Object.keys(ALLERGEN_DICT).filter((k) => !ALLERGENS_MAIN.includes(k));

// 表記ゆれ対策：全角半角をそろえ、カタカナをひらがなに
function normWord(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　・]/g, '');
}

function splitFreeWords(text) {
  return String(text || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(/[、,，\/／\n]+|\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 1)
    .slice(0, 30);
}

function householdMembers() {
  return (state.settings.household && state.settings.household.members) || [];
}

function memberById(id) {
  return householdMembers().find((m) => m.id === id);
}

/** 食べる人（ID一覧。nullなら家族全員）のNGルールを作る */
function ngRules(memberIds) {
  const hh = state.settings.household || {};
  const members = householdMembers().filter((m) => !memberIds || memberIds.includes(m.id));
  const map = new Map();
  const add = (label, who) => {
    const key = normWord(label);
    if (!key) return;
    if (!map.has(key)) {
      const dict = ALLERGEN_DICT[label] || [[label], [], []];
      map.set(key, {
        label,
        who: new Set(),
        ng: dict[0].map(normWord),
        caution: dict[1].map(normWord),
        except: dict[2].map(normWord),
      });
    }
    map.get(key).who.add(who);
  };
  members.forEach((m) => {
    (m.allergies || []).forEach((a) => add(a, m.name));
    splitFreeWords(m.avoid).forEach((a) => add(a, m.name));
  });
  splitFreeWords(hh.commonAvoid).forEach((a) => add(a, '家族全員'));
  return [...map.values()];
}

function hasFamilyRules() {
  return ngRules(null).length > 0;
}

/** 食材名の一覧をチェック → [{label, who, level:'ng'|'caution', names:[]}] */
function checkNames(names, rules) {
  const out = new Map();
  (names || []).forEach((raw) => {
    const n = normWord(raw);
    if (!n) return;
    rules.forEach((r) => {
      let m = n;
      r.except.forEach((ex) => { if (ex) m = m.split(ex).join('|'); });
      let level = '';
      if (r.ng.some((w) => w && m.includes(w))) level = 'ng';
      else if (r.caution.some((w) => w && n.includes(w))) level = 'caution';
      if (!level) return;
      const key = r.label + level;
      if (!out.has(key)) out.set(key, { label: r.label, who: [...r.who], level, names: [] });
      const hit = out.get(key);
      if (!hit.names.includes(String(raw))) hit.names.push(String(raw));
    });
  });
  return [...out.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === 'ng' ? -1 : 1));
}

function recipeNames(r) {
  return [...(r.ingredients || []).map((x) => x.name), ...(r.seasonings || []).map((x) => (typeof x === 'string' ? x : x.name))];
}

function checkRecipe(r, memberIds = null) {
  const rules = ngRules(memberIds);
  if (!rules.length || !r) return [];
  return checkNames(recipeNames(r), rules);
}

function whoText(who) {
  return who.map((w) => (w === '家族全員' ? w : `${w}さん`)).join('・');
}

function ngPill(issues) {
  const ng = issues.filter((x) => x.level === 'ng');
  if (ng.length) return `<span class="pill pill-ng">⚠ ${esc(ng.map((x) => x.label).join('・'))}</span>`;
  return '';
}

/** チェック結果の表示。showOk=true なら問題なしの表示も出す */
function ngBoxHtml(issues, showOk) {
  const ng = issues.filter((x) => x.level === 'ng');
  const caution = issues.filter((x) => x.level === 'caution');
  let html = '';
  if (ng.length) {
    html += `<div class="ng-box is-ng" role="alert"><strong>⚠ 使えない食材が含まれています</strong><ul>`
      + ng.map((x) => `<li><b>${esc(x.label)}</b>（${esc(whoText(x.who))}）：${esc(x.names.join('、'))}</li>`).join('')
      + `</ul></div>`;
  }
  if (caution.length) {
    html += `<div class="ng-box is-caution"><strong>原材料を確認してください</strong><ul>`
      + caution.map((x) => `<li>${esc(x.names.join('、'))} … <b>${esc(x.label)}</b>を含む商品があります（${esc(whoText(x.who))}）</li>`).join('')
      + `</ul></div>`;
  }
  if (!html && showOk) {
    html = '<div class="ng-box is-ok">家族のアレルギー・食べられないものは見つかりませんでした。加工品や調味料は原材料表示も確認してください。</div>';
  }
  return html;
}

function ngSummaryText(memberIds = null) {
  return ngRules(memberIds).map((r) => `${r.label}（${whoText([...r.who])}）`).join('、');
}

function renderAvoidNotice() {
  const wrap = $('#avoid-family-wrap');
  const list = $('#avoid-family-list');
  if (!wrap) return;
  const on = !!state.token && hasFamilyRules();
  wrap.hidden = !on;
  list.hidden = !on;
  list.textContent = on ? `対象：${ngSummaryText()}` : '';
}

/* ========== 設定（家族・冷蔵庫・調味料・献立の条件）の同期 ========== */

function defaultMenuPrefs() {
  return {
    meals: {
      breakfast: { enabled: false, excluded: [], style: 'おまかせ' },
      lunch: { enabled: false, excluded: [], style: 'おまかせ' },
      dinner: { enabled: true, excluded: [], style: 'おまかせ' },
    },
    days: 7, weekdayMinutes: 30, weekendMinutes: 0,
    useFridge: true, useSaved: false, budget: false, note: '',
  };
}

function mergeMenuPrefs(p) {
  const base = defaultMenuPrefs();
  if (!p || typeof p !== 'object') return base;
  const out = { ...base, ...p, meals: {} };
  MEAL_TYPES.forEach((t) => {
    const m = (p.meals && p.meals[t]) || {};
    out.meals[t] = { ...base.meals[t], ...m, excluded: Array.isArray(m.excluded) ? m.excluded : [] };
    if (!MEAL_STYLES.includes(out.meals[t].style)) out.meals[t].style = 'おまかせ';
  });
  return out;
}

function loadSettings(force = false) {
  if (!state.token) return Promise.resolve();
  if (state.settingsLoading) return state.settingsLoading;
  if (state.settingsLoaded && !force) return Promise.resolve();
  state.settingsLoading = api('getSettings')
    .then((d) => applySettings(d.settings))
    .catch((err) => { if (err.code !== 'AUTH') console.warn('設定の読み込みに失敗', err); })
    .finally(() => { state.settingsLoading = null; });
  return state.settingsLoading;
}

function applySettings(s) {
  s = s || {};
  state.settings.household = s.household || { members: [], commonAvoid: '' };
  state.settings.menuPrefs = mergeMenuPrefs(s.menuPrefs);
  let push = false;
  if (!state.fridgeDirty && Array.isArray(s.fridge) && s.fridge.length) {
    state.ingredients = s.fridge.slice(0, MAX_INGREDIENTS);
    try { localStorage.setItem(FRIDGE_KEY, JSON.stringify(state.ingredients)); } catch (e) { /* noop */ }
    renderMagnets();
  } else if (state.ingredients.length && !(s.fridge || []).length) {
    push = true; // この端末に入れてあった食材をサーバーにも保存
  }
  if (!state.seasoningsDirty && Array.isArray(s.seasonings)) {
    state.seasonings = new Set(s.seasonings);
    renderSeasonings();
    savePrefs(false);
  } else if (!Array.isArray(s.seasonings)) {
    push = true;
  }
  state.settingsLoaded = true;
  if (push) queueSettingsSave();
  renderAvoidNotice();
  if (state.currentTab === 'menu') renderMenuPanel();
}

let settingsTimer = null;
const settingsPatch = {};
function queueSettingsSave(extra = {}) {
  if (!state.token) return;
  Object.assign(settingsPatch, extra);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(flushSettings, 1500);
}

async function flushSettings() {
  if (!state.token) return;
  // サーバーの内容を読み込む前に送ると、別の端末で入れた冷蔵庫の中身を消してしまうため先に読み込む
  if (!state.settingsLoaded) {
    await loadSettings();
    if (!state.settingsLoaded || !state.token) return;
  }
  const patch = { ...settingsPatch, fridge: state.ingredients.slice(), seasonings: [...state.seasonings] };
  Object.keys(settingsPatch).forEach((k) => delete settingsPatch[k]);
  try {
    await api('saveSettings', patch);
  } catch (err) {
    if (err.code !== 'AUTH') toast(`設定を保存できませんでした：${err.message}`, 'error');
  }
}

/* ========== レシピ一覧（すべて・お気に入り・取り込み・献立） ========== */

function bindRecipesPanel() {
  const panel = $('[data-panel="recipes"]');
  panel.addEventListener('change', (e) => {
    if (e.target.name !== 'recipeFilter') return;
    state.recipeFilter = e.target.value;
    loadRecipes();
  });
  let timer = null;
  $('#recipe-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.recipeQuery = e.target.value.trim(); renderRecipes(); }, 200);
  });
}

async function loadRecipes() {
  const kind = state.recipeFilter === 'fav' ? 'favorites' : 'history';
  const box = $('#recipes-list');
  if (state.loaded[kind]) renderRecipes();
  else box.innerHTML = '<p class="list-status">読み込んでいます…</p>';
  try {
    const d = await api(kind === 'history' ? 'getHistory' : 'getFavorites', { limit: kind === 'history' ? 200 : 100 });
    d.recipes.forEach(cacheRecipe);
    state[kind] = d.recipes.map((r) => r.id);
    state.loaded[kind] = true;
    if (state.currentTab === 'recipes') renderRecipes();
  } catch (err) {
    if (err.code === 'AUTH') return;
    if (!state.loaded[kind]) box.innerHTML = `<p class="list-status">${esc(err.message)}</p>`;
    else toast(err.message, 'error');
  }
}

function renderRecipes() {
  const f = state.recipeFilter;
  const kind = f === 'fav' ? 'favorites' : 'history';
  const box = $('#recipes-list');
  if (!box || !state.loaded[kind]) return;
  let items = state[kind].map((id) => state.recipes.get(id)).filter(Boolean);
  if (f === 'fav') items = items.filter((x) => x.favorite);
  if (f === 'imported') items = items.filter(isImported);
  if (f === 'menu') items = items.filter(isMenuRecipe);
  const q = normWord(state.recipeQuery);
  if (q) {
    items = items.filter((x) => normWord(x.recipe.title || x.title).includes(q)
      || recipeNames(x.recipe).some((n) => normWord(n).includes(q)));
  }
  if (!items.length) {
    const msg = q ? ['見つかりませんでした', '別の言葉で探してみてください。', '']
      : {
        all: ['まだレシピがありません', '冷蔵庫の食材を入れて、最初のレシピを考えてもらいましょう。', '<button type="button" class="btn btn-outline" data-go="make">食材を入れる</button>'],
        fav: ['お気に入りはまだありません', 'レシピの星のボタンを押すと、ここに集まります。', ''],
        imported: ['取り込んだレシピはまだありません', '料理サイトのURLや写真から取り込めます。', '<button type="button" class="btn btn-outline" data-go="import">レシピを取り込む</button>'],
        menu: ['献立から作ったレシピはまだありません', '献立表の料理名を押すと、作り方を作ってここに保存します。', '<button type="button" class="btn btn-outline" data-go="menu">献立を見る</button>'],
      }[f];
    box.innerHTML = `<div class="empty"><strong>${msg[0]}</strong><p>${msg[1]}</p>${msg[2]}</div>`;
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
  const ng = hasFamilyRules() && checkRecipe(r).some((x) => x.level === 'ng');
  return `<article class="row">
    <button type="button" class="row-open" data-open="${esc(item.id)}">
      <span class="row-thumb">${thumb}</span>
      <span class="row-text">
        <span class="row-title">${esc(r.title || item.title)}</span>
        <span class="row-sub"><span>${esc(formatDate(item.createdAt))}</span><span>${r.cookingTimeMinutes}分</span>${isImported(item) ? '<span>取り込み</span>' : ''}${isMenuRecipe(item) ? '<span>献立</span>' : ''}${ng ? '<span class="row-ng">⚠ NG食材</span>' : ''}</span>
      </span>
    </button>
    ${favButton(item)}
  </article>`;
}

async function ensureRecipe(id) {
  if (state.recipes.has(id)) return state.recipes.get(id);
  const d = await api('getRecipe', { recipeId: id });
  cacheRecipe(d.recipe);
  return d.recipe;
}

/* ========== まとめて取り込み ========== */

const MAX_BULK_URLS = 30;
const MAX_BULK_IMAGES = 10;

function extractUrls(text) {
  const out = [];
  const seen = new Set();
  const re = /https?:\/\/[^\s<>"'`（）「」『』【】、。]+/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const u = m[0].replace(/[)\]}.,;:!?]+$/, '').replace(/&amp;/g, '&');
    if (u.length > 12 && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

function bindBulk() {
  const ta = $('#bulk-text');
  ta.addEventListener('input', updateBulkCount);
  $('#bulk-image').addEventListener('change', async (e) => {
    for (const file of Array.from(e.target.files || [])) {
      if (state.bulkImages.length >= MAX_BULK_IMAGES) { toast(`写真は${MAX_BULK_IMAGES}枚までです`); break; }
      try { state.bulkImages.push(await compressImage(file, 1600, 0.86)); } catch (err) { toast(err.message, 'error'); }
    }
    e.target.value = '';
    renderBulkPhotos();
    updateBulkCount();
  });
  $('#bulk-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('ファイルが大きすぎます（5MBまで）', 'error'); return; }
    try {
      const text = await file.text();
      const urls = extractUrls(text).filter((u) => !/\.(png|jpe?g|gif|webp|ico|svg|css|js)(\?|$)/i.test(u));
      if (!urls.length) { toast('ファイルの中にURLが見つかりませんでした', 'error'); return; }
      const current = extractUrls(ta.value);
      const merged = [...new Set([...current, ...urls])];
      ta.value = merged.join('\n');
      updateBulkCount();
      toast(`${urls.length}件のURLを読み込みました${merged.length > MAX_BULK_URLS ? `（取り込めるのは${MAX_BULK_URLS}件までです）` : ''}`);
    } catch (err) {
      toast('ファイルを読み込めませんでした', 'error');
    }
  });
}

function renderBulkPhotos() {
  const box = $('#bulk-photos');
  if (!box) return;
  box.innerHTML = state.bulkImages.map((src, i) => `<div class="photo-thumb">
      <img src="${src}" alt="${i + 1}枚目の写真">
      <button type="button" data-remove-bulk-photo="${i}" aria-label="${i + 1}枚目の写真を外す">×</button>
    </div>`).join('');
}

function bulkPlan() {
  const text = $('#bulk-text').value;
  const urls = extractUrls(text);
  const rest = urls.reduce((t, u) => t.split(u).join(' '), text).trim();
  return { urls, rest };
}

function updateBulkCount() {
  const el = $('#bulk-count');
  if (!el) return;
  const { urls, rest } = bulkPlan();
  const bits = [];
  if (urls.length) bits.push(`URL ${Math.min(urls.length, MAX_BULK_URLS)}件${urls.length > MAX_BULK_URLS ? `（${urls.length}件中、最初の${MAX_BULK_URLS}件）` : ''}`);
  else if (rest.length >= 20) bits.push('文章（中のレシピを最大10品）');
  if (state.bulkImages.length) bits.push(`写真 ${state.bulkImages.length}枚`);
  el.textContent = bits.length ? `取り込むもの：${bits.join('、')}` : '';
}

function startBulk() {
  const f = $('#form-import');
  if (state.bulk.running) return;
  const { urls, rest } = bulkPlan();
  const items = [];
  urls.slice(0, MAX_BULK_URLS).forEach((u) => items.push({ kind: 'url', url: u, label: u, status: 'wait' }));
  if (!urls.length && rest.length >= 20) items.push({ kind: 'multi', text: rest, label: '貼り付けた文章', status: 'wait' });
  state.bulkImages.forEach((img, i) => items.push({ kind: 'image', image: img, label: `写真 ${i + 1}`, status: 'wait' }));
  if (!items.length) return formMsg(f, 'URL・レシピの文章・写真のどれかを入れてください');
  formMsg(f, '');
  state.bulk = { items, running: false, stop: false, skipDuplicate: f.skipDuplicate.checked };
  $('#bulk-text').value = '';
  state.bulkImages = [];
  renderBulkPhotos();
  updateBulkCount();
  processBulk();
}

function retryBulk() {
  state.bulk.items.forEach((it) => { if (it.status === 'error') { it.status = 'wait'; it.error = ''; } });
  processBulk();
}

async function processBulk() {
  const b = state.bulk;
  if (b.running) return;
  b.running = true;
  b.stop = false;
  const btn = $('#form-import [type="submit"]');
  setBusy(btn, true);
  renderBulk();
  requestAnimationFrame(() => $('#bulk-progress').scrollIntoView({ behavior: 'smooth', block: 'start' }));

  for (const it of b.items) {
    if (b.stop || state.bulk !== b) break;
    if (it.status !== 'wait') continue;
    it.status = 'run';
    renderBulk();
    try {
      let d;
      if (it.kind === 'url') d = await api('importRecipe', { mode: 'url', url: it.url, bulk: true, skipDuplicate: b.skipDuplicate });
      else if (it.kind === 'multi') d = await api('importRecipe', { mode: 'multi', text: it.text, bulk: true });
      else d = await api('importRecipe', { mode: 'image', images: [it.image], bulk: true });
      const recs = d.recipes || [d.recipe];
      recs.forEach(cacheRecipe);
      if (!d.skipped && state.loaded.history) state.history.unshift(...recs.map((r) => r.id));
      it.status = d.skipped ? 'skip' : 'done';
      it.recipeIds = recs.map((r) => r.id);
      it.image = null;
    } catch (err) {
      if (err.code === 'AUTH') { it.status = 'wait'; b.stop = true; break; }
      it.status = 'error';
      it.error = err.message;
      if (err.code === 'LIMIT') { b.stop = true; toast(err.message, 'error'); }
    }
    renderBulk();
  }

  b.running = false;
  setBusy(btn, false);
  renderBulk();
  renderRecipes();
  const done = b.items.filter((x) => x.status === 'done').reduce((n, x) => n + (x.recipeIds || []).length, 0);
  const failed = b.items.filter((x) => x.status === 'error').length;
  if (state.bulk === b && state.token) {
    toast(`${done}品を取り込みました${failed ? `（${failed}件は取り込めませんでした）` : ''}`, failed && !done ? 'error' : 'info');
  }
}

function renderBulk() {
  const box = $('#bulk-progress');
  if (!box) return;
  const b = state.bulk;
  if (!b.items.length) { box.hidden = true; box.innerHTML = ''; return; }
  const total = b.items.length;
  const finished = b.items.filter((x) => ['done', 'skip', 'error'].includes(x.status)).length;
  const failed = b.items.filter((x) => x.status === 'error').length;
  const icon = { wait: '…', run: '⏳', done: '✓', skip: '↺', error: '×' };
  const text = { wait: '待っています', run: '取り込み中', done: '取り込みました', skip: '取り込み済みのため飛ばしました', error: '取り込めませんでした' };
  box.hidden = false;
  box.innerHTML = `<div class="bulk-head">
      <h3>まとめて取り込み <small>${finished} / ${total}</small></h3>
      <div class="bulk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${finished}"><span style="width:${Math.round(finished / total * 100)}%"></span></div>
    </div>
    <ol class="bulk-list">${b.items.map((it) => {
      const recs = (it.recipeIds || []).map((id) => state.recipes.get(id)).filter(Boolean);
      return `<li class="bulk-item is-${it.status}">
        <span class="bulk-icon" aria-hidden="true">${icon[it.status]}</span>
        <div class="bulk-body">
          <span class="bulk-label">${esc(it.label)}</span>
          <span class="bulk-status">${text[it.status]}${it.error ? `：${esc(it.error)}` : ''}</span>
          ${recs.length ? `<span class="bulk-recipes">${recs.map((r) => `<button type="button" class="btn-link" data-open="${esc(r.id)}">${esc(r.recipe.title)}</button>`).join('')}</span>` : ''}
        </div>
      </li>`;
    }).join('')}</ol>
    <div class="bulk-actions">
      ${b.running ? `<button type="button" class="btn btn-outline" data-bulk-stop ${b.stop ? 'disabled' : ''}>${b.stop ? '止めています…' : '途中で止める'}</button>` : ''}
      ${!b.running && failed ? `<button type="button" class="btn btn-outline" data-bulk-retry>取り込めなかった${failed}件をやり直す</button>` : ''}
      ${!b.running && b.items.some((x) => x.status === 'wait') ? '<button type="button" class="btn btn-outline" data-bulk-retry>続きを取り込む</button>' : ''}
      ${!b.running ? '<button type="button" class="btn btn-text" data-bulk-clear>一覧を閉じる</button>' : ''}
    </div>`;
}

/* ========== 献立タブ ========== */

function bindMenu() {
  const panel = $('[data-panel="menu"]');
  panel.addEventListener('click', onMenuClick);
  panel.addEventListener('input', onMenuInput);
  panel.addEventListener('change', onMenuChange);
  panel.addEventListener('submit', (e) => {
    if (e.target.id === 'form-menu') { e.preventDefault(); createMenu(); }
  });
  bindMenuKeys();
}

async function openMenuTab() {
  renderMenuPanel();
  await loadSettings();
  if (!state.menuListLoaded) await loadMenus();
  if (state.currentTab === 'menu') renderMenuPanel();
}

function setMenuView(view) {
  if (state.menuView === 'family' && view !== 'family' && state.famDirty) saveFamily(true);
  state.menuView = view;
  renderMenuPanel();
  window.scrollTo(0, 0);
}

function renderMenuPanel() {
  $$('[data-menu-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.menuView === state.menuView)));
  $$('[data-menu-pane]').forEach((p) => { p.hidden = p.dataset.menuPane !== state.menuView; });
  if (!state.settingsLoaded) {
    $(`#menu-${state.menuView}`).innerHTML = '<p class="list-status">読み込んでいます…</p>';
    return;
  }
  if (state.menuView === 'plan') renderPlanPane();
  else if (state.menuView === 'shopping') renderShoppingPane();
  else renderFamilyPane();
}

async function loadMenus() {
  try {
    const d = await api('getMenus');
    state.menuList = d.menus || [];
    state.menuListLoaded = true;
    if (!state.menu && state.menuList.length) {
      // 今日を含む献立があればそれを、なければいちばん新しい献立を開く
      const today = todayYmd();
      const cur = state.menuList.find((m) => m.startDate <= today && today <= m.endDate) || state.menuList[0];
      await loadMenu(cur.id);
    }
  } catch (err) {
    if (err.code !== 'AUTH') toast(err.message, 'error');
  }
}

async function loadMenu(id) {
  const d = await api('getMenu', { menuId: id });
  state.menu = d.menu;
  state.shopRange = null;
}

let menuSaveTimer = null;
function scheduleMenuSave() {
  clearTimeout(menuSaveTimer);
  menuSaveTimer = setTimeout(() => saveMenuNow().catch(() => { /* 表示済み */ }), 1200);
}

async function saveMenuNow() {
  clearTimeout(menuSaveTimer);
  const plan = state.menu;
  if (!plan || !state.token) return;
  try {
    const d = await api('saveMenu', { menu: plan });
    // 保存中に画面で変えた内容（チェックなど）を消さないよう、IDと日時だけ反映する
    plan.id = d.menu.id;
    plan.updatedAt = d.menu.updatedAt;
    const summary = {
      id: d.menu.id, title: d.menu.title, startDate: d.menu.days[0].date,
      endDate: d.menu.days[d.menu.days.length - 1].date, updatedAt: d.menu.updatedAt, createdAt: d.menu.createdAt,
    };
    const i = state.menuList.findIndex((m) => m.id === summary.id);
    if (i >= 0) state.menuList[i] = summary; else state.menuList.unshift(summary);
  } catch (err) {
    if (err.code !== 'AUTH') toast(`献立を保存できませんでした：${err.message}`, 'error');
    throw err;
  }
}

function memberNames(ids) {
  return ids.map((id) => (memberById(id) || {}).name).filter(Boolean);
}

function shortName(name) {
  return Array.from(String(name || '')).slice(0, 4).join('');
}

/* ---------- 家族・アレルギー ---------- */

function newMemberId() {
  return 'm_' + Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function renderFamilyPane() {
  if (!state.famDraft) {
    state.famDraft = JSON.parse(JSON.stringify(state.settings.household || { members: [], commonAvoid: '' }));
    state.famDirty = false;
  }
  const hh = state.famDraft;
  const toggles = (i, list, sel) => list.map((a) => `<button type="button" class="toggle" data-fam-allergy="${i}" data-label="${esc(a)}" aria-pressed="${sel.includes(a)}">${esc(a)}</button>`).join('');
  const extra = (m) => (m.allergies || []).filter((a) => !ALLERGENS_MAIN.includes(a) && !ALLERGENS_MORE.includes(a));

  $('#menu-family').innerHTML = `
    <p class="panel-lead">献立づくりとレシピ提案に使います。アレルギーや食べられないものは「使ってはいけない食材」としてAIに伝え、できあがった献立とレシピも自動でチェックします。</p>
    <div class="notice">重いアレルギーがある場合は、AIの提案やこのチェックだけに頼らず、必ず食品の原材料表示を確認してください。</div>

    <div class="members">
      ${hh.members.map((m, i) => `<article class="member-card" data-member-index="${i}">
        <div class="member-head">
          <span class="avatar" aria-hidden="true">${esc(Array.from(m.name || '？')[0])}</span>
          <strong>${esc(m.name || '新しい家族')}</strong>
          <button type="button" class="btn btn-danger-text btn-small" data-fam-del="${i}">削除</button>
        </div>
        <div class="member-grid">
          <div class="field">
            <label for="fam-name-${i}">呼び名</label>
            <input id="fam-name-${i}" type="text" maxlength="12" data-fam-field="name" data-i="${i}" value="${esc(m.name)}" placeholder="例：ケン">
          </div>
          <div class="field">
            <label for="fam-age-${i}">年齢</label>
            <input id="fam-age-${i}" type="number" inputmode="numeric" min="0" max="120" data-fam-field="age" data-i="${i}" value="${esc(m.age)}" placeholder="例：62">
          </div>
          <div class="field">
            <label for="fam-sex-${i}">性別</label>
            <select id="fam-sex-${i}" data-fam-field="sex" data-i="${i}">
              ${[['', '答えない'], ['male', '男性'], ['female', '女性'], ['other', 'その他']].map(([v, l]) => `<option value="${v}" ${m.sex === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <fieldset class="cond">
          <legend>アレルギー（特定原材料）</legend>
          <div class="toggle-list">${toggles(i, ALLERGENS_MAIN, m.allergies || [])}</div>
          <details class="more-allergens" ${(m.allergies || []).some((a) => ALLERGENS_MORE.includes(a)) ? 'open' : ''}>
            <summary>そのほかの品目</summary>
            <div class="toggle-list">${toggles(i, ALLERGENS_MORE, m.allergies || [])}</div>
          </details>
          ${extra(m).length ? `<div class="toggle-list">${toggles(i, extra(m), m.allergies)}</div>` : ''}
        </fieldset>
        <div class="field">
          <label for="fam-avoid-${i}">そのほか食べられないもの</label>
          <input id="fam-avoid-${i}" type="text" maxlength="200" data-fam-field="avoid" data-i="${i}" value="${esc(m.avoid)}" placeholder="例：生もの、アルコール、辛いもの">
          <p class="hint">「、」で区切って入れてください。献立では使いません。</p>
        </div>
        <div class="field">
          <label for="fam-dislikes-${i}">苦手なもの（なるべく避ける）</label>
          <input id="fam-dislikes-${i}" type="text" maxlength="200" data-fam-field="dislikes" data-i="${i}" value="${esc(m.dislikes)}" placeholder="例：ピーマン、セロリ">
        </div>
        <div class="field">
          <label for="fam-note-${i}">メモ（量や体調など）</label>
          <input id="fam-note-${i}" type="text" maxlength="120" data-fam-field="note" data-i="${i}" value="${esc(m.note)}" placeholder="例：よく食べる、減塩を心がけている、やわらかめが好き">
        </div>
      </article>`).join('')}
    </div>

    ${hh.members.length < 12 ? '<button type="button" class="btn btn-outline btn-block" data-fam-add>＋ 家族を追加</button>' : ''}

    <div class="settings-block fam-common">
      <div class="field">
        <label for="fam-common">家族全員で使わないもの</label>
        <input id="fam-common" type="text" maxlength="300" data-fam-common value="${esc(hh.commonAvoid)}" placeholder="例：豚肉、アルコール">
        <p class="hint">宗教・信条や家のルールなど、だれが食べるかに関係なく使わない食材。</p>
      </div>
    </div>

    <p class="form-msg" id="fam-msg" role="alert"></p>
    <button type="button" class="btn btn-primary btn-block btn-big" data-fam-save>家族の設定を保存</button>
  `;
  if (!hh.members.length) {
    hh.members.push({ id: newMemberId(), name: '', age: '', sex: '', allergies: [], avoid: '', dislikes: '', note: '' });
    renderFamilyPane();
  }
}

async function saveFamily(silent = false) {
  const hh = state.famDraft;
  if (!hh) return;
  const msg = $('#fam-msg');
  const isBlank = (m) => !String(m.name || '').trim() && !(m.allergies || []).length && !m.avoid && !m.dislikes && !m.note && m.age === '';
  const members = hh.members.filter((m) => !isBlank(m));
  const noName = members.findIndex((m) => !String(m.name || '').trim());
  if (noName >= 0) {
    if (silent) { toast('呼び名のない家族がいるため、家族の設定はまだ保存していません', 'error'); return; }
    const idx = hh.members.indexOf(members[noName]);
    if (msg) { msg.textContent = `${idx + 1}人目の呼び名を入れてください`; msg.className = 'form-msg is-error'; }
    const input = $(`#fam-name-${idx}`);
    if (input) input.focus();
    return;
  }
  const payload = {
    members: members.map((m) => ({ ...m, name: m.name.trim(), age: m.age === '' || m.age == null ? '' : Number(m.age) })),
    commonAvoid: hh.commonAvoid || '',
  };
  try {
    const d = await api('saveSettings', { household: payload });
    state.settings.household = d.settings.household;
    state.famDraft = null;
    state.famDirty = false;
    renderAvoidNotice();
    toast('家族の設定を保存しました');
    if (state.currentTab === 'menu' && state.menuView === 'family') renderFamilyPane();
  } catch (err) {
    if (err.code === 'AUTH') return;
    if (silent || !msg) toast(err.message, 'error');
    else { msg.textContent = err.message; msg.className = 'form-msg is-error'; }
  }
}

/* ---------- 献立をつくる（条件の入力） ---------- */

function menuPrefs() {
  if (!state.settings.menuPrefs) state.settings.menuPrefs = defaultMenuPrefs();
  return state.settings.menuPrefs;
}

function mealMembers(type) {
  const ex = menuPrefs().meals[type].excluded || [];
  return householdMembers().map((m) => m.id).filter((id) => !ex.includes(id));
}

function cellMembers(date, type) {
  const key = `${date}|${type}`;
  const ids = householdMembers().map((m) => m.id);
  if (state.menuOverrides[key]) return state.menuOverrides[key].filter((id) => ids.includes(id));
  return mealMembers(type);
}

function selectHtml(name, options, value) {
  return `<select name="${name}" id="mf-${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function renderPlanPane() {
  const box = $('#menu-plan');
  if (!householdMembers().length) {
    box.innerHTML = `<div class="empty">
      <strong>まず、食べる人を登録しましょう</strong>
      <p>家族の人数・年齢・アレルギーをもとに、1週間分の献立を考えます。</p>
      <button type="button" class="btn btn-primary" data-mv="family">家族を登録する</button>
    </div>`;
    return;
  }
  if (state.menuCreating || !state.menu) renderMenuForm();
  else renderPlan();
}

function renderMenuForm() {
  const p = menuPrefs();
  if (!state.menuStart) state.menuStart = todayYmd();
  const members = householdMembers();
  const mealBlock = (t) => {
    const m = p.meals[t];
    const inc = mealMembers(t);
    return `<div class="meal-pref ${m.enabled ? '' : 'is-off'}">
      <label class="check meal-check"><input type="checkbox" data-meal-enable="${t}" ${m.enabled ? 'checked' : ''}><span>${MEAL_LABELS[t]}</span></label>
      <div class="meal-pref-body">
        <div class="member-toggles" aria-label="${MEAL_LABELS[t]}を食べる人">
          ${members.map((mb) => `<button type="button" class="toggle" data-meal-member="${t}" data-id="${esc(mb.id)}" aria-pressed="${inc.includes(mb.id)}">${esc(mb.name)}</button>`).join('')}
        </div>
        <div class="field field-inline">
          <label for="mf-style_${t}">構成</label>
          ${selectHtml(`style_${t}`, MEAL_STYLES.map((s) => [s, s]), m.style)}
        </div>
      </div>
    </div>`;
  };
  const fridgeCount = state.ingredients.length;
  const ng = ngSummaryText();

  $('#menu-plan').innerHTML = `
    ${state.menu ? '<button type="button" class="btn btn-text back-link" data-m-cancel>← 献立表にもどる</button>' : ''}
    <form id="form-menu" class="menu-form" novalidate>
      <h3 class="mf-title">新しい献立をつくる</h3>
      <section class="mf-block">
        <h4>期間</h4>
        <div class="cond-row">
          <div class="field">
            <label for="mf-start">開始日</label>
            <input id="mf-start" type="date" name="startDate" value="${esc(state.menuStart)}" required>
          </div>
          <div class="field">
            <label for="mf-days">日数</label>
            ${selectHtml('days', Array.from({ length: 14 }, (_, k) => [k + 1, k + 1 === 7 ? '7日（1週間）' : `${k + 1}日`]), p.days)}
          </div>
        </div>
      </section>

      <section class="mf-block">
        <h4>作る食事と食べる人</h4>
        <p class="hint">名前を押すと、その食事を食べる人を切り替えられます。</p>
        ${MEAL_TYPES.map(mealBlock).join('')}
        <details class="menu-grid-wrap" ${Object.keys(state.menuOverrides).length ? 'open' : ''}>
          <summary>日ごとに食べる人を変える（外食・お弁当・留守の日など）</summary>
          <div id="menu-grid"></div>
        </details>
      </section>

      <section class="mf-block">
        <h4>条件</h4>
        <div class="cond-row">
          <div class="field">
            <label for="mf-weekdayMinutes">平日の調理時間</label>
            ${selectHtml('weekdayMinutes', MINUTE_OPTIONS, p.weekdayMinutes)}
          </div>
          <div class="field">
            <label for="mf-weekendMinutes">休日の調理時間</label>
            ${selectHtml('weekendMinutes', [...MINUTE_OPTIONS, [90, '90分']], p.weekendMinutes)}
          </div>
        </div>
        <label class="check"><input type="checkbox" name="useFridge" ${p.useFridge ? 'checked' : ''}><span>冷蔵庫の食材を優先して使う（いま${fridgeCount}品）</span></label>
        ${fridgeCount ? '' : '<p class="hint">冷蔵庫の食材は「つくる」画面で入れられます。</p>'}
        <label class="check"><input type="checkbox" name="useSaved" ${p.useSaved ? 'checked' : ''}><span>お気に入り・取り込んだレシピも取り入れる</span></label>
        <label class="check"><input type="checkbox" name="budget" ${p.budget ? 'checked' : ''}><span>食費を抑えたい</span></label>
        <div class="field">
          <label for="mf-note">家族の希望（なくても大丈夫）</label>
          <textarea id="mf-note" name="note" rows="2" maxlength="300" placeholder="例：魚を週2回、月曜は作り置きを活用、野菜多めに">${esc(p.note)}</textarea>
        </div>
      </section>

      <div class="ng-summary">${ng
        ? `<strong>使わない食材</strong><span>${esc(ng)}</span><button type="button" class="btn-link" data-mv="family">変更</button>`
        : '<span>アレルギー・食べられないものは登録されていません。</span><button type="button" class="btn-link" data-mv="family">登録する</button>'}</div>

      <p class="form-msg" role="alert"></p>
      <button type="submit" class="btn btn-primary btn-block btn-big">献立を作る</button>
      <p class="hint center">1週間分（夕食のみ）でおよそ1分かかります。朝食・昼食も作ると、そのぶん長くなります。</p>
    </form>`;
  renderMenuGrid();
}

function menuDates() {
  const start = state.menuStart || todayYmd();
  return Array.from({ length: menuPrefs().days }, (_, k) => addDays(start, k));
}

function renderMenuGrid() {
  const box = $('#menu-grid');
  if (!box) return;
  const p = menuPrefs();
  const meals = MEAL_TYPES.filter((t) => p.meals[t].enabled);
  if (!meals.length) { box.innerHTML = '<p class="hint">作る食事を選んでください。</p>'; return; }
  const members = householdMembers();
  box.innerHTML = `<div class="grid-scroll"><table class="menu-grid">
    <thead><tr><th scope="col">日付</th>${meals.map((t) => `<th scope="col">${MEAL_LABELS[t]}</th>`).join('')}</tr></thead>
    <tbody>${menuDates().map((date) => `<tr class="${isWeekend(date) ? 'is-weekend' : ''}">
      <th scope="row">${esc(dayLabel(date))}</th>
      ${meals.map((t) => {
        const inc = cellMembers(date, t);
        return `<td class="${inc.length ? '' : 'is-off'}">
          <div class="cell-members">${members.map((m) => `<button type="button" class="cell-btn" data-cell="${date}|${t}" data-id="${esc(m.id)}" aria-pressed="${inc.includes(m.id)}" aria-label="${esc(dayLabel(date))}の${MEAL_LABELS[t]}：${esc(m.name)}">${esc(shortName(m.name))}</button>`).join('')}</div>
          ${inc.length ? '' : '<span class="cell-off">作らない</span>'}
        </td>`;
      }).join('')}
    </tr>`).join('')}</tbody>
  </table></div>
  <p class="hint">全員を外すと、その食事は作りません。${Object.keys(state.menuOverrides).length ? '<button type="button" class="btn-link" data-grid-reset>日ごとの調整を元に戻す</button>' : ''}</p>`;
}

function saveMenuPrefs() {
  queueSettingsSave({ menuPrefs: menuPrefs() });
}

/* ---------- 献立をつくる（AI） ---------- */

function menuOptions() {
  const p = menuPrefs();
  return {
    weekdayMinutes: p.weekdayMinutes, weekendMinutes: p.weekendMinutes,
    useFridge: p.useFridge, useSaved: p.useSaved, budget: p.budget, note: p.note,
  };
}

async function collectSavedRecipes() {
  try {
    if (!state.loaded.history) {
      const d = await api('getHistory', { limit: 200 });
      d.recipes.forEach(cacheRecipe);
      state.history = d.recipes.map((r) => r.id);
      state.loaded.history = true;
    }
  } catch (err) {
    if (err.code === 'AUTH') throw err;
    return [];
  }
  const all = state.history.map((id) => state.recipes.get(id)).filter(Boolean);
  const picked = [...all.filter((x) => x.favorite), ...all.filter((x) => !x.favorite && isImported(x))];
  const seen = new Set();
  return picked.filter((x) => {
    const t = x.recipe.title;
    if (seen.has(t) || checkRecipe(x.recipe).some((i) => i.level === 'ng')) return false;
    seen.add(t);
    return true;
  }).slice(0, 40).map((x) => ({
    id: x.id, title: x.recipe.title, ingredients: x.recipe.ingredients.map((i) => i.name).slice(0, 8),
  }));
}

function mergeMenuDays(plan, days) {
  (days || []).forEach((nd) => {
    const day = plan.days.find((d) => d.date === nd.date);
    if (!day) return;
    nd.meals.forEach((nm) => {
      const meal = day.meals.find((m) => m.type === nm.type);
      if (meal) meal.dishes = nm.dishes;
    });
  });
}

function planDishNames(plan, exceptDate) {
  return plan.days.filter((d) => d.date !== exceptDate)
    .flatMap((d) => d.meals.flatMap((m) => m.dishes.map((x) => x.name)));
}

async function createMenu() {
  const f = $('#form-menu');
  const p = menuPrefs();
  const start = f.startDate.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return formMsg(f, '開始日を選んでください');
  state.menuStart = start;
  const mealsOn = MEAL_TYPES.filter((t) => p.meals[t].enabled);
  if (!mealsOn.length) return formMsg(f, '作る食事（朝食・昼食・夕食）を1つ以上選んでください');

  const days = menuDates().map((date) => ({
    date,
    meals: mealsOn.map((t) => ({ type: t, members: cellMembers(date, t), style: p.meals[t].style, dishes: [] }))
      .filter((m) => m.members.length),
  }));
  if (!days.some((d) => d.meals.length)) return formMsg(f, '食べる人が1人もいません。名前を押して選んでください');
  formMsg(f, '');
  if (state.famDirty) await saveFamily(true);

  const end = days[days.length - 1].date;
  const plan = {
    id: '',
    title: `${shortDate(start)}〜${shortDate(end)}の献立`,
    days,
    options: menuOptions(),
    shopping: null,
  };

  // AIの応答が長くなりすぎないよう、数日ずつに分けて作る
  const chunks = [];
  let cur = [];
  let count = 0;
  days.filter((d) => d.meals.length).forEach((d) => {
    if (cur.length && count + d.meals.length > MAX_MEALS_PER_CALL) { chunks.push(cur); cur = []; count = 0; }
    cur.push(d);
    count += d.meals.length;
  });
  if (cur.length) chunks.push(cur);

  const btn = $('[type="submit"]', f);
  setBusy(btn, true);
  const stop = showLoading(['献立を考える準備をしています…']);
  let failedAt = -1;
  let errorMsg = '';
  try {
    const savedRecipes = p.useSaved ? await collectSavedRecipes() : [];
    for (let i = 0; i < chunks.length; i++) {
      const head = chunks.length > 1 ? `献立を考えています（${i + 1}/${chunks.length}）` : '献立を考えています';
      setLoadingLines([`${head}…`, `${head}：栄養のバランスを整えています…`, `${head}：アレルギーの食材を確認しています…`, `${head}：冷蔵庫の食材と相談しています…`]);
      try {
        const d = await api('generateMenuPart', {
          slots: chunks[i].map((day) => ({
            date: day.date, weekend: isWeekend(day.date),
            meals: day.meals.map((m) => ({ type: m.type, members: m.members, style: m.style })),
          })),
          options: plan.options,
          fridge: p.useFridge ? state.ingredients : [],
          seasonings: [...state.seasonings],
          savedRecipes,
          previousDishes: planDishNames(plan, ''),
        });
        mergeMenuDays(plan, d.days);
      } catch (err) {
        if (err.code === 'AUTH') return;
        failedAt = i;
        errorMsg = err.message;
        break;
      }
    }
    if (failedAt === 0) {
      formMsg(f, errorMsg);
      return;
    }
    setLoadingLines(['献立を保存しています…']);
    state.menu = plan;
    state.shopRange = null;
    await saveMenuNow();
    state.menuCreating = false;
    state.menuOverrides = {};
    renderMenuPanel();
    window.scrollTo(0, 0);
    if (failedAt > 0) toast(`途中までの献立を保存しました（${errorMsg}）。残りの日は「この日を作る」から作れます`, 'error');
    else toast('献立ができました');
  } catch (err) {
    if (err.code !== 'AUTH') formMsg(f, err.message);
  } finally {
    stop();
    if (document.body.contains(btn)) setBusy(btn, false);
  }
}

/* ---------- 献立表 ---------- */

function renderPlan() {
  const plan = state.menu;
  const today = todayYmd();
  const first = plan.days[0].date;
  const last = plan.days[plan.days.length - 1].date;
  const mealsUsed = MEAL_TYPES.filter((t) => plan.days.some((d) => d.meals.some((m) => m.type === t)));
  const ngCount = plan.days.reduce((n, d) => n + d.meals.reduce((k, m) => k + m.dishes.filter((x) => checkNames(recipeNames(x), ngRules(m.members)).some((i) => i.level === 'ng')).length, 0), 0);

  const dishRow = (dish, di, mi, xi, meal) => {
    const issues = checkNames(recipeNames(dish), ngRules(meal.members));
    const ng = issues.filter((i) => i.level === 'ng');
    const caution = issues.filter((i) => i.level === 'caution');
    const time = dish.cookingTimeMinutes ? `${dish.cookingTimeMinutes}分` : '';
    return `<li class="dish-row ${ng.length ? 'has-ng' : ''}">
      <span class="role role-${esc(dish.role)}">${esc(dish.role)}</span>
      <div class="dish-main">
        <button type="button" class="dish-name" data-m-dish="${di}|${mi}|${xi}">${esc(dish.name)}</button>
        <span class="dish-sub">${[dish.summary, time].filter(Boolean).map(esc).join('・')}${dish.savedRecipeId ? '<em class="tag-saved">保存したレシピ</em>' : ''}${dish.recipeId ? '<em class="tag-recipe">作り方あり</em>' : ''}</span>
        ${ng.length ? `<span class="dish-ng">⚠ ${ng.map((x) => `${esc(x.label)}（${esc(whoText(x.who))}）：${esc(x.names.join('、'))}`).join(' ／ ')}</span>` : ''}
        ${!ng.length && caution.length ? `<span class="dish-caution">原材料を確認：${caution.map((x) => `${esc(x.names.join('、'))}（${esc(x.label)}）`).join('、')}</span>` : ''}
      </div>
    </li>`;
  };

  $('#menu-plan').innerHTML = `
    <div class="plan-head">
      <div>
        <h3 class="plan-title">${esc(plan.title)}</h3>
        <p class="plan-range">${esc(dayLabel(first))}〜${esc(dayLabel(last))}・${mealsUsed.map((t) => MEAL_LABELS[t]).join('・')}</p>
      </div>
      <button type="button" class="btn btn-outline btn-small" data-m-new>新しく作る</button>
    </div>
    ${state.menuList.length > 1 ? `<div class="field plan-switch">
      <label for="plan-switch">ほかの献立</label>
      <select id="plan-switch" data-m-switch>${state.menuList.map((m) => `<option value="${esc(m.id)}" ${m.id === plan.id ? 'selected' : ''}>${esc(m.title)}</option>`).join('')}</select>
    </div>` : ''}
    ${ngCount ? `<div class="ng-box is-ng" role="alert"><strong>⚠ 使えない食材を含む料理が${ngCount}品あります</strong><p>「この日を作り直す」で作り直すか、作り方を開いたときに材料を置き換えてください。</p></div>` : ''}

    <div class="days">
      ${plan.days.map((day, di) => {
        const empty = day.meals.every((m) => !m.dishes.length);
        return `<article class="day-card ${day.date === today ? 'is-today' : ''} ${day.date < today ? 'is-past' : ''}">
          <header class="day-head">
            <h4>${esc(dayLabel(day.date))}</h4>
            ${day.date === today ? '<span class="pill pill-mint">今日</span>' : ''}
          </header>
          ${day.meals.length ? day.meals.map((meal, mi) => `<section class="meal">
            <div class="meal-head">
              <span class="meal-label meal-${meal.type}">${MEAL_LABELS[meal.type]}</span>
              <span class="meal-who">${esc(memberNames(meal.members).join('・'))}</span>
            </div>
            ${meal.dishes.length
              ? `<ul class="dish-list">${meal.dishes.map((dish, xi) => dishRow(dish, di, mi, xi, meal)).join('')}</ul>`
              : '<p class="meal-empty">まだ献立がありません</p>'}
          </section>`).join('') : '<p class="meal-empty">この日は作る食事がありません</p>'}
          ${day.meals.length ? `<footer class="day-foot"><button type="button" class="btn-link" data-m-redo="${di}">${empty ? 'この日を作る' : 'この日を作り直す'}</button></footer>` : ''}
        </article>`;
      }).join('')}
    </div>

    <p class="hint center">料理名を押すと、作り方を表示します（はじめて開くときはAIが作ります）。</p>
    <div class="plan-actions">
      <button type="button" class="btn btn-primary btn-block btn-big" data-mv="shopping">${plan.shopping ? '買い物リストを見る' : '買い物リストを作る'}</button>
      <div class="plan-sub-actions">
        <button type="button" class="btn btn-outline" data-m-copy>献立をテキストでコピー</button>
        <button type="button" class="btn btn-danger-text" data-m-delete>この献立を削除</button>
      </div>
    </div>`;
}

async function openMenuDish(di, mi, xi) {
  const plan = state.menu;
  const day = plan.days[di];
  const meal = day && day.meals[mi];
  const dish = meal && meal.dishes[xi];
  if (!dish) return;

  for (const key of ['recipeId', 'savedRecipeId']) {
    const rid = dish[key];
    if (!rid) continue;
    try {
      const stop = state.recipes.has(rid) ? () => {} : showLoading(['レシピを読み込んでいます…']);
      try { await ensureRecipe(rid); } finally { stop(); }
      openRecipe(rid);
      return;
    } catch (err) {
      if (err.code === 'AUTH') return;
      dish[key] = ''; // 削除されたレシピ → 作り直す
      scheduleMenuSave();
    }
  }

  const stop = showLoading([`「${dish.name}」の作り方を考えています…`, '分量を家族の人数に合わせています…', 'アレルギーの食材を確認しています…']);
  try {
    const d = await api('menuDishRecipe', {
      dish, members: meal.members, date: day.date, mealType: meal.type, menuId: plan.id,
      fridge: state.ingredients, seasonings: [...state.seasonings],
    });
    cacheRecipe(d.recipe);
    if (state.loaded.history) state.history.unshift(d.recipe.id);
    dish.recipeId = d.recipe.id;
    scheduleMenuSave();
    renderPlan();
    openRecipe(d.recipe.id);
  } catch (err) {
    if (err.code !== 'AUTH') toast(err.message, 'error');
  } finally {
    stop();
  }
}

async function redoDay(di) {
  const plan = state.menu;
  const day = plan.days[di];
  if (!day || !day.meals.length) return;
  const had = day.meals.some((m) => m.dishes.length);
  if (had && !confirm(`${dayLabel(day.date)}の献立を作り直しますか？`)) return;
  const stop = showLoading([`${dayLabel(day.date)}の献立を考えています…`, 'ほかの日と重ならないようにしています…', 'アレルギーの食材を確認しています…']);
  try {
    const savedRecipes = plan.options.useSaved ? await collectSavedRecipes() : [];
    const d = await api('generateMenuPart', {
      slots: [{ date: day.date, weekend: isWeekend(day.date), meals: day.meals.map((m) => ({ type: m.type, members: m.members, style: m.style })) }],
      options: plan.options,
      fridge: plan.options.useFridge ? state.ingredients : [],
      seasonings: [...state.seasonings],
      savedRecipes,
      previousDishes: planDishNames(plan, day.date),
    });
    mergeMenuDays(plan, d.days);
    renderPlan();
    await saveMenuNow();
    toast(`${dayLabel(day.date)}の献立を${had ? '作り直しました' : '作りました'}`);
  } catch (err) {
    if (err.code !== 'AUTH') toast(err.message, 'error');
  } finally {
    stop();
  }
}

function planText(plan) {
  const lines = [`【${plan.title}】`];
  plan.days.forEach((d) => {
    lines.push('', `■${dayLabel(d.date)}`);
    if (!d.meals.length) lines.push('（作る食事なし）');
    d.meals.forEach((m) => {
      lines.push(`${MEAL_LABELS[m.type]}：${m.dishes.length ? m.dishes.map((x) => x.name).join('／') : '（未定）'}`);
    });
  });
  return lines.join('\n');
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(message);
}

async function deleteMenu() {
  const plan = state.menu;
  if (!plan) return;
  if (!confirm(`「${plan.title}」を削除しますか？\n買い物リストも一緒に削除されます（作り方のレシピは「レシピ」に残ります）。`)) return;
  try {
    if (plan.id) await api('deleteMenu', { menuId: plan.id });
    state.menuList = state.menuList.filter((m) => m.id !== plan.id);
    state.menu = null;
    state.shopRange = null;
    if (state.menuList.length) await loadMenu(state.menuList[0].id);
    renderMenuPanel();
    toast('献立を削除しました');
  } catch (err) {
    if (err.code !== 'AUTH') toast(err.message, 'error');
  }
}

/* ---------- 買い物リスト ---------- */

const SHOP_CATEGORIES = ['野菜・果物', '肉', '魚介', '卵・乳製品', '豆腐・大豆製品', '米・パン・麺', '調味料・油', '乾物・缶詰', '冷凍食品', 'その他'];

function shopRange() {
  const plan = state.menu;
  const dates = plan.days.map((d) => d.date);
  const first = dates[0];
  const last = dates[dates.length - 1];
  let r = state.shopRange;
  if (!r && plan.shopping && plan.shopping.from) r = { from: plan.shopping.from, to: plan.shopping.to };
  if (!r) {
    const today = todayYmd();
    r = { from: today > first && today <= last ? today : first, to: last };
  }
  if (!dates.includes(r.from)) r.from = first;
  if (!dates.includes(r.to)) r.to = last;
  if (r.to < r.from) r.to = r.from;
  state.shopRange = r;
  return r;
}

function dishesInRange(plan, r) {
  const out = [];
  plan.days.filter((d) => d.date >= r.from && d.date <= r.to).forEach((d) => {
    d.meals.forEach((m) => m.dishes.forEach((x) => out.push({
      label: `${shortDate(d.date)}${MEAL_LABELS[m.type]}`, name: x.name, ingredients: x.ingredients, seasonings: x.seasonings,
    })));
  });
  return out;
}

function renderShoppingPane() {
  const box = $('#menu-shopping');
  const plan = state.menu;
  if (!plan) {
    box.innerHTML = `<div class="empty"><strong>まだ献立がありません</strong><p>献立を作ると、その期間に必要な食材の買い物リストを作れます。</p><button type="button" class="btn btn-primary" data-mv="plan">献立を作る</button></div>`;
    return;
  }
  const r = shopRange();
  const dateOpts = (sel) => plan.days.map((d) => `<option value="${d.date}" ${d.date === sel ? 'selected' : ''}>${esc(dayLabel(d.date))}</option>`).join('');
  const count = dishesInRange(plan, r).length;
  const sh = plan.shopping;

  box.innerHTML = `
    <section class="shop-setup">
      <h3>${esc(plan.title)}</h3>
      <div class="cond-row">
        <div class="field"><label for="shop-from">いつから</label><select id="shop-from" data-shop-range="from">${dateOpts(r.from)}</select></div>
        <div class="field"><label for="shop-to">いつまで</label><select id="shop-to" data-shop-range="to">${dateOpts(r.to)}</select></div>
      </div>
      <p class="hint" id="shop-count">この期間の料理 ${count}品の食材を集計します。</p>

      <div class="shop-fridge">
        <h4>冷蔵庫にあるもの <small id="shop-fridge-count">${state.ingredients.length}品</small></h4>
        <p class="hint">ここにあるものは買い物リストに入れません。使い切ったものは外してください。</p>
        <ul id="shop-fridge" class="chip-list"></ul>
        <div class="ing-entry">
          <label for="shop-fridge-input" class="sr-only">冷蔵庫にある食材</label>
          <input id="shop-fridge-input" type="text" placeholder="例：玉ねぎ、卵" autocomplete="off" enterkeyhint="done" maxlength="60">
          <button type="button" class="btn btn-ink" data-shop-fridge-add>追加</button>
        </div>
      </div>
      <p class="hint">家にある調味料（${state.seasonings.size}種類）も入れません。<button type="button" class="btn-link" data-go="make">調味料を変える</button></p>

      <button type="button" class="btn btn-primary btn-block btn-big" data-shop-make>${sh ? '買い物リストを作り直す' : '買い物リストを作る'}</button>
      <button type="button" class="btn-link shop-local" data-shop-local>AIを使わずに、食材をそのまま集計する</button>
    </section>
    <section id="shop-result" class="shop-result" ${sh ? '' : 'hidden'}></section>`;
  renderShopFridge();
  if (sh) renderShopResult();
}

function renderShopFridge() {
  const ul = $('#shop-fridge');
  if (!ul) return;
  $('#shop-fridge-count').textContent = `${state.ingredients.length}品`;
  ul.innerHTML = state.ingredients.length
    ? state.ingredients.map((n) => `<li class="chip">${esc(n)}<button type="button" data-shop-fridge-remove="${esc(n)}" aria-label="${esc(n)}を外す">×</button></li>`).join('')
    : '<li class="chip-empty">冷蔵庫の食材は入っていません</li>';
}

function renderShopResult() {
  const box = $('#shop-result');
  const sh = state.menu.shopping;
  if (!box || !sh) return;
  box.hidden = false;
  const rules = ngRules(null);
  const left = sh.items.filter((x) => !x.checked).length;
  const groups = SHOP_CATEGORIES.map((c) => [c, sh.items.map((x, i) => [x, i]).filter(([x]) => x.category === c)]).filter(([, list]) => list.length);

  box.innerHTML = `
    <div class="shop-head">
      <h3>買い物リスト</h3>
      <p><span>${esc(dayLabel(sh.from))}〜${esc(dayLabel(sh.to))}</span>・<strong id="shop-left">${left ? `あと${left}品` : 'ぜんぶ買いました'}</strong></p>
    </div>
    ${sh.advice ? `<p class="shop-advice">${esc(sh.advice)}</p>` : ''}
    ${groups.map(([cat, list]) => `<section class="shop-cat">
      <h4>${esc(cat)}</h4>
      <ul class="shop-list">${list.map(([x, i]) => {
        const ng = rules.length ? checkNames([x.name], rules).filter((k) => k.level === 'ng') : [];
        return `<li class="shop-item ${x.checked ? 'is-checked' : ''}">
          <label>
            <input type="checkbox" data-shop-check="${i}" ${x.checked ? 'checked' : ''}>
            <span class="si-name">${esc(x.name)}</span>
            <span class="si-amt">${esc(x.amount)}</span>
          </label>
          ${x.dishes.length || x.note || ng.length ? `<div class="si-sub">
            ${x.dishes.length ? `<span>${esc(x.dishes.join('、'))}</span>` : ''}
            ${x.note ? `<span class="si-note">${esc(x.note)}</span>` : ''}
            ${ng.length ? `<span class="si-ng">⚠ ${esc(ng.map((k) => `${k.label}（${whoText(k.who)}）`).join('、'))}</span>` : ''}
          </div>` : ''}
          ${x.manual ? `<button type="button" class="si-del" data-shop-del="${i}" aria-label="${esc(x.name)}を消す">×</button>` : ''}
        </li>`;
      }).join('')}</ul>
    </section>`).join('')}
    ${!sh.items.length ? '<p class="hint">買い足すものはありません。冷蔵庫の食材で作れます。</p>' : ''}

    <div class="shop-add">
      <label for="shop-add-input" class="sr-only">買うものを追加</label>
      <input id="shop-add-input" type="text" maxlength="40" placeholder="ほかに買うもの（例：牛乳）" autocomplete="off" enterkeyhint="done">
      <button type="button" class="btn btn-ink" data-shop-add>追加</button>
    </div>

    ${sh.fromFridge.length ? `<section class="shop-cat shop-fridge-use">
      <h4>冷蔵庫から使うもの</h4>
      <ul class="plain-list">${sh.fromFridge.map((x) => `<li><strong>${esc(x.name)}</strong>${x.use ? `<span>${esc(x.use)}</span>` : ''}</li>`).join('')}</ul>
    </section>` : ''}

    <div class="shop-actions">
      <button type="button" class="btn btn-outline" data-shop-copy>テキストでコピー</button>
      ${navigator.share ? '<button type="button" class="btn btn-outline" data-shop-share>家族に送る</button>' : ''}
      <button type="button" class="btn btn-text" data-shop-reset>チェックをすべて外す</button>
    </div>`;
}

function updateShopLeft() {
  const sh = state.menu && state.menu.shopping;
  const el = $('#shop-left');
  if (!sh || !el) return;
  const left = sh.items.filter((x) => !x.checked).length;
  el.textContent = left ? `あと${left}品` : 'ぜんぶ買いました';
}

async function makeShopping(local) {
  const plan = state.menu;
  const r = shopRange();
  const dishes = dishesInRange(plan, r);
  if (!dishes.length) { toast('選んだ期間に料理がありません'); return; }
  const prevManual = plan.shopping ? plan.shopping.items.filter((x) => x.manual) : [];
  let result;
  if (local) {
    result = aggregateShopping(dishes);
  } else {
    const stop = showLoading(['献立の食材を集めています…', '冷蔵庫にあるものを確認しています…', '買う量をまとめています…']);
    try {
      result = await api('makeShoppingList', {
        dishes, fridge: state.ingredients, seasonings: [...state.seasonings],
      });
    } catch (err) {
      if (err.code !== 'AUTH') toast(`${err.message}（「AIを使わずに集計する」でも作れます）`, 'error');
      return;
    } finally {
      stop();
    }
  }
  plan.shopping = {
    from: r.from, to: r.to,
    items: [...result.items.map((x) => ({ ...x, checked: false })), ...prevManual],
    fromFridge: result.fromFridge || [],
    advice: result.advice || '',
    createdAt: new Date().toISOString(),
  };
  renderShoppingPane();
  requestAnimationFrame(() => $('#shop-result').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  try { await saveMenuNow(); } catch (e) { /* 表示済み */ }
}

const CATEGORY_WORDS = [
  ['乾物・缶詰', ['缶', 'わかめ', 'ひじき', '春雨', '切り干し', '干し', '乾燥', 'のり', '海苔', '昆布', '削り節', 'かつお節', 'ごま']],
  ['冷凍食品', ['冷凍']],
  ['卵・乳製品', ['卵', 'たまご', '牛乳', 'チーズ', 'バター', 'ヨーグルト', '生クリーム']],
  ['豆腐・大豆製品', ['豆腐', '納豆', '油揚げ', '厚揚げ', '豆乳', 'がんも', 'おから']],
  ['肉', ['肉', 'ベーコン', 'ハム', 'ソーセージ', 'ウインナー', 'ささみ', '手羽', 'ひき', 'レバー', 'チキン', 'ポーク', 'ビーフ']],
  ['魚介', ['鮭', 'さけ', 'さば', 'あじ', 'いわし', 'ぶり', 'たら', 'さんま', 'まぐろ', 'かつお', 'えび', 'いか', 'たこ', 'あさり', 'しじみ', 'ほたて', '牡蠣', 'かき', 'しらす', 'ちりめん', '刺身', '魚', 'サーモン', 'ツナ']],
  ['米・パン・麺', ['米', 'ごはん', 'ご飯', 'パン', 'うどん', 'そば', 'そうめん', 'パスタ', 'スパゲッティ', '麺', 'もち', '餅', 'マカロニ', 'ピザ', '餃子の皮', 'ぎょうざの皮']],
  ['その他', ['こんにゃく', 'しらたき', 'ちくわ', 'かまぼこ', 'はんぺん', 'キムチ', '漬け', 'ジャム']],
];

function guessCategory(name) {
  const n = normWord(name);
  for (const [cat, words] of CATEGORY_WORDS) {
    if (words.some((w) => n.includes(normWord(w)))) return cat;
  }
  return '野菜・果物';
}

function inFridge(name) {
  const n = normWord(name);
  if (n.length < 1) return false;
  return state.ingredients.some((f) => {
    const k = normWord(f);
    return k.length >= 1 && (n === k || (k.length >= 2 && n.includes(k)) || (n.length >= 2 && k.includes(n)));
  });
}

/** AIを使わずに、同じ名前の食材をまとめる（分量は並べるだけ） */
function aggregateShopping(dishes) {
  const items = new Map();
  const fridge = new Map();
  const home = [...state.seasonings].map(normWord);
  const add = (map, name, amount, dish, category) => {
    const key = normWord(name);
    if (!map.has(key)) map.set(key, { name, amounts: [], dishes: [], category });
    const it = map.get(key);
    if (amount) it.amounts.push(amount);
    if (dish && !it.dishes.includes(dish) && it.dishes.length < 3) it.dishes.push(dish);
  };
  dishes.forEach((d) => {
    const dish = `${d.label} ${d.name}`;
    d.ingredients.forEach((x) => {
      if (/^(水|お湯|湯|ごはん|ご飯|米)$/.test(x.name.trim())) return;
      if (inFridge(x.name)) add(fridge, x.name, x.amount, d.name);
      else add(items, x.name, x.amount, dish, guessCategory(x.name));
    });
    (d.seasonings || []).forEach((name) => {
      const n = normWord(name);
      if (!n || /^(水|お湯)$/.test(name) || home.some((h) => h && (n.includes(h) || h.includes(n)))) return;
      add(items, name, '', dish, '調味料・油');
    });
  });
  return {
    items: [...items.values()].map((x) => ({
      name: x.name, amount: x.amounts.join('＋'), category: x.category, dishes: x.dishes, note: '', checked: false,
    })),
    fromFridge: [...fridge.values()].map((x) => ({ name: x.name, use: x.dishes.join('、') })),
    advice: '',
  };
}

function shoppingText() {
  const plan = state.menu;
  const sh = plan.shopping;
  const lines = [`【買い物リスト】${dayLabel(sh.from)}〜${dayLabel(sh.to)}`];
  SHOP_CATEGORIES.forEach((c) => {
    const list = sh.items.filter((x) => x.category === c);
    if (!list.length) return;
    lines.push('', `■${c}`);
    list.forEach((x) => lines.push(`${x.checked ? '☑' : '□'} ${x.name}${x.amount ? `　${x.amount}` : ''}`));
  });
  if (sh.fromFridge.length) {
    lines.push('', '■冷蔵庫から使うもの');
    sh.fromFridge.forEach((x) => lines.push(`・${x.name}`));
  }
  const avoid = ngSummaryText();
  if (avoid) lines.push('', `※使わない食材：${avoid}`);
  return lines.join('\n');
}

/* ---------- 献立タブのイベント ---------- */

function onMenuClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;

  if (d.menuView) return setMenuView(d.menuView);
  if (d.mv) return setMenuView(d.mv);

  // 家族
  if (d.famAdd !== undefined) {
    state.famDraft.members.push({ id: newMemberId(), name: '', age: '', sex: '', allergies: [], avoid: '', dislikes: '', note: '' });
    state.famDirty = true;
    renderFamilyPane();
    const i = state.famDraft.members.length - 1;
    const input = $(`#fam-name-${i}`);
    if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus({ preventScroll: true }); }
    return;
  }
  if (d.famDel !== undefined) {
    const m = state.famDraft.members[Number(d.famDel)];
    if (m && (m.name || (m.allergies || []).length) && !confirm(`${m.name || 'この家族'}を削除しますか？`)) return;
    state.famDraft.members.splice(Number(d.famDel), 1);
    state.famDirty = true;
    renderFamilyPane();
    return;
  }
  if (d.famAllergy !== undefined) {
    const m = state.famDraft.members[Number(d.famAllergy)];
    const label = d.label;
    const has = m.allergies.includes(label);
    m.allergies = has ? m.allergies.filter((x) => x !== label) : [...m.allergies, label];
    t.setAttribute('aria-pressed', String(!has));
    state.famDirty = true;
    return;
  }
  if (d.famSave !== undefined) return saveFamily(false);

  // 献立の条件
  if (d.mealMember) {
    const meal = menuPrefs().meals[d.mealMember];
    const ex = new Set(meal.excluded || []);
    if (ex.has(d.id)) ex.delete(d.id); else ex.add(d.id);
    meal.excluded = [...ex];
    t.setAttribute('aria-pressed', String(!ex.has(d.id)));
    saveMenuPrefs();
    renderMenuGrid();
    return;
  }
  if (d.cell) {
    const [date, type] = d.cell.split('|');
    const cur = new Set(cellMembers(date, type));
    if (cur.has(d.id)) cur.delete(d.id); else cur.add(d.id);
    state.menuOverrides[d.cell] = [...cur];
    renderMenuGrid();
    return;
  }
  if (d.gridReset !== undefined) { state.menuOverrides = {}; renderMenuGrid(); return; }
  if (d.mCancel !== undefined) { state.menuCreating = false; renderPlanPane(); return; }
  if (d.mNew !== undefined) {
    state.menuCreating = true;
    const last = state.menu && state.menu.days.length ? state.menu.days[state.menu.days.length - 1].date : '';
    state.menuStart = last && last >= todayYmd() ? addDays(last, 1) : todayYmd();
    renderPlanPane();
    window.scrollTo(0, 0);
    return;
  }

  // 献立表
  if (d.mDish) { const [a, b, c] = d.mDish.split('|').map(Number); return openMenuDish(a, b, c); }
  if (d.mRedo !== undefined) return redoDay(Number(d.mRedo));
  if (d.mCopy !== undefined) return copyText(planText(state.menu), '献立をコピーしました');
  if (d.mDelete !== undefined) return deleteMenu();

  // 買い物リスト
  if (d.shopMake !== undefined) return makeShopping(false);
  if (d.shopLocal !== undefined) return makeShopping(true);
  if (d.shopFridgeAdd !== undefined) {
    const input = $('#shop-fridge-input');
    if (input.value.trim()) addIngredients(input.value);
    input.value = '';
    input.focus();
    return;
  }
  if (d.shopFridgeRemove) return removeIngredient(d.shopFridgeRemove);
  if (d.shopAdd !== undefined) return addShopItem();
  if (d.shopDel !== undefined) {
    state.menu.shopping.items.splice(Number(d.shopDel), 1);
    renderShopResult();
    scheduleMenuSave();
    return;
  }
  if (d.shopCopy !== undefined) return copyText(shoppingText(), '買い物リストをコピーしました');
  if (d.shopShare !== undefined) {
    navigator.share({ title: '買い物リスト', text: shoppingText() }).catch(() => { /* キャンセル */ });
    return;
  }
  if (d.shopReset !== undefined) {
    state.menu.shopping.items.forEach((x) => { x.checked = false; });
    renderShopResult();
    scheduleMenuSave();
  }
}

function addShopItem() {
  const input = $('#shop-add-input');
  const name = input.value.trim().slice(0, 40);
  if (!name) { input.focus(); return; }
  state.menu.shopping.items.push({ name, amount: '', category: guessCategory(name), dishes: [], note: '', checked: false, manual: true });
  renderShopResult();
  scheduleMenuSave();
  const again = $('#shop-add-input');
  if (again) again.focus();
}

function onMenuInput(e) {
  const el = e.target;
  if (el.dataset.famField !== undefined) {
    const m = state.famDraft.members[Number(el.dataset.i)];
    if (!m) return;
    m[el.dataset.famField] = el.value;
    state.famDirty = true;
    if (el.dataset.famField === 'name') {
      const card = el.closest('.member-card');
      $('.member-head strong', card).textContent = el.value || '新しい家族';
      $('.avatar', card).textContent = Array.from(el.value || '？')[0];
    }
    return;
  }
  if (el.dataset.famCommon !== undefined) {
    state.famDraft.commonAvoid = el.value;
    state.famDirty = true;
  }
}

function onMenuChange(e) {
  const el = e.target;
  if (el.dataset.famField !== undefined || el.dataset.famCommon !== undefined) return;

  if (el.closest('#form-menu')) {
    const p = menuPrefs();
    if (el.dataset.mealEnable) {
      p.meals[el.dataset.mealEnable].enabled = el.checked;
      el.closest('.meal-pref').classList.toggle('is-off', !el.checked);
    } else if (el.name === 'startDate') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) state.menuStart = el.value;
    } else if (el.name === 'days') {
      p.days = Number(el.value);
    } else if (/^style_/.test(el.name)) {
      p.meals[el.name.slice(6)].style = el.value;
    } else if (['weekdayMinutes', 'weekendMinutes'].includes(el.name)) {
      p[el.name] = Number(el.value);
    } else if (['useFridge', 'useSaved', 'budget'].includes(el.name)) {
      p[el.name] = el.checked;
    } else if (el.name === 'note') {
      p.note = el.value.trim();
    }
    if (el.name !== 'startDate') saveMenuPrefs();
    if (el.dataset.mealEnable || el.name === 'startDate' || el.name === 'days') renderMenuGrid();
    return;
  }

  if (el.dataset.mSwitch !== undefined) {
    const id = el.value;
    const stop = showLoading(['献立を読み込んでいます…']);
    loadMenu(id).then(() => renderMenuPanel())
      .catch((err) => { if (err.code !== 'AUTH') toast(err.message, 'error'); })
      .finally(stop);
    return;
  }

  if (el.dataset.shopRange) {
    const r = shopRange();
    r[el.dataset.shopRange] = el.value;
    if (r.to < r.from) {
      if (el.dataset.shopRange === 'from') r.to = r.from; else r.from = r.to;
    }
    state.shopRange = r;
    $('#shop-from').value = r.from;
    $('#shop-to').value = r.to;
    $('#shop-count').textContent = `この期間の料理 ${dishesInRange(state.menu, r).length}品の食材を集計します。`;
    return;
  }

  if (el.dataset.shopCheck !== undefined) {
    const item = state.menu.shopping.items[Number(el.dataset.shopCheck)];
    if (!item) return;
    item.checked = el.checked;
    el.closest('.shop-item').classList.toggle('is-checked', el.checked);
    updateShopLeft();
    scheduleMenuSave();
  }
}

function bindMenuKeys() {
  // 日本語入力の確定Enterでは追加しない
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (e.target.id === 'shop-fridge-input') {
      e.preventDefault();
      $('[data-shop-fridge-add]').click();
    } else if (e.target.id === 'shop-add-input') {
      e.preventDefault();
      addShopItem();
    }
  });
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
    if (d.goFamily !== undefined) { switchTab('menu'); setMenuView('family'); return; }
    if (d.fridgeClear !== undefined) return clearFridge();
    if (d.bulkStop !== undefined) { state.bulk.stop = true; renderBulk(); return; }
    if (d.bulkRetry !== undefined) return retryBulk();
    if (d.bulkClear !== undefined) { state.bulk.items = []; renderBulk(); return; }
    if (d.removeBulkPhoto !== undefined) {
      state.bulkImages.splice(Number(d.removeBulkPhoto), 1);
      renderBulkPhotos();
      updateBulkCount();
      return;
    }
    if (d.removePhoto !== undefined) {
      state.importImages.splice(Number(d.removePhoto), 1);
      renderImportPhotos();
      return;
    }
    if (d.remove) return removeIngredient(d.remove);
    if (d.quick) {
      if (state.ingredients.includes(d.quick)) removeIngredient(d.quick);
      else addIngredients(d.quick);
      return;
    }
    if (d.seasonToggle) {
      if (state.seasonings.has(d.seasonToggle)) state.seasonings.delete(d.seasonToggle);
      else state.seasonings.add(d.seasonToggle);
      state.seasoningsDirty = true;
      renderSeasonings();
      savePrefs();
      return;
    }
    if (d.season) {
      state.seasonings = new Set(d.season === 'all' ? SEASONINGS : d.season === 'basic' ? BASIC_SEASONINGS : []);
      state.seasoningsDirty = true;
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
  renderVersion();
  setupPasswordToggles();
  bindAuthForms();
  buildMakeForm();
  bindImport();
  bindBulk();
  bindRecipesPanel();
  bindMenu();
  bindGlobalEvents();
  readSharedImport();

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
    if (state.pendingImport) formMsg($('#form-login'), 'ログインすると、共有されたレシピを取り込めます', 'success');
  }
}

document.addEventListener('DOMContentLoaded', init);
