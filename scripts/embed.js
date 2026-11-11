// Packt app/index.html (und optionale Captcha-Dateien) in lib/assets.js,
// damit Vercel alles sicher in der Funktion hat. Vor jedem Deploy ausführen (macht "npm run deploy" automatisch).
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
const cdir = path.join(root, "app", "captcha");
const files = {};
if (fs.existsSync(cdir)) {
  for (const f of fs.readdirSync(cdir)) {
    if (f === "captcha.beispiel.json" || !/\.(json|jpe?g|png|webp)$/i.test(f)) continue;
    files[f] = fs.readFileSync(path.join(cdir, f)).toString("base64");
  }
}
fs.writeFileSync(path.join(root, "lib", "assets.js"),
  "// Automatisch erzeugt mit `node scripts/embed.js`. Nicht von Hand bearbeiten.\nmodule.exports = " + JSON.stringify({ html, files }) + ";\n");
console.log(`lib/assets.js erzeugt (index.html + ${Object.keys(files).length} Captcha-Datei(en))`);
