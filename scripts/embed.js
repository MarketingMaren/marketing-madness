// Packt app/index.html (und optionale Bilder aus app/captcha/ und app/hunde/) in lib/assets.js.
// Nur nötig für einen Deploy ohne GitHub (npm run deploy). Beim Deploy über GitHub liest Vercel app/ direkt.
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
const files = {};
for (const dir of ["captcha", "hunde"]) {
  const d = path.join(root, "app", dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (f === "captcha.beispiel.json" || !/\.(json|jpe?g|png|webp|gif)$/i.test(f)) continue;
    files[dir + "/" + f] = fs.readFileSync(path.join(d, f)).toString("base64");
  }
}
fs.writeFileSync(path.join(root, "lib", "assets.js"),
  "// Automatisch erzeugt mit `node scripts/embed.js`. Nicht von Hand bearbeiten.\nmodule.exports = " + JSON.stringify({ html, files }) + ";\n");
console.log(`lib/assets.js erzeugt (index.html + ${Object.keys(files).length} Bild-/Datei(en))`);
