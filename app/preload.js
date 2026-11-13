const { contextBridge, ipcRenderer } = require("electron");

// Мост для страницы: уведомления, версия, обновления и запуск вашего Claude Code.
contextBridge.exposeInMainWorld("coworkNative", {
  notify: (title, body) => ipcRenderer.send("cowork:notify", { title: String(title).slice(0, 120), body: String(body).slice(0, 300) }),
  version: () => ipcRenderer.invoke("cowork:version"),
  checkUpdates: () => ipcRenderer.send("cowork:check-updates"),
  onOpenSetup: fn => ipcRenderer.on("cowork:open-setup", () => fn()),
  onUpdateStatus: fn => ipcRenderer.on("cowork:update-status", (_e, s) => fn(s)),
  claude: {
    check: () => ipcRenderer.invoke("claude:check"),
    pickFolder: () => ipcRenderer.invoke("claude:pick-folder"),
    folderInfo: dir => ipcRenderer.invoke("claude:folder-info", String(dir || "")),
    run: opts => ipcRenderer.send("claude:run", opts),
    stop: id => ipcRenderer.send("claude:stop", id),
    onEvent: fn => ipcRenderer.on("claude:event", (_e, m) => fn(m))
  }
});
