# ADR-0006: jeden kontrakt tokenów wyglądu

- Status: accepted for local implementation
- Date: 2026-08-07
- Scope: Core and theme/plugin boundary

## Decision

Notible ma jeden semantyczny kontrakt tokenów CSS. Nazwy `--bg`, `--text`,
`--accent`, `--surface-*`, `--border-*`, `--radius-*` i tokeny gęstości są
kanoniczne dla Core. Starsza warstwa `--archive-*` pozostaje aliasem
kompatybilności, ustawianym przez `applyTheme()`, a nie drugą niezależną paletą.

Theme/plugin może zmienić tokeny i dołączać własne style przez stabilny kontrakt;
nie powinien opierać się na przypadkowej hierarchii DOM ani nadpisywać klas
przypadkowymi selektorami. Migracja plików CSS może być stopniowa, ale każda
nowa reguła powinna używać tokenów semantycznych.

## Consequences

- zmiana motywu nie wymaga synchronizowania dwóch źródeł kolorów;
- istniejące komponenty archiwum zachowują kompatybilność podczas migracji;
- test statyczny pilnuje, że aliasy pozostają związane z Core;
- pełne rozdzielenie CSS na Core i theme/plugin nadal wymaga migracji reguł,
  lecz nie wymaga zmiany kontraktu komponentów przy każdym kroku.
