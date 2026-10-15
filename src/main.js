'use strict';
// Git 账号管家 —— Electron 主进程：窗口、对话框、把界面的请求转给 core.js
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, net, session, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const core = require('./core');

// 开发测试用：指定单独的配置目录，不碰正在用的那份
if (process.env.GZ_USER_DATA) app.setPath('userData', process.env.GZ_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

// 从 Finder / 开始菜单启动时没有终端里的代理环境变量：读取系统代理交给 git
async function systemProxyEnv() {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) return {};
  try {
    const p = await session.defaultSession.resolveProxy('https://github.com');
    const m = p.match(/^(?:PROXY|HTTPS)\s+([^;\s]+)/);
    if (m) return { HTTPS_PROXY: 'http://' + m[1], HTTP_PROXY: 'http://' + m[1] };
  } catch (e) { /* 没有代理 */ }
  return {};
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 880, minHeight: 560,
    title: 'Git 账号管家',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : {}),
    backgroundColor: '#f6f7f9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // 文件拖到窗口上时不要跳转去打开它；外部链接用浏览器打开
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

// 只在主进程里才能做的事（系统对话框、打开文件夹）
const mainOnly = {
  async pickFolders() {
    const r = await dialog.showOpenDialog(win, { title: '选择项目文件夹', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return null;
    return core.api.addRepos({ paths: r.filePaths });
  },
  async openRepo({ path: p }) {
    if (!(await core.hasRepo(p))) throw new Error('不认识这个项目');
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return true;
  },
  // 打开 ~/.ssh（还没有就先建好）
  async openSshDir() {
    const dir = path.join(require('os').homedir(), '.ssh');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
    return true;
  },
  async exportFile() {
    const r = await dialog.showSaveDialog(win, { title: '导出账号配置', defaultPath: 'git-账号配置.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(core.api.exportData(), null, 2), 'utf8');
    return r.filePath;
  },
  async importFile() {
    const r = await dialog.showOpenDialog(win, { title: '导入账号配置', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    return core.api.importData({ data });
  },
  async showKeyFile({ id, path: keyPath }) {
    const r = await core.api.publicKey(id ? { id } : { path: keyPath });
    shell.showItemInFolder(r.pubPath || r.keyPath);
    return true;
  },
  async pickDir({ defaultPath }) {
    const r = await dialog.showOpenDialog(win, { title: '选择保存位置', defaultPath: defaultPath || undefined, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  },
  // 在 Sourcetree 里打开项目
  async openSourcetree({ path: p }) {
    if (!(await core.hasRepo(p))) throw new Error('不认识这个项目');
    const st = core.findSourcetree();
    if (!st) throw new Error('没找到 Sourcetree，请先安装');
    const { spawn } = require('child_process');
    const child = process.platform === 'darwin' ? spawn('open', ['-a', st, p], { detached: true, stdio: 'ignore' })
      : spawn(st, ['-f', p], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  },
  // 在项目目录打开终端
  async openTerminal({ path: p }) {
    if (!(await core.hasRepo(p))) throw new Error('不认识这个项目');
    if (!fs.existsSync(p)) throw new Error('目录不存在：' + p);
    const { spawn } = require('child_process');
    // Windows：路径不能写进命令行（Node 会把里面的引号转义成 \"，cmd 不认），用 cwd 传，start 开的新窗口会继承它
    const child = process.platform === 'darwin' ? spawn('open', ['-a', 'Terminal', p], { detached: true, stdio: 'ignore' })
      : process.platform === 'win32' ? spawn('cmd.exe', ['/d', '/c', 'start', '', 'cmd.exe'], { cwd: p, detached: true, stdio: 'ignore', windowsHide: false })
      : spawn('x-terminal-emulator', [], { cwd: p, detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  },
  // 本机应用的真实图标（Sourcetree / 访达 / 终端），给按钮用
  async appIcons() {
    const mac = process.platform === 'darwin', win32 = process.platform === 'win32';
    const paths = {
      sourcetree: core.findSourcetree(),
      folder: mac ? '/System/Library/CoreServices/Finder.app' : win32 ? 'C:\\Windows\\explorer.exe' : '',
      terminal: mac ? (fs.existsSync('/System/Applications/Utilities/Terminal.app') ? '/System/Applications/Utilities/Terminal.app' : '/Applications/Utilities/Terminal.app')
        : win32 ? 'C:\\Windows\\System32\\cmd.exe' : '',
    };
    // Mac 上 getFileIcon 拿不到 .app 的真实图标：直接读应用包里的 .icns
    const macIcon = appPath => {
      try {
        const info = JSON.parse(require('child_process').execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')]).toString());
        let f = info.CFBundleIconFile || info.CFBundleIconName || '';
        if (!f) return null;
        if (!/\.icns$/.test(f)) f += '.icns';
        // nativeImage 读不了 .icns：用系统自带的 sips 转成 PNG 缓存起来
        const dir = path.join(app.getPath('userData'), 'icon-cache');
        fs.mkdirSync(dir, { recursive: true });
        const png = path.join(dir, path.basename(appPath, '.app') + '.png');
        if (!fs.existsSync(png)) {
          require('child_process').execFileSync('sips', ['-s', 'format', 'png', '-Z', '64', path.join(appPath, 'Contents', 'Resources', f), '--out', png], { stdio: 'ignore' });
        }
        const img = nativeImage.createFromPath(png);
        return img.isEmpty() ? null : img;
      } catch (e) { return null; }
    };
    const out = {};
    for (const [k, p] of Object.entries(paths)) {
      if (!p || !fs.existsSync(p)) continue;
      try {
        const img = (mac && p.endsWith('.app') && macIcon(p)) || await app.getFileIcon(p, { size: 'normal' });
        if (img && !img.isEmpty()) out[k] = img.toDataURL();
      } catch (e) { /* 拿不到就只显示文字 */ }
    }
    return out;
  },
  copyText({ text }) {
    clipboard.writeText(String(text || ''));
    return true;
  },
  async pickKey() {
    const r = await dialog.showOpenDialog(win, { title: '选择 SSH 私钥文件', properties: ['openFile', 'showHiddenFiles'],
      defaultPath: path.join(require('os').homedir(), '.ssh') });
    return r.canceled ? null : r.filePaths[0];
  },
};

ipcMain.handle('call', async (e, name, args) => {
  try {
    const fn = mainOnly[name] || (Object.prototype.hasOwnProperty.call(core.api, name) ? core.api[name] : null);
    if (!fn) throw new Error('未知操作：' + name);
    core.setEnv(await systemProxyEnv());  // 代理软件可能刚开/刚关，每次都重新读
    return { ok: true, data: await fn(args || {}) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  // Windows 上默认菜单（File / Edit / View / Window）会出现在窗口里，还是英文的：去掉。输入框的复制粘贴不靠它
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  // “文档”被重定向到连不上的位置时 getPath 会抛错，不能因此打不开窗口
  let documents = '';
  try { documents = app.getPath('documents'); } catch (e) { /* 退回到 ~/Documents */ }
  core.init({ dataDir: app.getPath('userData'), fetchImpl: (url, opts) => net.fetch(url, opts), env: await systemProxyEnv(),
    trashImpl: p => shell.trashItem(p), documents });
  createWindow();
});
