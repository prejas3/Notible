# Źródła danych i widoki w Notible 0.8

Źródło danych odpowiada na proste pytanie: **które rekordy mają znaleźć się w
widoku?** Widok odpowiada natomiast za sposób ich pokazania. Dzięki temu ten sam
zbiór zgłoszeń może być tabelą dla supportu, Kanbanem dla zespołu i kalendarzem
dla osoby pilnującej terminów.

## Wybór zakresu

W górnej części widoku wybierz `Źródło danych`. Możesz użyć bieżącego projektu
lub folderu, całego workspace, wszystkich rekordów danego typu albo wcześniej
zapisanego źródła. Licznik obok selektora pokazuje liczbę rekordów po zastosowaniu
zapytania.

## Budowanie zapytania

Otwórz `Filtry zaawansowane` i dodaj warunek. Grupa `Wszystkie` oznacza AND —
każdy warunek musi być spełniony. `Dowolny` oznacza OR — wystarczy jeden warunek.
Grupy można zagnieżdżać, na przykład:

`Status jest Otwarte i (Priorytet jest Wysoki lub Termin jest po terminie)`.

Pod konstruktorem zawsze znajduje się opis reguły zwykłym językiem. Wpisz nazwę
i wybierz `Zapisz jako źródło danych`, aby użyć zapytania również w innym widoku.

## Konfiguracja tabeli

Przycisk `Kolumny` pozwala ukrywać, przesuwać i przypinać kolumny. Krawędź
nagłówka zmienia szerokość; podwójne kliknięcie przywraca szerokość domyślną.
Kliknięcie nagłówka sortuje, a Shift+kliknięcie dodaje kolejne kryterium.
Selektor grupowania tworzy zwijane sekcje.

Zaznacz kilka wierszy, aby zmienić ich status lub priorytet, dodać tag albo je
zarchiwizować. Pod tabelą pola liczbowe pokazują sumę i średnią; minimum oraz
maksimum są dostępne po najechaniu.

## Bezpieczny import

W widoku tabeli wybierz `Importuj dane`, wskaż CSV lub arkusz i sprawdź podgląd.
Dla każdej kolumny wybierz tytuł, istniejącą lub nową właściwość albo `Pomiń`.
Żaden rekord nie zostanie utworzony przed naciśnięciem `Importuj rekordy`.
