# ADR-0003: Pierwszy runtime pluginów jako zaufany JS/TS

Status: **Proposed**  
Data: 2026-08-07

## Kontekst

Notible korzysta z Tauri. Rust/Tauri pluginy są naturalnie kompilowane razem z
aplikacją, więc nie są dobrym pierwszym mechanizmem dla zewnętrznych pluginów
użytkownika. UI jest napisane w React/TypeScript i ma istniejące rozszerzenia
TipTap.

## Decyzja

Pierwsza generacja zewnętrznych pluginów będzie ładowanym JS/TS i będzie
traktowana jako kod zaufany. Runtime zapewni manifest, wersję API, jawne
uprawnienia, cleanup, logowanie, włączanie/wyłączanie i error boundary.

Nie obiecujemy izolacji bezpieczeństwa. Plugin może mieć szerokie możliwości
wynikające z uruchomienia w tym samym WebView, dlatego instalacja wymaga
ostrzeżenia i potwierdzenia.

## Późniejsza alternatywa

Sandbox procesowy z JSON-RPC może zostać rozważony po ustabilizowaniu API. Nie
blokuje to pierwszej generacji pluginów, ale nie należy używać słowa
„sandboxed”, dopóki izolacja nie będzie faktycznie przetestowana.

## Warunek akceptacji

Plugin demonstracyjny może rejestrować komendę, widok, ustawienia i event, a po
wyłączeniu nie pozostawia listenerów, timerów, stylów ani wpisów w rejestrach.
