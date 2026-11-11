// Smily Level 4 – lokaler Start: node server.js
"use strict";
const http = require("http");
const { createApp } = require("./lib/core");

const PORT = Number(process.env.PORT || 3000);
const app = createApp({ rootDir: __dirname });

http.createServer(app).listen(PORT, () => {
  console.log(`Smily Level 4 läuft auf Port ${PORT} (Speicher: ${app.info.storage})`);
  console.log(`Link: http://localhost:${PORT}${app.info.BASE}`);
});
