'use strict';
// Git 账号管家 —— 界面
// 文字统一走 t('中文原文', 变量)：切到英文时查 i18n.js 的词典；主进程传来的提示用 tr() 翻译

let S = null;            // 主进程给的完整状态
let syncing = false;     // 正在自动读取本机账号
let tab = 'repos';
const F = { q: '', filter: 'all' };
let ICONS = {};          // 本机应用的真实图标（Sourcetree / 访达 / 终端）
const pulling = new Set();
const testing = new Set();
let pending = 0;

const t = (s, v) => window.I18N.t(s, v);
const tr = m => window.I18N.tr(m);
const isEn = () => window.I18N.getLang() === 'en';
const LOCALE = () => isEn() ? 'en-US' : 'zh-CN';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = x => x ? new Date(x).toLocaleString(LOCALE(), { hour12: false }) : '';
const HOST_NAMES = { 'github.com': 'GitHub', 'gitee.com': 'Gitee', 'gitlab.com': 'GitLab', 'e.coding.net': 'Coding' };
const hostName = h => HOST_NAMES[h] || h;
const IS_MAC = /Mac/.test(navigator.platform);
const isWin = () => S.sys.platform === 'Windows';
const trashName = () => isWin() ? t('回收站') : t('废纸篓');
const storeName = () => isWin() ? t('Windows 凭据管理器') : t('钥匙串');
const sep = () => isEn() ? ', ' : '、';
// 同一个文件：Windows 上项目里记的是 C:/…，账号里是 C:\…
const sameFile = (x, y) => !!x && !!y && x.replace(/\\/g, '/').toLowerCase() === y.replace(/\\/g, '/').toLowerCase();
// 别的工具存 token 时常用的占位用户名（git 不核对用户名）：验证过的就显示网站上的真实账号
const PLACEHOLDER_USER = /^(x-access-token|oauth2|x-oauth-basic)$/i;
const placeholderOf = a => a.auth === 'token' && PLACEHOLDER_USER.test(a.username) && a.verify && a.verify.login ? a.username : '';
const loginOf = a => placeholderOf(a) ? a.verify.login : a.username;
const storedAs = a => placeholderOf(a) ? `<span title="${esc(t('别的工具用占位用户名 {user} 存的 token（git 只认 token，不核对用户名），实际账号是 {login}', { user: a.username, login: a.verify.login }))}">${esc(t('存为 {user}', { user: a.username }))}</span>` : '';

// 账号对应的官网页面（在浏览器打开；设置类页面显示的是浏览器里当前登录的那个账号）
function siteLinks(host, user) {
  const u = encodeURIComponent(user);
  const plainUser = /^[A-Za-z0-9_.-]+$/.test(user) && !/^\d+$/.test(user);  // 手机号、邮箱当不了主页地址
  const home = (base, url) => plainUser ? [t('主页'), url, 'home'] : [t('官网'), base, 'home'];
  const L = {
    'github.com': [home('https://github.com/', `https://github.com/${u}`), [t('Token 管理'), 'https://github.com/settings/personal-access-tokens'], [t('SSH 密钥'), 'https://github.com/settings/keys', 'ssh']],
    'gitee.com': [home('https://gitee.com/', `https://gitee.com/${u}`), [t('私人令牌管理'), 'https://gitee.com/profile/personal_access_tokens'], [t('SSH 公钥'), 'https://gitee.com/profile/sshkeys', 'ssh']],
    'gitlab.com': [home('https://gitlab.com/', `https://gitlab.com/${u}`), [t('Token 管理'), 'https://gitlab.com/-/user_settings/personal_access_tokens'], [t('SSH 密钥'), 'https://gitlab.com/-/user_settings/ssh_keys', 'ssh']],
  };
  return L[host] || [[t('官网'), `https://${host}/`, 'home']];
}
// 网站图标（GitHub 用 Octicons 的 mark-github，其它是简化的品牌色标识）
function siteIcon(host) {
  const svg = (bg, inner) => `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="20" fill="${bg}"/>${inner}</svg>`;
  const letter = (ch, color) => `<text x="20" y="26.5" text-anchor="middle" font-size="18" font-weight="700" font-family="-apple-system, Segoe UI, sans-serif" fill="${color || '#fff'}">${ch}</text>`;
  switch (host) {
    case 'github.com':
      return svg('#1f2328', '<g transform="translate(8 8) scale(1.5)"><path fill="#fff" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></g>');
    case 'gitee.com':
      return svg('#c71d23', '<path fill="#fff" d="M28.6 18H19.2a.8.8 0 0 0-.8.8v2a.8.8 0 0 0 .8.8h5.6a.8.8 0 0 1 .8.8v.4a2.4 2.4 0 0 1-2.4 2.4h-7.6a.8.8 0 0 1-.8-.8v-7.6a2.4 2.4 0 0 1 2.4-2.4h11.2a.8.8 0 0 0 .8-.8v-2a.8.8 0 0 0-.8-.8H17.2a6 6 0 0 0-6 6v11.2a.8.8 0 0 0 .8.8h11.8a5.4 5.4 0 0 0 5.4-5.4v-4.6a.8.8 0 0 0-.8-.8Z"/>');
    case 'gitlab.com':
      return svg('#fff3eb', '<path fill="#e24329" d="M20 31.5 9.6 23.4l1.9-11.6 3.2 8.4h10.6l3.2-8.4 1.9 11.6Z"/><path fill="#fc6d26" d="M20 31.5 14.7 20.2H9.6Zm0 0 5.3-11.3h5.1Z"/>');
    case 'e.coding.net':
      return svg('#0066ff', letter('C'));
    default:
      return svg('#6b7480', letter(esc((host || '?')[0].toUpperCase())));
  }
}
const typeOf = a => a.auth === 'ssh' ? 'ssh' : 'https';
const typeLabel = a => a.auth === 'ssh' ? t('SSH · 密钥') : a.secretKind === 'password' ? t('HTTPS · 密码') : 'HTTPS · Token';

const linkHtml = ([label, url], tip) => `<a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(tip || url)}">${esc(label)} ↗</a>`;

async function call(name, args) {
  $('#busy').hidden = !++pending;
  try {
    const r = await window.gz.call(name, args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  } finally {
    $('#busy').hidden = !--pending;
  }
}

let toastTimer;
function toast(msg, bad) {
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const d = document.createElement('div');
  d.className = 'toast' + (bad ? ' bad' : '');
  d.textContent = msg;
  document.body.appendChild(d);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => d.remove(), bad ? 7000 : 3500);
}
// 主进程报的错：翻译后弹出
const toastErr = e => toast(tr(e.message), true);

// 弹窗：buttons 的 value 可以是函数（读取表单，返回 undefined 表示不关闭）
function modal(title, html, buttons, onOpen) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal"><h2>${esc(title)}</h2><div>${html}</div><div class="foot"></div></div>`;
    const close = v => { back.remove(); resolve(v); };
    (buttons || [{ text: t('取消'), value: null }, { text: t('确定'), value: true, primary: true }]).forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.text;
      el.onclick = () => {
        const v = typeof b.value === 'function' ? b.value(back) : b.value;
        if (v !== undefined) close(v);
      };
      back.querySelector('.foot').appendChild(el);
    });
    back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
    back.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    document.body.appendChild(back);
    if (onOpen) onOpen(back);
    const first = back.querySelector('input:not([type=checkbox]), select, .btn.primary');
    if (first) first.focus();
  });
}

// ================================================================ 语言

function initLang() {
  let saved = '';
  try { saved = localStorage.getItem('gz-lang') || ''; } catch (e) { /* 存不了就跟随系统 */ }
  window.I18N.setLang(saved || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en'));
}

function setLang(lang) {
  window.I18N.setLang(lang);
  try { localStorage.setItem('gz-lang', lang); } catch (e) { /* 存不了下次就跟随系统 */ }
  call('setLang', { lang }).catch(() => {});
  closePicker();
  renderStatic();
  render();
}

// index.html 里写死的文字
function renderStatic() {
  document.documentElement.lang = isEn() ? 'en' : 'zh-CN';
  document.title = t('Git 账号管家');
  $('.brand').textContent = t('Git 账号管家');
  $('nav [data-tab=repos] span').textContent = t('项目');
  $('nav [data-tab=accounts] span').textContent = t('账号');
  $('nav [data-tab=records] span').textContent = t('记录与设置');
  $('#busy').innerHTML = `<span class="spin"></span> ${esc(t('处理中…'))}`;
  $('#drop').innerHTML = `<div>${esc(t('松开鼠标，添加项目'))}<small>${esc(t('拖入普通文件夹时，会添加里面的 Git 项目'))}</small></div>`;
  const lang = window.I18N.getLang();
  $('#lang').innerHTML = [['zh', '中文'], ['en', 'English']].map(([k, label]) =>
    `<button class="${lang === k ? 'on' : ''}" data-act="lang" data-l="${k}">${label}</button>`).join('');
}

let synced = false;
async function load() {
  try { S = await call('state'); render(); } catch (e) { return toastErr(e); }
  if (!synced) {
    synced = true;
    call('appIcons').then(x => { ICONS = x || {}; render(); }).catch(() => {});
    syncLocal(true).then(() => {
      const stale = S.repos.filter(r => r.remote && (!r.test || Date.now() - r.test.time > 3600e3)).map(r => r.path);
      if (stale.length) testMany(stale);
    });
  }
}

function setState(s) { if (s) { S = s; render(); } }

function render() {
  if (!S) return;
  const att = S.repos.filter(needsAttention).length;
  $('#n-repos').innerHTML = (att ? `<i class="nav-badge" title="${esc(t('{n} 个项目需要处理', { n: att }))}">${att}</i>` : '') + (S.repos.length || '');
  $('#n-accounts').textContent = S.accounts.length || '';
  $('#sys').textContent = S.sys.platform + (S.sys.gitMissing ? ' · ' + t('没找到 git') : '');
  renderRepos(); renderAccounts(); renderRecords();
}

function switchTab(x) {
  tab = x;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === x));
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== 'tab-' + x; });
  $('main').scrollTop = 0;
}

// ================================================================ 项目

const accById = id => S.accounts.find(a => a.id === id);
const accName = a => a ? loginOf(a) + (a.label ? (isEn() ? ` (${a.label})` : `（${a.label}）`) : '') : '';
const accKind = a => a.auth === 'ssh' ? 'SSH' : 'Token';
const bindable = r => (r.proto === 'https' || r.proto === 'ssh') && !r.viaProxy;
const groupOf = r => r.nhost || (r.proto === 'none' ? 'none' : 'other');
const groupName = g => g === 'none' ? t('没有远程仓库') : g === 'other' ? t('其他') : hostName(g);

function needsAttention(r) {
  if (!r.exists || r.secretInUrl || r.tokenAccess === 'missing') return true;
  if (r.test && r.remote && r.test.kind !== 'ok') return true;
  if (!bindable(r)) return false;
  if (r.bindStatus === 'unknown_user' || r.bindStatus === 'unknown_key') return true;
  return !!(r.suggestId && r.suggestId !== r.boundId);
}

const chip = (cls, text, title) => `<span class="chip ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;

function repoChips(r) {
  const c = [];
  if (!r.exists) c.push(chip('bad', t('目录不存在或不是 Git 项目')));
  if (r.exists && r.proto === 'none') c.push(chip('', t('没有远程仓库')));
  else if (r.proto === 'other') c.push(chip('', t('非标准地址')));
  else if (r.viaProxy) c.push(chip('', t('加速地址'), t('地址经过加速代理，一般是只拉取的开源项目')));
  else if (r.bindStatus === 'none') {
    c.push(r.suggestId
      ? chip('warn', t('未指定账号'), t('地址里没写用户名：会用系统密码库里这个站点的“默认”凭据，和其它项目共用，最容易被覆盖'))
      : chip('', t('未指定（开源项目可忽略）'), t('没有匹配的已登记账号。只拉取的开源项目可以不管')));
  } else if (r.bindStatus === 'unknown_user') c.push(chip('warn', t('用户 {user} 未登记', { user: r.user }), t('地址里写了用户名，但这个账号还没登记')));
  else if (r.bindStatus === 'unknown_key') c.push(chip('warn', t('SSH 密钥未登记'), r.sshKey));
  else if (r.bindStatus === 'default_ssh') c.push(chip('', t('SSH 默认密钥'), t('没指定密钥，ssh 会用默认密钥或 ~/.ssh/config 里的设置')));
  if (r.secretInUrl) c.push(chip('bad', t('地址里有明文密码'), t('远程地址里直接写着密码/token。重新选一次账号即可去掉')));
  if (r.pushUrl) c.push(chip('warn', t('另有推送地址'), t('这个项目单独设置了推送地址（pushurl），本工具不会改它')));
  if (r.tokenAccess === 'missing') c.push(chip('bad', t('token 授权里没有这个仓库'), t('这个 token 能访问的仓库列表里没有它。请 token 的主人在 GitHub 上把这个仓库加进授权')));
  else if (r.tokenAccess === 'read') c.push(chip('warn', t('token 只能读，不能推送')));
  else if (r.tokenAccess === 'push') c.push(chip('ok', t('token 可推送')));
  if (r.test && r.remote && !testing.has(r.path)) c.push(chip(r.test.kind === 'ok' ? 'ok' : 'bad', tr(r.test.msg), tr(r.test.detail || '') + '\n' + t('测试时间：') + fmtTime(r.test.time)));
  if (r.suggestId && r.suggestId !== r.boundId && bindable(r)) c.push(chip('acc', t('建议：{name}', { name: accName(accById(r.suggestId)) }), t('这个账号能访问该仓库')));
  return c.join('');
}

function normHost(h) {
  h = String(h || '').toLowerCase().split(':')[0];
  return ({ 'ssh.github.com': 'github.com', 'altssh.gitlab.com': 'gitlab.com' })[h] || h;
}
const shortPath = p => (S.sys.home && p.startsWith(S.sys.home)) ? '~' + p.slice(S.sys.home.length) : p;

// 某个账号对这个仓库有没有权限（token 账号验证过才知道确切结果）
function accessFor(a, r) {
  const full = (r.owner + '/' + r.repoName).toLowerCase();
  if (a.verify && a.verify.repos) {
    const hit = a.verify.repos.find(x => x.name.toLowerCase() === full);
    return hit ? (hit.push ? ['ok', t('能访问这个仓库，可推送'), 3] : ['warn', t('能访问，但只读'), 2]) : ['bad', t('token 授权里没有这个仓库'), 0];
  }
  if (r.owner && (a.owners || []).some(o => o.toLowerCase() === r.owner.toLowerCase())) return ['ok', t('负责 {owner} 的仓库', { owner: r.owner }), 2];
  if (a.auth === 'ssh') return ['', t('SSH 账号没法提前查权限，选了之后会自动测试'), 1];
  return ['', t('还没验证过权限'), 1];
}

// 项目行里的“选账号”按钮
function accountPicker(r, compact) {
  if (!bindable(r)) return '<span class="muted">—</span>';
  const a = accById(r.boundId);
  let inner;
  if (a) inner = `<span class="ic">${siteIcon(a.host)}</span><span class="nm" title="${esc(accName(a))}">${esc(loginOf(a))}</span><span class="mini-badge t-${typeOf(a)}">${a.auth === 'ssh' ? 'SSH' : 'Token'}</span>`;
  else {
    const label = r.bindStatus === 'unknown_user' ? t('用户 {user}（未登记）', { user: r.user }) : r.bindStatus === 'unknown_key' ? t('SSH 指定密钥（未登记）')
      : r.bindStatus === 'default_ssh' ? t('SSH 默认密钥') : t('不指定账号');
    inner = `<span class="ic ic-empty">${r.proto === 'ssh' ? '🔑' : '—'}</span><span class="nm muted">${esc(label)}</span>`;
  }
  const none = !S.accounts.some(x => x.host === r.nhost || x.host === r.host);
  return `<button class="acc-picker${r.suggestId && r.suggestId !== r.boundId ? ' has-suggest' : ''}" data-act="openPicker" data-path="${esc(r.path)}">${inner}<span class="chev">▾</span></button>`
    + (none && !compact ? `<div class="ppath" style="margin-top:4px">${esc(t('还没有 {host} 账号', { host: hostName(r.nhost) }))}</div>` : '');
}

let picker = null;
function closePicker() {
  if (!picker) return;
  picker.el.remove();
  picker = null;
}

function openPicker(p, trigger) {
  if (picker && picker.path === p) return closePicker();
  closePicker();
  const r = S.repos.find(x => x.path === p);
  const accs = S.accounts.filter(a => a.host === r.nhost || a.host === r.host)
    .map(a => ({ a, acc: accessFor(a, r) }))
    .sort((x, y) => (y.a.id === r.suggestId) - (x.a.id === r.suggestId) || y.acc[2] - x.acc[2] || loginOf(x.a).localeCompare(loginOf(y.a)));
  const item = ({ a, acc }) => `
    <div class="picker-item${a.id === r.boundId ? ' current' : ''}" data-pick="${a.id}">
      <span class="ic">${siteIcon(a.host)}</span>
      <span class="tx"><b>${esc(loginOf(a))}${a.label ? ` <span class="muted">· ${esc(a.label)}</span>` : ''}${placeholderOf(a) ? ` <span class="muted">· ${storedAs(a)}</span>` : ''}${a.id === r.suggestId ? ` <span class="tag">${esc(t('推荐'))}</span>` : ''}</b>
        <small class="${acc[0]}">${acc[0] === 'ok' ? '✓ ' : acc[0] === 'bad' ? '✕ ' : acc[0] === 'warn' ? '! ' : ''}${esc(acc[1])}</small></span>
      ${a.id === r.boundId ? '<span class="check">✓</span>' : ''}
    </div>`;
  const sec = (type, title) => {
    const list = accs.filter(x => typeOf(x.a) === type);
    return list.length ? `<div class="picker-sec"><span class="dot t-${type}"></span>${esc(title)}</div>${list.map(item).join('')}` : '';
  };
  const noneCur = !r.boundId && r.bindStatus === 'none';
  const el = document.createElement('div');
  el.className = 'picker-pop';
  el.innerHTML = `
    <div class="picker-title">${esc(t('给「{name}」选账号', { name: r.name }))}</div>
    ${sec('https', t('HTTPS · Token / 密码'))}${sec('ssh', t('SSH · 密钥'))}
    ${accs.length ? '' : `<div class="picker-empty">${esc(t('还没有 {host} 的账号', { host: hostName(r.nhost) }))}</div>`}
    <div class="picker-foot">
      <div class="picker-item${noneCur ? ' current' : ''}" data-pick=""><span class="ic ic-empty">—</span>
        <span class="tx"><b>${esc(t('不指定账号'))}</b><small>${esc(r.proto === 'ssh' ? t('用 SSH 默认密钥') : t('用系统密码库里这个网站的默认凭据（容易和别的项目互相覆盖）'))}</small></span>${noneCur ? '<span class="check">✓</span>' : ''}</div>
      <div class="picker-item add" data-goadd="1"><span class="ic ic-empty">＋</span><span class="tx"><b>${esc(t('添加账号…'))}</b></span></div>
    </div>`;
  document.body.appendChild(el);
  const rect = trigger.getBoundingClientRect();
  const w = Math.max(rect.width, 360), h = el.offsetHeight;
  el.style.width = w + 'px';
  el.style.left = Math.max(12, Math.min(rect.left, innerWidth - w - 12)) + 'px';
  el.style.top = (rect.bottom + 6 + h > innerHeight - 12 ? Math.max(12, rect.top - h - 6) : rect.bottom + 6) + 'px';
  picker = { el, path: p, idx: -1 };
  el.addEventListener('click', e => {
    if (e.target.closest('[data-goadd]')) { closePicker(); switchTab('accounts'); setTimeout(() => { const x = $('#tok'); if (x) x.focus(); }); return; }
    const it = e.target.closest('[data-pick]');
    if (!it) return;
    const id = it.dataset.pick;
    closePicker();
    if (id === (r.boundId || '') && (r.boundId || r.bindStatus === 'none')) return;
    bind(p, id);
  });
}

// 键盘：上下选择、回车确定、Esc 关闭
document.addEventListener('keydown', e => {
  if (!picker) return;
  const items = [...picker.el.querySelectorAll('.picker-item')];
  if (e.key === 'Escape') { closePicker(); e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    picker.idx = (picker.idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((x, i) => x.classList.toggle('active', i === picker.idx));
    items[picker.idx].scrollIntoView({ block: 'nearest' });
    e.preventDefault();
  } else if (e.key === 'Enter' && picker.idx >= 0) { items[picker.idx].click(); e.preventDefault(); }
}, true);
document.addEventListener('mousedown', e => { if (picker && !picker.el.contains(e.target) && !e.target.closest('.acc-picker')) closePicker(); });
window.addEventListener('resize', closePicker);
document.addEventListener('scroll', closePicker, true);

const FILTERS = {
  all: () => true,
  attention: needsAttention,
  behind: r => r.behind > 0,
  dirty: r => r.dirty > 0,
  fail: r => !!(r.test && r.remote && r.test.kind !== 'ok'),
};
function visibleRepos() {
  const q = F.q.toLowerCase();
  return S.repos.filter(r => (FILTERS[F.filter] || FILTERS.all)(r) &&
    (!q || (r.name + ' ' + r.path + ' ' + r.url).toLowerCase().includes(q)));
}
const appIcon = k => ICONS[k] ? `<img class="app-ic" src="${ICONS[k]}" alt="">` : '';

function renderRepos() {
  const el = $('#tab-repos');
  const repos = S.repos;
  const nSuggest = repos.filter(r => r.suggestId && r.suggestId !== r.boundId && bindable(r)).length;
  const head = `<div class="head"><h1>${esc(t('项目'))}</h1>
    <button class="btn" data-act="pick" title="${esc(t('把电脑上已有的项目加进来'))}">${esc(t('添加项目…'))}</button>
    <button class="btn" data-act="cloneUrl" title="${esc(t('填写仓库地址、选一个账号，拉到本地'))}">${esc(t('拉取仓库…'))}</button>
    ${repos.length ? `<button class="btn" data-act="testAll" title="${esc(t('对列表里的项目逐个 git fetch：看连不连得上、远程有没有新提交'))}">${esc(t('检查更新'))}</button>
    <button class="btn ${nSuggest ? 'primary' : ''}" data-act="autoBind" ${nSuggest ? '' : 'disabled'}>${esc(t('按建议绑定（{n}）', { n: nSuggest }))}</button>` : ''}</div>`;
  if (!repos.length) {
    el.innerHTML = head + `<div class="dropzone"><b>${esc(t('把项目文件夹拖到这里'))}</b>${esc(t('可以一次拖多个；拖入普通文件夹时，会添加里面的 Git 项目。'))}<br><br>
      <button class="btn primary" data-act="pick">${esc(t('选择文件夹…'))}</button> <button class="btn" data-act="cloneUrl">${esc(t('从地址拉取仓库…'))}</button></div>`;
    return;
  }
  const list = visibleRepos();
  const groups = {};
  list.forEach(r => { (groups[groupOf(r)] = groups[groupOf(r)] || []).push(r); });
  const rank = g => { const i = Object.keys(HOST_NAMES).indexOf(g); return i >= 0 ? i : g.includes('.') ? 50 : 99; };
  const order = Object.keys(groups).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  el.innerHTML = head + `
    <div class="stats">
      ${[['all', repos.length, t('全部项目'), ''], ['attention', repos.filter(needsAttention).length, t('需要处理'), 'warn'],
        ['behind', repos.filter(FILTERS.behind).length, t('远程有更新'), 'acc'], ['dirty', repos.filter(FILTERS.dirty).length, t('有本地改动'), ''],
        ['fail', repos.filter(FILTERS.fail).length, t('连不上'), 'bad']].map(([k, n, label, tone]) =>
        `<button class="stat ${tone}${F.filter === k ? ' on' : ''}" data-act="filter" data-f="${k}" title="${esc(k === 'all' ? t('显示全部') : t('只看：{label}', { label }))}"><b>${n}</b><span>${esc(label)}</span></button>`).join('')}
    </div>
    <div class="toolbar">
      <input id="q" placeholder="${esc(t('搜索项目名 / 路径 / 地址（{key}）', { key: IS_MAC ? '⌘F' : 'Ctrl+F' }))}" value="${esc(F.q)}" style="flex:1;min-width:200px">
      <span class="muted">${esc(t('也可以直接把文件夹拖进窗口'))}</span>
    </div>
    ${!list.length ? `<div class="empty">${esc(t('没有符合条件的项目'))}</div>` : order.map(g => `
      <div class="acc-group">
        <div class="acc-group-head">${g.includes('.') ? `<span class="gh-ic">${siteIcon(g)}</span>` : '<span class="dot"></span>'}<b>${esc(groupName(g))}</b><span class="muted">${esc(t('{n} 个项目', { n: groups[g].length }))}</span></div>
        <div class="xlist">${groups[g].map(repoRow).join('')}</div>
      </div>`).join('')}`;
  const qi = $('#q');
  qi.oninput = () => {
    F.q = qi.value;
    const pos = qi.selectionStart;
    renderRepos();
    const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos);
  };
}

const REPO_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>';

// 项目：一行一个，点开看详情（选账号按钮直接放在行里）
function repoRow(r) {
  const type = r.viaProxy || !bindable(r) ? 'other' : r.proto;
  const badge = r.proto === 'https' ? (r.viaProxy ? t('加速') : 'HTTPS') : r.proto === 'ssh' ? 'SSH' : r.proto === 'none' ? t('无远程') : t('其它');
  const ok = r.test && r.test.kind === 'ok';
  const msg = r.test ? tr(r.test.msg) : '';
  const st = pulling.has(r.path) ? `<span class="xstate"><span class="spin"></span> ${esc(t('拉取中'))}</span>`
    : testing.has(r.path) ? `<span class="xstate"><span class="spin"></span> ${esc(t('检查中'))}</span>`
    : !r.exists ? `<span class="xstate bad" title="${esc(t('目录不存在或已不是 Git 项目'))}">✕ ${esc(t('目录不存在'))}</span>`
    : !r.remote ? `<span class="xstate" title="${esc(t('没有配置远程仓库，只在本机'))}">${esc(t('仅本地'))}</span>`
    : r.test && !ok ? `<span class="xstate bad" title="${esc(msg + (r.test.detail ? '\n' + r.test.detail : ''))}">✕ ${esc(msg.split(/[：（:(]/)[0])}</span>`
    : r.behind > 0 ? `<button class="xstate-btn" data-act="pull" data-path="${esc(r.path)}" title="${esc(t('远程有 {n} 个新提交，点击拉取（只做快进，不会覆盖你的改动）', { n: r.behind }))}">↓ ${esc(t('拉取 {n}', { n: r.behind }))}</button>`
    : ok ? `<span class="xstate ok" title="${esc(t('检查于 {time}', { time: fmtTime(r.test.time) }))}">✓ ${esc(r.upstream ? t('已是最新') : t('可连接'))}</span>`
    : `<span class="xstate muted">${esc(t('未检查'))}</span>`;
  const head = `<span class="repo-ic${ok ? ' ok' : ''}">${REPO_ICON}</span>
    <span class="xmain"><b class="selectable">${esc(r.name)}</b>${r.branch ? `<span class="chip">${esc(r.branch)}</span>` : ''}
      <span class="muted" title="${esc(r.path)}">${esc(r.owner ? r.owner + '/' + r.repoName : shortPath(r.path))}</span>
      ${r.dirty ? `<span class="pill dirty" title="${esc(t('有 {n} 个文件改动还没提交', { n: r.dirty }))}">● ${esc(t('{n} 改动', { n: r.dirty }))}</span>` : ''}${r.ahead ? `<span class="pill ahead" title="${esc(t('本地有 {n} 个提交还没推送', { n: r.ahead }))}">↑ ${esc(t('{n} 未推送', { n: r.ahead }))}</span>` : ''}</span>
    ${needsAttention(r) ? `<span class="attn-badge" title="${esc(t('点开看橙色/红色的标签'))}">${esc(t('需处理'))}</span>` : ''}
    <span class="mini-badge t-${type}">${esc(badge)}</span>
    <span class="xpick">${bindable(r) ? accountPicker(r, true) : '<span class="muted">—</span>'}</span>
    ${st}`;
  const chips = repoChips(r);
  const upstreamInfo = r.upstream
    ? ` <span class="muted">· ${esc(r.behind ? t('远程有 {n} 个新提交', { n: r.behind }) : t('远程没有新提交'))}${r.ahead ? esc(t('，本地有 {n} 个提交没推送', { n: r.ahead })) : ''}${esc(r.test ? t('（检查于 {time}）', { time: fmtTime(r.test.time) }) : t('（还没检查过）'))}</span>`
    : r.branch ? ` <span class="muted">· ${esc(t('没有对应的远程分支'))}</span>` : '';
  const body = `
    <div class="kvgrid">
      <span>${esc(t('路径'))}</span><b class="selectable">${esc(r.path)}</b>
      <span>${esc(t('远程地址'))}</span><b class="mono selectable">${esc(r.url || t('（没有远程地址）'))}</b>
      <span>${esc(t('分支'))}</span><b>${r.branch ? esc(r.branch) : esc(t('（不在任何分支上）'))}${upstreamInfo}</b>
      <span>${esc(t('本地改动'))}</span><b>${r.dirty ? esc(t('{n} 个文件还没提交', { n: r.dirty })) : `<span class="muted">${esc(t('没有'))}</span>`}</b>
    </div>
    ${chips ? `<div class="chips" style="margin-bottom:10px">${chips}</div>` : ''}
    <div class="acts">
      <button class="btn sm" data-act="test" data-path="${esc(r.path)}" ${r.remote && !testing.has(r.path) ? '' : 'disabled'} title="${esc(t('git fetch：看连不连得上、远程有没有新提交'))}">${esc(t('检查更新'))}</button>
      ${r.behind > 0 ? `<button class="btn sm primary" data-act="pull" data-path="${esc(r.path)}" ${pulling.has(r.path) ? 'disabled' : ''}>${esc(t('拉取 {n} 个新提交', { n: r.behind }))}</button>` : ''}
      <span class="act-sep"></span>
      <button class="btn sm icon-btn" data-act="open" data-path="${esc(r.path)}" title="${esc(isWin() ? t('在资源管理器里打开文件夹') : t('在访达里打开文件夹'))}">${appIcon('folder')}${esc(t('打开文件夹'))}</button>
      <button class="btn sm icon-btn" data-act="terminal" data-path="${esc(r.path)}" title="${esc(t('在这个目录打开终端'))}">${appIcon('terminal')}${esc(t('终端'))}</button>
      ${S.sys.sourcetree ? `<button class="btn sm icon-btn" data-act="sourcetree" data-path="${esc(r.path)}" title="${esc(t('在 Sourcetree 里打开这个项目'))}">${appIcon('sourcetree')}Sourcetree</button>` : ''}
      ${bindable(r) && r.owner ? `<a class="btn sm" href="${esc(`https://${r.nhost}/${r.owner}/${r.repoName}`)}" target="_blank" rel="noopener" title="${esc(t('在浏览器打开这个仓库的网页'))}">${esc(t('网页'))} ↗</a>` : ''}
      <span class="spacer"></span>
      <button class="btn sm danger" data-act="remove" data-path="${esc(r.path)}" title="${esc(t('从列表移除（不会删除文件）'))}">${esc(t('移除'))}</button>
    </div>`;
  return rowHtml('r:' + r.path, head, body);
}

function patchTest(p, test) {
  const r = S.repos.find(x => x.path === p);
  if (!r) return;
  r.test = test;
  for (const k of ['ahead', 'behind', 'dirty', 'upstream']) if (k in test) r[k] = test[k];
}

async function pullRepo(p) {
  const r = S.repos.find(x => x.path === p);
  pulling.add(p); render();
  try {
    const res = await call('pullRepo', { path: p });
    patchTest(p, res.result);
    toast(res.pulled ? t('{name}：已拉取 {n} 个新提交', { name: r.name, n: res.pulled }) : t('{name}：已是最新', { name: r.name }));
  } catch (e) {
    const act = await modal(t('没能拉取「{name}」', { name: r.name }), `<p style="white-space:pre-line">${esc(tr(e.message))}</p><p class="muted">${esc(t('你的代码没有被改动。'))}</p>`,
      [{ text: t('知道了'), value: null }].concat(S.sys.sourcetree ? [{ text: t('在 Sourcetree 打开'), primary: true, value: 'st' }] : []));
    if (act === 'st') call('openSourcetree', { path: p }).catch(toastErr);
  }
  pulling.delete(p); render();
}

async function testRepo(p, quiet) {
  testing.add(p); renderRepos();
  try {
    const x = await call('testRepo', { path: p });
    patchTest(p, x);
    if (!quiet) toast(((S.repos.find(r => r.path === p) || {}).name || '') + (isEn() ? ': ' : '：') + tr(x.msg), x.kind !== 'ok');
  } catch (e) { toastErr(e); }
  testing.delete(p); renderRepos();
}

async function testMany(paths) {
  let i = 0;
  const worker = async () => { while (i < paths.length) await testRepo(paths[i++], true); };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const bad = paths.filter(p => ((S.repos.find(r => r.path === p) || {}).test || {}).kind !== 'ok').length;
  return bad;
}

// 没有远程仓库的项目不用测（只在本机，测了也只会报“没有配置远程仓库”）
const withRemote = paths => paths.filter(p => (S.repos.find(r => r.path === p) || {}).remote);

async function addPaths(paths) {
  if (!paths.length) return;
  try {
    const r = await call('addRepos', { paths });
    setState(r.state);
    switchTab('repos');
    if (!r.found) return toast(t('没有在拖入的文件夹里找到 Git 项目'), true);
    if (!r.added.length) return toast(t('这些项目都已经在列表里了'));
    toast(t('添加了 {n} 个项目，正在逐个测试', { n: r.added.length }));
    await testMany(withRemote(r.added));
  } catch (e) { toastErr(e); }
}

function planHtml(p) {
  let h = `<div class="diff"><div class="old">− ${esc(p.oldUrl)}</div><div class="new">+ ${esc(p.newUrl)}</div>`;
  if ((p.oldSsh || '') !== (p.newSsh || '')) h += `<div class="muted" style="margin-top:8px">core.sshCommand</div><div class="old">− ${esc(p.oldSsh || t('（无）'))}</div><div class="new">+ ${esc(p.newSsh || t('（无）'))}</div>`;
  return h + '</div>' + (p.note ? `<p class="muted">${esc(tr(p.note))}</p>` : '');
}

async function bind(p, accountId) {
  const r = S.repos.find(x => x.path === p);
  try {
    const plan = await call('bindRepo', { path: p, accountId, dryRun: true });
    if (plan.oldUrl === plan.newUrl && (plan.oldSsh || '') === (plan.newSsh || '')) { toast(t('没有变化')); return renderRepos(); }
    const ok = await modal(t('切换「{name}」的账号', { name: r.name }), `<p>${esc(t('只改这个项目的远程地址配置（.git/config），不动代码。改完自动测试一次。'))}</p>${planHtml(plan)}`);
    if (!ok) return renderRepos();
    setState(await call('bindRepo', { path: p, accountId }));
    testRepo(p);
  } catch (e) { toastErr(e); renderRepos(); }
}

async function autoBind() {
  const list = S.repos.filter(r => r.suggestId && r.suggestId !== r.boundId && bindable(r));
  const html = `<p>${esc(t('下面这些项目建议换成能访问它的账号。去掉勾选的不会改。'))}</p>
    <div style="max-height:50vh;overflow:auto">${list.map((r, i) => {
      const a = accById(r.suggestId);
      return `<label class="found"><input type="checkbox" data-i="${i}" checked>
        <span class="grow"><span class="t">${esc(r.name)}</span> → ${esc(accName(a))} · ${accKind(a)}<br><span class="ppath">${esc(r.path)}</span></span></label>`;
    }).join('')}</div>`;
  const picked = await modal(t('按建议绑定账号'), html, [
    { text: t('取消'), value: null },
    { text: t('绑定选中的项目'), primary: true, value: back => [...back.querySelectorAll('input:checked')].map(x => list[+x.dataset.i]) },
  ]);
  if (!picked || !picked.length) return;
  let ok = 0;
  for (const r of picked) {
    try { setState(await call('bindRepo', { path: r.path, accountId: r.suggestId })); ok++; } catch (e) { toast(r.name + (isEn() ? ': ' : '：') + tr(e.message), true); }
  }
  toast(t('已绑定 {n} 个项目，正在逐个测试', { n: ok }));
  const bad = await testMany(picked.map(r => r.path));
  toast(t('测试完成：{ok} 个正常，{bad} 个失败', { ok: picked.length - bad, bad }), bad > 0);
}

// ================================================================ 账号

function accountRow(a) {
  const used = S.repos.filter(r => r.boundId === a.id).length;
  const v = a.verify;
  const cred = a.auth === 'token'
    ? (!a.hasToken ? chip('warn', t('系统密码库里没有 token'))
      : `<button class="chip ok chip-btn" data-act="reveal" data-id="${a.id}" title="${esc(t('点击查看原文'))}">${esc(a.secretKind === 'password' ? t('登录密码') : 'token')} ${esc(a.tokenMask)} · ${esc(t('查看'))}</button>`)
    : (a.hasToken ? `<button class="chip ok chip-btn" data-act="pubkey" data-id="${a.id}" title="${esc(a.sshKey)}">${esc(t('密钥 {file} · 查看公钥', { file: a.sshKey.split(/[\\/]/).pop() }))}</button>` : chip('bad', t('找不到密钥文件')));
  const state = !v ? `<span class="xstate muted">${esc(t('未验证'))}</span>`
    : `<span class="xstate ${v.info ? '' : v.ok ? 'ok' : 'bad'}" title="${esc(tr(v.msg))}">${esc(v.info ? 'ℹ︎ ' + t('见详情') : v.ok ? '✓ ' + t('正常') : '✕ ' + t('有问题'))}</span>`;
  const head = `<span class="xsite lg">${siteIcon(a.host)}</span>
    <span class="xmain"><b class="selectable">${esc(loginOf(a))}</b>${a.label ? `<span class="chip">${esc(a.label)}</span>` : ''}
      <span class="muted">${esc(hostName(a.host))}${placeholderOf(a) ? ' · ' + storedAs(a) : ''}${a.auto ? ' · ' + esc(t('本机自动识别')) : ''}</span></span>
    <span class="mini-badge t-${typeOf(a)}">${esc(typeLabel(a))}</span>
    <span class="xmeta">${esc(used ? t('{n} 个项目在用', { n: used }) : t('没有项目在用'))}</span>
    ${state}`;
  const localOf = name => S.repos.find(r => r.nhost === normHost(a.host) && (r.owner + '/' + r.repoName).toLowerCase() === name.toLowerCase());
  const repoChipsHtml = v && v.repos ? (v.repos.length ? `<div class="repo-list">${v.repos.map(x => {
      const local = localOf(x.name);
      return `<button class="repo-chip${local ? ' local' : ''}" data-act="cloneRepo" data-id="${a.id}" data-repo="${esc(x.name)}"
        title="${esc(local ? t('已经在本地：{path}', { path: local.path }) + '\n' + t('点击跳到这个项目') : t('点击拉取到本地，并加进项目列表'))}">${local ? '✓ ' : '⤓ '}${esc(x.name)}${x.push ? '' : `<span class="ro">${esc(t('只读'))}</span>`}</button>`;
    }).join('')}</div>` : `<span class="muted">${esc(t('没有'))}</span>`) : '';
  const verifyLine = v ? `<span class="${v.info ? '' : v.ok ? 'ok-text' : 'bad-text'}">${v.info ? 'ℹ️' : v.ok ? '✅' : '❌'} ${esc(tr(v.msg))}</span><span class="muted"> · ${fmtTime(v.time)}</span>` : `<span class="muted">${esc(t('还没验证过'))}</span>`;
  const linkTip = l => l[2] === 'home' ? l[1] : l[1] + '\n' + t('（显示的是浏览器里当前登录的账号，不一定是 {login}）', { login: loginOf(a) });
  const body = `
    <div class="kvgrid wide">
      <span>${esc(t('凭据'))}</span><div class="chips" style="margin:0">${cred}${a.ssh443 ? chip('', t('走 443 端口')) : ''}</div>
      <span>${esc(t('验证'))}</span><div>${verifyLine}${v && v.warn && !placeholderOf(a) ? `<div class="chip warn" style="white-space:normal;margin-top:6px">${esc(tr(v.warn))}</div>` : ''}</div>
      <span>${esc(t('负责'))}</span><b>${esc((a.owners || []).filter(o => !PLACEHOLDER_USER.test(o)).join(', '))}</b>
      ${used ? `<span>${esc(t('在用项目'))}</span><b>${S.repos.filter(r => r.boundId === a.id).map(r => esc(r.name)).join(sep())}</b>` : ''}
      ${repoChipsHtml ? `<span>${esc(t('能访问的仓库'))}<small>${esc(t('点仓库名可直接拉到本地'))}</small></span><div>${repoChipsHtml}</div>` : ''}
      <span>${esc(t('网站'))}</span><div class="links">${siteLinks(a.host, loginOf(a)).map(l => linkHtml(l, linkTip(l))).join('')}</div>
    </div>
    <div class="acts body-acts">
      <button class="btn sm" data-act="verify" data-id="${a.id}">${esc(t('重新验证'))}</button>
      <button class="btn sm" data-act="editAcc" data-id="${a.id}">${esc(t('编辑'))}</button>
      <span class="spacer"></span>
      <button class="btn sm danger" data-act="delAcc" data-id="${a.id}">${esc(t('删除'))}</button>
    </div>`;
  return rowHtml('a:' + a.id, head, body);
}

const sshDirLink = () => `<button class="path-link" data-act="openSsh" title="${esc(t('打开这个文件夹'))}">~/.ssh</button>`;
const UPLOAD_HOSTS = ['github.com', 'gitee.com', 'gitlab.com'];
const uploaders = host => S.accounts.filter(a => a.auth === 'token' && a.hasToken && a.secretKind === 'token' &&
  UPLOAD_HOSTS.includes(a.host) && (!host || a.host === host));

// 账号按连接方式分两组：HTTPS（token / 密码）和 SSH（密钥）
function accountGroups() {
  const order = Object.keys(HOST_NAMES);
  const rank = a => { const i = order.indexOf(a.host); return i < 0 ? 99 : i; };
  const sorted = list => list.slice().sort((x, y) => rank(x) - rank(y) || loginOf(x).localeCompare(loginOf(y)));
  const groups = [
    ['https', t('HTTPS · Token / 密码'), esc(t('在网站上生成的一串 token（或网站登录密码），存在系统密码库里')), S.accounts.filter(a => a.auth !== 'ssh')],
    ['ssh', t('SSH · 密钥'), t('本机 {dir} 里的密钥文件，公钥登记在网站上', { dir: sshDirLink() }), S.accounts.filter(a => a.auth === 'ssh')],
  ];
  return groups.filter(g => g[3].length).map(([type, title, desc, list]) => `
    <div class="acc-group type-${type}">
      <div class="acc-group-head"><span class="dot"></span><b>${esc(title)}</b><span class="muted">${esc(t('{n} 个', { n: list.length }))} · ${desc}</span></div>
      <div class="xlist">${sorted(list).map(accountRow).join('')}</div>
    </div>`).join('');
}

function showHelp() {
  const rows = [
    ['是什么', '网站上生成的一串字符，相当于<b>可以限定权限的临时密码</b>', '自己电脑生成的一对文件：<b>私钥</b>留在本机，<b>公钥</b>登记到网站'],
    ['打比方', '门禁卡，写好了能进哪几扇门', '家门钥匙，配一次一直能用'],
    ['项目地址长相', 'https://github.com/用户/仓库.git', 'git@github.com:用户/仓库.git', 'mono'],
    ['存在哪', '系统密码库（Mac 钥匙串 / Windows 凭据管理器）', '~/.ssh 里的私钥文件'],
    ['会过期吗', '可以设到期时间，到期要换新的', '不过期，除非在网站上删掉公钥'],
    ['权限范围', '可以只给某几个仓库（GitHub 细粒度 token）', '这个账号能访问的所有仓库'],
    ['有代理时', '走 443 端口，一般都能通', '走 22 端口，经常被代理拦（可以改走 443 端口，或在代理里放行）'],
    ['适合', '别人给你的权限，比如公司给的 token', '自己的账号，长期使用'],
  ];
  // 词典里的这几句带 <b> 标签，原样插入
  const html = `
    <p>${t('Git 连接远程仓库<b>只有两种方式</b>：HTTPS 和 SSH。用网站账号密码登录、在 Sourcetree 里用 OAuth 授权，本质上都属于 HTTPS，最后存下来的还是一串 token 或密码。')}</p>
    <table class="cmp">
      <tr><th></th><th><span class="type-badge t-https">${esc(t('HTTPS · Token / 密码'))}</span></th><th><span class="type-badge t-ssh">${esc(t('SSH · 密钥'))}</span></th></tr>
      ${rows.map(([k, a, b, cls]) => `<tr><td>${esc(t(k))}</td><td${cls ? ` class="${cls}"` : ''}>${t(a)}</td><td${cls ? ` class="${cls}"` : ''}>${t(b)}</td></tr>`).join('')}
    </table>
    <p class="muted">${esc(t('GitHub 从 2021 年起不再接受网站登录密码，只能用 token；Gitee、Coding 还接受登录密码。两种方式选一种就行，本工具会按你给每个项目选的账号自动改好项目地址。'))}</p>`;
  return modal(t('token 和 SSH 有什么区别'), html, [{ text: t('知道了'), value: true, primary: true }], back => back.querySelector('.modal').classList.add('wide'));
}

function localKeysHtml() {
  const keys = S.localKeys || [];
  if (!keys.length) return '';
  return `<div class="card">
    <h2>${esc(t('本机还没对应到账号的 SSH 密钥（{n}）', { n: keys.length }))}</h2>
    <p>${t('这些密钥在 {dir} 里，但还没识别出属于哪个账号：可能还没登记到网站，或者网络暂时连不上。', { dir: sshDirLink() })}</p>
    ${keys.map(k => `<div class="found"><div class="grow"><span class="t">${esc(k.file)}</span> <span class="muted">${esc(k.type)} ${esc(k.comment)}</span>
        ${k.encrypted ? ' ' + chip('', t('有密码保护')) : ''}
        ${k.errors && k.errors.length ? `<div class="ppath">${esc(k.errors.map(tr).join(isEn() ? '; ' : '；'))}</div>` : ''}</div>
      <button class="btn sm" data-act="keyPub" data-path="${esc(k.path)}">${esc(t('查看公钥'))}</button>
      <button class="btn sm primary" data-act="uploadKey" data-path="${esc(k.path)}">${esc(t('登记到网站…'))}</button>
      <button class="btn sm danger" data-act="delKey" data-path="${esc(k.path)}">${esc(t('删除'))}</button></div>`).join('')}
  </div>`;
}

function renderAccounts() {
  const el = $('#tab-accounts');
  const tokenVal = ($('#tok') || {}).value || '';
  el.innerHTML = `
    <div class="head"><h1>${esc(t('账号'))}</h1>
      <span class="muted">${syncing ? `<span class="spin"></span> ${esc(t('正在读取本机的账号和密钥…'))}` : S.lastSync ? esc(t('已同步本机账号 · {time}', { time: fmtTime(S.lastSync) })) : ''}</span>
      <button class="btn" data-act="sync" ${syncing ? 'disabled' : ''} title="${esc(t('重新读取{store}和 ~/.ssh 里的账号', { store: storeName() }))}">${esc(t('刷新'))}</button>
      <button class="btn primary" data-act="genKey">${esc(t('生成 SSH 密钥'))}</button>
      <button class="btn help-btn" data-act="help" title="${esc(t('token 和 SSH 有什么区别？'))}">?</button></div>
    <div class="card">
      <h2>${esc(t('添加账号：粘贴 token 就行'))}</h2>
      <p class="muted" style="margin:-2px 0 8px">${esc(t('这里的账号和本机完全同步：在这里添加会写入本机，删除也会从本机删掉；在本机别处的增删，点“刷新”就会同步过来。'))}</p>
      <p>${esc(t('支持 GitHub / Gitee / GitLab。会自动识别是哪个站点、哪个账号、能访问哪些仓库。token 只存进本机系统密码库。'))}</p>
      <div class="addrow">
        <input id="tok" type="password" placeholder="${esc(t('粘贴 token，例如 github_pat_…'))}" autocomplete="off" spellcheck="false" value="${esc(tokenVal)}">
        <button class="btn primary" data-act="inspect">${esc(t('识别'))}</button>
      </div>
      <div class="links" style="margin-top:8px">
        ${linkHtml([t('去 GitHub 生成 token'), 'https://github.com/settings/personal-access-tokens/new'], t('打开 GitHub 的新建 token 页面（用浏览器里当前登录的账号）'))}
        ${linkHtml([t('去 Gitee 生成私人令牌'), 'https://gitee.com/profile/personal_access_tokens/new'])}
        <button class="btn link" data-act="manual">${esc(t('其它站点 / 手动添加…'))}</button>
      </div>
    </div>
    ${localKeysHtml()}
    ${S.accounts.length ? accountGroups() : `<div class="empty">${esc(t('还没有账号'))}</div>`}
  `;
  const tok = $('#tok');
  tok.addEventListener('keydown', e => { if (e.key === 'Enter') inspectToken(); });
}

async function inspectToken() {
  const token = $('#tok').value.trim();
  if (!token) return toast(t('请先粘贴 token'), true);
  let info;
  try { info = await call('inspectToken', { token }); } catch (e) { return toastErr(e); }
  const exists = S.accounts.find(a => a.host === info.host && a.auth === 'token' && a.username.toLowerCase() === info.login.toLowerCase());
  const mine = S.repos.filter(r => r.nhost === info.host && info.repos.some(x => x.name.toLowerCase() === (r.owner + '/' + r.repoName).toLowerCase()));
  const kv = (label, val) => `<div class="kv">${esc(label)}${isEn() ? ': ' : '：'}${val}</div>`;
  const html = `
    ${kv(t('站点'), `<b>${esc(hostName(info.host))}</b>`)}
    ${kv(t('账号'), `<b class="selectable">${esc(info.login)}</b>${info.name ? ` (${esc(info.name)})` : ''}`)}
    ${kv(t('类型'), `<b>${esc(tr(info.kind))}</b>${info.expires ? ` · ${esc(t('到期'))} <b>${esc(info.expires)}</b>` : ''}`)}
    <div class="kv">${esc(t('能访问 {n} 个仓库：', { n: info.repos.length }))}</div>
    <div class="list">${info.repos.map(r => esc(r.name) + (r.push ? '' : esc(t('（只读）')))).join('<br>') || esc(t('（没有）'))}</div>
    ${mine.length ? `<div class="kv">${esc(t('你列表里有 {n} 个项目可以用这个账号：', { n: mine.length }))}${mine.map(r => esc(r.name)).join(sep())}</div>` : ''}
    <p class="muted">${esc(t('保存后会存进系统密码库（站点 {host}，用户名 {login}）。', { host: info.host, login: info.login }))}${exists ? `<b>${esc(t('会替换这个账号原来存的 token。'))}</b>` : ''}</p>`;
  const ok = await modal(t('识别结果'), html, [{ text: t('取消'), value: null }, { text: exists ? t('更新 token') : t('保存账号'), primary: true, value: true }]);
  if (!ok) return;
  try {
    const r = await call('addToken', { token, host: info.host });
    $('#tok').value = '';
    setState(r.state);
    toast((r.isNew ? t('已添加账号 {name}。', { name: r.account.username }) : t('已更新账号 {name}。', { name: r.account.username })) + (mine.length ? t('去“项目”页点“按建议绑定”即可。') : ''));
  } catch (e) { toastErr(e); }
}

// 自动读取本机账号（打开软件时跑一次，“刷新”再跑）
async function syncLocal(silent) {
  if (syncing) return;
  syncing = true; renderAccounts();
  try {
    const r = await call('autoSync');
    setState(r.state);
    if (r.removed) toast(t('有 {n} 个账号在本机已经不存在（在工具外面被删了），已从列表去掉', { n: r.removed }));
    if (r.added.length) {
      toast(t('从本机找到 {n} 个新账号', { n: r.added.length }));
      for (const id of r.added) {
        const a = accById(id);
        if (a && a.auth === 'token') { try { setState(await call('verifyAccount', { id })); } catch (e) { /* 验证失败不影响 */ } }
      }
    } else if (!silent && !r.removed) toast(t('和本机一致，没有变化'));
  } catch (e) { if (!silent) toastErr(e); }
  syncing = false; renderAccounts();
}

function uniqueKeyName(base) {
  const used = new Set([...(S.localKeys || []).map(k => k.file), ...S.accounts.filter(a => a.sshKey).map(a => a.sshKey.split(/[\\/]/).pop())]);
  let name = base, i = 2;
  while (used.has(name)) name = `${base}_${i++}`;
  return name;
}

async function generateKeyDialog() {
  const accOpts = host => uploaders(host).map(a => `<option value="${a.id}">${esc(t('{name}（用它的 token 登记）', { name: accName(a) }))}</option>`).join('') +
    `<option value="">${esc(t('不自动登记（生成后我自己去网页粘贴公钥）'))}</option>`;
  const html = `<div class="form">
    <label>${esc(t('网站'))}</label><select id="f-host"><option value="github.com">GitHub</option><option value="gitee.com">Gitee</option><option value="gitlab.com">GitLab</option></select>
    <label>${esc(t('登记到账号'))}</label><select id="f-acc"></select>
    <div class="hint">${esc(t('选一个 token 账号，生成后自动把公钥登记到这个账号上，不用去网页手动粘贴。'))}</div>
    <label>${esc(t('文件名'))}</label><input id="f-name" spellcheck="false">
    <div class="hint">${esc(t('保存在 ~/.ssh 里。不设密钥密码，生成后直接能用。'))}</div>
    <label>${esc(t('标题'))}</label><input id="f-title" placeholder="${esc(t('留空 = Git账号管家 · 电脑名 · 日期'))}">
    <div class="hint">${esc(t('网站 SSH 公钥列表里显示的名字，方便以后认出是哪台电脑。'))}</div>
  </div>`;
  const data = await modal(t('生成 SSH 密钥'), html, [
    { text: t('取消'), value: null },
    { text: t('生成'), primary: true, value: b => ({ host: b.querySelector('#f-host').value, accountId: b.querySelector('#f-acc').value,
      name: b.querySelector('#f-name').value.trim(), title: b.querySelector('#f-title').value.trim() }) },
  ], back => {
    const suggestName = () => {
      const host = back.querySelector('#f-host').value, a = accById(back.querySelector('#f-acc').value);
      back.querySelector('#f-name').value = uniqueKeyName(`id_ed25519_${host.split('.')[0]}${a ? '_' + loginOf(a).replace(/[^A-Za-z0-9._-]/g, '') : ''}`);
    };
    const fill = () => { back.querySelector('#f-acc').innerHTML = accOpts(back.querySelector('#f-host').value); suggestName(); };
    back.querySelector('#f-host').onchange = fill;
    back.querySelector('#f-acc').onchange = suggestName;
    const firstHost = (uploaders()[0] || {}).host;
    if (firstHost) back.querySelector('#f-host').value = firstHost;
    fill();
  });
  if (!data) return;
  try {
    const r = await call('generateKey', data);
    setState(r.state);
    await showKeyResult(r);
  } catch (e) { toastErr(e); }
}

async function uploadKeyDialog(keyPath) {
  const list = uploaders();
  if (!list.length) return toast(t('还没有能用来登记的 token 账号：先在上面粘贴一个 GitHub / Gitee token'), true);
  const html = `<div class="form">
    <label>${esc(t('密钥'))}</label><div><b>${esc(keyPath.split(/[\\/]/).pop())}</b></div>
    <label>${esc(t('登记到账号'))}</label><select id="f-acc">${list.map(a => `<option value="${a.id}">${esc(hostName(a.host))} · ${esc(accName(a))}</option>`).join('')}</select>
    <label>${esc(t('标题'))}</label><input id="f-title" placeholder="${esc(t('留空 = Git账号管家 · 电脑名 · 日期'))}">
  </div>`;
  const data = await modal(t('把公钥登记到网站'), html, [
    { text: t('取消'), value: null },
    { text: t('登记'), primary: true, value: b => ({ path: keyPath, accountId: b.querySelector('#f-acc').value, title: b.querySelector('#f-title').value.trim() }) },
  ]);
  if (!data) return;
  try {
    const r = await call('uploadKey', data);
    setState(r.state);
    await showKeyResult(Object.assign({ host: accById(data.accountId).host }, r));
  } catch (e) { toastErr(e); }
}

async function showKeyResult(r) {
  const name = r.keyPath.split(/[\\/]/).pop();
  if (r.uploaded && r.verified) {
    switchTab('accounts');
    const where = r.existed ? t('网站上本来就有这把公钥') : t('已登记到 {host}', { host: hostName(r.host) });
    return toast((r.generated ? t('已生成 {file}。', { file: name }) : '') + t('{where}，SSH 测试通过：账号 {login}', { where, login: r.login }));
  }
  const settings = siteLinks(r.host, 'x').find(l => l[2] === 'ssh');
  const why = r.uploaded ? t('公钥已经登记到网站，但 SSH 测试没连上：{msg}', { msg: tr(r.msg) })
    : r.msg ? t('没能自动登记：{msg}', { msg: tr(r.msg) }) : t('你选了不自动登记。');
  const html = `<p>${r.generated ? esc(t('已生成密钥 {file}。', { file: name })) : ''}${esc(why)}</p>
    ${r.uploaded ? '' : `<p>${esc(t('复制下面的公钥，贴到网站的 SSH 设置里，再回来点“刷新”，工具会自动识别它属于哪个账号。'))}${settings ? ' ' + linkHtml(settings) : ''}</p>`}
    <div class="secret selectable">${esc(r.pub)}</div>`;
  const act = await modal(r.uploaded ? t('已登记，待验证') : t('还差一步'), html, [{ text: t('关闭'), value: null }, { text: t('复制公钥'), primary: true, value: 'copy' }]);
  if (act === 'copy') { try { await call('copyText', { text: r.pub }); toast(t('公钥已复制到剪贴板')); } catch (e) { toastErr(e); } }
}

async function manualAdd() {
  const keys = [...new Set([...(S.localKeys || []).map(k => k.path), ...S.accounts.filter(a => a.auth === 'ssh').map(a => a.sshKey)])];
  const html = `<div class="form">
    <label>${esc(t('站点'))}</label><input id="f-host" list="hostlist" value="github.com">
    <datalist id="hostlist"><option>github.com</option><option>gitee.com</option><option>gitlab.com</option><option>e.coding.net</option><option>gitcode.com</option><option>codeup.aliyun.com</option></datalist>
    <label>${esc(t('用户名'))}</label><input id="f-user" placeholder="${esc(t('这个账号在网站上的用户名'))}">
    <label>${esc(t('方式'))}</label><select id="f-auth"><option value="token">${esc(t('HTTPS + Token / 密码'))}</option><option value="ssh">${esc(t('SSH 密钥'))}</option></select>
    <label class="t">Token</label><input class="t" id="f-token" type="password" placeholder="${esc(t('token 或密码，存进系统密码库'))}">
    <label class="s">${esc(t('密钥文件'))}</label><div class="s" style="display:flex;gap:6px"><input id="f-key" value="${esc(keys[0] || '')}" style="flex:1"><button class="btn sm" id="f-pick">${esc(t('选择…'))}</button></div>
    <label class="s"></label><label class="s"><input type="checkbox" id="f-443"> ${esc(t('走 443 端口（22 端口被代理拦时用，仅 GitHub/GitLab）'))}</label>
  </div>`;
  const data = await modal(t('手动添加账号'), html, [
    { text: t('取消'), value: null },
    { text: t('保存'), primary: true, value: b => ({ host: b.querySelector('#f-host').value, username: b.querySelector('#f-user').value,
      auth: b.querySelector('#f-auth').value, token: b.querySelector('#f-token').value, sshKey: b.querySelector('#f-key').value.trim(),
      ssh443: b.querySelector('#f-443').checked }) },
  ], back => {
    const toggle = () => {
      const ssh = back.querySelector('#f-auth').value === 'ssh';
      back.querySelectorAll('.t').forEach(e => { e.style.display = ssh ? 'none' : ''; });
      back.querySelectorAll('.s').forEach(e => { e.style.display = ssh ? '' : 'none'; });
    };
    toggle();
    back.querySelector('#f-auth').onchange = toggle;
    back.querySelector('#f-pick').onclick = async () => { const p = await call('pickKey'); if (p) back.querySelector('#f-key').value = p; };
  });
  if (!data) return;
  try { setState(await call('addManual', data)); toast(t('已添加')); } catch (e) { toastErr(e); }
}

async function editAccount(id) {
  const a = accById(id);
  const html = `<div class="form">
    <label>${esc(t('账号'))}</label><div><b>${esc(loginOf(a))}</b> <span class="muted">· ${esc(hostName(a.host))} · ${a.auth === 'ssh' ? 'SSH' : 'Token'}${placeholderOf(a) ? ' · ' + storedAs(a) : ''}</span></div>
    <label>${esc(t('备注'))}</label><input id="f-label" value="${esc(a.label || '')}" placeholder="${esc(t('例如：公司 / 个人'))}">
    <label>${esc(t('仓库所有者'))}</label><input id="f-owners" value="${esc((a.owners || []).filter(o => !PLACEHOLDER_USER.test(o)).join(', '))}">
    <div class="hint">${t('这个账号负责哪些用户/组织的仓库（地址里 github.com/<b>这一段</b>/仓库名），用来推荐账号。token 账号验证时会自动补全。')}</div>
    ${a.auth === 'token' ? `<label>${esc(t('更新 token'))}</label><input id="f-token" type="password" placeholder="${esc(t('留空 = 不改'))}">
      <div class="hint">${esc(t('新 token 必须属于同一个账号。'))}</div>`
      : `<label>${esc(t('密钥'))}</label><div class="ppath">${esc(a.sshKey)}</div>
      <label></label><label><input type="checkbox" id="f-443" ${a.ssh443 ? 'checked' : ''}> ${esc(t('走 443 端口'))}</label>`}
  </div>`;
  const data = await modal(t('编辑账号'), html, [
    { text: t('取消'), value: null },
    { text: t('保存'), primary: true, value: b => ({ id, label: b.querySelector('#f-label').value, owners: b.querySelector('#f-owners').value,
      token: (b.querySelector('#f-token') || {}).value || '', ssh443: !!(b.querySelector('#f-443') || {}).checked }) },
  ]);
  if (!data) return;
  try { setState(await call('updateAccount', data)); toast(t('已保存')); } catch (e) { toastErr(e); }
}

async function showPublicKey(id, keyPath) {
  const a = id ? accById(id) : null;
  let r;
  try { r = await call('publicKey', a ? { id } : { path: keyPath }); } catch (e) { return toastErr(e); }
  const settings = a ? siteLinks(a.host, a.username).find(l => l[2] === 'ssh') : null;
  const colon = isEn() ? ': ' : '：';
  const html = `<div class="kv">${a ? `${esc(hostName(a.host))} · <b>${esc(a.username)}</b> · ` : `<b>${esc(r.keyPath.split(/[\\/]/).pop())}</b> · `}${esc(t('SSH 公钥'))}</div>
    <div class="secret selectable">${esc(r.pub)}</div>
    ${r.fingerprint ? `<div class="kv">${esc(t('指纹'))}${colon}<b class="selectable" style="font-family:var(--mono);font-size:12px">${esc(r.fingerprint)}</b></div>` : ''}
    <div class="kv">${esc(t('私钥文件'))}${colon}<b class="selectable">${esc(r.keyPath)}</b></div>
    <p class="muted">${esc(t('公钥可以公开，贴到网站的 SSH 设置里就能让这把密钥登录该账号。私钥文件不要给任何人。'))}${settings ? ' ' + linkHtml(settings) : ''}</p>`;
  const act = await modal(t('SSH 公钥'), html, [{ text: t('关闭'), value: null }, { text: isWin() ? t('在资源管理器中显示') : t('在访达中显示'), value: 'show' }, { text: t('复制公钥'), primary: true, value: 'copy' }]);
  try {
    if (act === 'copy') { await call('copyText', { text: r.pub }); toast(t('公钥已复制到剪贴板')); }
    if (act === 'show') await call('showKeyFile', a ? { id } : { path: keyPath });
  } catch (e) { toastErr(e); }
}

const localRepo = (host, repo) => S.repos.find(r => r.nhost === normHost(host) && (r.owner + '/' + r.repoName).toLowerCase() === repo.toLowerCase());

// 拉取到本地。从账号的仓库列表点进来时仓库已定（accountId + repo）；
// 从项目页进来时什么都不给：填仓库地址，按地址里的网站列出账号，也可以不指定账号拉公开仓库
async function cloneDialog(accountId, repo) {
  const local = repo && localRepo(accById(accountId).host, repo);
  if (local) {
    switchTab('repos'); openRows.add('r:' + local.path); render();
    setTimeout(() => { const el = document.querySelector(`[data-key="r:${CSS.escape(local.path)}"]`); if (el) el.scrollIntoView({ block: 'center' }); });
    return toast(t('这个仓库已经在本地了：{path}', { path: shortPath(local.path) }));
  }
  const first = repo ? accById(accountId) : null;
  const sp = isWin() ? '\\' : '/';
  const parent0 = S.cloneDir || S.sys.docs || (S.sys.home ? S.sys.home + sp + 'Documents' : '');
  const urlHint = t('也可以直接粘贴浏览器地址栏里的仓库网页地址');
  const html = `<div class="form">
    ${repo ? `<label>${esc(t('仓库'))}</label><div class="clone-repo"><span class="xsite">${siteIcon(first.host)}</span><b>${esc(repo)}</b></div>`
      : `<label>${esc(t('仓库地址'))}</label><input id="f-url" placeholder="${esc(t('https://github.com/用户/仓库.git 或 git@github.com:用户/仓库.git'))}" spellcheck="false">
         <div class="hint" id="f-info">${esc(urlHint)}</div>`}
    <label>${esc(t('用哪个账号'))}</label><select id="f-acc"></select>
    <div class="hint" id="f-acc-hint"></div>
    <label>${esc(t('保存到'))}</label><div style="display:flex;gap:6px"><input id="f-parent" value="${esc(parent0)}" spellcheck="false" style="flex:1"><button class="btn sm" id="f-pick">${esc(t('选择…'))}</button></div>
    <label>${esc(t('文件夹名'))}</label><input id="f-name" value="${esc(repo ? repo.split('/').pop() : '')}" spellcheck="false">
    <div class="hint" id="f-dest"></div>
  </div>`;
  let parsed = repo ? { host: normHost(first.host), repo } : null;  // 填地址时：主进程解析出来的站点、仓库、推荐账号
  let parseErr = '';
  const data = await modal(t('拉取到本地'), html, [
    { text: t('取消'), value: null },
    { text: t('开始拉取'), primary: true, value: b => {
      const v = { accountId: b.querySelector('#f-acc').value, parent: b.querySelector('#f-parent').value.trim(), name: b.querySelector('#f-name').value.trim() };
      if (repo) return Object.assign(v, { repo });
      if (!parsed) { toast(parseErr ? tr(parseErr) : t('请先填写仓库地址'), true); return undefined; }
      return Object.assign(v, { url: b.querySelector('#f-url').value.trim(), label: parsed.repo });
    } },
  ], back => {
    const $$ = s => back.querySelector(s);
    const upd = () => { $$('#f-dest').textContent = t('会拉到：{path}', { path: $$('#f-parent').value.replace(/[\\/]+$/, '') + sp + $$('#f-name').value }); };
    const accHint = () => {
      const none = !repo && !(parsed && S.accounts.some(a => normHost(a.host) === parsed.host));
      $$('#f-acc-hint').textContent = ($$('#f-acc').value ? t('拉下来后这个项目就绑定这个账号，以后拉取、推送都用它。')
        : t('不指定账号只能拉公开仓库；拉下来后也可以再给它选账号。')) + (parsed && none ? ' ' + t('还没有 {host} 的账号，私有仓库请先到“账号”页添加。', { host: hostName(parsed.host) }) : '');
    };
    // 只列地址里那个网站的账号
    const fillAccs = pick => {
      const accs = parsed ? S.accounts.filter(a => normHost(a.host) === parsed.host) : [];
      // 没有推荐时默认选这个网站的账号（优先和地址同一种方式）
      if (!pick && parsed && parsed.proto) pick = (accs.find(a => typeOf(a) === parsed.proto) || accs[0] || {}).id;
      $$('#f-acc').innerHTML = accs.map(a => `<option value="${a.id}" ${a.id === pick ? 'selected' : ''}>${esc(accName(a))} · ${esc(typeLabel(a))}</option>`).join('')
        + (repo ? '' : `<option value="" ${pick ? '' : 'selected'}>${esc(t('不指定账号（公开仓库）'))}</option>`);
      accHint();
    };
    $$('#f-acc').onchange = accHint;
    $$('#f-parent').oninput = upd; $$('#f-name').oninput = () => { $$('#f-name').dataset.touched = '1'; upd(); }; upd();
    $$('#f-pick').onclick = async () => {
      const p = await call('pickDir', { defaultPath: $$('#f-parent').value });
      if (p) { $$('#f-parent').value = p; upd(); }
    };
    fillAccs(accountId);
    if (repo) return;
    let seq = 0;
    $$('#f-url').oninput = async () => {
      const my = ++seq, url = $$('#f-url').value.trim(), info = $$('#f-info');
      const r = url ? await window.gz.call('parseRepoUrl', { url }) : null;  // 不走 call()：边打字边解析，不要闪“处理中”
      if (my !== seq) return;
      parsed = r && r.ok ? r.data : null;
      parseErr = r && !r.ok ? r.error : '';
      info.classList.toggle('bad-text', !!parseErr);
      if (!parsed) {
        info.textContent = parseErr ? tr(parseErr) : urlHint;
      } else {
        const have = localRepo(parsed.host, parsed.repo);
        info.textContent = `${hostName(parsed.host)} · ${parsed.repo}` + (have ? ' ' + t('（列表里已经有：{path}）', { path: shortPath(have.path) }) : '');
        if (!$$('#f-name').dataset.touched) $$('#f-name').value = parsed.name;
      }
      fillAccs(parsed && parsed.suggestId);
      upd();
    };
  });
  if (!data) return;
  const label = repo || data.label;
  delete data.label;
  // 拉取可能要几分钟：显示一个不能关的进度层
  const t0 = Date.now();
  const over = document.createElement('div');
  over.className = 'modal-back';
  over.innerHTML = `<div class="modal" style="width:min(460px,100%);text-align:center">
    <div class="spin big"></div><h2 style="margin:14px 0 6px">${esc(t('正在拉取 {repo}', { repo: label }))}</h2>
    <p class="muted" style="margin:0">${esc(t('大仓库可能要几分钟，请稍等'))} · ${t('{sec} 秒', { sec: '<span id="clone-t">0</span>' })}</p></div>`;
  document.body.appendChild(over);
  const timer = setInterval(() => { const e = over.querySelector('#clone-t'); if (e) e.textContent = Math.round((Date.now() - t0) / 1000); }, 1000);
  try {
    const r = await call('cloneRepo', data);
    clearInterval(timer); over.remove();
    setState(r.state);
    switchTab('repos'); openRows.add('r:' + r.path); render();
    toast(t('已拉取到 {path}，并加进了项目列表', { path: shortPath(r.path) }));
    testRepo(r.path, true);
  } catch (e) {
    clearInterval(timer); over.remove();
    modal(t('拉取到本地失败'), `<p style="white-space:pre-line">${esc(tr(e.message))}</p>`, [{ text: t('知道了'), value: true, primary: true }]);
  }
}

async function revealSecret(id) {
  const a = accById(id);
  let r;
  try { r = await call('revealSecret', { id }); } catch (e) { return toastErr(e); }
  const html = `<div class="kv">${esc(hostName(a.host))} · <b>${esc(loginOf(a))}</b> · ${esc(r.kind === 'password' ? t('网站登录密码') : 'token')}</div>
    <div class="secret selectable">${esc(r.secret)}</div>
    <p class="muted">${esc(t('这是系统密码库里存的原文，注意别截图外传。'))}</p>`;
  const act = await modal(t('查看原文'), html, [{ text: t('关闭'), value: null }, { text: t('复制'), primary: true, value: 'copy' }]);
  if (act === 'copy') {
    try { await call('copyText', { text: r.secret }); toast(t('已复制到剪贴板')); } catch (e) { toastErr(e); }
  }
}

async function deleteAccount(id) {
  const a = accById(id);
  const usedBy = S.repos.filter(r => r.boundId === id || (a.auth === 'ssh' && sameFile(r.sshKey, a.sshKey)));
  const keyFile = a.auth === 'ssh' ? a.sshKey.split(/[\\/]/).pop() : '';
  const sameKey = a.auth === 'ssh' ? S.accounts.filter(x => x.id !== id && x.auth === 'ssh' && sameFile(x.sshKey, a.sshKey)) : [];
  const store = storeName();
  const what = a.auth === 'token'
    ? `<p>${t('会从本机<b>{store}</b>里删除 <b>{who}</b> 这条{kind}。<b>删除后无法恢复</b>，以后要用得重新粘贴。',
        { store: esc(store), who: esc(hostName(a.host) + ' · ' + loginOf(a)), kind: esc(a.secretKind === 'password' ? t('登录密码') : ' token') })}</p>`
      + (placeholderOf(a) ? `<p>${t('它是用占位用户名 <b>{user}</b> 存的：本机别的项目或工具如果用 {url} 这种地址，删掉后也会拉不了代码。',
        { user: esc(a.username), url: `<span class="mono">https://${esc(a.username)}@${esc(a.host)}/…</span>` })}</p>` : '')
    : `<p>${t('会把密钥文件 <b>{file}</b> 和 <b>{file}.pub</b> 移到{trash}（删错了可以从那里找回）。', { file: esc(keyFile), trash: esc(trashName()) })}</p>
       ${sameKey.length ? `<p>${esc(t('这把密钥同时登记在：{list}，这些账号也会一起消失。', { list: sameKey.map(x => hostName(x.host) + ' · ' + x.username).join(sep()) }))}</p>` : ''}
       <p class="muted">${esc(t('网站上登记的公钥不会自动删除，需要的话去网站的 SSH 设置里删掉。'))}</p>`;
  const html = what + (usedBy.length ? `<p class="chip warn" style="white-space:normal;display:block;padding:6px 10px">${esc(t('有 {n} 个项目在用它：{list}。删除后这些项目会拉不了代码，要给它们换个账号。', { n: usedBy.length, list: usedBy.map(r => r.name).join(sep()) }))}</p>` : '');
  const buttons = [{ text: t('取消'), value: null }];
  if (a.auth === 'token' && a.hasToken) buttons.push({ text: t('先复制原文'), value: 'copy' });
  buttons.push({ text: a.auth === 'token' ? t('从本机删除') : t('移到{trash}', { trash: trashName() }), danger: true, value: 'delete' });
  const act = await modal(t('删除账号'), html, buttons);
  if (act === 'copy') {
    try { const r = await call('revealSecret', { id }); await call('copyText', { text: r.secret }); toast(t('已复制，可以先找个地方保存，再删除')); } catch (e) { toastErr(e); }
    return deleteAccount(id);
  }
  if (act !== 'delete') return;
  try { setState(await call('deleteAccount', { id })); toast(a.auth === 'token' ? t('已从本机{store}删除', { store }) : t('密钥已移到{trash}', { trash: trashName() })); } catch (e) { toastErr(e); }
}

async function deleteLocalKey(keyPath) {
  const name = keyPath.split(/[\\/]/).pop();
  const ok = await modal(t('删除密钥'), `<p>${t('把 <b>{file}</b> 和 <b>{file}.pub</b> 移到{trash}？删错了可以从那里找回。', { file: esc(name), trash: esc(trashName()) })}</p>`,
    [{ text: t('取消'), value: null }, { text: t('移到{trash}', { trash: trashName() }), danger: true, value: true }]);
  if (!ok) return;
  try { setState(await call('deleteLocalKey', { path: keyPath })); toast(t('已移到{trash}', { trash: trashName() })); } catch (e) { toastErr(e); }
}

// ================================================================ 记录与设置：一行一行，可展开折叠

const openRows = new Set(['sync']);  // 默认展开的行
const hostOfUrl = u => { const m = String(u || '').match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)?([^/:]+)/); return m ? normHost(m[1]) : ''; };
function dayLabel(x) {
  const d = new Date(x), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return diff === 0 ? t('今天') : diff === 1 ? t('昨天') : d.toLocaleDateString(LOCALE(), { year: 'numeric', month: 'long', day: 'numeric' });
}
const clock = x => new Date(x).toLocaleTimeString(LOCALE(), { hour12: false, hour: '2-digit', minute: '2-digit' });

function rowHtml(key, head, body) {
  const open = openRows.has(key);
  return `<div class="xrow${open ? ' open' : ''}">
    <div class="xrow-head" data-act="toggleRow" data-key="${esc(key)}">${head}<span class="xchev">›</span></div>
    ${open ? `<div class="xrow-body">${body}</div>` : ''}
  </div>`;
}

function historyRows() {
  if (!S.history.length) return `<div class="xempty">${esc(t('还没有修改过。在项目页给项目换账号后，这里会记下每一次改动，随时可以撤销。'))}</div>`;
  let out = '', lastDay = '';
  S.history.forEach((h, i) => {
    const day = dayLabel(h.time);
    if (day !== lastDay) { out += `<div class="xday">${esc(day)}</div>`; lastDay = day; }
    const name = h.path.split(/[\\/]/).pop();
    // 主进程记录里的 '撤销' / '不指定' 是数据，不是界面文字
    const isUndo = h.account === '撤销', isClone = h.kind === 'clone';
    const host = hostOfUrl(h.newUrl);
    const acc = isUndo ? t('撤销上一次改动') : h.account === '不指定' ? t('不指定账号') : h.account.replace(/ @ .*$/, '');
    const head = `<span class="xic ${isUndo ? 'undo' : isClone ? 'clone' : 'bind'}" title="${esc(isUndo ? t('撤销') : isClone ? t('拉取到本地') : t('换账号'))}">${isUndo ? '↺' : isClone ? '⤓' : '⇄'}</span>
      <span class="xmain"><b>${esc(name)}</b><span class="xarrow">→</span>${!isUndo && host ? `<span class="xsite">${siteIcon(host)}</span>` : ''}<span>${esc(acc)}</span></span>
      <span class="xmeta">${clock(h.time)}</span>`;
    const sshChanged = (h.oldSsh || '') !== (h.newSsh || '');
    const body = `
      <div class="kvgrid">
        <span>${esc(t('项目'))}</span><b class="selectable">${esc(h.path)}</b>
        <span>${esc(t('时间'))}</span><b>${fmtTime(h.time)}</b>
        <span>${esc(t('远程'))}</span><b>${esc(h.remote || 'origin')}</b>
      </div>
      <div class="diff"><div class="old">− ${esc(tr(h.oldUrl))}</div><div class="new">+ ${esc(h.newUrl)}</div>
        ${sshChanged ? `<div class="muted" style="margin-top:8px">core.sshCommand</div><div class="old">− ${esc(h.oldSsh || t('（无）'))}</div><div class="new">+ ${esc(h.newSsh || t('（无）'))}</div>` : ''}</div>
      <div class="acts" style="margin-top:10px">
        ${isClone ? '' : `<button class="btn sm" data-act="undo" data-i="${i}">${esc(t('撤销这次改动'))}</button>`}
        <button class="btn sm" data-act="openPath" data-path="${esc(h.path)}">${esc(t('打开文件夹'))}</button>
      </div>`;
    out += rowHtml('h' + h.time + ':' + h.path, head, body);
  });
  return out;
}

function renderRecords() {
  const s = S.sys;
  const store = storeName();
  const settings = [
    rowHtml('lang',
      `<span class="xic set">文A</span><span class="xmain"><b>${esc(t('语言'))}</b><span class="muted">${isEn() ? 'English' : '中文'}</span></span>`,
      `<div class="seg" id="lang-seg">${[['zh', '中文'], ['en', 'English']].map(([k, label]) => `<button class="${window.I18N.getLang() === k ? 'on' : ''}" data-act="lang" data-l="${k}">${label}</button>`).join('')}</div>
       <p class="muted" style="margin:8px 0 0">${esc(t('默认跟随系统语言。也可以在左下角切换。'))}</p>`),
    rowHtml('sync',
      `<span class="xic set">⇅</span><span class="xmain"><b>${esc(t('Mac / Windows 同步账号'))}</b><span class="muted">${esc(t('导出 / 导入账号配置，不含 token'))}</span></span>`,
      `<p class="muted" style="margin-top:0">${t('导出的文件只有账号信息（网站、用户名、备注、密钥文件名），<b>不含 token 和密钥</b>。在另一台电脑导入后，到账号页把 token 粘贴一次即可；SSH 密钥需要自己拷过去，或在那台电脑上重新生成。')}</p>
       <div class="acts"><button class="btn" data-act="export">${esc(t('导出账号配置…'))}</button><button class="btn" data-act="import">${esc(t('导入账号配置…'))}</button></div>`),
    rowHtml('sys',
      `<span class="xic set">ⓘ</span><span class="xmain"><b>${esc(t('本机信息'))}</b><span class="muted">${esc(s.platform)} · ${esc((s.gitVersion || t('没找到 git')).replace(/^git version /, 'Git '))} · ${esc(s.helper ? store : t('没配置凭据存储'))}</span></span>${s.helper && !s.gitMissing ? '' : chip('bad', t('要处理'))}`,
      `<div class="kvgrid">
         <span>${esc(t('系统'))}</span><b>${esc(s.platform)}</b>
         <span>Git</span><b>${esc(s.gitVersion || t('没有找到 git，请先安装'))}</b>
         <span>${esc(t('凭据存储'))}</span><b>${esc(s.helper || t('未配置'))}${s.helper ? '' : ' ' + chip('bad', t('没配置 credential.helper，token 存不住'))}</b>
         <span>${esc(t('代理'))}</span><b>${esc(s.proxy || t('无'))}</b>
         <span>${esc(t('配置文件'))}</span><b class="selectable">${esc(s.confPath)}</b>
       </div>`),
    rowHtml('how',
      `<span class="xic set">?</span><span class="xmain"><b>${esc(t('工作原理'))}</b><span class="muted">${esc(t('为什么要给每个项目指定账号'))}</span></span>`,
      `<p style="margin-top:0">${t('{store}按 <b>“网站 + 用户名”</b> 保存 token。项目地址里如果没写用户名，同一网站的项目只能共用一份 token：拉一个项目时换了 token，就会把别的项目顶掉。', { store: esc(store) })}</p>
       <p>${t('本工具给每个项目指定账号：HTTPS 项目把用户名写进地址（{example}），SSH 项目指定用哪把密钥。从此各项目互不影响。只改项目的 .git/config，不动代码，每次改动都记在上面，可以撤销。', { example: `<span class="mono">https://${esc(t('用户名'))}@github.com/…</span>` })}</p>`),
  ].join('');
  $('#tab-records').innerHTML = `
    <div class="head"><h1>${esc(t('记录与设置'))}</h1></div>
    <div class="xsec-title">${esc(t('修改记录'))} <span class="muted">${S.history.length ? esc(t('{n} 条 · 点一行看详情', { n: S.history.length })) : ''}</span></div>
    <div class="xlist">${historyRows()}</div>
    <div class="xsec-title">${esc(t('设置'))}</div>
    <div class="xlist">${settings}</div>`;
}

async function undo(i) {
  const h = S.history[i];
  const ok = await modal(t('撤销修改'), `<p>${t('把 <b>{path}</b> 的远程地址改回：', { path: esc(h.path) })}</p><div class="diff">${esc(h.oldUrl)}</div>`);
  if (!ok) return;
  try { setState(await call('undo', { index: i })); toast(t('已撤销')); } catch (e) { toastErr(e); }
}

// ================================================================ 事件

const ACTIONS = {
  pick: async () => {
    try {
      const r = await call('pickFolders');
      if (!r) return;
      setState(r.state);
      if (r.added.length) { toast(t('添加了 {n} 个项目，正在逐个测试', { n: r.added.length })); await testMany(withRemote(r.added)); }
      else toast(r.found ? t('这些项目都已经在列表里了') : t('没有找到 Git 项目'), !r.found);
    } catch (e) { toastErr(e); }
  },
  testAll: async () => { const ps = visibleRepos().filter(r => r.remote).map(r => r.path); const bad = await testMany(ps); toast(t('测试完成：{ok} 个正常，{bad} 个失败', { ok: ps.length - bad, bad }), bad > 0); },
  autoBind,
  filter: d => { F.filter = F.filter === d.f ? 'all' : d.f; renderRepos(); },
  pull: d => pullRepo(d.path),
  terminal: d => call('openTerminal', { path: d.path }).catch(toastErr),
  openPicker: (d, el) => openPicker(d.path, el),
  test: d => testRepo(d.path),
  open: d => call('openRepo', { path: d.path }).catch(toastErr),
  remove: async d => { try { setState(await call('removeRepo', { path: d.path })); } catch (e) { toastErr(e); } },
  inspect: inspectToken,
  manual: manualAdd,
  sync: () => syncLocal(false),
  genKey: generateKeyDialog,
  help: showHelp,
  lang: d => setLang(d.l),
  cloneRepo: d => cloneDialog(d.id, d.repo),
  cloneUrl: () => cloneDialog(),
  openSsh: () => call('openSshDir').catch(toastErr),
  sourcetree: d => call('openSourcetree', { path: d.path }).catch(toastErr),
  delKey: d => deleteLocalKey(d.path),
  uploadKey: d => uploadKeyDialog(d.path),
  keyPub: d => showPublicKey(null, d.path),
  verify: async (d, el) => {
    el.disabled = true; el.innerHTML = `<span class="spin"></span> ${esc(t('验证中…'))}`;
    try { setState(await call('verifyAccount', { id: d.id })); const a = accById(d.id); toast(tr(a.verify.msg), !a.verify.ok); } catch (e) { toastErr(e); renderAccounts(); }
  },
  reveal: d => revealSecret(d.id),
  pubkey: d => showPublicKey(d.id),
  editAcc: d => editAccount(d.id),
  delAcc: d => deleteAccount(d.id),
  undo: d => undo(+d.i),
  toggleRow: d => { openRows.has(d.key) ? openRows.delete(d.key) : openRows.add(d.key); render(); },
  openPath: d => call('openRepo', { path: d.path }).catch(() => toast(t('这个项目已经不在列表里了，没法打开'), true)),
  export: async () => { try { const p = await call('exportFile'); if (p) toast(t('已导出到 {path}', { path: p })); } catch (e) { toastErr(e); } },
  import: async () => {
    try { const r = await call('importFile'); if (r) { setState(r.state); toast(t('导入了 {n} 个新账号。token 账号需要重新填 token', { n: r.imported })); } }
    catch (e) { toast(t('导入失败：{msg}', { msg: tr(e.message) }), true); }
  },
};

document.addEventListener('click', e => {
  const nav = e.target.closest('nav button');
  if (nav) return switchTab(nav.dataset.tab);
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el.dataset, el);
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !document.querySelector('.modal-back')) {
    e.preventDefault(); switchTab('repos'); const q = $('#q'); if (q) { q.focus(); q.select(); }
  }
});
if (IS_MAC) document.body.classList.add('mac');

// 拖拽添加项目
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0; $('#drop').hidden = true;
  const paths = [...(e.dataTransfer ? e.dataTransfer.files : [])].map(f => window.gz.pathOf(f)).filter(Boolean);
  addPaths(paths);
});

initLang();
renderStatic();
call('setLang', { lang: window.I18N.getLang() }).catch(() => {});
load();
