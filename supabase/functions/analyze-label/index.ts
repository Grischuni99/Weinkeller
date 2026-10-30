// Supabase Edge Function "analyze-label"
// Nur für angemeldete Benutzer der Weinkeller-App.
//   mode "label"  (Standard): liest das Etikett auf dem Foto – OHNE Internetsuche (günstig).
//   mode "enrich": ergänzt einen Wein mit einer Internetsuche (auf Knopfdruck in der App).
//   mode "rating": sucht nur die Bewertung eines Weins im Internet.
// Benötigt das Secret ANTHROPIC_API_KEY (Dashboard → Edge Functions → Secrets).
// Optional: CLAUDE_MODEL (Standard claude-haiku-5-5), MAX_SEARCHES (Standard 2).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-5-5";
const MAX_SEARCHES = Math.max(1, Math.min(5, Number(Deno.env.get("MAX_SEARCHES") ?? 2)));

const JSON_FORM = `{"producer":"","name":"","vintage":"","color":"rot|weiss|rose|schaum|suess","grape":"","appellation":"","region":"","country":"","alcohol":"","volume":"","price":"","drinkFrom":"","drinkTo":"","profile":{"acidity":null,"body":null,"sweetness":null,"tannin":null},"pairings":[],"description":"","extRating":null,"sources":[{"title":"","url":""}],"foundOnline":true,"labelReadable":true,"confidence":"hoch|mittel|tief"}`;

const PAIRING_RULES = `Für "pairings": 1–4 passende Gruppen genau aus dieser Liste: "Rotes Fleisch", "Weisses Fleisch & Geflügel", "Wild", "Fisch", "Meeresfrüchte", "Käse", "Vegetarisch", "Pasta & Pizza", "Asiatisch & scharf", "Apéro & Vorspeisen", "Dessert". Optional danach 1–3 konkrete Gerichte.`;
const FORMAT_RULES = `profile-Werte sind Zahlen 1–5 (acidity 1=weich 5=säurehaltig, body 1=leicht 5=üppig, sweetness 1=trocken 5=süss, tannin 1=sanft 5=tanninhaltig; bei Weisswein tannin null). alcohol nur Zahl ("13.5"), volume in cl als Zahl ("75"), Jahreszahlen vierstellig, price z. B. "CHF 24". Schweizer Rechtschreibung ohne ß.`;

const RATING_RULES = `Bewertung ("extRating"): eine öffentlich sichtbare Bewertung genau dieses Weins, bevorzugt für diesen Jahrgang.
Quellen in dieser Reihenfolge: Vivino (Skala 5), dann Falstaff, Gault&Millau, Parker, Suckling, Decanter, Wine Spectator (Skala 100 oder 20).
Nur übernehmen, wenn du die Zahl auf einer gefundenen Seite gesehen hast; diese Seite als url. Nie schätzen, umrechnen oder erfinden.
Bewertung über alle Jahrgänge erlaubt, dann vintageOnly=false. Nichts Verlässliches: "extRating": null.
Form: {"value":"3.9","scale":"5","source":"Vivino","count":"1200","url":"https://…","vintageOnly":true}`;

const LABEL_PROMPT = `Du hilfst, einen privaten Weinkeller in der Schweiz zu katalogisieren. Auf dem Bild ist ein Weinetikett (oder ein Screenshot davon).
Lies alle Angaben ab, die auf dem Etikett stehen. Leite nur ab, was sicher daraus folgt (z. B. Weinart aus der Rebsorte, Land aus der Appellation).
"pairings" darfst du aus allgemeinem Weinwissen zur Rebsorte und Region vorschlagen. Alles andere (Trinkfenster, Preis, Beschreibung, Bewertung, Geschmacksprofil) lässt du leer bzw. null – das wird später im Internet ergänzt.
"labelReadable": false, wenn auf dem Bild kein lesbares Weinetikett ist. "foundOnline": false.
${PAIRING_RULES}
${FORMAT_RULES}
Antworte NUR mit einem JSON-Objekt in genau dieser Form, ohne Text davor oder danach:
${JSON_FORM}`;

const wineLine = (w: Record<string, unknown>) =>
  `Weingut: ${w.producer || "?"} · Wein: ${w.name || "?"} · Jahrgang: ${w.vintage || "?"} · Rebsorte: ${w.grape || "?"} · Appellation: ${w.appellation || "?"} · Region: ${w.region || "?"}, ${w.country || "?"}`;

const enrichPrompt = (w: Record<string, unknown>) => `Du bist Sommelier und hilfst, einen privaten Weinkeller in der Schweiz zu katalogisieren.
Suche im Internet nach genau diesem Wein (höchstens ${MAX_SEARCHES} Suchen, am besten Website des Weinguts, seriöse Händler, Weinführer, Vivino):
${wineLine(w)}
Ergänze: Rebsorte(n), Region, Land, Trinkfenster, Geschmacksprofil, Speiseempfehlungen, ungefährer Preis in der Schweiz, eine Bewertung und eine kurze Beschreibung (2–3 Sätze, sachlich).
Übernimm die bekannten Angaben oben unverändert. Erfinde nichts; was du nicht findest, bleibt leer ("" bzw. null).
"foundOnline": true, wenn du Angaben genau zu diesem Wein gefunden hast, sonst false. "labelReadable": true.
${RATING_RULES}
${PAIRING_RULES}
${FORMAT_RULES}
Antworte am Schluss NUR mit einem JSON-Objekt in genau dieser Form, ohne Text davor oder danach:
${JSON_FORM}`;

const ratingPrompt = (w: Record<string, unknown>) => `Suche im Internet (höchstens ${MAX_SEARCHES} Suchen) eine Bewertung für diesen Wein:
${wineLine(w)}
${RATING_RULES}
Antworte am Schluss NUR mit JSON, ohne Text davor oder danach: {"extRating": … oder null}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Prüft, ob die Anfrage von einem angemeldeten Benutzer kommt (nicht nur mit dem öffentlichen anon-Key).
async function isSignedIn(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const base = Deno.env.get("SUPABASE_URL");
  if (!auth.startsWith("Bearer ") || !base) return false;
  const r = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!r.ok) return false;
  const u = await r.json().catch(() => null);
  return !!u?.id;
}

async function askClaude(key: string, content: unknown[], useSearch: boolean) {
  const messages: unknown[] = [{ role: "user", content }];
  const tools = useSearch ? [{
    type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES,
    user_location: { type: "approximate", country: "CH", timezone: "Europe/Zurich" },
  }] : undefined;
  let text = "";
  // Bei langen Suchen kann die API mit "pause_turn" unterbrechen; dann weiterführen.
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages, ...(tools ? { tools } : {}) }),
    });
    if (!r.ok) {
      const detail = await r.text();
      const low = detail.toLowerCase();
      const hint = low.includes("credit") || low.includes("balance") ? " – Guthaben bei Anthropic aufgebraucht" : "";
      return { error: `Claude API Fehler ${r.status}${hint}`, detail: detail.slice(0, 400) };
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
  if (!(await isSignedIn(req))) return json({ error: "Bitte in der Weinkeller-App anmelden." }, 401);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY fehlt in den Supabase-Secrets." }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400); }
  const mode = String(body.mode ?? "label");

  if (mode === "enrich" || mode === "rating") {
    const w = (body.wine ?? {}) as Record<string, unknown>;
    if (!w.producer && !w.name) return json({ error: "Bitte zuerst Weingut oder Wein eintragen." }, 400);
    const prompt = mode === "enrich" ? enrichPrompt(w) : ratingPrompt(w);
    const out = await askClaude(key, [{ type: "text", text: prompt }], true);
    if ("error" in out) return json(out, 502);
    return json(out.result);
  }

  // mode "label": nur Etikett lesen, keine Internetsuche
  const image = String(body.image ?? "");
  const mediaType = String(body.mediaType ?? "image/jpeg");
  if (!image || image.length > 7_000_000) return json({ error: "Kein oder zu grosses Bild" }, 400);
  const out = await askClaude(key, [
    { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
    { type: "text", text: LABEL_PROMPT },
  ], false);
  if ("error" in out) return json(out, 502);
  return json(out.result);
});
