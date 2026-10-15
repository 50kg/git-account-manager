'use strict';
// Git 账号管家 —— 核心逻辑（运行在 Electron 主进程，不依赖界面）
// token 一律交给 git 存进系统密码库（macOS 钥匙串 / Windows 凭据管理器），本工具的配置文件不保存 token。

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HOME = os.homedir();
const SSH_DIR = path.join(HOME, '.ssh');

const GIT_HOSTS = ['github.com', 'gitee.com', 'gitlab.com', 'e.coding.net', 'gitcode.com', 'gitcode.net',
  'codeup.aliyun.com', 'bitbucket.org', 'dev.azure.com', 'jihulab.com'];
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', '.venv', 'build', 'dist', 'target', 'Pods',
  'vendor', 'Library', 'DerivedData', 'site-packages']);

let confPath = '';
let docsDir = '';  // 系统的“文档”文件夹（Windows 上可能被挪到别的盘或 OneDrive 里）
let extraEnv = {};
let httpFetch = (...a) => fetch(...a);
// 删除 SSH 密钥时移到废纸篓（Electron 里由主进程传入 shell.trashItem；测试时退化为移到临时目录）
let trashItem = async p => {
  const dir = path.join(os.tmpdir(), 'git-zhanghao-trash');
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(p, path.join(dir, Date.now() + '-' + path.basename(p)));
};

function init({ dataDir, fetchImpl, env, trashImpl, documents }) {
  if (trashImpl) trashItem = trashImpl;
  if (documents) docsDir = documents;
  confPath = path.join(dataDir, 'config.json');
  if (fetchImpl) httpFetch = fetchImpl;
  if (env) extraEnv = env;
}

// 主进程每次操作前更新一次（系统代理可能随时被打开/关掉）
function setEnv(env) { extraEnv = env || {}; }

// ------------------------------------------------------------------ 配置

function loadConf() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(confPath, 'utf8')); } catch (e) { /* 第一次运行 */ }
  c.accounts = c.accounts || [];
  c.repos = c.repos || [];
  c.tests = c.tests || {};
  c.history = c.history || [];
  // 旧版本在验证结果里显示过密码的前后几位，清掉
  for (const a of c.accounts) if (a.verify && /有凭据（/.test(a.verify.msg || '')) delete a.verify;
  return c;
}

function saveConf(c) {
  fs.mkdirSync(path.dirname(confPath), { recursive: true });
  const tmp = confPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), 'utf8');
  fs.renameSync(tmp, confPath);
}

// 所有改配置的操作串行执行，避免并发测试时互相覆盖
let queue = Promise.resolve();
function withConf(fn) {
  const p = queue.then(async () => {
    const c = loadConf();
    const r = await fn(c);
    saveConf(c);
    return r;
  });
  queue = p.catch(() => {});
  return p;
}

// ------------------------------------------------------------------ 调用外部命令

function childEnv(more) {
  const env = Object.assign({}, process.env, extraEnv, {
    GIT_TERMINAL_PROMPT: '0',  // 不在终端弹用户名/密码提示
    GCM_INTERACTIVE: 'never',  // Windows 凭据管理器不弹窗
    GIT_ASKPASS: '', SSH_ASKPASS: '',
    LC_ALL: 'C', LANGUAGE: 'C',
  }, more || {});
  if (IS_MAC) env.PATH = [env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':');
  return env;
}

function run(cmd, args, { cwd = HOME, input = null, timeout = 30000, env = null } = {}) {
  return new Promise(resolve => {
    let out = '', err = '', done = false, p, timer;
    const finish = (code, o, e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: o, stderr: e });
    };
    try {
      // detached：脱离终端，ssh 不会卡在输入口令上
      p = spawn(cmd, args, { cwd, env: childEnv(env), windowsHide: true, detached: !IS_WIN });
    } catch (e) {
      return finish(127, '', e.message);
    }
    timer = setTimeout(() => {
      // Windows：PATH 里的 git.exe 只是个启动器，只杀它的话真正干活的 git / ssh 会一直挂着，要连子进程一起杀
      try {
        if (IS_WIN) spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => p.kill());
        else process.kill(-p.pid, 'SIGKILL');
      } catch (e) { /* 已退出 */ }
      finish(124, '', `超时（${Math.round(timeout / 1000)} 秒没有响应）`);
    }, timeout);
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => finish(127, '', e.code === 'ENOENT' ? `找不到命令：${cmd}` : e.message));
    p.on('close', code => finish(code == null ? 1 : code, out, err));
    p.stdin.on('error', () => {});
    p.stdin.end(input == null ? '' : input);
  });
}

const git = (args, opts) => run('git', args, opts);

function scrub(text) {
  return String(text || '')
    .replace(/(:\/\/[^/\s:@]+):[^@\s/]+@/g, '$1:***@')
    .replace(/(gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_-]{8,}/g, '$1***');
}

// 区分 token 和登录密码：登录密码一个字符都不显示
const TOKEN_PREFIX = /^(github_pat_|gh[pousr]_|glpat-)/;
const looksLikeToken = s => TOKEN_PREFIX.test(s) || /^[0-9a-f]{32,40}$/i.test(s) || /^[A-Za-z0-9_-]{36,}$/.test(s);
function maskSecret(s) {
  if (!s) return '';
  const m = s.match(TOKEN_PREFIX);
  if (m) return m[1] + '…' + s.slice(-4);
  return looksLikeToken(s) ? '…' + s.slice(-4) : '•'.repeat(Math.min(s.length, 8));
}
const maskUrl = u => String(u || '').replace(/(:\/\/[^/:@]+):[^@/]+@/, '$1:***@');

// 别的工具存 token 时常用的占位用户名（git 只认 token，不核对用户名），真实账号以网站返回的为准
const PLACEHOLDER_USER = /^(x-access-token|oauth2|x-oauth-basic)$/i;
const loginOf = a => PLACEHOLDER_USER.test(a.username) && a.verify && a.verify.login ? a.verify.login : a.username;

// ------------------------------------------------------------------ 系统密码库（通过 git credential）

function credInput(host, user, pass) {
  let s = `protocol=https\nhost=${host}\n`;
  if (user) s += `username=${user}\n`;
  if (pass != null) s += `password=${pass}\n`;
  return s + '\n';
}

function parseKv(text) {
  const d = {};
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) d[line.slice(0, i)] = line.slice(i + 1);
  }
  return d;
}

async function credGet(host, user) {
  const r = await git(['credential', 'fill'], { input: credInput(host, user), timeout: 90000 });
  if (r.code !== 0) return null;
  const d = parseKv(r.stdout);
  return d.password ? { username: d.username || user, password: d.password } : null;
}

async function credStore(host, user, token) {
  const r = await git(['credential', 'approve'], { input: credInput(host, user, token), timeout: 90000 });
  if (r.code !== 0) throw new Error('写入系统密码库失败：' + scrub(r.stderr));
}

async function credErase(host, user) {
  await git(['credential', 'reject'], { input: credInput(host, user), timeout: 90000 });
}

// ------------------------------------------------------------------ 地址解析

function normHost(h) {
  h = String(h || '').toLowerCase().split(':')[0];
  return ({ 'ssh.github.com': 'github.com', 'altssh.gitlab.com': 'gitlab.com' })[h] || h;
}

function parseUrl(url) {
  const r = { proto: 'other', host: '', user: '', rpath: '', owner: '', repoName: '', nhost: '',
    secretInUrl: false, viaProxy: false };
  if (!url) { r.proto = 'none'; return r; }
  let m = url.match(/^(https?):\/\/(?:([^@/]+)@)?([^/]+)\/(.+?)\/?$/);
  if (m) {
    const userinfo = m[2] || '';
    Object.assign(r, { proto: 'https', host: m[3], user: decodeURIComponent(userinfo.split(':')[0]),
      secretInUrl: userinfo.includes(':'), rpath: m[4] });
    const inner = r.rpath.match(/^https?:\/+([^/]+)\/(.+)$/);
    if (inner) Object.assign(r, { viaProxy: true, rpath: inner[2] });  // https://gh-proxy.com/https://github.com/a/b
  } else {
    // file:// 之类的其它协议不能当成 user@host:path 的简写
    m = url.match(/^ssh:\/\/(?:([^@/]+)@)?([^/]+)\/(.+?)\/?$/) || (!url.includes('://') && url.match(/^(?:([^@/]+)@)?([^:/\\]+):(?!\\)(.+?)\/?$/));
    if (m && !/^[a-zA-Z]$/.test(m[2])) Object.assign(r, { proto: 'ssh', user: m[1] || '', host: m[2], rpath: m[3].replace(/^\/+/, '') });
  }
  if (r.rpath.endsWith('.git')) r.rpath = r.rpath.slice(0, -4);
  const parts = r.rpath.split('/');
  if (parts.length >= 2) { r.owner = parts[0]; r.repoName = parts[parts.length - 1]; }
  r.nhost = normHost(r.host);
  return r;
}

function sshKeyOf(cmd) {
  const m = String(cmd || '').match(/-i\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return m ? (m[1] || m[2] || m[3]) : '';
}

function samePath(a, b) {
  if (!a || !b) return false;
  const f = p => {
    p = path.normalize(p.replace(/^~(?=$|[\\/])/, HOME));
    return IS_WIN || IS_MAC ? p.toLowerCase() : p;
  };
  return f(a) === f(b);
}

// ------------------------------------------------------------------ 项目

const isRepo = p => { try { return fs.existsSync(path.join(p, '.git')); } catch (e) { return false; } };

// 拖进来的是普通文件夹时，找里面的项目（最多 3 层）
function findReposIn(dir, depth = 0, out = []) {
  if (depth > 3 || out.length > 500) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  if (entries.some(e => e.name === '.git')) { out.push(dir); return out; }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) findReposIn(path.join(dir, e.name), depth + 1, out);
  }
  return out;
}

async function repoInfo(p) {
  const info = { path: p, name: path.basename(p), exists: fs.existsSync(p) };
  if (!info.exists || !isRepo(p)) {
    return Object.assign(info, parseUrl(''), { exists: false, remote: '', url: '', remotes: [], sshCommand: '', sshKey: '', branch: '', pushUrl: false,
      dirty: 0, upstream: false, ahead: 0, behind: 0 });
  }
  const [cfg, br, st, ab] = await Promise.all([
    git(['config', '--local', '--list'], { cwd: p, timeout: 10000 }),
    git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: p, timeout: 10000 }),
    git(['status', '--porcelain'], { cwd: p, timeout: 15000 }),
    git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { cwd: p, timeout: 10000 }),
  ]);
  const abm = ab.code === 0 ? ab.stdout.trim().split(/\s+/).map(Number) : null;
  const remotes = {}, pushUrls = new Set();
  let sshCmd = '';
  for (const line of cfg.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i), v = line.slice(i + 1);
    const m = k.match(/^remote\.(.+)\.(url|pushurl)$/i);
    if (m) {
      if (m[2].toLowerCase() === 'url') { if (!(m[1] in remotes)) remotes[m[1]] = v; } else pushUrls.add(m[1]);
    } else if (k.toLowerCase() === 'core.sshcommand') sshCmd = v;
  }
  const names = Object.keys(remotes);
  const remote = remotes.origin != null ? 'origin' : (names[0] || '');
  const url = remotes[remote] || '';
  return Object.assign(info, parseUrl(url), {
    remote, url: maskUrl(url), remotes: names, sshCommand: sshCmd, sshKey: sshKeyOf(sshCmd),
    branch: br.stdout.trim(), pushUrl: pushUrls.has(remote),
    dirty: st.code === 0 ? st.stdout.split(/\r?\n/).filter(Boolean).length : 0,
    upstream: !!abm, ahead: abm ? abm[0] : 0, behind: abm ? abm[1] : 0,
  });
}

// 判断项目现在用哪个账号，并推荐最合适的账号
function annotate(info, accounts) {
  const host = info.nhost;
  let bound = null, status;
  if (info.proto === 'https') {
    if (info.user) {
      bound = accounts.find(a => a.auth === 'token' && normHost(a.host) === host && a.username.toLowerCase() === info.user.toLowerCase());
      status = bound ? 'bound' : 'unknown_user';
    } else status = 'none';
  } else if (info.proto === 'ssh') {
    if (info.sshKey) {
      bound = accounts.find(a => a.auth === 'ssh' && normHost(a.host) === host && samePath(a.sshKey, info.sshKey));
      status = bound ? 'bound' : 'unknown_key';
    } else status = 'default_ssh';
  } else status = info.proto;

  const full = (info.owner + '/' + info.repoName).toLowerCase();
  const owner = info.owner.toLowerCase();
  let best = null, bestScore = 0;
  for (const a of accounts) {
    if (normHost(a.host) !== host || !owner) continue;
    let s = 0;
    const hit = a.verify && a.verify.repos ? a.verify.repos.find(r => r.name.toLowerCase() === full) : null;
    if (hit) s = hit.push ? 100 : 45;  // 只读的不如“负责这个组织”的账号（推不了代码）
    else if ((a.owners || []).some(o => o.toLowerCase() === owner)) s = 50;
    if (s && a.auth === (info.proto === 'ssh' ? 'ssh' : 'token')) s += 5;  // 尽量不换协议
    if (s > bestScore) { best = a; bestScore = s; }
  }
  info.boundId = bound ? bound.id : '';
  info.bindStatus = status;
  info.suggestId = best ? best.id : '';
  info.tokenAccess = '';
  const v = bound && bound.verify;
  if (v && v.repos && info.owner) {
    const hit = v.repos.find(r => r.name.toLowerCase() === full);
    info.tokenAccess = hit ? (hit.push ? 'push' : 'read') : 'missing';
  }
  return info;
}

const bindable = r => (r.proto === 'https' || r.proto === 'ssh') && !r.viaProxy;

function planBind(info, acc) {
  if (!bindable(info)) throw new Error('这个项目的远程地址不是标准的 HTTPS/SSH 地址，不支持切换账号');
  const p = info.rpath;
  if (!acc) {
    if (info.proto === 'https') return { url: `https://${info.host}/${p}.git`, ssh: '' };
    return { url: null, ssh: '' };  // SSH：只去掉指定的密钥
  }
  if (acc.auth === 'token') return { url: `https://${encodeURIComponent(acc.username)}@${acc.host}/${p}.git`, ssh: '' };
  const key = acc.sshKey.replace(/\\/g, '/');
  let cmd = `ssh -i "${key}" -o IdentitiesOnly=yes`;
  if (IS_MAC) cmd += ' -o UseKeychain=yes -o AddKeysToAgent=yes';
  if (acc.ssh443 && normHost(acc.host) === 'github.com') return { url: `ssh://git@ssh.github.com:443/${p}.git`, ssh: cmd };
  if (acc.ssh443 && normHost(acc.host) === 'gitlab.com') return { url: `ssh://git@altssh.gitlab.com:443/${p}.git`, ssh: cmd };
  return { url: `git@${acc.host}:${p}.git`, ssh: cmd };
}

// 用户填的仓库地址。也接受从浏览器地址栏复制的网页地址（…/tree/main、?tab=readme 之类）和省略 https:// 的写法
function repoFromUrl(input) {
  let url = String(input || '').trim();
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?\//i.test(url)) url = 'https://' + url;
  if (/^https?:\/\//i.test(url)) url = url.replace(/[?#].*$/, '');
  const r = parseUrl(url);
  if (r.proto !== 'https' && r.proto !== 'ssh') throw new Error('看不懂这个地址：请填 https://… 或 git@…:… 形式的仓库地址');
  let parts = r.rpath.split('/').filter(Boolean);
  if (r.proto === 'https' && !r.viaProxy) {
    if (parts.includes('-')) parts = parts.slice(0, parts.indexOf('-'));  // GitLab 网页：组/项目/-/tree/main
    if (r.nhost === 'github.com' || r.nhost === 'gitee.com') parts = parts.slice(0, 2);  // 这两个站点的仓库固定是两段
  }
  if (parts.length < 2) throw new Error('地址里要有“所有者/仓库名”');
  const rpath = parts.join('/').replace(/\.git$/, '');
  return { proto: r.proto, user: r.user, nhost: r.nhost, rpath, owner: parts[0], repoName: rpath.split('/').pop(), viaProxy: r.viaProxy,
    // 不指定账号时拉取用的地址：HTTPS 去掉用户名、密码和网页后缀；SSH 原样
    plainUrl: r.proto === 'https' && !r.viaProxy ? `https://${r.host}/${rpath}.git` : url };
}

async function rawUrl(p, remote) {
  const r = await git(['config', '--local', '--get', `remote.${remote}.url`], { cwd: p, timeout: 10000 });
  return r.stdout.trim();
}

async function applyChange(p, remote, url, ssh) {
  if (url != null) {
    const r = await git(['remote', 'set-url', remote, url], { cwd: p, timeout: 10000 });
    if (r.code !== 0) throw new Error('修改远程地址失败：' + scrub(r.stderr));
  }
  if (ssh) await git(['config', '--local', 'core.sshCommand', ssh], { cwd: p, timeout: 10000 });
  else await git(['config', '--local', '--unset', 'core.sshCommand'], { cwd: p, timeout: 10000 });
}

function classify(code, err, proto) {
  const e = String(err).toLowerCase();
  if (code === 0) return ['ok', '可以拉取'];
  if (code === 124) return ['network', '连接超时：网络/代理不通'];
  const px = e.match(/failed to connect to (127\.0\.0\.1|localhost|::1) port (\d+)/);
  if (px) return ['proxy', `本机代理没开：连不上 ${px[1]}:${px[2]}（Clash 等代理软件没在运行？）`];
  const rules = [
    [['permission denied (publickey)'], 'auth', 'SSH 密钥没被接受（密钥没加到账号上，或账号没有这个仓库的权限）'],
    [['write access to repository not granted', 'returned error: 403', 'permission to'], 'denied', '无权限（403）：账号/token 的授权里没有这个仓库'],
    [['repository not found', 'returned error: 404', 'does not appear to be a git repository', 'not found'], 'denied', '找不到仓库：仓库不存在、改了名，或当前账号看不到它'],
    [['authentication failed', 'returned error: 401', 'invalid username or', 'terminal prompts disabled', 'could not read username', 'could not read password'], 'auth', '没有可用的凭据：系统密码库里没有这个账号的 token'],
    [['host key verification failed'], 'auth', '第一次连这个服务器，需要先确认指纹（在终端里 ssh 一次）'],
    [['connection closed', 'could not resolve', 'timed out', 'failed to connect', 'connection refused', 'connection reset', 'ssl', 'network is unreachable'], 'network', proto === 'ssh' ? '网络不通：SSH 连不上（22 端口经常被代理拦，可在账号里改用 443 端口）' : '网络不通：连不上服务器，检查网络/代理'],
  ];
  for (const [keys, kind, msg] of rules) if (keys.some(k => e.includes(k))) return [kind, msg];
  return ['error', '失败'];
}

// 只读 helper：git 认证失败时默认会把 token 从密码库删掉（credential reject），测试时绝不能这样
const READONLY_HELPER = '!f() { test "$1" = get && printf "username=%s\\npassword=%s\\n" "$GZ_TEST_USER" "$GZ_TEST_PASS"; }; f';

async function remoteGit(p, info, gitArgs, timeout) {
  const args = ['-c', 'credential.helper='];
  let env = null;
  if (info.proto === 'https' && !info.secretInUrl) {
    const c = await credGet(info.host, info.user);
    if (c) {
      args.push('-c', 'credential.helper=' + READONLY_HELPER);
      env = { GZ_TEST_USER: c.username || info.user || 'git', GZ_TEST_PASS: c.password };
    }
  }
  const go = more => git(args.concat(gitArgs), { cwd: p, timeout, env: Object.assign({}, env, more) });
  let r = await go();
  let [kind, msg] = classify(r.code, r.stderr, info.proto);
  let direct = false;
  if (kind === 'proxy') {
    // 系统设置了代理但代理软件没开：去掉代理直连再试一次
    const d = await go({ HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '', ALL_PROXY: '', all_proxy: '' });
    const [k2, m2] = classify(d.code, d.stderr, info.proto);
    if (k2 !== 'network') { r = d; kind = k2; msg = m2; direct = true; }
  }
  if (kind === 'auth' && env && !/publickey/i.test(r.stderr)) msg = 'token 无效或已过期：密码库里有 token，但服务器不认';
  const lines = scrub(r.stderr).trim().split(/\r?\n/).filter(l => l.trim() && !/^(From |remote: (Counting|Compressing|Enumerating|Total))/.test(l));
  return { r, kind, msg, detail: lines.slice(-4).join('\n'), direct };
}

// 检查更新：git fetch（只更新远程分支信息，不动工作区），顺便知道连不连得上、落后几个提交
async function testRepo(p) {
  const info = await repoInfo(p);
  let result;
  if (!info.exists) result = { kind: 'error', msg: '目录不存在或已不是 Git 项目', detail: '' };
  else if (!info.remote) result = { kind: 'error', msg: '没有配置远程仓库', detail: '' };
  else {
    const res = await remoteGit(p, info, ['fetch', '--prune', info.remote], 120000);
    result = { kind: res.kind, msg: res.kind === 'ok' ? '可以拉取' : res.msg, detail: res.detail };
    if (res.direct) result.msg += '（代理没开，这次是直连的）';
  }
  const after = info.exists ? await repoInfo(p) : info;
  Object.assign(result, { time: Date.now(), ahead: after.ahead, behind: after.behind, dirty: after.dirty, upstream: after.upstream });
  return result;
}

// 拉取：只做快进（fast-forward），有分叉或冲突时不动代码，给出原因
async function pullRepo(p) {
  const info = await repoInfo(p);
  if (!info.exists) throw new Error('目录不存在或已不是 Git 项目');
  if (!info.remote) throw new Error('没有配置远程仓库');
  if (!info.branch) throw new Error('当前不在任何分支上（detached HEAD），请在 Sourcetree 里处理');
  if (!info.upstream) throw new Error(`当前分支 ${info.branch} 没有对应的远程分支，没法拉取`);
  const res = await remoteGit(p, info, ['pull', '--ff-only'], 5 * 60 * 1000);
  if (res.kind !== 'ok') {
    const e = res.r.stderr.toLowerCase();
    let msg = res.msg;
    if (/not possible to fast-forward|diverg/.test(e)) msg = '本地和远程都有新提交（分叉了），不能自动合并。请在 Sourcetree 里拉取并合并';
    else if (/would be overwritten|local changes/.test(e)) msg = '你本地改过的文件和远程的更新冲突了。先提交或暂存（stash）本地改动，再拉取';
    else if (/no tracking information/.test(e)) msg = '当前分支没有对应的远程分支';
    else if (res.kind === 'error') msg = '拉取失败';
    throw new Error(msg + (res.detail ? '\n' + res.detail : ''));
  }
  const after = await repoInfo(p);
  return { pulled: Math.max(0, info.behind - after.behind), result: { kind: 'ok', msg: '可以拉取', detail: '', time: Date.now(),
    ahead: after.ahead, behind: after.behind, dirty: after.dirty, upstream: after.upstream } };
}

// ------------------------------------------------------------------ 识别 token

async function getJson(url, headers) {
  try {
    const res = await Promise.race([
      httpFetch(url, { headers: Object.assign({ 'User-Agent': 'git-zhanghao' }, headers || {}) }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 20000)),
    ]);
    let body = null;
    try { body = await res.json(); } catch (e) { /* 非 JSON */ }
    return { status: res.status, body, headers: res.headers };
  } catch (e) {
    return { status: 0, body: null, error: e.message };
  }
}

async function pages(fn) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fn(page);
    if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) break;
    all.push(...r.body);
    if (r.body.length < 100) break;
  }
  return all;
}

const PROVIDERS = {
  'github.com': async token => {
    const h = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
    const u = await getJson('https://api.github.com/user', h);
    if (u.status !== 200) return { status: u.status, error: u.error || (u.body && u.body.message) };
    const items = await pages(p => getJson(`https://api.github.com/user/repos?per_page=100&page=${p}`, h));
    const kind = token.startsWith('github_pat_') ? '细粒度 token' : token.startsWith('ghp_') ? '经典 token' : token.startsWith('gho_') ? 'OAuth token' : 'token';
    return {
      status: 200, login: u.body.login, name: u.body.name || '', kind,
      expires: (u.headers.get && u.headers.get('github-authentication-token-expiration')) || '',
      repos: items.map(i => ({ name: i.full_name, push: !!(i.permissions && i.permissions.push), private: !!i.private })),
    };
  },
  'gitee.com': async token => {
    const q = encodeURIComponent(token);
    const u = await getJson('https://gitee.com/api/v5/user?access_token=' + q);
    if (u.status !== 200) return { status: u.status, error: u.error || (u.body && u.body.message) };
    const items = await pages(p => getJson(`https://gitee.com/api/v5/user/repos?per_page=100&page=${p}&access_token=${q}`));
    return {
      status: 200, login: u.body.login, name: u.body.name || '', kind: '私人令牌', expires: '',
      repos: items.map(i => ({ name: i.full_name, push: !!(i.permission && i.permission.push), private: !!i.private })),
    };
  },
  'gitlab.com': async token => {
    const h = { 'PRIVATE-TOKEN': token };
    const u = await getJson('https://gitlab.com/api/v4/user', h);
    if (u.status !== 200) return { status: u.status, error: u.error || (u.body && (u.body.message || u.body.error)) };
    const items = await pages(p => getJson(`https://gitlab.com/api/v4/projects?membership=true&simple=false&per_page=100&page=${p}`, h));
    const lvl = i => Math.max(((i.permissions || {}).project_access || {}).access_level || 0, ((i.permissions || {}).group_access || {}).access_level || 0);
    return {
      status: 200, login: u.body.username, name: u.body.name || '', kind: '个人访问令牌', expires: '',
      repos: items.map(i => ({ name: i.path_with_namespace, push: lvl(i) >= 30, private: i.visibility !== 'public' })),
    };
  },
};

function guessHosts(token) {
  if (/^(github_pat_|gh[pousr]_)/.test(token)) return ['github.com'];
  if (/^glpat-/.test(token)) return ['gitlab.com'];
  if (/^[0-9a-f]{32}$/i.test(token)) return ['gitee.com', 'github.com', 'gitlab.com'];
  return ['github.com', 'gitee.com', 'gitlab.com'];
}

// 只给 token：自动识别是哪个站点、哪个账号、能访问哪些仓库（不保存）
async function inspectToken(token, hostHint) {
  token = String(token || '').trim();
  if (!token) throw new Error('请先粘贴 token');
  const hosts = hostHint ? [normHost(hostHint)] : guessHosts(token);
  const errors = [];
  for (const host of hosts) {
    const fn = PROVIDERS[host];
    if (!fn) continue;
    const r = await fn(token);
    if (r.status === 200) {
      const owners = [...new Set(r.repos.map(x => x.name.split('/')[0]))];
      if (!owners.some(o => o.toLowerCase() === r.login.toLowerCase())) owners.unshift(r.login);
      return { host, login: r.login, name: r.name, kind: r.kind, expires: r.expires, repos: r.repos, owners };
    }
    errors.push(r.status === 0 ? `${host}：连不上（${r.error}），检查网络/代理` :
      r.status === 401 ? `${host}：不认这个 token` : `${host}：返回 ${r.status} ${r.error || ''}`);
  }
  throw new Error('没能识别这个 token。\n' + errors.join('\n') +
    (hostHint ? '' : '\n如果是 Coding、阿里云等其它站点的 token，请用“手动添加”。'));
}

function verifyFromInspect(i) {
  let msg = `${i.kind} · 能访问 ${i.repos.length} 个仓库`;
  if (i.expires) msg += ' · 到期 ' + i.expires;
  return { ok: true, login: i.login, msg, repos: i.repos, time: Date.now() };
}

async function verifyAccount(acc) {
  if (acc.auth === 'ssh') {
    const r = await sshIdentify(acc.sshKey, normHost(acc.host));
    if (r.login) {
      return { ok: true, login: r.login, msg: `密钥可用，对应账号 ${r.login}${r.via443 ? '（443 端口）' : ''}`, time: Date.now(),
        warn: r.login.toLowerCase() === acc.username.toLowerCase() ? '' : `这把密钥实际属于 ${r.login}` };
    }
    return { ok: false, msg: r.msg, time: Date.now() };
  }
  const c = await credGet(acc.host, acc.username);
  if (!c) return { ok: false, msg: '系统密码库里没有这个账号的 token，点“编辑 → 更新 token”粘贴一个', time: Date.now() };
  if (!looksLikeToken(c.password)) return { ok: true, info: true, msg: '密码库里存的是登录密码，不是 token，没法在线查权限。用项目的“测试”看能不能拉取即可', time: Date.now() };
  if (!PROVIDERS[normHost(acc.host)]) return { ok: true, info: true, msg: '系统密码库里有 token。这个站点不支持在线查权限，请用项目的“测试”', time: Date.now() };
  try {
    const i = await inspectToken(c.password, acc.host);
    const v = verifyFromInspect(i);
    if (!PLACEHOLDER_USER.test(acc.username) && i.login.toLowerCase() !== acc.username.toLowerCase()) v.warn = `密码库里这个 token 实际属于 ${i.login}`;
    return v;
  } catch (e) {
    return { ok: false, msg: /不认/.test(e.message) ? 'token 无效、已过期或被撤销' : e.message, time: Date.now() };
  }
}

// ------------------------------------------------------------------ 扫描本机：SSH 密钥

const SSH_HOSTS = {
  'github.com': [['github.com', 22], ['ssh.github.com', 443]],
  'gitee.com': [['gitee.com', 22]],
  'gitlab.com': [['gitlab.com', 22], ['altssh.gitlab.com', 443]],
};

async function sshTry(key, host, port) {
  const args = ['-T', '-p', String(port), '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new'];
  if (IS_MAC) args.push('-o', 'UseKeychain=yes');
  args.push('git@' + host);
  const r = await run('ssh', args, { timeout: 20000 });
  const text = (r.stdout + '\n' + r.stderr).trim();
  const m = text.match(/Hi [^\n!]*?\(@([^)\s]+)\)!/) ||   // Gitee：Hi 名字(@login)!
    text.match(/Hi ([^!\s]+)!/) ||                          // GitHub：Hi login!
    text.match(/Welcome to GitLab, @?([^!\s]+)!/);          // GitLab
  if (m) return { login: m[1] };
  const [kind, msg] = classify(r.code, text, 'ssh');
  return { kind, msg };
}

async function sshIdentify(key, host) {
  const tries = SSH_HOSTS[host] || [[host, 22]];
  let last = { msg: '未知错误' };
  for (const [h, port] of tries) {
    const r = await sshTry(key, h, port);
    if (r.login) return { login: r.login, via443: port === 443 };
    last = r;
    if (r.kind === 'auth') break;  // 服务器连上了但不认这把钥匙，换端口也没用
  }
  return { msg: last.msg };
}

async function listSshKeys() {
  let names = [];
  try { names = fs.readdirSync(SSH_DIR); } catch (e) { return []; }
  const keys = [];
  for (const n of names) {
    const full = path.join(SSH_DIR, n);
    if (n.endsWith('.pub') || /^(known_hosts|config|authorized_keys|environment)/.test(n)) continue;
    let head = '';
    try {
      if (!fs.statSync(full).isFile() || fs.statSync(full).size > 20000) continue;
      head = fs.readFileSync(full, 'utf8').slice(0, 200);
    } catch (e) { continue; }
    if (!/PRIVATE KEY-----/.test(head)) continue;
    let type = '', comment = '', body = '';
    try {
      const pub = fs.readFileSync(full + '.pub', 'utf8').trim().split(/\s+/);
      type = (pub[0] || '').replace(/^ssh-/, '');
      body = pub[1] || '';
      comment = pub.slice(2).join(' ');
    } catch (e) { /* 没有 .pub */ }
    const enc = await run('ssh-keygen', ['-y', '-P', '', '-f', full], { timeout: 10000 });
    keys.push({ path: full, file: n, type, comment, body, encrypted: enc.code !== 0 });
  }
  return keys;
}

// SSH 连不上时的兜底：GitHub 公开了每个用户的公钥（https://github.com/用户名.keys），拿本机公钥去比对
async function matchGithubKeysByApi(keys, candidates) {
  const todo = keys.filter(k => k.body && !k.matches.some(m => m.host === 'github.com'));
  if (!todo.length || !candidates.length) return;
  await Promise.all(candidates.slice(0, 30).map(async user => {
    let text = '';
    try {
      const res = await Promise.race([httpFetch(`https://github.com/${encodeURIComponent(user)}.keys`, { headers: { 'User-Agent': 'git-zhanghao' } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 15000))]);
      if (res.status === 200) text = await res.text();
    } catch (e) { return; }
    const bodies = new Set(text.split(/\r?\n/).map(l => l.trim().split(/\s+/)[1]).filter(Boolean));
    for (const k of todo) {
      if (bodies.has(k.body) && !k.matches.some(m => m.host === 'github.com')) {
        k.matches.push({ host: 'github.com', login: user, via443: false, byPubkey: true });
        k.errors = (k.errors || []).filter(e => !e.startsWith('github.com'));
      }
    }
  }));
}

async function scanSshKeys(hosts, githubUsers) {
  const keys = await listSshKeys();
  const targets = [...new Set(['github.com', 'gitee.com', ...(hosts || [])].map(normHost))].filter(h => SSH_HOSTS[h] || hosts.includes(h));
  await Promise.all(keys.map(async k => {
    k.matches = [];
    const results = await Promise.all(targets.map(h => sshIdentify(k.path, h).then(r => [h, r])));
    for (const [h, r] of results) {
      if (r.login) k.matches.push({ host: h, login: r.login, via443: r.via443 });
      else if (/网络|超时/.test(r.msg)) (k.errors = k.errors || []).push(`${h}：${r.msg}`);
    }
  }));
  await matchGithubKeysByApi(keys, githubUsers || []);
  keys.forEach(k => { delete k.body; });
  return keys;
}

// ------------------------------------------------------------------ 扫描本机：系统密码库里已存的 Git 账号

async function scanStoredCreds(extraHosts) {
  const wanted = new Set(GIT_HOSTS.concat(extraHosts || []).map(normHost));
  const found = [];
  if (IS_MAC) {
    const r = await run('security', ['dump-keychain'], { timeout: 30000 });  // 不带 -d：只读条目名，不读密码，不会弹窗
    for (const block of r.stdout.split(/\n(?=keychain: )/)) {
      if (!/class: "inet"/.test(block)) continue;
      const srvr = (block.match(/"srvr"<blob>="([^"]*)"/) || [])[1];
      const acct = (block.match(/"acct"<blob>="([^"]*)"/) || [])[1];
      if (srvr && acct && wanted.has(normHost(srvr))) found.push({ host: srvr.toLowerCase(), user: acct });
    }
  } else if (IS_WIN) {
    // cmdkey 按控制台代码页输出（中文系统是 GBK），先切到 UTF-8 再读。
    // 标签随系统语言变（User / 用户 / …），所以按位置取：每条凭据依次是 目标、类型、用户（没有用户名时没这行）
    const r = await run('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 >nul & cmdkey /list'], { timeout: 30000 });
    for (const block of r.stdout.split(/\r?\n[ \t]*\r?\n/)) {
      const t = block.match(/target=git:https?:\/\/(?:([^@/\s]+)@)?([^/\s]+)/i);
      if (!t || !wanted.has(normHost(t[2]))) continue;
      const vals = block.split(/\r?\n/).map(l => (l.match(/^[^:：]+[:：]\s*(.*?)\s*$/) || [])[1]).filter(v => v != null);
      // 同一站点的第二个账号，GCM 起目标名时会把用户名里的 @ 换成 _，所以优先用“用户”那一行
      found.push({ host: t[2].toLowerCase(), user: vals[2] || t[1] || '' });
    }
  }
  const seen = new Set();
  const list = found.filter(f => {
    const k = f.host + '|' + f.user.toLowerCase();
    if (seen.has(k) || !f.user || f.user === 'PersonalAccessToken') return false;
    seen.add(k);
    return true;
  });
  if (!IS_WIN) return list;
  // 用 git 读一次确认：读不出来的不能当成账号，不然每次同步都会加了又删
  const ok = await Promise.all(list.map(f => credGet(f.host, f.user)));
  return list.filter((f, i) => ok[i]);
}

// ------------------------------------------------------------------ 对外接口

const newId = () => crypto.randomBytes(4).toString('hex');
const findAcc = (c, id) => c.accounts.find(a => a.id === id);

async function accountView(a) {
  const v = Object.assign({}, a);
  if (a.auth === 'token') {
    const c = await credGet(a.host, a.username);
    v.hasToken = !!c;
    v.secretKind = c && !looksLikeToken(c.password) ? 'password' : 'token';
    v.tokenMask = c ? maskSecret(c.password) : '';
  } else {
    v.hasToken = fs.existsSync(a.sshKey || '');
    v.tokenMask = '';
  }
  return v;
}

async function allRepos(c) {
  const infos = await Promise.all(c.repos.map(repoInfo));
  return infos.map(i => Object.assign(annotate(i, c.accounts), { test: c.tests[i.path] || null }));
}

// Sourcetree 装在哪（没装返回空）
function findSourcetree() {
  const c = IS_MAC ? ['/Applications/Sourcetree.app', path.join(HOME, 'Applications', 'Sourcetree.app')]
    : IS_WIN ? [path.join(process.env.LOCALAPPDATA || '', 'SourceTree', 'SourceTree.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Atlassian', 'Sourcetree', 'SourceTree.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Atlassian', 'Sourcetree', 'SourceTree.exe')]
    : [];
  return c.find(p => p && fs.existsSync(p)) || '';
}

// JetBrains IDE 默认用 `git -c credential.helper= …` 跑 git，绕过系统密码库，推送时会弹 “Log In to GitHub”。
// 只有 Settings → Version Control → Git 勾了 “Use credential helper”（git.xml 里的 USE_CREDENTIAL_HELPER）才会用到本工具存的 token。
// 只读，不改 IDE 配置；每个产品只看最新版本的配置目录（旧版本目录升级后还留着）
const IDE_NAMES = { IdeaIC: 'IntelliJ IDEA CE', IntelliJIdea: 'IntelliJ IDEA', PyCharmCE: 'PyCharm CE', AndroidStudio: 'Android Studio' };
function jetbrainsIdes() {
  const base = IS_WIN ? process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
    : IS_MAC ? path.join(HOME, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
  const latest = {};
  for (const vendor of ['JetBrains', 'Google']) {
    let names = [];
    try { names = fs.readdirSync(path.join(base, vendor)); } catch (e) { continue; }
    for (const n of names) {
      const m = /^([A-Za-z]+?)(\d{4})\.(\d+)$/.exec(n);
      if (!m || /^JetBrains(Client|Gateway)$/.test(m[1]) || (vendor === 'Google') !== m[1].startsWith('AndroidStudio')) continue;
      const dir = path.join(base, vendor, n, 'options');
      const ver = +m[2] * 100 + +m[3];
      if (fs.existsSync(dir) && (!latest[m[1]] || latest[m[1]].ver < ver)) latest[m[1]] = { product: m[1], version: m[2] + '.' + m[3], ver, dir };
    }
  }
  return Object.values(latest).map(x => {
    const file = path.join(x.dir, 'git.xml');
    let xml = '';
    try { xml = fs.readFileSync(file, 'utf8'); } catch (e) { /* 没有 git.xml = 没开 */ }
    return { name: (IDE_NAMES[x.product] || x.product) + ' ' + x.version, file,
      helper: /<option\s+name="USE_CREDENTIAL_HELPER"\s+value="true"/.test(xml) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function sysInfo() {
  const [ver, helper] = await Promise.all([
    git(['--version'], { timeout: 10000 }),
    git(['config', '--get-all', 'credential.helper'], { timeout: 10000 }),
  ]);
  return {
    platform: IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : process.platform,
    gitVersion: ver.code === 0 ? ver.stdout.trim() : '', gitMissing: ver.code !== 0,
    helper: helper.stdout.split(/\s+/).filter(Boolean).join(', '),
    proxy: extraEnv.HTTPS_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || '',
    home: HOME,
    docs: docsDir && fs.existsSync(docsDir) ? docsDir : '',
    sourcetree: findSourcetree(),
    ides: jetbrainsIdes(),
    confPath,
  };
}

async function state() {
  const c = loadConf();
  const [accounts, repos, sys] = await Promise.all([Promise.all(c.accounts.map(accountView)), allRepos(c), sysInfo()]);
  // 本机还没对应到任何账号的 SSH 密钥
  const localKeys = (c.localKeys || []).filter(k => fs.existsSync(k.path) && !c.accounts.some(a => a.auth === 'ssh' && samePath(a.sshKey, k.path)));
  return { accounts, repos, history: c.history.slice(-100).reverse(), sys, localKeys, lastSync: c.lastSync || 0,
    cloneDir: c.cloneDir && fs.existsSync(c.cloneDir) ? c.cloneDir : '' };
}

// 账号的“身份”：站点 + 用户名 + 方式（SSH 再加密钥文件）。用户删掉的自动识别账号按这个记下来，不再自动加回
const accSig = a => [normHost(a.host), String(a.username).toLowerCase(), a.auth, a.auth === 'ssh' ? path.normalize(a.sshKey || '') : ''].join('|');
function unignore(c) { delete c.ignored; }  // 兼容旧配置

// 把私钥和公钥一起移到废纸篓，并去掉用这把密钥的所有账号
async function trashKey(keyPath) {
  for (const f of [keyPath, keyPath + '.pub']) {
    if (fs.existsSync(f)) {
      try { await trashItem(f); } catch (e) { throw new Error(`没能把 ${path.basename(f)} 移到${IS_WIN ? '回收站' : '废纸篓'}：${e.message}`); }
    }
  }
  await withConf(c => {
    c.accounts = c.accounts.filter(x => !(x.auth === 'ssh' && samePath(x.sshKey, keyPath)));
    c.localKeys = (c.localKeys || []).filter(k => !samePath(k.path, keyPath));
  });
}

// 只在没有时新建，已有的账号不动
function ensureAccount(c, fields) {
  const a = c.accounts.find(x => accSig(x) === accSig(fields));
  if (a) return { acc: a, isNew: false };
  const acc = Object.assign({ id: newId(), label: '', owners: PLACEHOLDER_USER.test(fields.username) ? [] : [fields.username], auto: true }, fields);
  c.accounts.push(acc);
  return { acc, isNew: true };
}

// ------------------------------------------------------------------ SSH 公钥：读取 / 上传到网站

async function readPub(keyPath) {
  let pub = '';
  try { pub = fs.readFileSync(keyPath + '.pub', 'utf8').trim(); } catch (e) { /* 没有 .pub，从私钥推出来 */ }
  if (!pub) {
    const r = await run('ssh-keygen', ['-y', '-P', '', '-f', keyPath], { timeout: 10000 });
    if (r.code !== 0) throw new Error('这把密钥没有 .pub 公钥文件，而且私钥有密码保护，没法直接推出公钥。可以在终端运行：ssh-keygen -y -f ' + keyPath);
    pub = r.stdout.trim();
  }
  return pub;
}

async function sendJson(url, { headers = {}, body = {}, form = false } = {}) {
  try {
    const h = Object.assign({ 'User-Agent': 'git-zhanghao' }, headers,
      { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' });
    const res = await Promise.race([
      httpFetch(url, { method: 'POST', headers: h, body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 20000)),
    ]);
    let b = null;
    try { b = await res.json(); } catch (e) { /* 非 JSON */ }
    return { status: res.status, body: b };
  } catch (e) {
    return { status: 0, body: null, error: e.message };
  }
}

const errText = r => r.error || (r.body ? (r.body.message || r.body.error || '') + (r.body.errors ? ' ' + JSON.stringify(r.body.errors) : '') : '');

const KEY_UPLOAD = {
  'github.com': async (token, title, key) => {
    const r = await sendJson('https://api.github.com/user/keys', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, body: { title, key } });
    if (r.status === 201) return { ok: true };
    if (r.status === 422 && /already in use/i.test(errText(r))) return { ok: true, existed: true };
    if ([401, 403, 404].includes(r.status)) return { ok: false, msg: 'token 无效，或者没有“管理 SSH 密钥”的权限。经典 token 要勾 admin:public_key；细粒度 token 要在 Account permissions 里把 Git SSH keys 设为 Read and write' };
    return { ok: false, msg: `GitHub 返回 ${r.status || '连不上'}：${errText(r)}` };
  },
  'gitee.com': async (token, title, key) => {
    const r = await sendJson('https://gitee.com/api/v5/user/keys', { form: true, body: { access_token: token, key, title } });
    if (r.status === 201 || r.status === 200) return { ok: true };
    if (/已经存在|已存在|already|taken/i.test(errText(r))) return { ok: true, existed: true };
    if ([401, 403].includes(r.status)) return { ok: false, msg: '令牌无效，或者没有 keys 权限：到 Gitee「设置 → 私人令牌」里确认令牌还在、并勾上 keys 后再试' };
    return { ok: false, msg: `Gitee 返回 ${r.status || '连不上'}：${errText(r)}` };
  },
  'gitlab.com': async (token, title, key) => {
    const r = await sendJson('https://gitlab.com/api/v4/user/keys', { headers: { 'PRIVATE-TOKEN': token }, body: { title, key } });
    if (r.status === 201) return { ok: true };
    if (/taken/i.test(errText(r))) return { ok: true, existed: true };
    if ([401, 403].includes(r.status)) return { ok: false, msg: '这个 token 没有 api 权限，没法上传 SSH 公钥' };
    return { ok: false, msg: `GitLab 返回 ${r.status || '连不上'}：${errText(r)}` };
  },
};

const defaultKeyTitle = () => `Git账号管家 · ${os.hostname().replace(/\.local$/, '')} · ${new Date().toISOString().slice(0, 10)}`;

// 用 token 账号把公钥登记到网站，成功后登记成 SSH 账号
async function uploadKeyFor(accountId, keyPath, title) {
  const acc = findAcc(loadConf(), accountId);
  if (!acc || acc.auth !== 'token') throw new Error('请选择一个 token 账号来上传');
  const host = normHost(acc.host);
  if (!KEY_UPLOAD[host]) throw new Error(`${host} 不支持自动上传，请复制公钥到网站上手动添加`);
  const c = await credGet(acc.host, acc.username);
  if (!c || !looksLikeToken(c.password)) throw new Error('这个账号存的不是 token（可能是登录密码），没法自动上传。请先粘贴一个 token 添加账号');
  const pub = await readPub(keyPath);
  const up = await KEY_UPLOAD[host](c.password, title || defaultKeyTitle(), pub);
  if (!up.ok) return { uploaded: false, msg: up.msg, pub, keyPath };
  // 实测一次：确认网站已经认这把钥匙
  const id = await sshIdentify(keyPath, host);
  const login = id.login || loginOf(acc);
  await withConf(cf => {
    const fields = { host, username: login, auth: 'ssh', sshKey: keyPath, ssh443: !!id.via443 };
    unignore(cf, fields);
    const r = ensureAccount(cf, fields);
    r.acc.auto = false;
    r.acc.verify = id.login ? { ok: true, login, msg: `密钥可用，对应账号 ${login}${id.via443 ? '（443 端口）' : ''}`, time: Date.now() }
      : { ok: false, msg: '公钥已经登记到网站，但 SSH 测试没连上：' + id.msg, time: Date.now() };
  });
  return { uploaded: true, existed: !!up.existed, verified: !!id.login, login, msg: id.login ? '' : id.msg, pub, keyPath };
}

function upsertAccount(c, fields) {
  let a = c.accounts.find(x => normHost(x.host) === normHost(fields.host) && x.auth === fields.auth &&
    x.username.toLowerCase() === fields.username.toLowerCase() && (x.auth !== 'ssh' || samePath(x.sshKey, fields.sshKey)));
  const isNew = !a;
  if (isNew) { a = { id: newId(), label: '', owners: [] }; c.accounts.push(a); }
  const owners = new Set((a.owners || []).concat(fields.owners || []));
  Object.assign(a, fields, { owners: [...owners] });
  return { acc: a, isNew };
}

const api = {
  state,

  async addRepos({ paths }) {
    const found = [];
    for (const p of paths || []) {
      if (!p) continue;
      let st;
      try { st = fs.statSync(p); } catch (e) { continue; }
      const dir = st.isDirectory() ? p : path.dirname(p);
      if (isRepo(dir)) found.push(dir); else findReposIn(dir).forEach(x => found.push(x));
    }
    const added = await withConf(c => {
      const have = new Set(c.repos.map(x => path.normalize(x)));
      const add = [...new Set(found.map(x => path.normalize(x)))].filter(x => !have.has(x));
      c.repos.push(...add);
      c.repos.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      return add;
    });
    return { added, found: found.length, state: await state() };
  },

  async removeRepo({ path: p }) {
    await withConf(c => { c.repos = c.repos.filter(x => x !== p); delete c.tests[p]; });
    return state();
  },

  async testRepo({ path: p }) {
    const res = await testRepo(p);
    await withConf(c => { if (c.repos.includes(p)) c.tests[p] = res; });
    return res;
  },

  async pullRepo({ path: p }) {
    if (!loadConf().repos.includes(p)) throw new Error('不认识这个项目');
    const r = await pullRepo(p);
    await withConf(c => { c.tests[p] = r.result; });
    return r;
  },

  async bindRepo({ path: p, accountId, dryRun }) {
    const c = loadConf();
    if (!c.repos.includes(p)) throw new Error('不认识这个项目');
    const info = annotate(await repoInfo(p), c.accounts);
    const acc = accountId ? findAcc(c, accountId) : null;
    if (accountId && !acc) throw new Error('账号不存在');
    const plan = planBind(info, acc);
    const oldUrl = await rawUrl(p, info.remote);
    const preview = { oldUrl: maskUrl(oldUrl), newUrl: maskUrl(plan.url == null ? oldUrl : plan.url),
      oldSsh: info.sshCommand, newSsh: plan.ssh, note: info.secretInUrl && plan.url != null ? '旧地址里的明文密码会被去掉' : '' };
    if (dryRun) return preview;
    await applyChange(p, info.remote, plan.url, plan.ssh);
    await withConf(c2 => {
      c2.history.push({ time: Date.now(), path: p, remote: info.remote,
        oldUrl: info.secretInUrl ? maskUrl(oldUrl) : oldUrl, newUrl: plan.url == null ? oldUrl : plan.url,
        oldSsh: info.sshCommand, newSsh: plan.ssh, account: acc ? `${loginOf(acc)} @ ${acc.host}` : '不指定' });
      c2.history = c2.history.slice(-300);
      delete c2.tests[p];
    });
    return state();
  },

  async undo({ index }) {
    return withConf(async c => {
      const h = c.history[c.history.length - 1 - index];
      if (!h) throw new Error('找不到这条记录');
      if (h.kind === 'clone') throw new Error('这是新拉取的项目，没有可以撤销的地址改动');
      if (h.oldUrl.includes('***')) throw new Error('旧地址里含有密码，出于安全没有保存，无法撤销');
      await applyChange(h.path, h.remote, h.oldUrl, h.oldSsh);
      c.history.push({ time: Date.now(), path: h.path, remote: h.remote, oldUrl: h.newUrl, newUrl: h.oldUrl,
        oldSsh: h.newSsh, newSsh: h.oldSsh, account: '撤销' });
      delete c.tests[h.path];
    }).then(state);
  },

  inspectToken: ({ token, host }) => inspectToken(token, host),

  // 只填 token：识别后存进系统密码库并登记账号
  async addToken({ token, host }) {
    const i = await inspectToken(token, host);
    await credStore(i.host, i.login, String(token).trim());
    const r = await withConf(c => { unignore(c, { host: i.host, username: i.login, auth: 'token' }); return upsertAccount(c, { host: i.host, username: i.login, auth: 'token', owners: i.owners, verify: verifyFromInspect(i), auto: false }); });
    return { account: { username: i.login, host: i.host }, isNew: r.isNew, state: await state() };
  },

  // 手动添加：其它站点，或想指定用户名
  async addManual({ host, username, token, auth, sshKey, ssh443 }) {
    host = String(host || '').trim().toLowerCase();
    username = String(username || '').trim();
    if (!host || !username) throw new Error('站点和用户名都要填');
    if (auth === 'ssh' && !fs.existsSync(sshKey || '')) throw new Error('找不到密钥文件');
    if (auth !== 'ssh') {
      if (token) await credStore(host, username, String(token).trim());
      else if (!(await credGet(host, username))) throw new Error('请填写 token 或密码：账号要真正存进本机系统密码库才算添加');
    }
    await withConf(c => {
      const f = { host, username, auth: auth === 'ssh' ? 'ssh' : 'token', sshKey: auth === 'ssh' ? sshKey : '', ssh443: auth === 'ssh' && !!ssh443, owners: [username], auto: false };
      unignore(c, f);
      upsertAccount(c, f);
    });
    return state();
  },

  async addSsh({ sshKey, host, login, via443, byPubkey }) {
    const msg = byPubkey ? `公钥比对确认属于 ${login}（SSH 暂时连不上，还没实测）` : `密钥可用，对应账号 ${login}${via443 ? '（443 端口）' : ''}`;
    await withConf(c => upsertAccount(c, { host, username: login, auth: 'ssh', sshKey, ssh443: !!via443, owners: [login],
      verify: { ok: true, login, msg, time: Date.now() } }));
    return state();
  },

  async addStored({ host, user }) {
    const r = await withConf(c => upsertAccount(c, { host, username: user, auth: 'token', owners: [user] }).acc.id);
    return api.verifyAccount({ id: r });
  },

  async updateAccount({ id, label, owners, ssh443, token }) {
    const c = loadConf();
    const a = findAcc(c, id);
    if (!a) throw new Error('账号不存在');
    let verify = null;
    if (token && a.auth === 'token') {
      const i = await inspectToken(token, PROVIDERS[normHost(a.host)] ? a.host : null).catch(e => {
        if (!PROVIDERS[normHost(a.host)]) return null;
        throw e;
      });
      // 占位用户名（x-access-token 等）还没验证出真实账号时，不知道该属于谁，不拦
      const want = loginOf(a);
      if (i && !PLACEHOLDER_USER.test(want) && i.login.toLowerCase() !== want.toLowerCase()) throw new Error(`这个 token 属于 ${i.login}，不是 ${want}。请用“添加账号”单独添加`);
      await credStore(a.host, a.username, String(token).trim());
      if (i) verify = verifyFromInspect(i);
    }
    await withConf(c2 => {
      const x = findAcc(c2, id);
      x.label = String(label || '').trim();
      x.owners = String(owners || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
      if (!x.owners.length) x.owners = [loginOf(x)];
      if (x.auth === 'ssh') x.ssh443 = !!ssh443;
      if (verify) x.verify = verify;
    });
    return state();
  },

  // 点击查看原文：从系统密码库读出这个账号存的 token / 密码
  async revealSecret({ id }) {
    const a = findAcc(loadConf(), id);
    if (!a) throw new Error('账号不存在');
    if (a.auth !== 'token') throw new Error('SSH 账号用的是密钥文件，没有存密码');
    const c = await credGet(a.host, a.username);
    if (!c) throw new Error('系统密码库里没有这个账号的凭据');
    return { secret: c.password, kind: looksLikeToken(c.password) ? 'token' : 'password' };
  },

  // SSH 账号：显示公钥（贴到 GitHub/Gitee 的 SSH 设置里用的那段）
  async publicKey({ id, path: keyPath }) {
    if (id) {
      const a = findAcc(loadConf(), id);
      if (!a) throw new Error('账号不存在');
      if (a.auth !== 'ssh') throw new Error('这个账号不是 SSH 账号');
      keyPath = a.sshKey;
    } else if (!keyPath || path.dirname(path.resolve(keyPath)) !== path.resolve(SSH_DIR)) {
      throw new Error('只能查看 ~/.ssh 里的密钥');
    }
    if (!fs.existsSync(keyPath || '')) throw new Error('找不到密钥文件：' + keyPath);
    const pub = await readPub(keyPath);
    const fp = await run('ssh-keygen', ['-lf', '-'], { input: pub + '\n', timeout: 10000 });
    return { pub, fingerprint: fp.code === 0 ? fp.stdout.trim() : '', keyPath, pubPath: fs.existsSync(keyPath + '.pub') ? keyPath + '.pub' : '' };
  },

  // 生成一对新的 SSH 密钥；选了 token 账号就顺便登记到网站
  async generateKey({ host, accountId, name, title }) {
    host = normHost(host || 'github.com');
    name = String(name || '').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('文件名只能用英文字母、数字、点、下划线和横线');
    const keyPath = path.join(SSH_DIR, name);
    if (fs.existsSync(keyPath) || fs.existsSync(keyPath + '.pub')) throw new Error(`~/.ssh 里已经有 ${name} 了，换个文件名`);
    fs.mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
    const acc = accountId ? findAcc(loadConf(), accountId) : null;
    const comment = `${acc ? loginOf(acc).replace(/[^\x21-\x7e]/g, '') + '@' : ''}${host} git-zhanghao ${os.hostname().replace(/\.local$/, '').replace(/[^\x21-\x7e]/g, '')}`;
    const g = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-C', comment, '-f', keyPath, '-N', ''], { timeout: 20000 });
    if (g.code !== 0 || !fs.existsSync(keyPath)) throw new Error('生成密钥失败：' + (g.stderr || g.stdout).trim());
    await withConf(c => {
      c.localKeys = (c.localKeys || []).concat([{ path: keyPath, file: name, type: 'ed25519', comment, encrypted: false, matched: false }]);
    });
    if (!accountId) return { generated: true, uploaded: false, pub: await readPub(keyPath), keyPath, host, state: await state() };
    const r = await uploadKeyFor(accountId, keyPath, title);
    return Object.assign(r, { generated: true, host, state: await state() });
  },

  // 本机已有的密钥：用 token 账号登记到网站
  async uploadKey({ path: keyPath, accountId, title }) {
    if (!keyPath || path.dirname(path.resolve(keyPath)) !== path.resolve(SSH_DIR)) throw new Error('只能上传 ~/.ssh 里的密钥');
    const r = await uploadKeyFor(accountId, keyPath, title);
    return Object.assign(r, { state: await state() });
  },

  // 拉取对话框里边填边解析：认出站点和仓库，推荐一个账号
  parseRepoUrl({ url }) {
    const u = repoFromUrl(url);
    const a = annotate(Object.assign({ sshKey: '' }, u), loadConf().accounts);
    return { host: u.nhost, repo: u.rpath, name: u.repoName, proto: u.proto, suggestId: a.boundId || a.suggestId };
  },

  // 把仓库拉到本地，并加进项目列表（已经按选的账号配好）。
  // 从账号的仓库列表点进来时给 repo（所有者/仓库名）；在项目页填地址时给 url，这时可以不选账号（只能拉公开仓库）
  async cloneRepo({ accountId, repo, url, parent, name }) {
    const acc = accountId ? findAcc(loadConf(), accountId) : null;
    if (accountId && !acc) throw new Error('账号不存在');
    const u = url ? repoFromUrl(url) : null;
    if (u) {
      repo = u.rpath;
      if (acc && normHost(acc.host) !== u.nhost) throw new Error(`这个账号是 ${acc.host} 的，地址是 ${u.nhost} 的，对不上`);
    } else if (!acc) throw new Error('请选择账号');
    repo = String(repo || '').replace(/^\/+|\.git$/g, '');
    if (!/^[^/\s]+\/[^\s]+$/.test(repo)) throw new Error('仓库名应该是“所有者/仓库名”的形式');
    name = String(name || '').trim();
    if (!name || /[\\/:*?"<>|]/.test(name)) throw new Error('文件夹名不能为空，也不能含 \\ / : * ? " < > |');
    if (!parent || !fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error('保存位置不存在：' + parent);
    const dest = path.join(parent, name);
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error('目标文件夹已经存在而且不是空的：' + dest);
    const plan = acc ? planBind({ proto: 'https', host: normHost(acc.host), rpath: repo, viaProxy: false, owner: repo.split('/')[0] }, acc)
      : { url: u.plainUrl, ssh: '' };
    const proto = acc ? (acc.auth === 'ssh' ? 'ssh' : 'https') : u.proto;
    const args = [], extra = {}, clone = ['clone', '--progress'];
    if (acc && acc.auth === 'token') {
      // 和“测试”一样只读地交出 token：失败时 git 不会把它从密码库删掉
      const c = await credGet(acc.host, acc.username);
      if (!c) throw new Error('系统密码库里没有这个账号的 token');
      args.push('-c', 'credential.helper=', '-c', 'credential.helper=' + READONLY_HELPER);
      Object.assign(extra, { GZ_TEST_USER: acc.username, GZ_TEST_PASS: c.password });
    } else if (acc) {
      clone.push('--config', 'core.sshCommand=' + plan.ssh);
    } else if (proto === 'https') {
      args.push('-c', 'credential.helper=');  // 不指定账号：不碰系统密码库（认证失败时 git 会把里面的凭据删掉）
    }
    const r = await git(args.concat(clone, [plan.url, dest]), { cwd: parent, timeout: 30 * 60 * 1000, env: extra });
    if (r.code !== 0) {
      let [kind, msg] = classify(r.code, r.stderr, proto);
      if (!acc && kind === 'auth' && proto === 'https') msg = '这个仓库需要登录（或者地址不对）：请选一个能访问它的账号再拉取';
      const last = scrub(r.stderr).trim().split(/\r?\n/).filter(l => l.trim() && !/^(Cloning|remote: (Counting|Compressing|Enumerating|Total))/.test(l)).slice(-2).join('\n');
      throw new Error('拉取失败：' + msg + (last ? '\n' + last : ''));
    }
    await withConf(c => {
      if (!c.repos.includes(dest)) c.repos.push(dest);
      c.repos.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      c.cloneDir = parent;
      c.history.push({ time: Date.now(), path: dest, remote: 'origin', oldUrl: '（新拉取）', newUrl: plan.url, oldSsh: '', newSsh: plan.ssh,
        account: acc ? `${loginOf(acc)} @ ${acc.host}` : '不指定', kind: 'clone' });
    });
    return { path: dest, state: await state() };
  },

  // 打开软件时自动同步本机账号：钥匙串里存过的 Git 账号 + ~/.ssh 里能识别出主人的密钥
  async autoSync() {
    const { keys, stored } = await api.scanLocal();
    // 工具里有、本机已经没有的账号（在工具外面删掉了）
    const before = loadConf().accounts;
    const gone = new Set();
    await Promise.all(before.map(async a => {
      const exists = a.auth === 'ssh' ? fs.existsSync(a.sshKey || '') : !!(await credGet(a.host, a.username));
      if (!exists) gone.add(a.id);
    }));
    const added = [];
    await withConf(c => {
      delete c.ignored;  // 旧版本“只从工具里删”的记录，完全同步后不再需要
      const removed = c.accounts.filter(a => gone.has(a.id));
      c.accounts = c.accounts.filter(a => !gone.has(a.id));
      c.lastRemoved = removed.map(a => `${a.username} @ ${a.host}`);
      for (const s of stored) {
        const f = { host: normHost(s.host), username: s.user, auth: 'token' };
        const r = ensureAccount(c, f);
        if (r.isNew) added.push(r.acc.id);
      }
      for (const k of keys) {
        for (const m of k.matches) {
          const f = { host: m.host, username: m.login, auth: 'ssh', sshKey: k.path, ssh443: !!m.via443 };
          const r = ensureAccount(c, f);
          if (r.isNew) {
            r.acc.verify = { ok: true, login: m.login, time: Date.now(),
              msg: m.byPubkey ? `公钥比对确认属于 ${m.login}（SSH 暂时连不上，还没实测）` : `密钥可用，对应账号 ${m.login}${m.via443 ? '（443 端口）' : ''}` };
            added.push(r.acc.id);
          }
        }
      }
      c.localKeys = keys.map(k => ({ path: k.path, file: k.file, type: k.type, comment: k.comment, encrypted: k.encrypted,
        matched: k.matches.length > 0, errors: k.errors || [] }));
      c.lastSync = Date.now();
    });
    return { added, removed: [...gone].length, state: await state() };
  },

  // 删除账号 = 本机也删：token 从系统密码库删除；SSH 密钥文件移到废纸篓
  async deleteAccount({ id }) {
    const a = findAcc(loadConf(), id);
    if (!a) return state();
    if (a.auth === 'token') {
      // Windows 的 GCM 可能给同一个账号存了好几条（目标名带 / 不带用户名），一次只删一条
      let left = true;
      for (let i = 0; i < 5 && left; i++) {
        await credErase(a.host, a.username);
        left = !!(await credGet(a.host, a.username));
      }
      if (left) throw new Error(`没能从系统密码库删掉这条凭据，请在${IS_WIN ? '“凭据管理器 → Windows 凭据”' : '“钥匙串访问”'}里搜索 ${a.host} 手动删除`);
      await withConf(c => { c.accounts = c.accounts.filter(x => x.id !== id); });
    } else {
      await trashKey(a.sshKey);
    }
    return state();
  },

  // 本机还没对应到账号的密钥：也可以直接删（移到废纸篓）
  async deleteLocalKey({ path: keyPath }) {
    if (!keyPath || path.dirname(path.resolve(keyPath)) !== path.resolve(SSH_DIR)) throw new Error('只能删除 ~/.ssh 里的密钥');
    await trashKey(keyPath);
    return state();
  },

  async verifyAccount({ id }) {
    const a = findAcc(loadConf(), id);
    if (!a) throw new Error('账号不存在');
    const v = await verifyAccount(a);
    await withConf(c => {
      const x = findAcc(c, id);
      if (!x) return;
      x.verify = v;
      if (v.ok && v.repos) x.owners = [...new Set((x.owners || []).concat(v.repos.map(r => r.name.split('/')[0])))].filter(o => !PLACEHOLDER_USER.test(o));
    });
    return state();
  },

  async scanLocal() {
    const c = loadConf();
    const infos = await Promise.all(c.repos.map(repoInfo));
    const repoHosts = infos.map(r => r.nhost).filter(Boolean);
    const stored = await scanStoredCreds(repoHosts.concat(c.accounts.map(a => normHost(a.host))));
    // 可能的 GitHub 用户名：已登记的账号、密码库里存过的账号、项目的所有者
    const ghUsers = [...new Set([
      ...c.accounts.filter(a => normHost(a.host) === 'github.com').map(loginOf),
      ...stored.filter(s => normHost(s.host) === 'github.com').map(s => s.user),
      ...infos.filter(r => r.nhost === 'github.com' && r.owner).map(r => r.owner),
    ].filter(u => /^[A-Za-z0-9-]+$/.test(u)))];
    const keys = await scanSshKeys(repoHosts.filter(h => SSH_HOSTS[h]), ghUsers);
    return { keys, stored };
  },

  exportData() {
    const c = loadConf();
    return { app: 'git-zhanghao', version: 2, exportedAt: Date.now(),
      accounts: c.accounts.map(a => ({ host: a.host, username: a.username, auth: a.auth, label: a.label, owners: a.owners,
        sshKey: a.sshKey ? path.basename(a.sshKey) : '', ssh443: !!a.ssh443 })) };
  },

  async importData({ data }) {
    let n = 0;
    await withConf(c => {
      for (const a of (data && data.accounts) || []) {
        if (!a.host || !a.username) continue;
        const sshKey = a.auth === 'ssh' ? path.join(SSH_DIR, path.basename(String(a.sshKey || '').replace(/\\/g, '/'))) : '';
        const r = upsertAccount(c, { host: a.host, username: a.username, auth: a.auth === 'ssh' ? 'ssh' : 'token',
          sshKey, ssh443: !!a.ssh443, owners: a.owners || [a.username] });
        if (r.isNew) { r.acc.label = a.label || ''; n++; }
      }
    });
    return { imported: n, state: await state() };
  },
};

const hasRepo = p => loadConf().repos.includes(p);

module.exports = { init, setEnv, api, hasRepo, findSourcetree, parseUrl, classify, planBind, annotate, scrub, normHost, IS_MAC, IS_WIN };
