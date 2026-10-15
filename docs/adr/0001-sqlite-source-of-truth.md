# ADR-0001: SQLite jako źródło prawdy

Status: **Proposed**  
Data: 2026-08-07

## Kontekst

Notible przechowuje obiekty, typy, relacje, historię, źródła danych,
automatyzacje i konfigurację synchronizacji. Część elastycznych właściwości
znajduje się w JSON w kolumnie `props`.

## Decyzja

SQLite pozostaje kanonicznym źródłem prawdy. Markdown i JSON są formatami
importu, eksportu, backupu czy przenośnej projekcji, ale nie drugim miejscem
autorytatywnego zapisu tych samych danych.

Pluginy nie dostają bezpośredniego SQL-a. Używają wersjonowanego Data API.

## Konsekwencje pozytywne

- relacje, transakcje i zapytania są naturalne;
- można zapewnić atomowość i integralność;
- synchronizacja może działać na obiektach i operacjach;
- pluginy nie są związane z prywatnym schematem SQLite.

## Konsekwencje negatywne

- trzeba utrzymywać migracje i eksporty;
- przenośność danych wymaga dobrego formatu wymiany;
- publiczne API musi ukryć szczegóły schematu;
- JSON `props` będzie wymagał dodatkowych zasad indeksowania i walidacji.

## Alternatywy odrzucone na tym etapie

- Markdown jako główne źródło wszystkiego — nie pasuje do relacji, finansów i
  transakcyjnych automatyzacji;
- równoległe SQLite + Markdown — ryzyko dwóch źródeł prawdy;
- synchronizacja pliku `notible.db` — konflikty binarne, blokady i brak
  sensownego merge'u.

## Warunek akceptacji

Użytkownik akceptuje zasadę, że API i eksport gwarantują dostęp do danych, ale
bezpośredni format SQLite pozostaje szczegółem implementacji.
