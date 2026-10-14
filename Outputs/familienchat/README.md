# Familienchat

Privater Chat für 2 Personen oder eine Familie. Läuft als Web-App (PWA) auf iPhone und Android, wird über den Browser auf den Home-Bildschirm gelegt. Kein App Store nötig.

👉 **Einrichtung Schritt für Schritt:** [ANLEITUNG.md](ANLEITUNG.md)

## Funktionen

- Textnachrichten mit Link-Erkennung, grosse Emojis
- Bilder (werden vor dem Senden auf max. 1600 px verkleinert)
- Sprachnachrichten bis 5 Minuten
- Lesebestätigung: ✓ gesendet, blaue ✓✓ von allen gelesen
- Push-Benachrichtigungen (Android, iPhone ab iOS 16.4 als Home-Bildschirm-App)
- Zugang nur mit Einladungscode (einmalig, 7 Tage gültig), Admins können einladen
- Ende-zu-Ende-Verschlüsselung für Texte, Bilder und Audio
- Schlüssel-Sicherung mit Passwort für Gerätewechsel
- Heller und dunkler Modus

## Aufbau

| Ordner / Datei | Inhalt |
|---|---|
| `app/` | Die Web-App. Diesen Ordner auf Netlify hochladen |
| `app/config.js` | Supabase-Adresse und öffentlicher Schlüssel |
| `app/app.js` | Ablauf, Chat, Senden, Einstellungen |
| `app/crypto.js` | Verschlüsselung (nur eingebaute Web Crypto API) |
| `app/sw.js` | Service Worker: Installierbarkeit, Zwischenspeicher, Push |
| `app/vapid.html` | Werkzeug zum Erzeugen der Push-Schlüssel |
| `supabase/setup.sql` | Tabellen, Zugriffsregeln, Speicher, Start-Code |
| `supabase/functions/notify/` | Edge Function, die Push-Nachrichten verschickt |

Kein Build-Schritt. Einzige externe Bibliothek ist `@supabase/supabase-js` (über jsDelivr, feste Version).

## Verschlüsselung

- Jede Person hat ein **ECDH-P-256-Schlüsselpaar**. Der private Teil liegt nur in der IndexedDB des Geräts.
- Pro Nachricht entsteht ein zufälliger **AES-256-GCM-Schlüssel**. Er verschlüsselt Inhalt und Datei.
- Dieser Schlüssel wird für jedes Mitglied einzeln verpackt: Einmal-Schlüssel + ECDH + HKDF-SHA-256 → AES-GCM.
- Die Schlüssel-Sicherung ist mit PBKDF2 (600 000 Runden) und AES-GCM geschützt.

**Was der Server sieht:** wer wann eine Nachricht geschickt hat, Dateigrössen, Lesestand. **Was er nicht sieht:** Text, Bilder, Audio, Art der Nachricht.

**Grenzen:** Nachrichten sind nicht zusätzlich signiert. Die Absenderangabe kommt von der Supabase-Anmeldung. Gegen einen Server, der öffentliche Schlüssel austauscht, schützt der Vergleich der Sicherheitsnummer. Wer später dazukommt, kann ältere Nachrichten nicht lesen.

## Datenbank

| Tabelle | Zweck | Wer darf |
|---|---|---|
| `members` | Name, öffentlicher Schlüssel, Admin | Mitglieder lesen, eigene Zeile ändern (nur Name, Schlüssel) |
| `invites` | Einladungscodes | nur Admins; einlösen über `redeem_invite()` |
| `messages` | verschlüsselte Nachrichten | Mitglieder lesen und schreiben unter eigenem Namen, nichts ändern oder löschen |
| `read_state` | Lesestand pro Person | Mitglieder lesen, eigenen Stand setzen |
| `push_subscriptions` | Push-Abos pro Gerät | nur eigene |
| Storage `media` | verschlüsselte Dateien | Mitglieder |

## Getestet

- `setup.sql` gegen PostgreSQL 16 mit nachgebildetem Supabase-Schema: doppeltes Ausführen, alle Zugriffsregeln (Nicht-Mitglied sieht nichts, kein Selbst-Admin, keine fremden Absender, Codes nur einmal)
- `crypto.js`: Ver- und Entschlüsseln, fremde Schlüssel scheitern, Sicherung mit richtigem und falschem Passwort
- Ganze App in Chromium mit simuliertem Backend: Registrierung, Text, Bild, Sprachnachricht, Empfang, Häkchen, Einladung, Sicherung, Neuladen, Wiederherstellung, neuer Schlüssel
- Push-Schlüssel aus `vapid.html` mit der Bibliothek `web-push` 3.6.7

Noch nicht getestet: echtes Supabase-Projekt, echte Push-Zustellung, echte iPhones und Android-Geräte.
