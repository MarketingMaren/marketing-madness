// GoldClub Level 4 – Kernlogik (läuft lokal über server.js und auf Vercel über api/index.js)
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createApp({ rootDir }) {
  /* ===== Konfiguration (Umgebungsvariablen) ===== */
  const TICKET_TOKEN = process.env.TICKET_TOKEN || "goldenes-ticket-BITTE-AENDERN"; // geheimer Teil der URL im QR-Code
  const EVENT_PIN = String(process.env.EVENT_PIN || "6767");                        // steht auf der GoldClub-Karte
  const QUEUE_SECONDS = Math.max(25, Number(process.env.QUEUE_SECONDS || 60));       // mind. 25 s
  const ADMIN_KEY = process.env.ADMIN_KEY || "";                                      // leer = Admin-Funktionen aus
  // Spielzeit (Berlin). Vorher: Sperrseite. Danach: nur noch Rangliste.
  const GAME_START = Date.parse(process.env.GAME_START || "2026-11-27T18:30:00+01:00");
  const GAME_END = Date.parse(process.env.GAME_END || "2026-11-27T23:59:59+01:00");
  const SESSION_SECRET = process.env.SESSION_SECRET ||
    crypto.createHash("sha256").update("sl4|" + TICKET_TOKEN + "|" + EVENT_PIN).digest("hex");

  const BASE = "/" + TICKET_TOKEN;
  const APP_DIR = path.join(rootDir, "app");
  // Lokal und auf Vercel (includeFiles) direkt aus app/, sonst aus dem eingebetteten lib/assets.js
  let EMB = null; try { EMB = require("./assets.js"); } catch {}
  function readAsset(rel) {
    try { return fs.readFileSync(path.join(APP_DIR, rel)); }
    catch (e) {
      if (EMB) {
        if (rel === "index.html") return Buffer.from(EMB.html, "utf8");
        if (EMB.files[rel]) return Buffer.from(EMB.files[rel], "base64");
      }
      throw e;
    }
  }
  function listAssets(dir) {
    let names = [];
    try { names = fs.readdirSync(path.join(APP_DIR, dir)); }
    catch { if (EMB) names = Object.keys(EMB.files).filter(k => k.startsWith(dir + "/")).map(k => k.slice(dir.length + 1)); }
    return names.filter(f => /^[\w.-]+\.(jpe?g|png|webp|gif)$/i.test(f)).sort();
  }
  const assetExists = rel => { try { readAsset(rel); return true; } catch { return false; } };
  const INDEX_HTML = readAsset("index.html").toString("utf8");
  const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

  function loadCaptcha() {
    try {
      const c = JSON.parse(readAsset("captcha/captcha.json").toString("utf8"));
      const bilder = (c.bilder || []).filter(b => /^[\w.-]+\.(jpe?g|png|webp)$/i.test(b.datei) && assetExists("captcha/" + b.datei));
      return bilder.length ? { frage: c.frage || "Wähle alle passenden Bilder.", bilder } : null;
    } catch { return null; }
  }

  /* ===== Speicher: Redis (Vercel/Upstash) oder lokale JSON-Datei ===== */
  // Drei Bereiche: Spieler (players), Stationen/Tracking (marks), Einstellungen (meta)
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  const KEY = "sl4:players:" + crypto.createHash("sha256").update(TICKET_TOKEN).digest("hex").slice(0, 12);
  const KEY_MARKS = KEY + ":marks", KEY_META = KEY + ":meta";
  const hashToObj = a => { const o = {}; for (let i = 0; i < (a || []).length; i += 2) o[a[i]] = a[i + 1]; return o; };
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
      async all() { const o = hashToObj(await cmd("HGETALL", KEY)); for (const k in o) o[k] = JSON.parse(o[k]); return o; },
      async mark(id, ev, t) { await cmd("HSETNX", KEY_MARKS, id + "|" + ev, String(t)); await cmd("HSET", KEY_MARKS, id + "|_cur", ev + "|" + t); },
      async incr(id, ev) { await cmd("HINCRBY", KEY_MARKS, id + "|#" + ev, 1); },
      async marks() { return hashToObj(await cmd("HGETALL", KEY_MARKS)); },
      async getMeta(k) { return await cmd("HGET", KEY_META, k); },
      async setMeta(k, v) { await cmd("HSET", KEY_META, k, String(v)); },
      async reset() { await cmd("DEL", KEY, KEY_MARKS); }
    };
  } else if (process.env.VERCEL) {
    const fail = async () => { throw Object.assign(new Error("no-db"), { userMessage: "Rangliste nicht eingerichtet: Bitte Upstash Redis mit dem Vercel-Projekt verbinden (siehe README)." }); };
    store = { kind: "fehlt", get: fail, set: fail, all: fail, mark: fail, incr: fail, marks: fail, getMeta: async () => null, setMeta: fail, reset: fail };
  } else {
    const DATA_FILE = process.env.DATA_FILE || path.join(rootDir, "data.json");
    let data = { players: {}, marks: {}, meta: {} };
    try { data = { players: {}, marks: {}, meta: {}, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) }; } catch {}
    const persist = () => { const tmp = DATA_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, DATA_FILE); };
    store = {
      kind: "datei",
      async get(id) { return data.players[id] ? { ...data.players[id] } : null; },
      async set(id, p) { data.players[id] = p; persist(); },
      async all() { return data.players; },
      async mark(id, ev, t) { const k = id + "|" + ev; if (!(k in data.marks)) data.marks[k] = String(t); data.marks[id + "|_cur"] = ev + "|" + t; persist(); },
      async incr(id, ev) { const k = id + "|#" + ev; data.marks[k] = String(Number(data.marks[k] || 0) + 1); persist(); },
      async marks() { return data.marks; },
      async getMeta(k) { return data.meta[k] ?? null; },
      async setMeta(k, v) { data.meta[k] = String(v); persist(); },
      async reset() { data.players = {}; data.marks = {}; persist(); }
    };
  }

  /* ===== Signierte Cookies ===== */
  const sign = v => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
  function readSigned(req, name) {
    const m = new RegExp("(?:^|;\\s*)" + name + "=([^;]+)").exec(req.headers.cookie || "");
    if (!m) return null;
    const i = m[1].lastIndexOf(".");
    if (i < 1) return null;
    const v = m[1].slice(0, i), sig = m[1].slice(i + 1);
    const a = Buffer.from(sig), b = Buffer.from(sign(name + ":" + v));
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
  }
  function cookie(req, name, v, maxAge) {
    const secure = req.headers["x-forwarded-proto"] === "https" || process.env.SECURE_COOKIE === "1";
    return `${name}=${v}.${sign(name + ":" + v)}; Path=${BASE}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }
  const readSession = req => readSigned(req, "sl4");

  /* ===== Spielphase: vorher / live / ende ===== */
  // Reihenfolge: Vorschau-Cookie (nur dieses Gerät) > globale Einstellung im Monitoring > Zeitplan
  const PHASES = ["before", "live", "ended"];
  async function phaseInfo(req, now) {
    const sim = readSigned(req, "sl4sim");
    let override = null; try { override = await store.getMeta("phase"); } catch {}
    if (!PHASES.includes(override)) override = null;
    const byTime = now < GAME_START ? "before" : now > GAME_END ? "ended" : "live";
    const phase = PHASES.includes(sim) ? sim : override || byTime;
    return { phase, sim: PHASES.includes(sim) ? sim : null, override, byTime, start: GAME_START, end: GAME_END, now };
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
  const isAdmin = req => {
    if (!ADMIN_KEY) return false;
    const a = Buffer.from(String(req.headers["x-admin-key"] || "")), b = Buffer.from(ADMIN_KEY);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  // Stationen, die für das Monitoring gezählt werden
  const EVENTS = ["ticket", "dash", "bot_tip", "retention1", "wheel", "wheel_spin", "retention2", "fangfrage", "agb", "app_sheet", "app_deadend",
    "reason", "rating", "advent_sheet", "queue", "skip", "sign", "survey_sheet", "survey_deadend", "done"];

  // Rangliste: Testläufe (Vorschau-Modus) sehen nur Tester
  async function board(me, withTests) {
    const players = await store.all();
    const all = Object.entries(players).map(([id, p]) => ({ id, ...p })).filter(p => withTests || !p.test);
    const done = all.filter(p => typeof p.bestMs === "number").sort((a, b) => a.bestMs - b.bestMs);
    const active = all.filter(p => p.status === "aktiv");
    const myRank = done.findIndex(p => p.id === me) + 1;
    return {
      top: done.slice(0, 10).map((p, i) => ({ rank: i + 1, name: p.name, bestMs: p.bestMs, me: p.id === me, test: !!p.test })),
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
    // Auf Vercel kommt der Originalpfad per Route als ?__p= an
    const raw = url.searchParams.has("__p") ? "/" + url.searchParams.get("__p") : url.pathname;
    const p = raw.replace(/\/+$/, "");
    if (p !== BASE && !p.startsWith(BASE + "/")) return send(res, 404, "Not found");
    const route = p.slice(BASE.length) || "/";
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    const now = Date.now();

    if (req.method === "GET" && (route === "/" || route === "/monitor")) return send(res, 200, INDEX_HTML);

    // Bilder für die Fehlerseite (optional: Fotos in app/hunde/)
    if (req.method === "GET" && route === "/api/hunde") return send(res, 200, { bilder: listAssets("hunde").map(f => BASE + "/hunde/" + encodeURIComponent(f)) });
    if (req.method === "GET" && route.startsWith("/hunde/")) {
      const name = decodeURIComponent(route.slice("/hunde/".length));
      if (!listAssets("hunde").includes(name)) return send(res, 404, { error: "not found" });
      res.writeHead(200, { "Content-Type": MIME[name.split(".").pop().toLowerCase()], "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex" });
      return res.end(readAsset("hunde/" + name));
    }

    const ph = await phaseInfo(req, now);
    const me0 = readSession(req);

    // Öffentlicher Status (auch ohne PIN): Phase, Zeiten, nach Spielende die finale Rangliste
    if (req.method === "GET" && route === "/api/state") {
      const out = { phase: ph.phase, sim: ph.sim, start: ph.start, end: ph.end, now };
      if (ph.phase === "ended") out.board = await board(me0, !!ph.sim);
      return send(res, 200, out);
    }

    /* --- Admin (Header x-admin-key) --- */
    if (route.startsWith("/api/admin/")) {
      if (!isAdmin(req)) return send(res, 403, { error: "Admin-Key falsch oder nicht gesetzt." });
      const body = req.method === "POST" ? await readBody(req) : {};
      if (route === "/api/admin/check") return send(res, 200, { ok: true });
      if (req.method === "POST" && route === "/api/admin/sim") {
        const v = PHASES.includes(body.phase) ? body.phase : null;
        const c = v ? cookie(req, "sl4sim", v, 86400) : `sl4sim=; Path=${BASE}; HttpOnly; SameSite=Lax; Max-Age=0`;
        return send(res, 200, { ok: true, sim: v }, { "Set-Cookie": c });
      }
      if (req.method === "POST" && route === "/api/admin/phase") {
        await store.setMeta("phase", PHASES.includes(body.phase) ? body.phase : "auto");
        return send(res, 200, { ok: true, ...(await phaseInfo(req, now)) });
      }
      if (req.method === "POST" && route === "/api/admin/reset") { await store.reset(); return send(res, 200, { ok: true }); }
      if (req.method === "GET" && route === "/api/admin/stats") {
        const players = await store.all(), marks = await store.marks();
        const per = {};
        for (const [k, v] of Object.entries(marks)) {
          const i = k.indexOf("|"); const id = k.slice(0, i), ev = k.slice(i + 1);
          (per[id] ||= { reached: {}, counts: {}, cur: null });
          if (ev === "_cur") { const [s, t] = v.split("|"); per[id].cur = { step: s, at: Number(t) }; }
          else if (ev.startsWith("#")) per[id].counts[ev.slice(1)] = Number(v);
          else per[id].reached[ev] = Number(v);
        }
        const list = Object.entries(players).map(([id, pl]) => ({ id, ...pl, ...(per[id] || { reached: {}, counts: {}, cur: null }) }));
        return send(res, 200, { ...ph, events: EVENTS, queueSeconds: QUEUE_SECONDS, storage: store.kind, players: list });
      }
      return send(res, 404, { error: "not found" });
    }

    if (req.method === "POST" && route === "/api/login") {
      if (ph.phase === "before") return send(res, 423, { error: "Noch geschlossen. Die Tür öffnet sich am 27. November um 18:30 Uhr.", phase: ph.phase });
      if (ph.phase === "ended") return send(res, 423, { error: "Das Spiel ist vorbei.", phase: ph.phase });
      if (tooMany(ip)) return send(res, 429, { error: "Zu viele Versuche. Bitte warte ein paar Minuten." });
      const { pin } = await readBody(req);
      const a = Buffer.from(String(pin || "").replace(/\s+/g, "")), b = Buffer.from(EVENT_PIN);
      if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
        attempts.get(ip).push(Date.now());
        return send(res, 401, { error: "Falsche PIN. Schau nochmal genau auf die GoldClub-Karte." });
      }
      const id = me0 || crypto.randomBytes(12).toString("base64url");
      return send(res, 200, { ok: true }, { "Set-Cookie": cookie(req, "sl4", id, 172800) });
    }

    const me = me0;
    if (!me) return send(res, 401, { error: "Bitte zuerst die PIN eingeben." });
    const player = await store.get(me);

    if (req.method === "GET" && route === "/api/me") {
      return send(res, 200, { now, phase: ph.phase, queueSeconds: QUEUE_SECONDS, player: player ? { name: player.name, status: player.status, startedAt: player.startedAt, queueOk: !!(player.queueAt && player.queueAt >= player.startedAt), lastMs: player.lastMs ?? null, bestMs: player.bestMs ?? null } : null });
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

    if (req.method === "GET" && route === "/api/board") return send(res, 200, await board(me, !!ph.sim));

    // Live-Meldungen: wer hat seit `since` gekündigt (ohne einen selbst)
    if (req.method === "GET" && route === "/api/feed") {
      const since = Number(url.searchParams.get("since")) || now;
      const players = await store.all();
      const items = Object.entries(players)
        .filter(([id, q]) => id !== me && q.finishedAt && q.finishedAt > since && (ph.sim || !q.test))
        .map(([, q]) => ({ name: q.name, ms: q.lastMs, at: q.finishedAt }))
        .sort((a, b) => a.at - b.at).slice(-5);
      return send(res, 200, { now, items });
    }

    // Tracking der erreichten Stationen
    if (req.method === "POST" && route === "/api/step") {
      const { ev } = await readBody(req);
      if (!EVENTS.includes(ev) || !player) return send(res, 200, { ok: false });
      if (["wheel_spin", "skip", "app_deadend", "survey_deadend"].includes(ev)) await store.incr(me, ev);
      await store.mark(me, ev, now);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && route === "/api/start") {
      if (ph.phase !== "live") return send(res, 423, { error: ph.phase === "before" ? "Noch geschlossen." : "Das Spiel ist vorbei.", phase: ph.phase });
      const name = cleanName((await readBody(req)).name);
      if (name.length < 2) return send(res, 400, { error: "Bitte gib einen Namen ein." });
      await store.set(me, { ...(player || {}), name, status: "aktiv", startedAt: now, queueAt: null, finishedAt: null, test: !!ph.sim || !!player?.test });
      return send(res, 200, { startedAt: now, now });
    }

    if (!player || player.status !== "aktiv") return send(res, 409, { error: "Kein aktives Abo gefunden." });

    if (req.method === "POST" && route === "/api/queue") {
      await store.set(me, { ...player, queueAt: now });
      return send(res, 200, { ok: true, queueSeconds: QUEUE_SECONDS });
    }

    if (req.method === "POST" && route === "/api/finish") {
      if (ph.phase === "ended") return send(res, 423, { error: "Zu spät: Das Spiel ist um Mitternacht zu Ende gegangen.", phase: ph.phase });
      if (!player.queueAt || player.queueAt < player.startedAt || now - player.queueAt < (QUEUE_SECONDS - 3) * 1000)
        return send(res, 409, { error: "Die Warteschleife lässt sich nicht abkürzen. Netter Versuch." });
      const ms = now - player.startedAt;
      const upd = { ...player, status: "gekündigt", finishedAt: now, lastMs: ms, bestMs: player.bestMs == null ? ms : Math.min(player.bestMs, ms), runs: (player.runs || 0) + 1 };
      await store.set(me, upd);
      await store.mark(me, "done", now);
      return send(res, 200, { ms, bestMs: upd.bestMs, ...(await board(me, !!ph.sim)) });
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
