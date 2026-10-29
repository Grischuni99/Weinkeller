# Mein Weinkeller

Persönliche Wein-App als Ersatz für Vivino: Weine per Foto erfassen, Angaben automatisch vom Etikett lesen und im Internet ergänzen, Flaschen im Keller zählen.

- **App:** GitHub Pages (diese Dateien)
- **Daten und Fotos:** Supabase (kostenloser Plan), sicher online, auf jedem Gerät gleich
- **Etikett-Erkennung mit Internetsuche:** Claude API, der Schlüssel liegt geschützt bei Supabase

Die Einrichtung dauert etwa 20 Minuten und muss nur einmal gemacht werden.

---

## 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) anmelden → **New project**.
2. Name z. B. `weinkeller`, ein Datenbank-Passwort wählen (gut aufbewahren), Region **Central EU (Frankfurt)** oder **Zurich**, falls angeboten.
3. Warten, bis das Projekt bereit ist (1–2 Minuten).

> Nutzt du schon ein Supabase-Projekt für eine andere App, kannst du stattdessen dieses verwenden. Die Weinkeller-Tabellen kommen einfach dazu.

## 2. Datenbank und Foto-Speicher einrichten

1. Im Projekt links **SQL Editor** öffnen → **New query**.
2. Den ganzen Inhalt der Datei `supabase/schema.sql` einfügen → **Run**.
3. Es sollte „Success“ erscheinen.

## 3. Erkennungsfunktion anlegen

1. Links **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name: `analyze-label` (genau so schreiben).
3. Den Inhalt von `supabase/functions/analyze-label/index.ts` einfügen → **Deploy function**.

## 4. Claude-API-Schlüssel hinterlegen

1. Auf [console.anthropic.com](https://console.anthropic.com) unter **API Keys** einen Schlüssel erstellen und etwas Guthaben laden (z. B. 5 $ reichen für viele Weine).
2. In Supabase links **Edge Functions** → **Secrets** → **Add new secret**:
   - Name: `ANTHROPIC_API_KEY`
   - Wert: dein Schlüssel (beginnt mit `sk-ant-`)
3. Speichern.

Den Schlüssel **nie** in `config.js` oder sonst in eine Datei im Repository schreiben.

## 5. App mit Supabase verbinden

1. In Supabase **Project Settings** → **API** (bzw. **Data API**) öffnen.
2. **Project URL** und den Key **anon public** kopieren.
3. In `config.js` eintragen:

```js
window.WEINKELLER_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

Der anon-Key ist öffentlich gedacht. Die Daten sind trotzdem geschützt: Jede Person sieht nur ihre eigenen Weine.

## 6. Auf GitHub veröffentlichen

1. Alle Dateien dieses Ordners ins Repository hochladen (auf github.com: **Add file → Upload files**), inklusive des Ordners `.github`.
2. Im Repository **Settings → Pages** → Source: **Deploy from a branch**, Branch **main**, Ordner **/ (root)** → **Save**.
3. Nach 1–2 Minuten ist die App unter `https://<dein-github-name>.github.io/<repository>/` erreichbar.

## 7. Konto erstellen und absichern

1. In Supabase **Authentication → URL Configuration**: Bei **Site URL** die Adresse deiner App eintragen (aus Schritt 6).
2. Die App öffnen, E-Mail und Passwort eingeben → **Konto erstellen**, dann den Link in der Bestätigungs-E-Mail anklicken.
3. **Wichtig:** Danach in Supabase **Authentication → Sign In / Providers** die Option **Allow new users to sign up** ausschalten. So kann niemand sonst ein Konto in deiner App anlegen.

## 8. Ersten Wein übernehmen

In der App oben rechts **⋯ → Backup einlesen** und die Datei `weinkeller-start.json` wählen. Danach ist der St. Jodern Visperterminen Pinot Noir 2024 mit Foto im Keller. Die Datei kannst du anschliessend aus dem Repository löschen.

## 9. Aufs Handy

App-Adresse im Handy-Browser öffnen → **Teilen → Zum Home-Bildschirm** (iPhone) bzw. **⋮ → Zum Startbildschirm hinzufügen** (Android).

---

## Gut zu wissen

- **Browser-Speicher löschen:** Kein Problem. Danach meldest du dich einfach wieder an. Alle Weine und Fotos liegen bei Supabase.
- **Wach halten:** Kostenlose Supabase-Projekte werden nach einer Woche ohne Zugriff pausiert. Die Aufgabe in `.github/workflows/keep-alive.yml` ruft die Datenbank alle 3 Tage kurz auf und verhindert das. Prüfen kannst du sie im Repository unter **Actions** („Supabase wach halten“ → **Run workflow**).
- **Backup:** Über **⋯ → Backup herunterladen** bekommst du den ganzen Keller inklusive Fotos als eine Datei. Ab und zu eines machen schadet nicht.
- **Kosten:** Supabase kostenlos. Claude API pro erfasstem Wein wenige Rappen (Internetsuche 1 Cent pro Suche, höchstens 4 Suchen pro Wein, plus Textverarbeitung).
- **Modell ändern:** Standard ist `claude-sonnet-5-5`. Ein anderes Modell setzt du mit dem Secret `CLAUDE_MODEL`.
