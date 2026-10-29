// Supabase Edge Function "analyze-label"
// Liest ein Weinetikett und ergänzt die Angaben mit einer Internetsuche über die Claude API.
// Benötigt das Secret ANTHROPIC_API_KEY (Dashboard → Edge Functions → Secrets).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";

const PROMPT = `Du bist Sommelier und hilfst, einen privaten Weinkeller in der Schweiz zu katalogisieren.
Auf dem Bild ist ein Weinetikett (oder ein Screenshot davon).

1. Lies alle Angaben vom Etikett ab.
2. Suche im Internet nach genau diesem Wein (Weingut, Name, Jahrgang), am besten auf der Website des Weinguts oder bei seriösen Händlern und Weinführern. Ergänze damit: Rebsorte(n), Region, Land, Trinkfenster, Geschmacksprofil, Speiseempfehlungen, ungefährer Preis in der Schweiz und eine kurze Beschreibung (2–3 Sätze, sachlich, Schweizer Rechtschreibung ohne ß).
3. Erfinde nichts. Was du nicht findest oder nicht sicher weisst, lässt du leer ("" bzw. null).

Antworte am Schluss NUR mit einem JSON-Objekt in genau dieser Form, ohne Text davor oder danach:
{"producer":"","name":"","vintage":"","color":"rot|weiss|rose|schaum|suess","grape":"","appellation":"","region":"","country":"","alcohol":"","volume":"","price":"","drinkFrom":"","drinkTo":"","profile":{"acidity":null,"body":null,"sweetness":null,"tannin":null},"pairings":[],"description":"","sources":[{"title":"","url":""}],"confidence":"hoch|mittel|tief"}

Für "pairings": zuerst 1–4 passende Gruppen genau aus dieser Liste wählen: "Rotes Fleisch", "Weisses Fleisch & Geflügel", "Wild", "Fisch", "Meeresfrüchte", "Käse", "Vegetarisch", "Pasta & Pizza", "Asiatisch & scharf", "Apéro & Vorspeisen", "Dessert". Danach optional 1–3 konkrete Gerichte (z. B. "Kalbsgeschnetzeltes").
Hinweise: profile-Werte sind Zahlen 1–5 (acidity 1=weich 5=säurehaltig, body 1=leicht 5=üppig, sweetness 1=trocken 5=süss, tannin 1=sanft 5=tanninhaltig; bei Weisswein tannin null). alcohol nur Zahl ("13.5"), volume in cl als Zahl ("75"), Jahreszahlen vierstellig, price z. B. "CHF 24".`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY fehlt in den Supabase-Secrets." }, 500);

  let image = "", mediaType = "image/jpeg";
  try {
    const body = await req.json();
    image = String(body.image ?? "");
    mediaType = String(body.mediaType ?? "image/jpeg");
  } catch { return json({ error: "Ungültige Anfrage" }, 400); }
  if (!image || image.length > 7_000_000) return json({ error: "Kein oder zu grosses Bild" }, 400);

  const messages: unknown[] = [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
      { type: "text", text: PROMPT },
    ],
  }];

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
          type: "web_search_20250305", name: "web_search", max_uses: 4,
          user_location: { type: "approximate", country: "CH", timezone: "Europe/Zurich" },
        }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return json({ error: `Claude API Fehler ${r.status}`, detail: detail.slice(0, 500) }, 502);
    }
    const data = await r.json();
    text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    if (data.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: data.content });
  }

  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return json({ error: "Keine verwertbare Antwort erhalten" }, 502);
  try { return json(JSON.parse(m[0])); }
  catch { return json({ error: "Antwort war kein gültiges JSON" }, 502); }
});
