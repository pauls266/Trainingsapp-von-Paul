# Laufbuch – Projektbeschreibung für Claude Code

Diese Datei beschreibt das Projekt, den bisherigen Stand und die nächsten Aufgaben. Lies sie vollständig, bevor du Änderungen machst. Antworte dem Nutzer auf Deutsch.

## 1. Worum es geht

„Laufbuch“ ist eine private Trainingsanalyse-App von Paul. Er läuft mit einer **Garmin Forerunner 265**, trainiert auf **Halbmarathon und Marathon** und will eine genauere, transparentere Auswertung als in Garmin Connect: persönliche Zonen, Belastungssteuerung, Erholung und konkrete Trainingsvorschläge.

Die App ist eine **Web-App (eine einzelne `index.html`)**, gehostet über **GitHub Pages** unter
`https://pauls266.github.io/Trainingsapp-von-Paul/`
und auf dem iPhone über „Zum Home-Bildschirm“ installiert.

### Rahmenbedingungen des Nutzers – bitte unbedingt beachten
- **Datenschutz ist die wichtigste Anforderung.** Trainings- und Gesundheitsdaten werden ausschließlich im Browser auf dem Gerät verarbeitet und gespeichert. Kein eigener Server, keine Analyse-/Tracking-Skripte, keine Uploads.
- Geräte: **iPhone** (Safari / Home-Bildschirm-App) und **Windows-PC**. Kein aktueller Mac.
- **Keine native iOS-App**: Der Nutzer will kein Apple-Developer-Programm (99 €/Jahr) bezahlen. Also kein HealthKit-Zugriff per App, alles bleibt Web.
- **Keine HRV-Brücken-Apps** (z. B. HRV Sync), bewusst abgelehnt.
- Garmin bietet Privatpersonen **keine offizielle API** (Garmin Connect Developer Program nur für Unternehmen). Inoffizielle Garmin-Logins (z. B. python-garminconnect) wurden nicht gewählt. Nicht ohne ausdrückliche Zustimmung einführen.
- Oberfläche komplett auf **Deutsch**, mobile-first fürs iPhone.

## 2. Aktueller Stand (Version 2.2)

### Dateien
`index.html` (Gerüst), `style.css`, `core.js` (alle Berechnungen, ohne DOM, auch in Node testbar), `exercises.js` (Übungsnamen aus dem FIT SDK, erzeugt mit `tools/gen-exercises.mjs`), `charts.js` (interaktive SVG-Diagramme), `map.js` (Karte mit Leaflet), `app.js` (Oberfläche), `sw.js` + `manifest.webmanifest` (Offline-Start), `vendor/` (JSZip 3.10.1, Leaflet 1.9.4 aus npm). Tests: `npm test` (node --test), Oberflächenprüfung: `npm run ui-check` (Playwright/Chromium). Versionsnummer in `core.js` (`APP_VERSION`) und `sw.js` (`VERSION`) immer gemeinsam erhöhen, `CHANGELOG.md` pflegen.

### Neu in 2.2 (Kurzfassung)
- Aktivitäts-Schema `v: 2` (`SCHEMA` in core.js): GPS-Spur im 5-s-Stream (`stream.la/lo`, Grad × 1e5), `laps`, `sets` (Krafttraining, FIT-Nachricht 225), `kind` (run/strength/team/bike/swim/walk/other), Mehrsport-Sessions als eigene Aktivitäten. Beim erneuten Import werden ältere Datensätze ersetzt; manuell eingetragene (`src: 'manual'`) nie.
- Eigene Angaben pro Aktivität (z. B. RPE) liegen getrennt im Store `meta` unter `annot` (`{id: {rpe}}`), damit ein Re-Import sie nicht überschreibt.
- VO2max-Schätzung (`vo2maxRun`, Daniels + Swain), Trainingszustand (`trainingStatus`), Kraft-Auswertung (`strengthSummary`), Wochenplan mit `S.strengthPerWeek`, `S.teamDays` (0 = Mo), `S.teamSport`. Kartenhintergrund nur mit `S.mapTiles` (Standard aus, Datenschutz).

### Stand Version 2 (Grundlage)

### Datenquellen
1. **FIT-Dateien** aus Garmin Connect („Original exportieren“ → ZIP) oder dem kompletten Garmin-Datenexport (verschachtelte ZIPs). Import über Datei-Auswahl, ZIPs werden mit JSZip (cdnjs, 3.10.1) entpackt, auch rekursiv.
2. **Apple-Health-Export** (`Export.zip` → `export.xml`): wird per Streaming gelesen (JSZip `internalStream`, bzw. `File.stream()` für lose XML). Verwendet werden nur Ruhepuls (`HKQuantityTypeIdentifierRestingHeartRate`) und Schlaf (`HKCategoryTypeIdentifierSleepAnalysis`).
3. **iOS-Kurzbefehl „Laufbuch Tageswerte“**: liest Ruhepuls und Schlafanalyse der letzten 14 Tage aus Apple Health und kopiert Text in die Zwischenablage. Der Nutzer fügt ihn in der App ein. Format:
   ```
   LB1
   R;<Startdatum>;<Wert>;<Quelle>
   S;<Startdatum>;<Enddatum>;<Wert>;<Quelle>
   ```
   Datumsformat ISO 8601 oder deutsches Format („25.9.2026, 08:00“), beides wird erkannt. Schlafwerte werden über Schlüsselwörter zugeordnet (Kern/Tief/REM/Wach/Im Bett, auch englisch und HK-Konstanten). **Dieses Format nicht brechen**, der Kurzbefehl ist beim Nutzer eingerichtet.

### Eigener FIT-Parser
Keine Fremdbibliothek. Unterstützt normale und komprimierte Zeitstempel-Header, Entwicklerfelder (werden übersprungen), Little- und Big-Endian, abgeschnittene Dateien. Ausgewertete Nachrichten: `file_id` (0), `user_profile` (3), `zones_target` (7), `session` (18), `lap` (19, wird gelesen, aber noch nicht genutzt), `record` (20). Mehrsport-Sessions: bisher wird nur die erste Session verwendet.

### Gespeicherte Daten (IndexedDB, Datenbank `laufbuch`, Version 1)
- Store `acts` (keyPath `id` = Startzeit in ms als String): Zusammenfassung pro Aktivität plus 5-Sekunden-Stream (`t, hr, v, c, d, a`), Bestzeiten nach Distanz (`bestD`) und Dauer (`bestT`), beste 30-min-HF (`hr30`), Werte aus der Uhr (`watch.lthr`, `watch.maxHR`, `watch.rest`, `watch.sex`).
- Store `meta`: `settings` (Nutzereinstellungen) und `wellness` (`{rhr:{Datum:{Quelle:Wert}}, sleep:{Nacht:{Quelle:{deep,rem,core,asleep,awake,inbed,start,end}}}}`). Eine Nacht wird dem Tag des Aufwachens zugeordnet (Endzeit + 6 h).
- **Bestehende Daten dürfen bei Updates nie verloren gehen.** Schemaänderungen nur mit Migration (`onupgradeneeded`). Die App muss mit alten Datensätzen weiter funktionieren.

### Analysen
- **HF-Zonen** nach Friel, basierend auf Laktatschwellen-HF (LTHR): Z1 < 85 %, Z2 85–89 %, Z3 90–94 %, Z4 95–99 %, Z5 ≥ 100 %. Die LTHR kommt, in dieser Reihenfolge, aus der Nutzereingabe, der Uhr-Einstellung, der besten 30-min-HF der letzten 180 Tage oder als Schätzung mit 90 % der HFmax.
- **Belastung**: Banister-TRIMP aus dem HF-Stream (Geschlechtsfaktoren 0,64/1,92 bzw. 0,86/1,67). Ohne HF: Minuten × 1 als Schätzung. Daraus Fitness (CTL, 42 Tage), Ermüdung (ATL, 7 Tage) und Form (TSB). Akut/Chronisch-Verhältnis als Überlastungswarnung.
- **VDOT** nach Jack Daniels (Formeln für VO₂ und %VO₂max). Quelle ist ein vom Nutzer eingegebenes Wettkampfergebnis oder die beste Leistung der letzten 120 Tage (≥ 3 km bzw. ≥ 12 min). Tempobereiche E (62–70 %), M/HM (über die Zeitprognose), T (88 %), I (97,5 %) sowie Prognosen für HM und Marathon.
- **Aerobe Entkopplung** (Pa:HR) für gleichmäßige Läufe ≥ 40 min, **Effizienzfaktor** für lockere Läufe, Zonenverteilung über 4 Wochen, Schrittfrequenz, Bodenkontaktzeit und vertikale Bewegung (falls vorhanden).
- **Erholungswert (0–100)**: Ruhepuls gegenüber dem 4-Wochen-Schnitt, Schlaf gegenüber dem Schlafziel (inkl. 3-Nächte-Defizit) und TSB/CTL. Eine Warnung erscheint, wenn der Ruhepuls ≥ 3 Tage lang mindestens 3 bpm über dem Schnitt liegt.
- **Wochenplan (regelbasiert)**: Phasen Grundlage, Aufbau, Spezifisch und Tapering, abhängig von Ziel (HM/M) und Wettkampfdatum. Jede 4. Woche Entlastung. Der Umfang ergibt sich aus dem 4-Wochen-Schnitt (+≤ 8 %). Dazu kommen Qualitätseinheiten je Phase, ein langer Lauf (begrenzt durch den längsten Lauf der letzten 6 Wochen + 2 km) und 3–6 Läufe pro Woche. Die „Heute“-Empfehlung passt sich an Erholung, Form und Belastung des Vortags an.

### Oberfläche
Tabs: Heute (Tagesempfehlung als „Startnummer“-Karte, Erholung, Form, Prognose, letzter Lauf, Hinweise), Läufe, Plan, Zonen, Trends. Dazu Einstellungen und Detailansicht als Vollbild-Sheets. Diagramme als eigenes Inline-SVG ohne Bibliothek. Hell- und Dunkelmodus über CSS-Variablen, Safe-Area-Insets fürs iPhone. Schriften: Barlow und Barlow Condensed (Google Fonts) mit System-Fallback.

## 3. Nächste Aufgaben

Arbeite in dieser Reihenfolge. Stimme größere Entscheidungen vorher kurz mit dem Nutzer ab.

### Schritt 0 – Projekt aufräumen (Vorschlag, erst nachfragen)
- `index.html` in `index.html`, `core.js` (reine Analysefunktionen ohne DOM) und `app.js` (Oberfläche) aufteilen. GitHub Pages liefert mehrere Dateien direkt aus, ein Build-Schritt ist nicht nötig.
- Tests für `core.js` mit Node (`node --test`) anlegen, inklusive eines kleinen FIT-Encoders, der synthetische Testdateien erzeugt, und Tests für das Kurzbefehl- und Health-XML-Format.
- Eine Versionsnummer in der App anzeigen und `CHANGELOG.md` pflegen.
- Optional: Web-App-Manifest und Service Worker, damit die App offline startet. Achtung: Beim Deploy muss der Cache sauber erneuert werden.

### Schritt 1 – Alle Sportarten erfassen und auswerten
Ziel: Auch Krafttraining, Fußball, Radfahren, Schwimmen usw. fließen vollständig in Analyse und Planung ein.
- **Sportarten sauber zuordnen**: vollständiges FIT-Enum für `sport` und `sub_sport` gemäß dem offiziellen Garmin FIT SDK Profile (Feldnummern und Werte dort nachschlagen, nicht raten). Krafttraining ist bei Garmin typischerweise `sport` = training mit `sub_sport` = strength_training.
- **Krafttraining**: FIT-Nachricht `set` auswerten (Übung bzw. Kategorie, Wiederholungen, Gewicht, Dauer, aktiv/Pause). Die Forerunner 265 zeichnet Sätze auf. Auswertungen: Volumen pro Muskelgruppe und Woche, Trainingsfrequenz, Entwicklung der Gewichte pro Übung.
- **Fußball und andere Mannschaftssportarten**: HF-basierte Belastung, Zeit in Zonen, falls GPS vorhanden auch Distanz und Sprints (Anzahl Abschnitte über einer Schwelle, z. B. > 5,5 m/s).
- **Belastung ohne HF**: Session-RPE nach Foster (Dauer × Anstrengung 1–10) als manuelle Eingabe pro Aktivität. Das ist sinnvoll für Kraft und für Einheiten ohne Pulsdaten.
- **Gesamtbelastung**: CTL/ATL/TSB über alle Sportarten, zusätzlich eine Aufteilung nach Sportart (Wochenansicht als gestapelte Balken).
- **Plan anpassen**: Nicht-Lauf-Einheiten berücksichtigen. Beispiele: Fußball zählt als harter Tag, deshalb am Folgetag keine Qualitäts-Laufeinheit; Krafttraining sinnvoll platzieren (nicht direkt vor langen Läufen oder Qualitätseinheiten). Wiederkehrende feste Termine (z. B. „Fußball Mi + Sa“) in den Einstellungen erfassen und im Wochenplan einsetzen.
- **Lap-Auswertung**: Runden bzw. Intervalle aus `lap` (19) anzeigen und Intervalle automatisch erkennen.
- **Mehrsport-Aktivitäten**: alle Sessions einer Datei berücksichtigen.
- **Zusätzlich über Apple Health**: Workouts aller Sportarten aus `export.xml` (`<Workout workoutActivityType=… duration=… >` mit Statistiken) als Zusammenfassung importieren, wenn keine FIT-Datei vorliegt. Dabei nicht doppelt zählen: Mit FIT-Aktivitäten über Startzeit (±2 min) und Sportart abgleichen, FIT hat Vorrang. Prüfen, ob der Kurzbefehl zusätzlich Workouts ausgeben kann. Wenn ja, als neuen Zeilentyp `W;…` ergänzen, abwärtskompatibel und mit aktualisierter Anleitung in der App.

### Schritt 2 – KI-Analyse des Trainings
Ziel: Eine KI kann das Training im Gesamtzusammenhang bewerten und Fragen beantworten („Warum war mein langer Lauf so schwer?“, „Wie sollte ich die nächsten 4 Wochen aufbauen?“). **Das muss mit der Datenschutz-Anforderung vereinbar sein.** Deshalb in drei Stufen:

1. **„Für KI kopieren“ (zuerst umsetzen)**: Ein Knopf erzeugt eine kompakte, lesbare Zusammenfassung: Profil (Zonen, VDOT, Ziel), die letzten 4–8 Wochen pro Woche (Umfang nach Sportart, Belastung, Zonenverteilung), die wichtigsten Einheiten, Erholungswerte, Plan und Hinweise. Keine GPS-Koordinaten, keine Namen, keine exakten Uhrzeiten nötig. Vor dem Kopieren zeigt die App genau an, was kopiert wird. Der Nutzer fügt den Text selbst in einen Claude-Chat ein und behält so die volle Kontrolle.
2. **Direkte KI-Anbindung (optional, nur nach ausdrücklicher Zustimmung)**: Ein Chat-Bereich in der App, der die Claude API direkt aus dem Browser aufruft, mit einem eigenen API-Schlüssel des Nutzers, lokal gespeichert. Direkte Browser-Aufrufe brauchen den Header `anthropic-dangerous-direct-browser-access: true`. Aktuelle Details (Modellname, Header, Preise) in der offiziellen Doku prüfen: https://docs.claude.com. Anforderungen: standardmäßig aus; vor jedem Senden anzeigen, welche Daten rausgehen; nur die Zusammenfassung aus Stufe 1 senden, keine Rohdaten; klar kennzeichnen, dass die Daten dann an Anthropic gehen; Hinweis zu API-Kosten (nutzungsbasiert, getrennt vom Claude-Abo). Den Schlüssel nie ins Repository schreiben, denn das Repository ist öffentlich.
3. **Lokale KI (prüfen, nicht sofort bauen)**: Bewerten, ob ein kleines Sprachmodell im Browser (WebGPU, z. B. WebLLM) auf dem iPhone brauchbar läuft: Downloadgröße, Speicher, Akku, Antwortqualität. Ergebnis dem Nutzer ehrlich berichten.

Die KI-Antworten sollen die regelbasierte Analyse ergänzen, nicht ersetzen. Die Berechnungen (Zonen, Belastung, Plan) bleiben nachvollziehbar im Code.

## 4. Arbeitsregeln
- Nach jeder Änderung die Tests laufen lassen und die Ansichten mit synthetischen Daten prüfen (keine `undefined`/`NaN` in der Ausgabe).
- Kleine, gut beschriebene Commits. Vor dem Push auf `main` kurz zusammenfassen, was sich ändert, denn `main` ist sofort live.
- Keine neuen externen Skripte außer bei klarem Nutzen. Nur etablierte CDNs mit fester Versionsnummer. Keine Tracker, keine Analytics.
- Alle Browser-Speicherzugriffe in `try/catch`. Die App muss auch ohne Daten und mit alten Datensätzen korrekt starten.
- Trainingsempfehlungen vorsichtig formulieren. Bei Schmerzen, Krankheit oder auffälligen Werten auf ärztliche bzw. trainerische Abklärung hinweisen.
- Wenn eine Anforderung technisch nicht sauber lösbar ist (z. B. wegen fehlender Garmin-API), das dem Nutzer ehrlich sagen und Alternativen vorschlagen.
