// Копирует живую панель из ../dashboard в app/web, чтобы она попала в сборку.
const fs = require("fs"), path = require("path");
const src = path.join(__dirname, "..", "..", "dashboard", "index.html");
const dst = path.join(__dirname, "..", "web");
fs.mkdirSync(dst, { recursive: true });
fs.copyFileSync(src, path.join(dst, "index.html"));
console.log("web: dashboard/index.html -> app/web/index.html");
