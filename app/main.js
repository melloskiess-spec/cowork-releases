const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, dialog, nativeImage } = require("electron");
const path = require("path");
const log = require("electron-log");
const { autoUpdater } = require("electron-updater");

app.setAppUserModelId("com.cowork.live");   // нужно для уведомлений Windows
log.initialize();
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let win = null, tray = null, quitting = false;
const ICON = path.join(__dirname, "build", "icon.png");

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on("second-instance", () => show());

function show() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 380, minHeight: 600,
    backgroundColor: "#0d0c11", title: "Cowork", icon: ICON,
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "web", "index.html"));
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
    { type: "separator" },
    { label: `Версия ${app.getVersion()}`, enabled: false },
    { label: "Выйти", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("click", show);
}

let manualCheck = false;
function checkUpdates(manual) {
  if (!app.isPackaged) { if (manual) dialog.showMessageBox({ message: "Обновления проверяются только в установленной версии." }); return; }
  manualCheck = !!manual;
  autoUpdater.checkForUpdates().catch(err => log.warn("update check failed", err));
}
autoUpdater.on("checking-for-update", () => sendStatus({ state: "checking" }));
autoUpdater.on("update-available", info => { sendStatus({ state: "downloading", version: info.version }); });
autoUpdater.on("update-not-available", () => {
  sendStatus({ state: "latest" });
  if (manualCheck) dialog.showMessageBox({ message: `У вас последняя версия (${app.getVersion()}).` });
});
autoUpdater.on("download-progress", p => sendStatus({ state: "downloading", percent: Math.round(p.percent) }));
autoUpdater.on("error", err => {
  sendStatus({ state: "error" });
  if (manualCheck) dialog.showMessageBox({ type: "warning", message: "Не удалось проверить обновления.", detail: String(err?.message || err) });
});
autoUpdater.on("update-downloaded", async info => {
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

app.whenReady().then(() => {
  createWindow();
  buildTray();
  setTimeout(() => checkUpdates(false), 5000);
  setInterval(() => checkUpdates(false), 30 * 60 * 1000);
});
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { /* живём в трее */ });
