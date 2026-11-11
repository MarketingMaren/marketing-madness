// Smily Level 4 – Kernlogik (läuft lokal über server.js und auf Vercel über api/index.js)
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createApp({ rootDir }) {
  /* ===== Konfiguration (Umgebungsvariablen) ===== */
  const TICKET_TOKEN = process.env.TICKET_TOKEN || "goldenes-ticket-BITTE-AENDERN"; // geheimer Teil der URL im QR-Code
  const EVENT_PIN = String(process.env.EVENT_PIN || "2412");                        // steht auf der GoldClub-Karte
  const KUNDENNUMMER = String(process.env.KUNDENNUMMER || "SL4-2412").toUpperCase();  // steht auf der GoldClub-Karte
  const QUEUE_SECONDS = Math.max(25, Number(process.env.QUEUE_SECONDS || 60));       // mind. 25 s
  const ADMIN_KEY = process.env.ADMIN_KEY || "";                                      // leer = Reset aus
  const SESSION_SECRET = process.env.SESSION_SECRET ||
    crypto.createHash("sha256").update("sl4|" + TICKET_TOKEN + "|" + EVENT_PIN).digest("hex");

  const BASE = "/" + TICKET_TOKEN;
  const APP_DIR = path.join(rootDir, "app");
  const CAPTCHA_DIR = path.join(APP_DIR, "captcha");
  // Lokal wird direkt aus app/ gelesen, auf Vercel aus dem eingebetteten lib/assets.js
  let EMB = null; try { EMB = require("./assets.js"); } catch {}
  function readAsset(rel) {
    try { return fs.readFileSync(path.join(APP_DIR, rel)); }
    catch (e) {
      if (EMB) {
        if (rel === "index.html") return Buffer.from(EMB.html, "utf8");
        const f = rel.replace(/^captcha\//, "");
        if (rel.startsWith("captcha/") && EMB.files[f]) return Buffer.from(EMB.files[f], "base64");
      }
      throw e;
    }
  }
  const assetExists = rel => { try { readAsset(rel); return true; } catch { return false; } };
  const INDEX_HTML = readAsset("index.html").toString("utf8");
  const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

  function loadCaptcha() {
    try {
      const c = JSON.parse(readAsset("captcha/captcha.json").toString("utf8"));
      const bilder = (c.bilder || []).filter(b => /^[\w.-]+\.(jpe?g|png|webp)$/i.test(b.datei) && assetExists("captcha/" + b.datei));
      return bilder.length ? { frage: c.frage || "Wähle alle passenden Bilder.", bilder } : null;
    } catch { return null; }
  }

  /* ===== Speicher: Redis (Vercel/Upstash) oder lokale JSON-Datei ===== */
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  const KEY = "sl4:players:" + crypto.createHash("sha256").update(TICKET_TOKEN).digest("hex").slice(0, 12);
  let store;
  if (REDIS_URL && REDIS_TOKEN) {
    const cmd = async (...args) => {
      const r = await fetch(REDIS_URL, { method: "POST", headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(args) });
      const j = await r.json();
      if (j.error) throw new Error("Redis: " + j.error);
      return j.result;
    };
    store = {
      kind: "redis",
      async get(id) { const v = await cmd("HGET", KEY, id); return v ? JSON.parse(v) : null; },
      async set(id, p) { await cmd("HSET", KEY, id, JSON.stringify(p)); },
      async all() { const a = (await cmd("HGETALL", KEY)) || []; const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i]] = JSON.parse(a[i + 1]); return o; },
      async reset() { await cmd("DEL", KEY); }
    };
  } else if (process.env.VERCEL) {
    const fail = async () => { throw Object.assign(new Error("no-db"), { userMessage: "Rangliste nicht eingerichtet: Bitte Upstash Redis mit dem Vercel-Projekt verbinden (siehe README)." }); };
    store = { kind: "fehlt", get: fail, set: fail, all: fail, reset: fail };
  } else {
    const DATA_FILE = process.env.DATA_FILE || path.join(rootDir, "data.json");
    let data = { players: {} };
    try { data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {}
    const persist = () => { const tmp = DATA_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, DATA_FILE); };
    store = {
      kind: "datei",
      async get(id) { return data.players[id] ? { ...data.players[id] } : null; },
      async set(id, p) { data.players[id] = p; persist(); },
      async all() { return data.players; },
      async reset() { data = { players: {} }; persist(); }
    };
  }

  /* ===== Session-Cookie (signiert) ===== */
  const sign = v => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
  function readSession(req) {
    const m = /(?:^|;\s*)sl4=([^;]+)/.exec(req.headers.cookie || "");
    if (!m) return null;
    const [id, sig] = m[1].split(".");
    if (!id || !sig) return null;
    const a = Buffer.from(sig), b = Buffer.from(sign(id));
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
  }
  function sessionCookie(req, id) {
    const secure = req.headers["x-forwarded-proto"] === "https" || process.env.SECURE_COOKIE === "1";
    return `sl4=${id}.${sign(id)}; Path=${BASE}; HttpOnly; SameSite=Lax; Max-Age=172800${secure ? "; Secure" : ""}`;
  }

  /* ===== Rate-Limit für PIN-Versuche ===== */
  const attempts = new Map();
  function tooMany(ip) {
    const now = Date.now(), win = 10 * 60 * 1000;
    const list = (attempts.get(ip) || []).filter(t => now - t < win);
    attempts.set(ip, list);
    return list.length >= 10;
  }

  /* ===== Helfer ===== */
  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== "string";
    res.writeHead(status, {
      "Content-Type": isJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...headers
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }
  function readBody(req) {
    if ("body" in req) { // Vercel hat den Body schon gelesen
      try { const b = req.body; return Promise.resolve(typeof b === "string" ? JSON.parse(b || "{}") : Buffer.isBuffer(b) ? JSON.parse(b.toString() || "{}") : (b || {})); }
      catch { return Promise.resolve({}); }
    }
    return new Promise(resolve => {
      let s = "";
      req.on("data", c => { s += c; if (s.length > 10000) req.destroy(); });
      req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
    });
  }
  const cleanName = n => String(n || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 30);

  async function board(me) {
    const players = await store.all();
    const all = Object.entries(players).map(([id, p]) => ({ id, ...p }));
    const done = all.filter(p => typeof p.bestMs === "number").sort((a, b) => a.bestMs - b.bestMs);
    const active = all.filter(p => p.status === "aktiv");
    const myRank = done.findIndex(p => p.id === me) + 1;
    return {
      top: done.slice(0, 10).map((p, i) => ({ rank: i + 1, name: p.name, bestMs: p.bestMs, me: p.id === me })),
      myRank: myRank || null,
      myBest: players[me]?.bestMs ?? null,
      doneCount: done.length,
      activeCount: active.length,
      activeNames: active.slice(0, 12).map(p => p.name)
    };
  }

  /* ===== Routen ===== */
  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    // Auf Vercel kommt der Originalpfad per Rewrite als ?__p= an
    const raw = url.searchParams.has("__p") ? "/" + url.searchParams.get("__p") : url.pathname;
    const p = raw.replace(/\/+$/, "");
    if (p !== BASE && !p.startsWith(BASE + "/")) return send(res, 404, "Not found");
    const route = p.slice(BASE.length) || "/";
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

    if (req.method === "GET" && route === "/") return send(res, 200, INDEX_HTML);

    if (req.method === "POST" && route === "/api/login") {
      if (tooMany(ip)) return send(res, 429, { error: "Zu viele Versuche. Bitte warte ein paar Minuten." });
      const { pin } = await readBody(req);
      const a = Buffer.from(String(pin || "")), b = Buffer.from(EVENT_PIN);
      if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
        attempts.get(ip).push(Date.now());
        return send(res, 401, { error: "Falsche PIN." });
      }
      const id = readSession(req) || crypto.randomBytes(12).toString("base64url");
      return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, id) });
    }

    if (req.method === "POST" && route === "/api/admin/reset") {
      if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) return send(res, 403, { error: "forbidden" });
      await store.reset();
      return send(res, 200, { ok: true });
    }

    const me = readSession(req);
    if (!me) return send(res, 401, { error: "Bitte zuerst die Ticket-PIN eingeben." });
    const player = await store.get(me);
    const now = Date.now();

    if (req.method === "GET" && route === "/api/me") {
      return send(res, 200, { now, queueSeconds: QUEUE_SECONDS, player: player ? { name: player.name, status: player.status, startedAt: player.startedAt, kdnrOk: !!player.kdnrAt, lastMs: player.lastMs ?? null, bestMs: player.bestMs ?? null } : null });
    }

    if (req.method === "POST" && route === "/api/start") {
      const name = cleanName((await readBody(req)).name);
      if (name.length < 2) return send(res, 400, { error: "Bitte gib einen Namen ein." });
      await store.set(me, { ...(player || {}), name, status: "aktiv", startedAt: now, kdnrAt: null, finishedAt: null });
      return send(res, 200, { startedAt: now, now });
    }

    if (req.method === "GET" && route.startsWith("/captcha/")) {
      const name = decodeURIComponent(route.slice("/captcha/".length));
      const c = loadCaptcha();
      if (!c || !c.bilder.some(b => b.datei === name)) return send(res, 404, { error: "not found" });
      res.writeHead(200, { "Content-Type": MIME[name.split(".").pop().toLowerCase()], "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex" });
      return res.end(readAsset("captcha/" + name));
    }

    if (req.method === "GET" && route === "/api/captcha") {
      const c = loadCaptcha();
      if (!c) return send(res, 200, { aktiv: false });
      return send(res, 200, { aktiv: true, frage: c.frage, bilder: c.bilder.map(b => ({ id: b.datei, src: BASE + "/captcha/" + encodeURIComponent(b.datei) })) });
    }

    if (req.method === "POST" && route === "/api/captcha") {
      const c = loadCaptcha();
      if (!c) return send(res, 200, { ok: true });
      const pick = new Set(((await readBody(req)).auswahl || []).map(String));
      const right = new Set(c.bilder.filter(b => b.richtig).map(b => b.datei));
      return send(res, 200, { ok: pick.size === right.size && [...pick].every(x => right.has(x)) });
    }

    if (req.method === "GET" && route === "/api/board") return send(res, 200, await board(me));

    if (!player || player.status !== "aktiv") return send(res, 409, { error: "Kein aktives Abo gefunden." });

    if (req.method === "POST" && route === "/api/kdnr") {
      // Leerzeichen und Bindestriche ignorieren: "SL4-2412", "sl4 2412" und "SL42412" zählen gleich
      const norm = s => String(s || "").toUpperCase().replace(/[\s\-–—_]+/g, "");
      const code = norm((await readBody(req)).code);
      if (code !== norm(KUNDENNUMMER)) return send(res, 200, { ok: false });
      await store.set(me, { ...player, kdnrAt: now });
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && route === "/api/finish") {
      if (!player.kdnrAt) return send(res, 409, { error: "Kundennummer fehlt." });
      if (now - player.kdnrAt < (QUEUE_SECONDS - 3) * 1000) return send(res, 409, { error: "Die Warteschleife lässt sich nicht abkürzen. Netter Versuch." });
      const ms = now - player.startedAt;
      const upd = { ...player, status: "gekündigt", finishedAt: now, lastMs: ms, bestMs: player.bestMs == null ? ms : Math.min(player.bestMs, ms), runs: (player.runs || 0) + 1 };
      await store.set(me, upd);
      return send(res, 200, { ms, bestMs: upd.bestMs, ...(await board(me)) });
    }

    send(res, 404, { error: "not found" });
  }

  const handler = async (req, res) => {
    try { await handle(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: e.userMessage || "Serverfehler. Bitte nochmal versuchen." }); }
  };
  handler.info = { BASE, storage: store.kind };
  return handler;
}

module.exports = { createApp };
