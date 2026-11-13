const { contextBridge, ipcRenderer } = require("electron");

// Небольшой мост для страницы: системные уведомления, версия, обновления.
contextBridge.exposeInMainWorld("coworkNative", {
  notify: (title, body) => ipcRenderer.send("cowork:notify", { title: String(title).slice(0, 120), body: String(body).slice(0, 300) }),
  version: () => ipcRenderer.invoke("cowork:version"),
  checkUpdates: () => ipcRenderer.send("cowork:check-updates"),
  onOpenSetup: fn => ipcRenderer.on("cowork:open-setup", () => fn()),
  onUpdateStatus: fn => ipcRenderer.on("cowork:update-status", (_e, s) => fn(s))
});
