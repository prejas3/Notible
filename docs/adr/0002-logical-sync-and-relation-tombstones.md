# ADR-0002: Synchronizacja logiczna i tombstony relacji

Status: **Proposed**  
Data: 2026-08-07

## Kontekst

Obecny sync przesyła obiekty, relacje i tombstony obiektów. Obiekty mogą być
scalane przez `updated_at`, lecz usunięcie relacji nie jest osobną operacją,
która może być później odtworzona na innym urządzeniu.

## Decyzja

Synchronizacja działa na logicznych zmianach, nie na pliku SQLite. Relacje mają
własne operacje `relation.created` i `relation.deleted`, własne identyfikatory
operacji oraz mechanizm retencji tombstonów.

Każda operacja ma być idempotentna i możliwa do ponownego dostarczenia. Outbox
lokalny zachowuje operacje do czasu potwierdzenia przez serwer.

## Pierwszy model konfliktów

Zostaje deterministyczny LWW dla całego obiektu, ale z jawną wersją, źródłem,
identyfikatorem operacji i raportem konfliktu. Merge per-field jest osobną
decyzją po testach rzeczywistych scenariuszy.

## Warunek akceptacji

Testy obejmują offline, retry, duplicate delivery, zmianę kolejności, usunięcie
obiektu, usunięcie relacji i ponowne utworzenie relacji. Żaden z tych scenariuszy
nie może odtworzyć usuniętej relacji bez nowej, jawnej operacji użytkownika.
