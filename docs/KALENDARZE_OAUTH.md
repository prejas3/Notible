# OAuth kalendarzy Google i Outlook

Notible używa natywnego przepływu Authorization Code z PKCE. Logowanie otwiera
systemową przeglądarkę, a odpowiedź wraca na losowy port `127.0.0.1`.

## Konfiguracja wydania

Przed budowaniem ustaw publiczne identyfikatory klientów:

```powershell
$env:NOTIBLE_GOOGLE_CLIENT_ID="identyfikator-aplikacji-desktopowej.apps.googleusercontent.com"
$env:NOTIBLE_MICROSOFT_CLIENT_ID="identyfikator-aplikacji-Entra"
npm.cmd run tauri -- build
```

Identyfikatory mogą też być zmiennymi środowiskowymi procesu uruchamiającego
gotową aplikację. Nie są sekretami, ale nie należy umieszczać w repozytorium
identyfikatorów należących do prywatnego środowiska testowego.

## Google Cloud

1. Włącz Google Calendar API.
2. Skonfiguruj ekran zgody OAuth.
3. Utwórz klienta OAuth typu **Desktop app**.
4. Zakres Notible to wyłącznie `calendar.readonly`.

## Microsoft Entra

1. Zarejestruj aplikację jako klient publiczny dla desktopu.
2. Dodaj redirect loopback dla systemowej przeglądarki.
3. Zezwól na konta zgodnie z przeznaczeniem rejestracji.
4. Dodaj delegowane uprawnienie Microsoft Graph `Calendars.Read`.
5. Notible prosi dodatkowo o `offline_access`, aby odświeżać sesję.

## Bezpieczeństwo

- `state` i PKCE S256 są generowane osobno dla każdego logowania.
- Callback nasłuchuje tylko na `127.0.0.1` i wygasa po 180 sekundach.
- Tokeny przechowuje Windows Credential Manager przez systemowy keyring.
- Projekt zapisuje wyłącznie nazwy/identyfikatory kalendarzy i lokalny cache
  wydarzeń. Nie zapisuje tokenów ani sekretów klienta.
- Integracja wykonuje wyłącznie operacje odczytu. Nie tworzy i nie modyfikuje
  wydarzeń oraz nie generuje powiadomień Notible.
