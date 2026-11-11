// Smily Level 4 – Einstieg für Vercel (alle Pfade werden per vercel.json hierher umgeleitet)
"use strict";
const path = require("path");
const { createApp } = require("../lib/core");

module.exports = createApp({ rootDir: path.join(__dirname, "..") });
