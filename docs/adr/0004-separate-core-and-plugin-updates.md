# ADR-0004: Osobne kanały aktualizacji Core i pluginów

Status: **Accepted** (zasada aktualna)

Data: 2026-08-07

> **Uwaga 2026-09-09:** rozdzielenie kanałów Core i pluginów obowiązuje bez
> zmian, ale *dystrybucja* pluginów przeszła na model społecznościowy jak w
> Obsidianie — hosting na GitHub Releases, recenzja przez PR do
> `release/market/catalog.json`, **brak podpisu pluginów** (zniknęły Ed25519,
> `keyId` i podpisany manifest aktualizacji z punktów poniżej). Szczegóły:
> `2026-09-09-plugin-market-model-a-design.md` (dokument wewnętrzny, nieopublikowany).

## Kontekst

Notible ma już updater Tauri dla instalatora aplikacji. Pluginy będą ładowanym
kodem JS/TS i muszą móc zmieniać wersję bez wymiany całego Core. Wspólny
manifest lub wspólny klucz podpisujący mieszałby cykle wydawnicze i zwiększał
skutek kompromitacji jednego kanału.

## Decyzja

Utrzymujemy dwa niezależne kanały:

1. **Core** — istniejący Tauri updater, `latest.json`, instalator Windows i
   podpis Tauri. Aktualizacja może wymienić aplikację, ale nie instaluje
   automatycznie nowych pluginów.
2. **Pluginy** — katalog pluginów w tym samym Cloudflare R2, lecz pod osobną
   ścieżką, np. `plugins/<plugin-id>/<channel>/manifest.json` oraz paczki w
   katalogach wersji. Manifest pluginu zawiera wersję API, zakres zgodności z
   Core, URL paczki, rozmiar, SHA-256 i podpis Ed25519.

Klucze podpisujące są rozdzielone. Klucz Tauri nie może podpisywać paczek
pluginów, a klucz pluginów nie może podpisywać instalatorów Core.

## Zasady instalacji i aktualizacji pluginu

1. Core pobiera manifest po HTTPS.
2. Sprawdza schemat, identyfikator, kanał, zgodność wersji Core/API i zaufany
   `keyId`.
3. Weryfikuje podpis manifestu oraz SHA-256 pobranej paczki.
4. Rozpakowuje plugin do katalogu staging, nie nadpisując aktywnej wersji.
5. Aktywuje nową wersję dopiero po poprawnym przygotowaniu; błąd `onload`
   uruchamia rollback do poprzedniej wersji.

Wersje pluginów są przechowywane osobno od wersji Core. Aktualizacja Core nie
usuwa katalogu pluginów ani ich danych, a aktualizacja pluginu nie dotyka bazy
Core poza publicznym Data API.

## Konsekwencje

- R2 może przechowywać Core i pluginy razem, ale upload i manifesty są
  rozdzielone.
- Każdy plugin wymaga własnej polityki zaufania klucza.
- Potrzebujemy katalogu aktywnych wersji, stagingu i rollbacku przed
  włączeniem zewnętrznego loadera.
- Nie wystarczy sam hash paczki: hash chroni integralność względem manifestu,
  dlatego manifest musi być podpisany kluczem przypiętym w Core.

