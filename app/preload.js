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
    status21: () => ipcRenderer.invoke("claude:21st-status"),
    commands: opts => ipcRenderer.invoke("claude:commands", opts),
    login21: () => ipcRenderer.invoke("claude:21st-login"),
    saveImage: opts => ipcRenderer.invoke("claude:save-image", opts),
    pickFolder: () => ipcRenderer.invoke("claude:pick-folder"),
    folderInfo: dir => ipcRenderer.invoke("claude:folder-info", String(dir || "")),
    run: opts => ipcRenderer.send("claude:run", opts),
    stop: id => ipcRenderer.send("claude:stop", id),
    onEvent: fn => ipcRenderer.on("claude:event", (_e, m) => fn(m))
  },
  pane: {
    read: opts => ipcRenderer.invoke("pane:read", opts),
    list: opts => ipcRenderer.invoke("pane:list", opts),
    capture: rect => ipcRenderer.invoke("pane:capture", rect),
    start: opts => ipcRenderer.send("app:start", opts),
    stop: id => ipcRenderer.send("app:stop", id),
    guess: opts => ipcRenderer.invoke("app:guess", opts),
    onEvent: fn => ipcRenderer.on("app:event", (_e, m) => fn(m))
  },
  self: {
    clone: () => ipcRenderer.invoke("self:clone"),
    preview: dir => ipcRenderer.invoke("self:preview", String(dir || "")),
    previewOff: () => ipcRenderer.send("self:preview-off")
  }
});
