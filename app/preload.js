const { contextBridge, ipcRenderer } = require("electron");

// Мост для страницы: уведомления, версия, обновления и запуск вашего Claude Code.
contextBridge.exposeInMainWorld("coworkNative", {
  notify: (title, body) => ipcRenderer.send("cowork:notify", { title: String(title).slice(0, 120), body: String(body).slice(0, 300) }),
  version: () => ipcRenderer.invoke("cowork:version"),
  checkUpdates: () => ipcRenderer.send("cowork:check-updates-inline"),
  installUpdate: () => ipcRenderer.send("cowork:install-update"),
  copy: text => ipcRenderer.send("cowork:copy", String(text)),
  openUrl: url => ipcRenderer.send("cowork:open-url", String(url)),
  onOpenSetup: fn => ipcRenderer.on("cowork:open-setup", () => fn()),
  onUpdateStatus: fn => ipcRenderer.on("cowork:update-status", (_e, s) => fn(s)),
  claude: {
    check: quick => ipcRenderer.invoke("claude:check", !!quick),
    pickBin: () => ipcRenderer.invoke("claude:pick-bin"),
    install: () => ipcRenderer.invoke("claude:install"),
    pickFolder: () => ipcRenderer.invoke("claude:pick-folder"),
    folderInfo: dir => ipcRenderer.invoke("claude:folder-info", String(dir || "")),
    run: opts => ipcRenderer.send("claude:run", opts),
    stop: id => ipcRenderer.send("claude:stop", id),
    onEvent: fn => ipcRenderer.on("claude:event", (_e, m) => fn(m))
  },
  self: {
    clone: () => ipcRenderer.invoke("self:clone"),
    preview: dir => ipcRenderer.invoke("self:preview", String(dir || "")),
    previewOff: () => ipcRenderer.send("self:preview-off")
  }
});
