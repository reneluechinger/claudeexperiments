# Pinnwand

Ein Kanban-Board im Stil von Trello, als eine einzige HTML-Datei ohne Server.

## Funktionen

- Mehrere Boards mit eigenem Hintergrund
- Listen und Karten per Drag & Drop verschieben (Maus; am Handy kurz gedrückt halten)
- Karten mit Labels, Fälligkeitsdatum, Beschreibung, Checkliste und Titelfarbe
- Suche und Label-Filter (Taste `/` springt in die Suche)
- Rückgängig nach dem Löschen
- Export und Import als JSON

Die Daten liegen im `localStorage` des Browsers. Sie sind also nur auf dem Gerät sichtbar, auf dem sie erfasst wurden. Für den Umzug auf ein anderes Gerät: Menü → Daten exportieren, dort importieren.

## Online stellen mit GitHub Pages

1. Im Repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Der Workflow `.github/workflows/pages.yml` veröffentlicht den Ordner `Outputs/pinnwand` bei jedem Push.
3. Die Adresse steht danach im Workflow-Lauf und unter Settings → Pages.

Lokal reicht ein Doppelklick auf `index.html`.
