# Änderungen

Alle Änderungen am Laufbuch in verständlicher Sprache. Die aktuelle Version steht in der App unten in den Einstellungen.

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
