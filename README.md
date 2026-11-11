# Smily Level 4 – Weihnachtsfeier-App

Ein Escape Game vom Marketing-Team: Gäste scannen den QR-Code auf dem Poster, geben die PIN von der GoldClub-Karte und ihren Namen ein (die Uhr startet) und müssen das Abo „Smily Level 4" so schnell wie möglich wieder kündigen. Die schnellsten Kündigungen landen in der Rangliste.

Die Lösungen stehen in [`LOESUNGEN.md`](LOESUNGEN.md). Diese Datei nicht in ein Repo legen, das Gäste vor der Feier sehen können.

## Ordner
| Datei/Ordner | Inhalt |
|---|---|
| `app/index.html` | Die komplette Oberfläche, alle Texte zum Anpassen |
| `app/captcha/` | Optional: Fotos + `captcha.json` für das Foto-Captcha |
| `lib/core.js` | Server-Logik (PIN, Zeitmessung, Rangliste) |
| `lib/assets.js` | Automatisch erzeugt aus `app/` (`npm run embed`), nicht von Hand bearbeiten |
| `server.js` | Start auf dem eigenen Rechner |
| `api/index.js` + `vercel.json` | Start auf Vercel |
| `scripts/embed.js` | Packt die Oberfläche für Vercel in `lib/assets.js` |
| `setup-vercel.sh` | Einmalige Einrichtung auf Vercel |

## Was nicht ins Repo gehört
Diese Dateien entstehen lokal und sind per `.gitignore` ausgeschlossen:

- `zugangsdaten.txt` – geheimer Link-Teil, Admin-Key, PIN (nur lokal bzw. im Passwortmanager, nie hochladen)
- `.env.local` – von Vercel erzeugt, enthält Zugangstoken
- `.vercel/` – Verknüpfung mit dem Vercel-Projekt
- `data.json` – lokale Testrangliste

Wichtig: Beim Hochladen über die GitHub-Weboberfläche („Upload files") greift die `.gitignore` nicht. Dann diese Dateien nicht mit hineinziehen.

## Schutz
- **Geheimer Link:** Die App ist nur unter `/<TICKET_TOKEN>` erreichbar, alles andere liefert 404. Der Link steckt im QR-Code auf dem Poster.
- **Event-PIN** auf der GoldClub-Karte, max. 10 Fehlversuche pro 10 Minuten.
- Zeiten misst der Server. Kundennummer und Foto-Captcha-Lösung kennt nur der Server.

## Einstellungen (Umgebungsvariablen)
| Variable | Bedeutung | Standard |
|---|---|---|
| `TICKET_TOKEN` | Geheimer Teil der URL (lang und zufällig wählen) | `goldenes-ticket-BITTE-AENDERN` |
| `EVENT_PIN` | PIN auf der GoldClub-Karte | `2412` |
| `KUNDENNUMMER` | Steht auf der GoldClub-Karte (Leerzeichen/Bindestriche bei der Eingabe egal) | `SL4-2412` |
| `QUEUE_SECONDS` | Länge der Warteschleife (mind. 25) | `60` |
| `ADMIN_KEY` | Schlüssel für den Reset der Rangliste (leer = aus) | leer |
| `SESSION_SECRET` | Optional, sonst aus Token und PIN abgeleitet | – |

Die echten Werte stehen nur in den Vercel-Einstellungen und in `zugangsdaten.txt`, nie im Code.

## A) Lokal testen
```bash
TICKET_TOKEN=test node server.js
```
Dann http://localhost:3000/test öffnen (PIN `2412`, Kundennummer `SL4-2412`). Die Rangliste liegt in `data.json`.

## B) Online mit Vercel (über GitHub)
Das Repo ist mit einem Vercel-Projekt verbunden. **Jeder Commit auf `main` wird automatisch veröffentlicht**, auch Änderungen direkt in der GitHub-Weboberfläche. `app/index.html` wird dabei direkt verwendet, ein Zwischenschritt ist nicht nötig.

Der Link lautet `https://<vercel-adresse>/<TICKET_TOKEN>`. Nur dieser Link liefert die App aus, alle anderen Adressen ergeben 404 (dafür sorgt `vercel.json`).

Einmalige Einrichtung im Vercel-Projekt:
1. **Settings → Environment Variables:** `TICKET_TOKEN`, `EVENT_PIN`, `KUNDENNUMMER`, `ADMIN_KEY` eintragen (Werte nur dort und im Passwortmanager ablegen, nie im Repo).
2. **Storage:** „Upstash for Redis" (kostenloser Tarif, Region Frankfurt) anlegen und mit dem Projekt verbinden.
3. **Deployments:** letzten Eintrag → „…" → **Redeploy**, damit die Einstellungen greifen.

Wechsel auf das GoldClub-Repo später: im Vercel-Projekt unter **Settings → Git** das Repo umstellen. Adresse, Einstellungen und Rangliste bleiben dabei erhalten.

`npm run deploy` und `setup-vercel.sh` sind nur noch für einen Deploy ohne GitHub gedacht und werden normalerweise nicht gebraucht.

Hinweis: Der Hobby-Tarif von Vercel ist laut Vercel für nicht-kommerzielle Nutzung gedacht; für eine interne Feier ggf. kurz klären. Ohne verbundene Datenbank zeigt die App auf Vercel „Rangliste nicht eingerichtet".

## Foto-Captcha (optional)
Neun Fotos in `app/captcha/` legen, `captcha.beispiel.json` zu `captcha.json` kopieren und bei den richtigen Fotos `"richtig": true` setzen. Ohne `captcha.json` erscheint das Leitlinien-Captcha. Danach neu deployen.

## Rangliste leeren (nach dem Testen und nach der Feier)
```bash
curl -X POST -H "x-admin-key: <ADMIN_KEY>" https://<vercel-adresse>/<TICKET_TOKEN>/api/admin/reset
```
Lokal reicht es, `data.json` zu löschen. Nach der Feier zusätzlich die Upstash-Datenbank im Vercel-Dashboard löschen. Gespeichert sind nur Spitznamen und Zeiten.

## Vor Ort
- **Poster:** QR-Code mit dem geheimen Link.
- **GoldClub-Karte:** Kundennummer (`SL4-2412`) und PIN aufdrucken. Beide müssen mit den Vercel-Einstellungen übereinstimmen.
