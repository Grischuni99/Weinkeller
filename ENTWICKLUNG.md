# Weinkeller – Entwickler-Notiz

Diese Notiz beschreibt, wie die App aufgebaut ist, damit sie später (auch in einem neuen Claude-Chat) gezielt erweitert werden kann.

**Kurzfassung für einen neuen Chat:**
> Ich möchte meine Weinkeller-App erweitern. Code: GitHub `Grischuni99/Weinkeller` (GitHub Pages), Daten: Supabase-Projekt „Weinkeller“. Lies zuerst `ENTWICKLUNG.md`. Ich möchte …

---

## Überblick

| Teil | Wo | Wofür |
|---|---|---|
| App (Oberfläche) | GitHub Pages: https://grischuni99.github.io/Weinkeller/ | Eine einzige Seite `index.html`, läuft im Browser und auf dem Handy-Home-Bildschirm |
| Daten | Supabase-Projekt „Weinkeller“ (Ref `aqujdwzerevsuwfixjsu`, Region eu-west-1, Gratis-Plan) | Tabelle `wines`, Foto-Speicher `wine-photos`, Anmeldung |
| Etikett-Erkennung | Supabase Edge Function `analyze-label` | Schickt das Foto an die Claude API mit Websuche, liefert JSON zurück |
| Wach halten | GitHub Action `.github/workflows/keep-alive.yml` | Ruft alle 3 Tage `rpc/ping` auf, damit Supabase nicht pausiert; committet alle ~45 Tage `.keepalive`, damit GitHub die Aufgabe nicht abschaltet |

Ablauf beim Erfassen: Foto → im Browser auf max. 1400 px verkleinert → Upload nach `wine-photos/<user-id>/<uuid>.jpg` → `functions.invoke("analyze-label")` → Formular wird vorausgefüllt → Benutzer prüft → Speichern in `wines`.

---

## Dateien im Repository

| Datei | Inhalt |
|---|---|
| `index.html` | Die ganze App: HTML, CSS und JavaScript in einer Datei. Lädt `supabase-js` 2.45.4 (UMD) von jsDelivr und Google Fonts |
| `config.js` | Supabase-URL und öffentlicher **anon**-Key. Kein Geheimnis. Niemals hier: service_role-Key oder Claude-API-Schlüssel |
| `manifest.webmanifest`, `icons/` | Für „Zum Home-Bildschirm“ (Name, Farben, Icons 192/512) |
| `README.md` | Einrichtungsanleitung von Grund auf |
| `.github/workflows/keep-alive.yml` | Wach-halten-Aufgabe (siehe oben) |
| `supabase/schema.sql` | Datenbank-Setup (Tabellen, Regeln, Bucket, ping) – nur zur Dokumentation, wird nicht automatisch ausgeführt |
| `supabase/functions/analyze-label/index.ts` | Quellcode der Edge Function – Änderungen müssen im Supabase-Dashboard eingespielt werden |

---

## Datenbank

### Tabelle `public.wines`

| Spalte | Typ | Bedeutung | Feld in der App |
|---|---|---|---|
| `id` | uuid, PK | | `id` |
| `user_id` | uuid, default `auth.uid()` | Besitzer | – |
| `producer` | text | Weingut | `producer` |
| `name` | text | Weinname | `name` |
| `vintage` | text | Jahrgang | `vintage` |
| `color` | text | `rot` / `weiss` / `rose` / `schaum` / `suess` | `color` |
| `grape` | text | Rebsorte(n) | `grape` |
| `appellation` | text | z. B. AOC Wallis | `appellation` |
| `region`, `country` | text | | `region`, `country` |
| `alcohol` | text | Zahl als Text, z. B. "14" | `alcohol` |
| `volume` | text | cl, z. B. "75" | `volume` |
| `price` | text | frei, z. B. "CHF 24" | `price` |
| `drink_from`, `drink_to` | text | Trinkfenster (Jahre) | `drinkFrom`, `drinkTo` |
| `profile` | jsonb | `{acidity, body, sweetness, tannin}` je 1–5 | `profile` |
| `pairings` | text[] | Speiseempfehlungen | `pairings` |
| `description` | text | Beschreibung | `description` |
| `source` | text | 1. Zeile Hinweis, weitere Zeilen `Titel \| URL` (Quellen) | `source` |
| `notes` | text | eigene Notizen | `notes` |
| `rating` | int | eigene Sterne 0–5 | `rating` |
| `bottles` | int ≥ 0 | Flaschen im Keller | `bottles` |
| `photo_path` | text | Pfad im Bucket `wine-photos` | `photoPath` |
| `created_at`, `updated_at` | timestamptz | `updated_at` per Trigger `wines_touch` | |

**Zugriffsregeln (RLS):** Jede Person liest, erstellt, ändert und löscht nur Zeilen mit `user_id = auth.uid()`.

### Foto-Speicher `wine-photos`
Privater Bucket. Pfad `<user-id>/<uuid>.jpg`. Regeln: nur eigener Ordner (lesen, hochladen, löschen). Anzeige über signierte URLs (12 h gültig).

### Funktion `public.ping()`
Gibt `'ok'` zurück, für die Wach-halten-Aufgabe (anon darf sie aufrufen, gibt keine Daten preis).

---

## Supabase-Einstellungen

- **Authentication → URL Configuration → Site URL:** `https://grischuni99.github.io/Weinkeller/` (grosses W)
- **Authentication → Sign In / Providers:** „Allow new users to sign up“ ist **aus** (nur ein Konto). Für ein weiteres Konto kurz einschalten oder unter Users → „Add user“ anlegen.
- **Edge Functions → Secrets:** `ANTHROPIC_API_KEY` (Claude API). Optional `CLAUDE_MODEL` (Standard `claude-sonnet-5-5`).
- **API-Keys:** Die App nutzt den Legacy-**anon**-Key (JWT). Der service_role-Key wird nirgends verwendet.

Claude API: Konto auf platform.claude.com („Daniel’s Individual Org“), Guthaben ohne automatisches Aufladen. Websuche `web_search_20250305`, max. 4 Suchen pro Etikett.

---

## Aufbau von `index.html` (JavaScript)

Alles steckt in einer Funktion am Ende der Datei. Wichtige Teile, in dieser Reihenfolge:

| Abschnitt | Wichtige Namen |
|---|---|
| Konstanten | `COLORS` (Weinarten), `PROFILE` (4 Geschmacksregler), `FIELDS` (Textfelder des Formulars), `BUCKET` |
| Datenbank | `toRow(w)` App → Spalten, `fromRow(r)` Spalten → App, `loadWines()`, `saveWine(w)`, `uploadPhoto(blob)`, `refreshPhotoUrls()` |
| Liste | `renderChips()`, `renderStats()`, `matches(w)` (Suche/Filter), `renderList()`, `setBottles(id, n)` |
| Details | `openDetail(id)`, `windowHtml(w)` (Trinkfenster), `profileHtml(p)`, `sourcesHtml(src)` |
| Formular | `formHtml(w)`, `readForm()`, `openForm(w)`, `fillForm(info)` (übernimmt Erkennungsergebnis, überschreibt keine bereits ausgefüllten Felder) |
| Foto & Erkennung | `resize()`, `handlePhoto(file)` |
| Backup | `exportBackup()` (JSON inkl. Fotos als data-URL), `importBackup(file)` (überspringt gleiche Weingut+Name+Jahrgang) |
| Anmeldung | `auth("login"/"signup")`, `onSession(session)` |

Design: Farben als CSS-Variablen in `:root` mit Dark-Mode-Varianten (`--wine` ist die Akzentfarbe). Schriften: Bodoni Moda (Titel), Figtree (Text), IBM Plex Mono (Zahlen).

Sprache der Oberfläche: Deutsch (Schweiz), ohne ß.

---

## Rezept: ein neues Feld hinzufügen (Beispiel „Lagerort“)

1. **Supabase → SQL Editor:**
   ```sql
   alter table public.wines add column if not exists location text default '';
   ```
2. **`index.html`:**
   - in `toRow` ergänzen: `location: w.location || ""`
   - in `fromRow` ergänzen: `location: r.location`
   - in `FIELDS` den Namen `"location"` ergänzen
   - in `formHtml` ein Eingabefeld mit `name="location"` und `id="f-location"` einbauen
   - in `openDetail` bei `facts` eine Zeile `["Lagerort", w.location]` ergänzen
   - optional: in `matches` in die Suche aufnehmen
3. Soll die Erkennung das Feld füllen: Prompt und JSON-Form in `analyze-label/index.ts` ergänzen, im Dashboard neu deployen, und in `fillForm` übernehmen.
4. Backup funktioniert automatisch mit (es speichert alle Felder).

## Änderungen veröffentlichen

- **App:** geänderte Datei(en) auf GitHub ersetzen (Add file → Upload files → Commit changes). Nach 1–2 Minuten live; im Browser mit Ctrl+F5 neu laden.
- **Datenbank:** SQL im Supabase SQL Editor ausführen und `supabase/schema.sql` nachführen.
- **Edge Function:** Code im Supabase-Dashboard unter Edge Functions → `analyze-label` → Code ersetzen → Deploy; `supabase/functions/analyze-label/index.ts` im Repository nachführen.

Bestehende Daten bleiben bei App-Änderungen immer erhalten. Vor grösseren Datenbank-Änderungen: in der App ⋯ → **Backup herunterladen**.

---

## Bekannte Grenzen und Ideen

- Nur ein Benutzerkonto vorgesehen (Registrierung geschlossen).
- Keine Offline-Nutzung (kein Service Worker).
- Supabase-Gratis-Plan: 500 MB Datenbank, 1 GB Fotos, 2 aktive Projekte pro Konto.
- Ideen: Lagerort, Wunschliste, Statistik nach Region/Jahrgang, Erinnerung bei Trinkfenster-Ende, Kaufpreis und Kaufort, Verkostungsnotizen mit Datum.
