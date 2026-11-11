#!/bin/bash
# Smily Level 4 – Einrichtung auf Vercel (einmalig)
set -e
cd "$(dirname "$0")"
PROJECT="sl4-weihnachten"
VC="npx --yes vercel@65"

echo ""
echo "== 1/4 Projekt bei Vercel anlegen =="
echo "   (Beim ersten Mal öffnet sich der Browser zum Einloggen.)"
$VC link --yes --project "$PROJECT"

echo ""
echo "== 2/4 Einstellungen setzen =="
if [ -f zugangsdaten.txt ]; then
  source zugangsdaten.txt
else
  TICKET_TOKEN="$(openssl rand -hex 12)"
  ADMIN_KEY="$(openssl rand -hex 12)"
  EVENT_PIN="2412"
  KUNDENNUMMER="SL4-2412"
  printf 'TICKET_TOKEN=%s\nADMIN_KEY=%s\nEVENT_PIN=%s\nKUNDENNUMMER=%s\n' "$TICKET_TOKEN" "$ADMIN_KEY" "$EVENT_PIN" "$KUNDENNUMMER" > zugangsdaten.txt
fi
for VAR in TICKET_TOKEN ADMIN_KEY EVENT_PIN KUNDENNUMMER; do
  $VC env rm "$VAR" production --yes >/dev/null 2>&1 || true
  printf '%s' "${!VAR}" | $VC env add "$VAR" production >/dev/null
  echo "   ✓ $VAR"
done

echo ""
echo "== 3/4 Datenbank für die Rangliste verbinden =="
echo "   Öffne https://vercel.com/dashboard → Projekt \"$PROJECT\" → Storage"
echo "   → \"Upstash for Redis\" (kostenlos) anlegen → mit dem Projekt verbinden."
read -r -p "   Drücke Enter, sobald die Datenbank verbunden ist … " _

echo ""
echo "== 4/4 Live schalten =="
$VC --prod --yes

echo ""
echo "=============================================="
echo " Fertig! Dein Link (für den QR-Code):"
echo " https://$PROJECT.vercel.app/$TICKET_TOKEN"
echo " PIN: $EVENT_PIN   ·   Kundennummer: $KUNDENNUMMER"
echo " Zugangsdaten liegen in zugangsdaten.txt (nicht teilen)."
echo " Falls Vercel einen anderen Namen vergeben hat: Link oben im Output prüfen."
echo "=============================================="
