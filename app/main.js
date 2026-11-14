const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, dialog, nativeImage, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const log = require("electron-log");
const { autoUpdater } = require("electron-updater");

app.setAppUserModelId("com.cowork.live");   // нужно для уведомлений Windows
log.initialize();
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let win = null, tray = null, quitting = false;
const ICON = path.join(__dirname, "build", "icon.png");
const BUNDLED = path.join(__dirname, "web", "index.html");
const SELF_REPO = "https://github.com/melloskiess-spec/cowork-releases.git";

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on("second-instance", () => show());

function show() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#0d0c11", title: "Cowork", icon: ICON,
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.removeMenu();
  win.loadFile(BUNDLED);
  win.once("ready-to-show", () => win.show());
  // внешние ссылки открываем в браузере, а не внутри приложения
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  // крестик прячет в трей, чтобы уведомления продолжали приходить
  win.on("close", e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on("closed", () => { win = null; });
}

function sendStatus(s) { win?.webContents.send("cowork:update-status", s); }

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("Cowork");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Открыть Cowork", click: show },
    { label: "Настройки канала", click: () => { show(); win?.webContents.send("cowork:open-setup"); } },
    { label: "Проверить обновления", click: () => checkUpdates(true) },
    { label: "Выйти из предпросмотра", click: () => { show(); win?.loadFile(BUNDLED); } },
    { type: "separator" },
    { label: `Версия ${app.getVersion()}`, enabled: false },
    { label: "Выйти", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("click", show);
}

let manualCheck = false;
function checkUpdates(manual) {
  if (!app.isPackaged) { sendStatus({ state: "dev" }); if (manual === true) dialog.showMessageBox({ message: "Обновления проверяются только в установленной версии." }); return; }
  manualCheck = manual === true;
  autoUpdater.checkForUpdates().catch(err => log.warn("update check failed", err));
}
autoUpdater.on("checking-for-update", () => sendStatus({ state: "checking" }));
autoUpdater.on("update-available", info => { sendStatus({ state: "downloading", version: info.version }); });
let readyVersion = null;
autoUpdater.on("update-not-available", () => {
  sendStatus({ state: "latest", version: app.getVersion() });
  if (manualCheck) dialog.showMessageBox({ message: `У вас последняя версия (${app.getVersion()}).` });
});
autoUpdater.on("download-progress", p => sendStatus({ state: "downloading", percent: Math.round(p.percent) }));
autoUpdater.on("error", err => {
  sendStatus({ state: "error" });
  if (manualCheck) dialog.showMessageBox({ type: "warning", message: "Не удалось проверить обновления.", detail: String(err?.message || err) });
});
autoUpdater.on("update-downloaded", async info => {
  readyVersion = info.version;
  sendStatus({ state: "ready", version: info.version });
  const { response } = await dialog.showMessageBox({
    type: "info", buttons: ["Перезапустить сейчас", "Позже"], defaultId: 0, cancelId: 1,
    message: `Готова новая версия Cowork ${info.version}`,
    detail: "Перезапустите, чтобы обновиться. Если выберете «Позже», обновление установится при выходе."
  });
  if (response === 0) { quitting = true; autoUpdater.quitAndInstall(); }
});

ipcMain.on("cowork:notify", (_e, { title, body }) => {
  if (!Notification.isSupported()) return;
  if (win && win.isVisible() && win.isFocused()) return;   // окно перед глазами, не отвлекаем
  const n = new Notification({ title, body, icon: ICON, silent: false });
  n.on("click", show);
  n.show();
});
ipcMain.handle("cowork:version", () => app.getVersion());
ipcMain.on("cowork:check-updates", () => checkUpdates(true));
ipcMain.on("cowork:check-updates-inline", () => { if (readyVersion) return sendStatus({ state: "ready", version: readyVersion }); checkUpdates("inline"); });
ipcMain.on("cowork:install-update", () => { if (!readyVersion) return; quitting = true; autoUpdater.quitAndInstall(); });
ipcMain.on("cowork:copy", (_e, text) => clipboard.writeText(String(text).slice(0, 5000)));
ipcMain.on("cowork:open-url", (_e, url) => { if (/^https:\/\/github\.com\//.test(String(url))) shell.openExternal(String(url)); });

// ---------- Claude Code: запуск вашего локального claude в папке проекта ----------
const runs = new Map();
const isWin = process.platform === "win32";
const PERMS = new Set(["acceptEdits", "bypassPermissions", "plan"]);

// Claude Code часто стоит там, куда не смотрит PATH приложения: установщик кладёт его в ~/.local/bin,
// npm в %APPDATA%\npm, а PATH, изменённый после входа в Windows, Cowork не видит до перезагрузки.
// Поэтому собираем PATH заново: свежие значения из реестра плюс известные папки установки.
function claudePath() {
  const home = require("os").homedir(), sep = isWin ? ";" : ":";
  const parts = (process.env.PATH || process.env.Path || "").split(sep);
  if (isWin) {
    for (const key of ["HKCU\\Environment", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"]) {
      try {
        const out = require("child_process").execFileSync("reg", ["query", key, "/v", "Path"], { encoding: "utf8", windowsHide: true, timeout: 4000 });
        const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
        if (m) parts.push(...m[1].trim().replace(/%([^%]+)%/g, (a, v) => process.env[v] || a).split(";"));
      } catch {}
    }
    const ad = process.env.APPDATA || path.join(home, "AppData", "Roaming"), lad = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    parts.push(path.join(home, ".local", "bin"), path.join(ad, "npm"), path.join(home, ".claude", "local"),
      path.join(lad, "Programs", "claude"), path.join(lad, "AnthropicClaude"), path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"));
  } else {
    parts.push(path.join(home, ".local", "bin"), path.join(home, ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin");
  }
  return [...new Set(parts.map(x => x.trim()).filter(Boolean))].join(sep);
}
let CLAUDE_ENV = null;
const claudeEnv = (extra = {}) => {
  if (!CLAUDE_ENV) { const P = claudePath(); CLAUDE_ENV = { ...process.env, PATH: P }; if (isWin) CLAUDE_ENV.Path = P; }
  return { ...CLAUDE_ENV, ...extra };
};

function readEnvFile(dir) {
  const out = {};
  for (const f of ["cowork.env", "cowork.local.env"]) {
    try {
      for (const line of fs.readFileSync(path.join(dir, ".claude", f), "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*(COWORK_[A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
        if (m) out[m[1]] = m[2].trim();
      }
    } catch {}
  }
  return out;
}

// ищем сам файл claude: свой путь из настроек → папки PATH и установки → where.exe → PowerShell (видит shim'ы scoop и т.п.)
const BIN_FILE = () => path.join(app.getPath("userData"), "claude-path.txt");
const BIN_NAMES = isWin ? ["claude.exe", "claude.cmd", "claude.bat"] : ["claude"];
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
let CLAUDE_BIN = null, CLAUDE_TRIED = [];
function resolveClaude(quick) {
  const tried = [];
  try { const own = fs.readFileSync(BIN_FILE(), "utf8").trim(); if (own) { tried.push(own); if (isFile(own)) return { bin: own, tried }; } } catch {}
  for (const dir of claudePath().split(isWin ? ";" : ":")) {
    tried.push(dir);
    for (const n of BIN_NAMES) { const f = path.join(dir.replace(/^"|"$/g, ""), n); if (isFile(f)) return { bin: f, tried }; }
  }
  if (quick) return { bin: null, tried };
  const cp = require("child_process"), opt = { encoding: "utf8", windowsHide: true, timeout: 10000, env: claudeEnv() };
  const probes = isWin
    ? [["where.exe", ["claude"]], ["powershell.exe", ["-NoLogo", "-Command", "(Get-Command claude -ErrorAction SilentlyContinue).Source"]]]
    : [[process.env.SHELL || "/bin/sh", ["-lc", "command -v claude"]]];
  for (const [cmd, args] of probes) {
    tried.push(cmd);
    try {
      for (const line of cp.execFileSync(cmd, args, opt).split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
        if (isFile(line) && !/\.ps1$/i.test(line)) return { bin: line, tried };
        if (/\.ps1$/i.test(line)) for (const ext of [".cmd", ".exe"]) { const f = line.replace(/\.ps1$/i, ext); if (isFile(f)) return { bin: f, tried }; }
      }
    } catch {}
  }
  return { bin: null, tried };
}
// .cmd/.bat запускаются только через cmd.exe, поэтому их и аргументы с пробелами берём в кавычки; .exe запускаем напрямую
function spawnClaude(args, opts, quick) {
  if (!CLAUDE_BIN) { const r = resolveClaude(quick); CLAUDE_BIN = r.bin; CLAUDE_TRIED = r.tried; }
  if (!CLAUDE_BIN) { const err = new Error("Claude Code не найден. Укажите путь к claude в настройках проекта."); err.code = "ENOENT"; throw err; }
  if (isWin && /\.(cmd|bat)$/i.test(CLAUDE_BIN)) {
    const q = a => /[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
    return spawn(`"${CLAUDE_BIN}"`, args.map(q), { ...opts, shell: true, windowsHide: true });
  }
  return spawn(CLAUDE_BIN, args, { ...opts, shell: false, windowsHide: true });
}

ipcMain.handle("claude:check", (_e, quick) => new Promise(resolve => {
  let out = "", err = "", done = false;
  CLAUDE_ENV = null; CLAUDE_BIN = null;   // каждая проверка ищет заново: вдруг Claude Code только что установили
  const finish = v => { if (!done) { done = true; resolve({ ...v, bin: CLAUDE_BIN, tried: CLAUDE_TRIED.slice(0, 40) }); } };
  try {
    const p = spawnClaude(["--version"], { env: claudeEnv() }, !!quick);
    p.stdout.on("data", d => out += d);
    p.stderr.on("data", d => err += d);
    p.on("error", e => finish({ ok: false, error: String(e.message || e) }));
    p.on("close", code => finish(code === 0 ? { ok: true, version: out.trim().split(/\s+/)[0] } : { ok: false, error: (err || out).trim().slice(-400) || "код выхода " + code }));
    setTimeout(() => { try { p.kill(); } catch {} finish({ ok: false, timeout: true, error: "claude --version не ответил за 30 секунд" }); }, 30000);
  } catch (e) { finish({ ok: false, error: e.code === "ENOENT" ? "" : String(e.message || e) }); }
}));
// установка Claude Code в один клик: видимое окно PowerShell ставит его официальным установщиком,
// добавляет ~/.local/bin в PATH пользователя, показывает версию и открывает Claude для входа в подписку
const INSTALL_PS = `
$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'Cowork: установка Claude Code'
Write-Host 'Cowork ставит Claude Code с claude.ai...' -ForegroundColor Magenta
irm https://claude.ai/install.ps1 | iex
$bin = Join-Path $HOME '.local\\bin'
$exe = Join-Path $bin 'claude.exe'
if (-not (Test-Path $exe)) { Write-Host 'Не получилось: claude.exe не появился. Пришлите этот текст.' -ForegroundColor Red; return }
$p = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($p -split ';') -contains $bin)) { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';')) + ';' + $bin), 'User'); $env:Path += ';' + $bin; Write-Host 'Папка добавлена в PATH.' -ForegroundColor Green }
Write-Host ''
Write-Host ('Установлено: ' + (& $exe --version)) -ForegroundColor Green
Write-Host ''
Write-Host 'Сейчас откроется Claude. Войдите в свою подписку в браузере, потом напишите /exit и закройте окно.' -ForegroundColor Magenta
Write-Host 'Cowork заметит Claude Code сам.'
& $exe
`;
ipcMain.handle("claude:install", () => {
  if (!isWin) return { ok: false, error: "Автоустановка есть только на Windows. Выполните в терминале: curl -fsSL https://claude.ai/install.sh | bash" };
  try {
    const enc = Buffer.from(INSTALL_PS, "utf16le").toString("base64");
    spawn("powershell.exe", ["-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc],
      { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle("claude:pick-bin", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Где лежит claude", properties: ["openFile"],
    filters: isWin ? [{ name: "Claude Code", extensions: ["exe", "cmd", "bat"] }] : [] });
  if (r.canceled || !r.filePaths[0]) return false;
  try { fs.writeFileSync(BIN_FILE(), r.filePaths[0]); } catch { return false; }
  return true;
});

// фото для Claude: кладём в <проект>/.cowork/images (папка скрыта от git через .git/info/exclude).
// Фото напарника скачиваем только с сервера канала проекта.
ipcMain.handle("claude:save-image", async (_e, { folder, name, data, url, server, token, file }) => {
  try {
    if (!folder || !fs.statSync(folder).isDirectory()) throw new Error("нет папки проекта");
    const dir = path.join(folder, ".cowork", file ? "files" : "images"); fs.mkdirSync(dir, { recursive: true });
    try {
      const ex = path.join(folder, ".git", "info", "exclude");
      if (fs.existsSync(path.join(folder, ".git"))) {
        const cur = fs.existsSync(ex) ? fs.readFileSync(ex, "utf8") : "";
        if (!/^\.cowork\/?\s*$/m.test(cur)) { fs.mkdirSync(path.dirname(ex), { recursive: true }); fs.appendFileSync(ex, "\n.cowork/\n"); }
      }
    } catch {}
    let buf;
    if (data) buf = Buffer.from(String(data), "base64");
    else {
      const u = String(url || ""), srv = String(server || "").replace(/\/+$/, "");
      if (!/^https?:\/\//.test(u) || !srv || !u.startsWith(srv + "/")) throw new Error("чужой адрес фото");
      const r = await fetch(u, { headers: token ? { Authorization: "Bearer " + token } : {} });
      if (!r.ok) throw new Error("фото недоступно, HTTP " + r.status);
      buf = Buffer.from(await r.arrayBuffer());
    }
    if (!buf || !buf.length || buf.length > 30e6) throw new Error("пустой или слишком большой файл");
    const safe = String(name || "file").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "").slice(-80) || "file";
    const f = path.join(dir, Date.now().toString(36) + "-" + safe);
    fs.writeFileSync(f, buf);
    // архив распаковываем рядом, чтобы Claude сразу видел содержимое (tar на Windows 10+ умеет и zip)
    let extracted = "";
    if (file && /\.(zip|tar|tgz|tar\.gz|tar\.bz2|tar\.xz)$/i.test(safe)) {
      const out = f.replace(/\.(zip|tar|tgz|tar\.gz|tar\.bz2|tar\.xz)$/i, "") + "_files";
      fs.mkdirSync(out, { recursive: true });
      const cp = require("child_process"), opt = { windowsHide: true, timeout: 120000, stdio: "ignore" };
      try {
        if (!isWin && /\.zip$/i.test(safe)) cp.execFileSync("unzip", ["-q", "-o", f, "-d", out], opt);
        else cp.execFileSync("tar", ["-xf", f, "-C", out], opt);
        extracted = out;
      } catch (e) { log.warn("extract failed", e?.message); }
    }
    return { path: f, extracted };
  } catch (e) { return { error: String(e.message || e) }; }
});

ipcMain.handle("claude:pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Папка проекта", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], env: readEnvFile(r.filePaths[0]), repo: githubRepo(r.filePaths[0]) };
});
ipcMain.handle("claude:folder-info", (_e, dir) => {
  try { if (!dir || !fs.statSync(dir).isDirectory()) return null; } catch { return null; }
  return { path: dir, env: readEnvFile(dir), repo: githubRepo(dir) };
});
// https-ссылка на репозиторий GitHub из .git/config папки проекта, если есть
function githubRepo(dir) {
  try {
    const cfg = fs.readFileSync(path.join(dir, ".git", "config"), "utf8");
    const m = cfg.match(/url\s*=\s*(?:https:\/\/(?:[^@\/]+@)?github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m);
    return m ? "https://github.com/" + m[1] : "";
  } catch { return ""; }
}

ipcMain.on("claude:run", (e, { id, prompt, cwd, resume, perm, self, team }) => {
  const send = msg => { if (!e.sender.isDestroyed()) e.sender.send("claude:event", { id, ...msg }); };
  if (!cwd || !fs.existsSync(cwd)) return send({ done: true, error: "Папка проекта не найдена. Выберите её в настройках." });
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--permission-mode", PERMS.has(perm) ? perm : "acceptEdits"];
  // вкладка «Cowork»: Claude правит код самого приложения, ему можно git и npm, чтобы выпустить обновление
  if (self) args.push("--allowedTools", "Bash(git:*)", "Bash(npm:*)", "Bash(node:*)");
  // «Оба Claude»: ветки, коммиты, push и слияние нужны обоим даже в режиме «Менять файлы»
  else if (team) args.push("--allowedTools", "Bash(git:*)");
  if (resume && /^[0-9a-f-]{36}$/i.test(resume)) args.push("--resume", resume);
  // хуки трансляции молчат: события в канал отправляет само приложение, без дублей
  const env = claudeEnv({ COWORK_ENABLED: "0" });
  let p;
  try { p = spawnClaude(args, { cwd, env }); }
  catch (err) { return send({ done: true, error: String(err.message || err) }); }
  runs.set(id, p);
  let buf = "", errTail = "";
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { send({ msg: JSON.parse(line) }); } catch {}
    }
  });
  p.stderr.setEncoding("utf8");
  p.stderr.on("data", d => { errTail = (errTail + d).slice(-1500); });
  p.on("error", err => { runs.delete(id); send({ done: true, error: err.code === "ENOENT" ? "Claude Code не найден. Установите его и войдите в аккаунт." : String(err.message || err) }); });
  p.on("close", code => { runs.delete(id); send({ done: true, code, stopped: p._stopped === true, error: code && !p._stopped ? errTail.trim() || `claude завершился с кодом ${code}` : "" }); });
  p.stdin.end(String(prompt || ""));
});

// ---------- вкладка «Cowork»: код приложения на этом компьютере ----------
ipcMain.handle("self:clone", () => new Promise(resolve => {
  const dest = path.join(app.getPath("documents"), "Cowork-source");
  if (fs.existsSync(path.join(dest, ".git"))) return resolve({ path: dest, existed: true });
  let err = "";
  try {
    const p = spawn("git", ["clone", SELF_REPO, isWin ? `"${dest}"` : dest], { shell: isWin, windowsHide: true });
    p.stderr.on("data", d => { err = (err + d).slice(-800); });
    p.on("error", e => resolve({ error: e.code === "ENOENT" ? "Не найден git. Установите Git for Windows и попробуйте снова." : String(e.message || e) }));
    p.on("close", code => resolve(code === 0 ? { path: dest } : { error: err.trim() || `git clone завершился с кодом ${code}` }));
  } catch (e) { resolve({ error: String(e.message || e) }); }
}));
ipcMain.handle("self:preview", (_e, dir) => {
  const file = path.join(String(dir || ""), "dashboard", "index.html");
  if (!fs.existsSync(file)) return { error: "В папке нет dashboard/index.html" };
  win?.loadFile(file, { query: { preview: "1" } });
  return { ok: true };
});
ipcMain.on("self:preview-off", () => win?.loadFile(BUNDLED));

ipcMain.on("claude:stop", (_e, id) => {
  const p = runs.get(id); if (!p) return;
  p._stopped = true;
  if (isWin) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true });
  else p.kill("SIGTERM");
});
app.on("before-quit", () => { for (const id of runs.keys()) ipcMain.emit("claude:stop", null, id); });

app.whenReady().then(() => {
  createWindow();
  buildTray();
  setTimeout(() => checkUpdates(false), 5000);
  setInterval(() => checkUpdates(false), 30 * 60 * 1000);
});
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { /* живём в трее */ });
