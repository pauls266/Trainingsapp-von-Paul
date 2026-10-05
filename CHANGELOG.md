# Änderungen

Alle Änderungen am Laufbuch in verständlicher Sprache. Die aktuelle Version steht in der App unten in den Einstellungen.

## 2.3.0

### Neu
- **Laufschuhe:** Schuhe mit bisher gelaufenen Kilometern und Ersatz-Grenze anlegen. Nach jedem Lauf fragt „Heute“, welches Paar du anhattest; nach einem Import öffnet sich die Zuordnung. Kilometer, Anzahl Läufe und „bald ersetzen“ im Tab „Training“.
- **Plan für die nächsten 7 Tage:** immer ab heute, auch am Sonntag. Die Tage der nächsten Woche sind eine Vorschau, die sich deinem Training anpasst. Auf „Heute“ steht zusätzlich, was morgen ansteht.
- **Krafttraining mit Puls:** Eingetragene Krafteinheiten werden automatisch mit der Uhr-Aufzeichnung zusammengeführt (egal, was zuerst da ist). Ohne Uhr-Aufzeichnung ordnet die App Pulswerte aus Apple Health zu – dafür liefert der Kurzbefehl optional Zeilen `H;…`. Neuer Verlauf „Puls und Belastung pro Einheit“.
- **Zonenmodell wählbar:** Herzfrequenzreserve (neuer Standard), Laktatschwelle nach Friel oder % der HFmax, mit Vergleichstabelle im Tab „Zonen“.

### Verbessert
- **Karte:** zuverlässigeres Laden auf dem iPhone (Stile werden abgewartet, Zeichnen erst nach dem Einblenden, Zeichenfläche statt Vektorgrafik). Antippen öffnet die Karte im Vollbild zum Zoomen. Klarer Hinweis, wenn ein Lauf noch ohne GPS gespeichert ist.
- Ausführliche Schritt-für-Schritt-Anleitung für den Kurzbefehl unter „Tageswerte“.

## 2.2.1

- Neuer Knopf **Tageswerte einfügen** auf „Heute“: holt die Werte des Kurzbefehls mit einem Tipp aus der Zwischenablage (iOS fragt einmal mit „Einfügen“ nach).
- Anleitung unter „Tageswerte“ um die **automatische Morgen-Automation** und das Rückseiten-Tippen ergänzt.

## 2.2.0

### Neu
- **Interaktive Diagramme:** Wischen zeigt die Werte an jeder Stelle, mit zwei Fingern zoomst und verschiebst du, doppelt tippen setzt zurück. Jedes Diagramm lässt sich über das Symbol oben rechts im Vollbild öffnen. Am PC: darüberfahren, Strg + Mausrad zoomt.
- **Karte:** Bei Aktivitäten mit GPS wird die Strecke gezeichnet und nach Herzfrequenzzone eingefärbt. Beim Wischen in den Diagrammen zeigt ein Punkt die Stelle auf der Karte. Der Kartenhintergrund (OpenStreetMap) ist standardmäßig aus und lässt sich in den Einstellungen einschalten.
- **VO2max-Schätzung** aus Tempo und Puls gleichmäßiger, flacher Abschnitte, mit Verlauf.
- **Trainingszustand:** klare Einschätzung (z. B. Produktiv, Stabil, Überlastet, Erholung) mit konkreten Punkten „Das verbessert sich“ und „Darauf achten“.
- **Krafttraining:** Übungen, Sätze, Wiederholungen und Gewichte aus der Uhr (Profil „Krafttraining“) oder von Hand eingetragen. Auswertung: Sätze pro Muskelgruppe, Verlauf, Entwicklung je Übung (geschätztes Maximum).
- **Anstrengung (RPE)** pro Aktivität eintragen. Krafttraining und Einheiten ohne Puls gehen damit realistischer in die Belastung ein.
- **Wochenplan mit Kraft und festen Terminen:** Krafteinheiten (Anzahl in den Einstellungen), gern samstags kombiniert mit einem lockeren Lauf. Fußball montags als optionaler fester Termin, keine Qualitätseinheit am Tag danach.
- **Runden** in der Detailansicht, Intervalle werden automatisch erkannt.
- **Alle Sportarten** nach dem offiziellen Garmin-Profil, Mehrsport-Dateien werden in einzelne Aktivitäten aufgeteilt. Fußball mit GPS: Sprints und Höchstgeschwindigkeit.
- Neuer Bereich **Belastung nach Sportart** in Trends.

### Verbessert
- Etwas mehr Glanz, dezente Tipp-Effekte, gleitende Markierung in der Tab-Leiste.
- Kein Hineinzoomen der Seite mehr per Doppeltipp oder zwei Fingern – fühlt sich mehr nach App an.
- Die maximale Herzfrequenz aus der Uhr wird jetzt genutzt (vorher wurde sie ignoriert).
- Tab „Läufe“ heißt jetzt „Training“ und hat Filter für Laufen, Kraft und Andere.

### Hinweis
- Für Karte, Runden und Sätze bei schon importierten Aktivitäten: die Garmin-Dateien einfach erneut importieren. Bestehende Aktivitäten werden dabei ergänzt, deine Eingaben bleiben erhalten.

## 2.1.1

### Einstellungen überarbeitet
- Zeiten (Zielzeit, Wettkampfzeit) gibst du jetzt in drei Feldern ein: Stunden, Minuten, Sekunden. Es öffnet sich die Zifferntastatur, ein Doppelpunkt ist nicht mehr nötig.
- Fehler behoben: Eine Zielzeit wie „3:15“ wurde bisher als 3 Minuten 15 Sekunden gelesen. Jetzt gilt sie als 3 Stunden 15 Minuten.
- Alle Felder sind gleich hoch und bleiben in ihrer Spalte, auch auf kleinen iPhones. Einheiten (bpm, Jahre, Std) stehen direkt im Feld.
- Der Speichern-Knopf bleibt beim Scrollen unten sichtbar.
- Unplausible Eingaben (z. B. 75 Minuten oder ein Ruhepuls von 300) werden markiert, statt gespeichert zu werden.

## 2.1.0

### Neues Design
- Kantiger, ruhiger Stil: dunkles Blau-Schwarz bzw. heller Sandton, gebrochenes Weiß und ein roter Akzent. Abgeschrägte Ecken statt Rundungen, Überschriften und Beschriftungen in schmalen Großbuchstaben.
- Neues App-Icon: ein nach vorn geneigtes „L“ mit roter Bahnlinie.

### Offline-Start
- Die App startet jetzt auch ohne Internet (Flugmodus, Funkloch). Mit Internet wird immer zuerst die neueste Version geladen, die gespeicherte Kopie dient nur als Ersatz.
- Das neue Icon erscheint erst, wenn die App neu zum Home-Bildschirm hinzugefügt wird. **Achtung:** Beim Löschen einer Home-Bildschirm-App löscht iOS auch deren gespeicherte Daten. Vorher also die Daten sichern (Sicherungsfunktion folgt) oder die App mit altem Icon behalten.

### Aufgeräumt
- Die App besteht jetzt aus mehreren Dateien statt aus einer einzigen: `index.html` (Grundgerüst), `style.css` (Aussehen), `core.js` (alle Berechnungen) und `app.js` (Bedienung). Für dich ändert sich dadurch nichts.
- Automatische Prüfungen („Tests“) für das Einlesen der Garmin-Dateien, das Format des Kurzbefehls, den Apple-Health-Export, Zonen, Belastung, VDOT und den Wochenplan.
- Die Versionsnummer steht unten in den Einstellungen.

### Datenschutz
- Das ZIP-Hilfsprogramm (JSZip 3.10.1) liegt jetzt direkt im Projekt, statt von einem fremden Server geladen zu werden. Die App ruft damit außer den Schriftarten keine fremden Server mehr auf.

## 2.0

- Ausgangsstand: FIT-Import, Apple-Health-Export und Kurzbefehl „Laufbuch Tageswerte“, HF-Zonen, Belastung, VDOT, Erholungswert und regelbasierter Wochenplan.
