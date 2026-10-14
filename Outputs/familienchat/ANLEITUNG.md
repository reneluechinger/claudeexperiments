# BRÄssenger einrichten

Diese Anleitung führt dich in etwa **45 Minuten** von null zur fertigen App auf deinem Handy. Du brauchst kein Vorwissen. Alles ist kostenlos.

## So hängt alles zusammen

Stell dir den Chat wie einen Briefkasten vor:

- **Supabase** ist das Postamt. Es nimmt die Briefe entgegen und bewahrt sie auf. Die Briefe sind aber versiegelt, das Postamt kann sie nicht lesen.
- **Netlify** ist das Schaufenster. Dort holt sich das Handy die App ab.
- **Die App auf dem Handy** hat den einzigen Schlüssel zum Öffnen der Briefe.

```
 Handy Anna  ──┐                         ┌──  Handy Bert
 (Schlüssel A) │   ┌─────────────────┐   │   (Schlüssel B)
               ├──►│ Supabase        │◄──┤
               │   │ nur versiegelte │   │
               │   │ Nachrichten     │   │
               │   └─────────────────┘   │
               └──── App von Netlify ────┘
```

## Was du brauchst

- [ ] Eine E-Mail-Adresse für die Konten
- [ ] Einen Computer (für die Einrichtung, später nicht mehr)
- [ ] Den Ordner `app` und den Ordner `supabase` aus diesem Projekt auf deinem Computer. Auf GitHub: **Code → Download ZIP**, dann entpacken. Die Dateien liegen unter `Outputs/familienchat/`.

---

## Schritt 1: Supabase-Projekt anlegen (10 Min.)

1. Gehe auf **supabase.com** und klicke auf **Start your project**. Melde dich mit GitHub oder E-Mail an.
2. Klicke auf **New project**.
   - **Name:** zum Beispiel `familienchat`
   - **Database Password:** auf «Generate» klicken. Du brauchst es später nicht, notiere es trotzdem.
   - **Region:** **Central EU (Frankfurt)** oder **Zurich**, falls angeboten. So bleiben die Daten in Europa.
3. Klicke auf **Create new project** und warte etwa 2 Minuten.

## Schritt 2: Datenbank einrichten (5 Min.)

1. Links im Menü: **SQL Editor**.
2. Öffne auf deinem Computer die Datei `supabase/setup.sql` mit einem Texteditor. Markiere alles und kopiere es.
3. Füge den Text im SQL Editor ein und klicke auf **Run**.
4. Unten erscheint **«Dein Start-Code»**, zum Beispiel `7F3K9-Q2M8D`. **Schreib ihn auf.** Mit diesem Code wirst du selbst Admin.

> Kommt eine Warnung zu «destructive operations»? Das liegt an den `drop policy`-Zeilen. Sie räumen nur alte Regeln auf. Bestätige mit **Run this query**.

## Schritt 3: Anmeldung einstellen (3 Min.)

1. Links: **Authentication** → **Sign In / Providers** (bei älteren Versionen: **Providers → Email**).
2. Schalte **Confirm email** **aus** und speichere.

Warum? Der kostenlose E-Mail-Versand von Supabase schickt nur an Mitglieder deines Supabase-Teams. Ohne diese Einstellung könnte sich deine Familie nicht registrieren. Der Schutz kommt trotzdem vom Einladungscode: Ohne Code sieht niemand etwas.

## Schritt 4: Push-Benachrichtigungen vorbereiten (10 Min.)

**4a. Schlüssel erzeugen**

1. Öffne die Datei `app/vapid.html` per Doppelklick im Browser (Chrome, Edge oder Safari).
2. Klicke auf **Schlüssel erzeugen**. Lass die Seite offen.

**4b. Schlüssel in Supabase hinterlegen**

1. In Supabase links: **Edge Functions** → **Secrets** (manchmal unter **Project Settings → Edge Functions**).
2. Lege drei Einträge an:

| Name | Wert |
|---|---|
| `VAPID_PUBLIC_KEY` | erster Wert aus der Seite |
| `VAPID_PRIVATE_KEY` | zweiter Wert aus der Seite |
| `VAPID_SUBJECT` | `mailto:` plus deine E-Mail, z. B. `mailto:rene@example.ch` |

**4c. Funktion «notify» anlegen**

1. Links: **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name: genau **`notify`**
3. Lösche den Beispieltext. Kopiere den Inhalt von `supabase/functions/notify/index.ts` hinein.
4. Klicke auf **Deploy function**.

## Schritt 5: App mit deinem Projekt verbinden (3 Min.)

1. In Supabase links: **Project Settings** → **API Keys** (oder oben der Knopf **Connect**).
2. Kopiere die **Project URL** und den **Publishable key** (beginnt mit `sb_publishable_`). Bei älteren Projekten heisst er **anon public**.
3. Öffne `app/config.js` mit einem Texteditor und ersetze die beiden Platzhalter:

```js
SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
SUPABASE_KEY: 'sb_publishable_xxxxxxxx',
APP_NAME: 'BRÄssenger',
```

`APP_NAME` ist schon auf **BRÄssenger** gesetzt. Du kannst ihn jederzeit ändern.

> ⚠️ Trage **nie** den «secret» oder «service_role» Key ein. Der gehört nur auf den Server.

## Schritt 6: App ins Internet stellen (5 Min.)

1. Gehe auf **app.netlify.com/drop** und erstelle ein kostenloses Konto.
2. Ziehe den ganzen Ordner **`app`** in das Feld auf der Seite.
3. Nach ein paar Sekunden bekommst du eine Adresse wie `https://lustiger-name-123.netlify.app`.
4. Unter **Site configuration → Change site name** kannst du einen schöneren Namen wählen, z. B. `chat-familie-xy`.
5. Zurück in Supabase: **Authentication → URL Configuration** → bei **Site URL** deine Netlify-Adresse eintragen und speichern.

## Schritt 7: Selbst einsteigen (5 Min.)

**iPhone**
1. Öffne die Netlify-Adresse in **Safari**.
2. Tippe auf **Teilen** ⬆︎ → **Zum Home-Bildschirm**.
3. Öffne die App **über das neue Symbol**. Wichtig: nicht im Safari weitermachen, sonst liegt der Schlüssel am falschen Ort.

**Android**
1. Öffne die Adresse in **Chrome**.
2. Menü **⋮** → **App installieren** (oder **Zum Startbildschirm hinzufügen**).
3. Öffne die App über das neue Symbol.

**Dann auf beiden Geräten**
1. Tippe auf **Neu mit Einladung**.
2. Gib deinen **Start-Code**, deinen Namen, E-Mail und ein Passwort ein.
3. Tippe im Chat auf **Einschalten**, damit Benachrichtigungen kommen.
4. Öffne **⋮ → Schlüssel sichern** und lade die Sicherung herunter. Bewahre Datei und Passwort gut auf (z. B. im Passwort-Manager).

## Schritt 8: Jemanden einladen

1. In der App: **⋮** → **Einladungscode erstellen**.
2. Tippe auf **Teilen** und schick die Nachricht per SMS oder E-Mail. Darin steht die Adresse, die Anleitung und der Code.
3. Jeder Code gilt **einmal** und **7 Tage**.

---

## Gut zu wissen

**Neues Handy?** Melde dich an und wähle **Aus Sicherung wiederherstellen**. Dann kannst du alle alten Nachrichten lesen. Mit derselben Sicherung kannst du den Chat auch auf einem zweiten Gerät (z. B. Tablet) nutzen.

**Keine Sicherung?** Dann wähle **Neuen Schlüssel erstellen**. Neue Nachrichten funktionieren, alte bleiben verschlossen.

**Sicherheitsnummer vergleichen:** Unter **⋮ → Mitglieder** steht bei jeder Person eine Nummer. Vergleicht sie einmal am Familientisch. Stimmen sie auf allen Handys überein, kann niemand unbemerkt mitlesen.

**Pause bei Nichtbenutzung:** Kostenlose Supabase-Projekte werden nach etwa einer Woche ohne Nutzung pausiert. Dann im Supabase-Dashboard auf **Restore project** klicken. Bei täglichem Chatten passiert das nicht.

**Kostenlose Grenzen:** 500 MB Datenbank und 1 GB Dateien (Stand Supabase Free Plan, 2025). Für eine Familie reicht das für Tausende Bilder.

**Jemanden entfernen:** In Supabase **Table Editor → members** die Zeile der Person löschen. Sie sieht danach nichts mehr.

**Passwort vergessen:** Der Link in der App funktioniert nur, wenn in Supabase ein eigener E-Mail-Versand eingerichtet ist (**Authentication → Emails → SMTP Settings**). Ohne ihn kann der Admin das Konto unter **Authentication → Users** löschen und eine neue Einladung schicken.

**App aktualisieren:** Geänderten Ordner `app` erneut bei Netlify hochladen (**Deploys → Drag and drop**). Vorher in `sw.js` die Zeile `const VERSION = 'v1'` hochzählen (`'v2'`), damit alle Handys die neue Version holen.

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| App zeigt «Fast geschafft» | `config.js` ist noch nicht ausgefüllt oder nicht neu hochgeladen |
| «Einladungscode ungültig» | Code schon benutzt oder älter als 7 Tage. Neuen erstellen |
| Kein Knopf «Einschalten» auf dem iPhone | App nicht vom Home-Bildschirm geöffnet, oder iOS älter als 16.4 |
| «Benachrichtigungs-Dienst nicht eingerichtet» | Schritt 4 prüfen: Name der Funktion genau `notify`, alle drei Secrets gesetzt |
| Push kommt nicht an | Supabase → Edge Functions → notify → **Logs** ansehen. Am Handy prüfen, ob Benachrichtigungen für die App erlaubt sind |
| «Diese Nachricht lässt sich nicht entschlüsseln» | Die Nachricht wurde vor einem Schlüsselwechsel geschickt. Mit der passenden Sicherung wiederherstellen |
