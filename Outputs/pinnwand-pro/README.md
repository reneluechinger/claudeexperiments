# Pinnwand Pro

Persönlicher Trello-Ersatz als claude.ai-Artifact. Der Code hier enthält keine Daten: Boards und Karten liegen in der privaten Datenbank des Artifacts.

## Funktionen

- Boards, Listen und Karten mit Drag & Drop (Maus und Touch)
- Karten: Labels, Datum mit Uhrzeit, Beschreibung (Markdown), mehrere Checklisten, Titelfarbe, Archiv
- Automationen pro Board
  - Haken setzen verschiebt die Karte in die Erledigt-Liste
  - Karte in die Erledigt-Liste ziehen hakt sie ab
  - Erledigte Karten nach X Tagen archivieren
  - Karte mit neuem Datum wandert in die Termin-Liste
- Wiederkehrende Karten (wöchentlich, monatlich, alle X Tage)
- Capture über Apple Kurzbefehle: Mail mit «[Capture]» im Betreff, die Pinnwand holt sie über Gmail ab
- Abkürzungen beim Erfassen: `#label`, `@morgen`, `@fr 14:00`, `@24.10.`

## Datenmodell (Artifact-Datenbank)

| Sammlung | Inhalt |
|---|---|
| `boards/{id}` | Name, Hintergrund, Listen, Labels, Regeln |
| `cards/{id}` | board, list, pos, title, desc, labels, due, done, checklists, archived |
| `recurring/{id}` | Vorlage und Rhythmus für wiederkehrende Karten |
| `meta/settings` | Capture-Ziel, Gmail-Label, Reihenfolge der Boards |

Claude-Routinen können über das Werkzeug `ArtifactData` direkt Karten lesen und schreiben.
