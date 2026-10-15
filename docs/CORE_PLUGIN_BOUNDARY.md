# Granica Core/pluginów

## Cel

Core ma umożliwiać uruchomienie, przechowywanie, odzyskanie workspace'u,
renderowanie minimalnego dokumentu i korzystanie z publicznego API. Funkcje
domenowe powinny być osobnymi pluginami, także wtedy, gdy są dostarczane
razem z Notible.

## Core pozostaje właścicielem

- Tauri/window lifecycle i recovery mode;
- SQLite, migracje, backup, restore, integralność i obiektowy Data API;
- sync, outbox, tombstones i conflict handling;
- ExtensionHost, manifesty, permissions, loader, registry i rollback;
- minimalny host UI: routing, tabs, command palette, settings/slots;
- podstawowy renderer dokumentu, tokeny, i18n, accessibility i error boundary;
- podstawowy import/export potrzebny do odzyskania workspace'u.

## Pluginy builtin

Katalog jest w `plugins/builtin/`, a produktowy zestaw w
`plugins/builtin/index.ts`. Obecnie są to osobne, ładowalne pluginy z
publicznymi operacjami danych: Work Models, Views, Planning,
Automations, Finance, Calendar, AI, Editor Extensions, Whiteboard, Search,
Import/Export i Themes. Nie wszystkie mają jeszcze pełną równoważność z dawnym
UI domenowym.

Szkielet nie oznacza migracji funkcji. Migracja może zostać uznana za gotową
dopiero, gdy:

1. plugin nie importuje prywatnych komponentów ani modułów domenowych Core;
2. stara ścieżka i plugin dają równoważny wynik dla tych samych danych;
3. plugin działa osobno, razem z pozostałymi i po wyłączeniu bez utraty danych;
4. Core-only build uruchamia się z pustym zestawem pluginów.

## Kolejność migracji

1. zbudować kontrakt i fixtures każdego pluginu;
2. uruchomić wszystkie pluginy osobno i razem;
3. wydzielić pierwszą domenę jako pełny pion (historycznie: Work Packs, usunięte w 0.78.7);
4. wydzielać kolejne domeny przez publiczne operacje i plugin-owned surfaces;
5. wykonać test równoważności każdej domeny przed usunięciem jej starej ścieżki;
6. dopiero na końcu usuwać stare importy z produktu i włączać Core-only build.

## Obecny test

- `npm.cmd run test:core-only` — Core-only TypeScript entrypoint i pusty host;
- `npm.cmd run test:core-build` — niezależny `dist-core` bez normalnego `App`,
  builtinów i szerokiego API domenowego;
- `npm.cmd run test:builtin-plugins` — 14 pluginów osobno, przez realny loader
  paczki i razem;
- `npm.cmd run test:work-models-views` — katalog modeli, persystencja widoków i
  osobne entrypointy pakietów przez publiczny `DataApi`;
- `npm.cmd run test:plugin-views` — lazy view surfaces każdego builtin pluginu
  osobno i wspólnie oraz cleanup rejestracji po wyłączeniu;
- `npm.cmd run test:builtin-domains` — Planning, Automations, Finance i Search
  osobno przez produktowy plugin oraz pakiet;
- `npm.cmd run test:advanced-builtin` — Whiteboard, Calendar, AI, Editor,
  Import/Export i Themes osobno przez produktowy plugin oraz pakiet;
- `npm.cmd run test:builtin-together` — wykonanie komendy wszystkich 14 pluginów
  razem i cleanup po wyłączeniu;
- `npm.cmd run test:quality` — Core settings host i lazy plugin surface pozostają
  zgodne z kontraktem UI;
- `npm.cmd run build` — produkt z normalnie aktywnym pełnym builtin bundle,
  trybem `?plugins=builtin` dla jawnego testu zestawu oraz `?core-only=1`.

Tryb `?core-only=1` jest minimalnym UI odzyskującym i tworzącym notatki bez
ładowania domenowych pluginów. Nie zastępuje jeszcze pełnej migracji normalnego
ekranu aplikacji.

Host ustawień konsumuje publiczne `SettingsRegistration` i potrafi ładować
surface pluginu przez lazy loader. Work Packs korzystało z tego mechanizmu na
normalnym starcie do 0.78.7, kiedy zostało usunięte i zastąpione modułami
kontenera (`props._modules` + `ContainerModulePicker`).

Host views konsumuje publiczne `ViewRegistration` przez `PluginViewSurface`.
Normalny shell ma wejście `Plugin surfaces`, a wszystkie builtin view surfaces
są ładowane lazy z modułów pluginów. Jawny tryb `?views=plugin` montuje
`notible.views` także w realnym `MainPanel` dla kontenerów; przycisk `Use legacy
view` zachowuje natychmiastowy fallback. To domyka ścieżkę testową, ale nie jest
jeszcze zgodą na usunięcie legacy rendererów przed testem równoważności.
