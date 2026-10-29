// Supabase Edge Function "analyze-label"
// 1) Standard: liest ein Weinetikett (Bild) und ergänzt die Angaben mit einer Internetsuche über die Claude API.
// 2) mode "rating": sucht für einen bereits erfassten Wein nur die Bewertung im Internet (ohne Bild).
// Benötigt das Secret ANTHROPIC_API_KEY (Dashboard → Edge Functions → Secrets).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";

const RATING_RULES = `Bewertung aus dem Internet ("extRating"): Suche eine öffentlich sichtbare Bewertung genau dieses Weins, bevorzugt für diesen Jahrgang.
Reihenfolge der Quellen: Vivino (Durchschnitt der Nutzer, Skala 5), dann Weinführer und Kritiker wie Falstaff, Gault&Millau, Robert Parker, James Suckling, Decanter, Wine Spectator (meist Skala 100 oder 20).
Übernimm die Zahl nur, wenn du sie auf einer gefundenen Seite tatsächlich gesehen hast, und gib diese Seite als url an. Schätze nie, rechne nie um, erfinde nie.
Ist der Jahrgang nicht bewertet, darf es eine Bewertung über alle Jahrgänge sein; dann vintageOnly=false.
Findest du nichts Verlässliches: "extRating": null.
Form: {"value":"3.9","scale":"5","source":"Vivino","count":"1200","url":"https://…","vintageOnly":true}`;

const PROMPT = `Du bist Sommelier und hilfst, einen privaten Weinkeller in der Schweiz zu katalogisieren.
Auf dem Bild ist ein Weinetikett (oder ein Screenshot davon).

1. Lies alle Angaben vom Etikett ab.
2. Suche im Internet nach genau diesem Wein (Weingut, Name, Jahrgang), am besten auf der Website des Weinguts oder bei seriösen Händlern und Weinführern. Ergänze damit: Rebsorte(n), Region, Land, Trinkfenster, Geschmacksprofil, Speiseempfehlungen, ungefährer Preis in der Schweiz, eine Bewertung und eine kurze Beschreibung (2–3 Sätze, sachlich, Schweizer Rechtschreibung ohne ß).
3. Erfinde nichts. Was du nicht findest oder nicht sicher weisst, lässt du leer ("" bzw. null).
4. "foundOnline": true, wenn du im Internet Angaben genau zu diesem Wein gefunden hast; false, wenn nur das Etikett ausgewertet werden konnte. "labelReadable": false, wenn auf dem Bild kein lesbares Weinetikett ist.

Antworte am Schluss NUR mit einem JSON-Objekt in genau dieser Form, ohne Text davor oder danach:
{"producer":"","name":"","vintage":"","color":"rot|weiss|rose|schaum|suess","grape":"","appellation":"","region":"","country":"","alcohol":"","volume":"","price":"","drinkFrom":"","drinkTo":"","profile":{"acidity":null,"body":null,"sweetness":null,"tannin":null},"pairings":[],"description":"","extRating":null,"sources":[{"title":"","url":""}],"foundOnline":true,"labelReadable":true,"confidence":"hoch|mittel|tief"}

${RATING_RULES}

Für "pairings": zuerst 1–4 passende Gruppen genau aus dieser Liste wählen: "Rotes Fleisch", "Weisses Fleisch & Geflügel", "Wild", "Fisch", "Meeresfrüchte", "Käse", "Vegetarisch", "Pasta & Pizza", "Asiatisch & scharf", "Apéro & Vorspeisen", "Dessert". Danach optional 1–3 konkrete Gerichte (z. B. "Kalbsgeschnetzeltes").
Hinweise: profile-Werte sind Zahlen 1–5 (acidity 1=weich 5=säurehaltig, body 1=leicht 5=üppig, sweetness 1=trocken 5=süss, tannin 1=sanft 5=tanninhaltig; bei Weisswein tannin null). alcohol nur Zahl ("13.5"), volume in cl als Zahl ("75"), Jahreszahlen vierstellig, price z. B. "CHF 24".`;

const ratingPrompt = (w: Record<string, unknown>) => `Suche im Internet eine Bewertung für diesen Wein:
Weingut: ${w.producer || "?"} · Wein: ${w.name || "?"} · Jahrgang: ${w.vintage || "?"} · Rebsorte: ${w.grape || "?"} · Region: ${w.region || "?"}, ${w.country || "?"}

${RATING_RULES}

Antworte am Schluss NUR mit JSON, ohne Text davor oder danach: {"extRating": … oder null}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function askClaude(key: string, content: unknown[], maxUses: number) {
  const messages: unknown[] = [{ role: "user", content }];
  let text = "";
  // Bei langen Suchen kann die API mit "pause_turn" unterbrechen; dann einfach weiterführen.
  for (let i = 0; i < 4; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        messages,
        tools: [{
          type: "web_search_20250305", name: "web_search", max_uses: maxUses,
          user_location: { type: "approximate", country: "CH", timezone: "Europe/Zurich" },
        }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return { error: `Claude API Fehler ${r.status}`, detail: detail.slice(0, 500) };
    }
    const data = await r.json();
    text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    if (data.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: data.content });
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "Keine verwertbare Antwort erhalten" };
  try { return { result: JSON.parse(m[0]) }; }
  catch { return { error: "Antwort war kein gültiges JSON" }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY fehlt in den Supabase-Secrets." }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400); }

  // Nur Bewertung suchen
  if (body.mode === "rating") {
    const w = (body.wine ?? {}) as Record<string, unknown>;
    if (!w.producer && !w.name) return json({ error: "Weingut oder Wein fehlt" }, 400);
    const out = await askClaude(key, [{ type: "text", text: ratingPrompt(w) }], 3);
    if ("error" in out) return json(out, 502);
    return json(out.result);
  }

  // Etikett auswerten
  const image = String(body.image ?? "");
  const mediaType = String(body.mediaType ?? "image/jpeg");
  if (!image || image.length > 7_000_000) return json({ error: "Kein oder zu grosses Bild" }, 400);
  const out = await askClaude(key, [
    { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
    { type: "text", text: PROMPT },
  ], 5);
  if ("error" in out) return json(out, 502);
  return json(out.result);
});
