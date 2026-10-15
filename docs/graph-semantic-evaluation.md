# Graf semantyczny Notible - specyfikacja do dalszej ewaluacji

Status: propozycja techniczno-produktowa, wersja 0.1  
Data: 2026-08-23  
Zakres: wizualizacja relacji między obiektami Notible oraz jej skalowanie do dużych zbiorów danych

## 1. Streszczenie

Obecny graf pokazuje głównie strukturę drzewa i bezpośrednie linki. To dobrze odpowiada na pytanie "co jest wewnątrz czego", ale słabo pokazuje, że dwa obiekty mogą być powiązane przez wspólne tagi, temat, status, czas powstania albo przynależność do tego samego obszaru pracy.

Proponowany kierunek to graf semantyczny oparty na dwóch warstwach:

1. **Relacje jawne** - zapisane w danych, np. `in`, `depends_on`, `blocks`, `gantt_fs`, `related_to`.
2. **Relacje wywnioskowane** - podobieństwo wynikające z tagów, typów, statusów, słów kluczowych, dat i opcjonalnie embeddingów.

Graf nie powinien udawać, że relacja wywnioskowana jest faktycznym linkiem. Każde połączenie musi mieć wyjaśnienie, np. "wspólny tag #ui" albo "wspólny rodzic: Projects". Dzięki temu widok będzie użyteczny do analizy, a nie tylko efektowny wizualnie.

Najważniejsza zmiana względem klasycznego grafu Obsidiana:

> Obiekt nie jest pojedynczą kropką, a relacja nie jest anonimową kreską. Obiekt jest kartą kontekstu, a połączenie jest hipotezą o sile i źródle.

## 2. Punkt wyjścia: rzeczywiste dane Notible

W lokalnej bazie Notible znaleziono aktywny snapshot:

- 67 aktywnych obiektów,
- typy: 27 issue, 24 task, 6 note, 4 project, 2 milestone, 1 cycle, 1 habit, 1 release i 1 space,
- 137 relacji, z czego zdecydowana większość to relacje `in`,
- 2 relacje `related_to`, po jednej `depends_on`, `blocks` i `gantt_fs`,
- tagi między innymi: `#ui`, `#bug`, `#feature`, `#ux`, `#architecture`, `#mcp`, `#ai`, `#editor`, `#canvas`, `#workflow`, `#planning`, `#oauth`.

Obecne demo semantyczne prezentuje reprezentatywny podzbiór 23 obiektów z tego snapshotu. Jest to materiał do oceny kierunku, nie połączenie na żywo z bazą. W produkcyjnej wtyczce dane powinny być pobierane przez API Notible, a nie przez bezpośredni odczyt pliku SQLite.

### Co już działa w prototypie

- macierz kontekstów z agregatami dla całego workspace'u,
- graf z relacjami jawnymi oraz relacjami wyliczanymi z cech obiektów,
- filtrowanie warstw: relacje jawne, tagi, kontekst, status, słowa kluczowe i daty,
- próg siły relacji,
- panel inspektora z informacją, dlaczego obiekty zostały połączone.

### Najważniejsze ograniczenia prototypu

- pozycje kart są obecnie ustalone ręcznie,
- linie są proste i mogą przechodzić przez inne karty,
- tytuł jest obecnie skracany do jednej linii,
- graf nie ma jeszcze modelu ciężaru klastrów ani stabilnej symulacji,
- część grafu jest reprezentatywnym snapshotem, a nie pełnym widokiem live,
- liczenie relacji parami jest akceptowalne dla 67 obiektów, ale nie dla tysięcy.

## 3. Jakie pytania ma odpowiadać graf

Widok powinien pomagać odpowiedzieć na konkretne pytania:

- Które obszary są obecnie poznawczo "ciężkie" i mają najwięcej zależności?
- Które issue, taski i notatki dotyczą tego samego problemu mimo braku bezpośredniego linku?
- Gdzie znajdują się mosty między projektami lub workspace'ami?
- Które obiekty są osierocone albo mają tylko jedno słabe powiązanie?
- Dlaczego dwa obiekty są pokazane jako sąsiednie?
- Czy relacja jest faktem z bazy, czy tylko sugestią wynikającą z podobieństwa?
- Jak zmienia się mapa po zastosowaniu filtra, np. tylko `#ui`, `issue` i status `in-progress`?

Jeżeli odpowiedź nie wynika z grafu albo panelu inspektora, wizualizacja nie spełnia swojej funkcji, nawet jeśli wygląda atrakcyjnie.

## 4. Proponowany model wizualny

### 4.1. Karty zamiast kropek

Każdy obiekt powinien być prostokątną kartą o zmiennym, ale ograniczonym rozmiarze:

- szerokość: 132-184 px,
- wysokość: 58-78 px,
- tytuł: maksymalnie 2 linie,
- drugi wiersz: typ, status albo priorytet,
- opcjonalny trzeci element: 1-2 najważniejsze tagi jako małe etykiety.

Na płótnie nie pokazujemy całej treści notatki, opisu ani wszystkich właściwości. Pełny kontekst trafia do panelu inspektora po kliknięciu. Dzięki temu graf pozostaje mapą, a nie tabelą z tekstem.

Kolor karty powinien identyfikować typ obiektu, natomiast status musi być widoczny również tekstowo. Nie należy polegać wyłącznie na kolorze, ponieważ utrudnia to odczyt i jest nieprzyjazne dla osób z zaburzeniami rozróżniania barw.

### 4.2. Linie jako nośnik znaczenia

Linia nie może wyglądać tak samo niezależnie od powodu połączenia. Proponowana hierarchia:

| Rodzaj połączenia | Znaczenie | Styl |
|---|---|---|
| Relacja jawna | Fakt zapisany w danych | mocniejsza, 2-3 px, pełna linia |
| `depends_on`, `blocks`, `gantt_fs` | Zależność kierunkowa | strzałka, mocna linia |
| Wspólny rodzic lub kontener | Wspólny kontekst organizacyjny | delikatna linia albo obszar klastra |
| Wspólny tag | Wspólny temat | cienka linia w kolorze tagu |
| Wspólny typ/status | Słabsza korelacja | bardzo subtelna, przerywana |
| Wspólne słowa kluczowe | Podobieństwo treściowe | cienka, półprzezroczysta linia |
| Bliskość dat | Pomocniczy sygnał czasowy | domyślnie niewidoczna; dostępna jako warstwa |

Relacje wywnioskowane powinny być mniej dominujące niż relacje jawne. Na starcie nie pokazujemy wszystkich możliwych krawędzi. Dla każdego obiektu zachowujemy relacje jawne oraz maksymalnie 8-16 najsilniejszych sąsiadów semantycznych.

### 4.3. Obszary zamiast nadmiaru linii

Jeżeli 20 obiektów ma wspólnego rodzica lub wspólny klaster, nie należy rysować 20 podobnych połączeń do jednego centrum. Lepsze rozwiązanie to miękki obszar klastra, podpis pojawiający się po najechaniu oraz kilka najważniejszych połączeń wewnątrz.

Obszary mogą być wyznaczane według:

- workspace'u lub folderu,
- projektu albo rodzica,
- typu obiektu,
- dominującego tagu,
- klastra podobieństwa semantycznego.

Użytkownik powinien móc przełączyć sposób grupowania. Domyślnie najlepiej zacząć od projektu/rodzica, bo jest to interpretowalne i pochodzi bezpośrednio z danych.

## 5. Lekka symulacja grawitacji i ciężaru

W interfejsie warto mówić o "polu semantycznym" albo "przyciąganiu klastra", a nie o obiektywnej grawitacji. Ciężar wizualny jest funkcją danych, nie pomiarem ważności biznesowej.

### 5.1. Zasady rozmieszczania

Symulacja powinna działać w kilku poziomach:

1. **Stabilny seed** - początkowa pozycja wynika z identyfikatora obiektu i położenia jego klastra. Ten sam dataset daje ten sam układ po ponownym otwarciu.
2. **Centroidy klastrów** - najpierw wyznaczamy środki obszarów, np. `Projects`, `UI`, `MCP`, `Feedback`.
3. **Przyciąganie krawędzi** - obiekty połączone silną relacją przyciągają się proporcjonalnie do siły i rodzaju połączenia.
4. **Odpychanie kart** - każda karta odpycha inne karty, a promień odpychania uwzględnia jej rzeczywisty rozmiar.
5. **Przyciąganie do klastra** - obiekty pozostają blisko swojego obszaru, ale nie zapadają się w jeden punkt.
6. **Kolizje i margines** - karty nie mogą nachodzić na siebie; między nimi zostaje minimalny odstęp na przebieg linii.
7. **Chłodzenie symulacji** - po kilkuset iteracjach ruch wygasa. Użytkownik może jednak przeciągnąć kartę i lokalnie wznowić obliczenia.

### 5.2. Ciężar obszaru

Ciężar klastra powinien zależeć przede wszystkim od liczby obiektów i sumy silnych relacji, ale z malejącym przyrostem. Przykładowo:

```text
mass(cluster) = 0.8 * sqrt(numberOfObjects)
                + 0.2 * sqrt(sumOfStrongEdgeScores)
```

W praktyce oznacza to, że większy obszar jest wizualnie stabilniejszy, ale nie wypycha całej reszty grafu. Nie wolno używać liczby obiektów jako prostego rozmiaru w pikselach, bo jeden duży projekt zdominowałby mapę.

### 5.3. Siły i ograniczenia

W wersji pierwszej wystarczy deterministyczny układ force-directed z:

- repulsją między kartami,
- sprężyną na krawędziach,
- przyciąganiem do centroidu klastra,
- collision detection dla prostokątów,
- ograniczeniem do viewportu,
- ograniczeniem maksymalnej długości krawędzi.

W wersji produkcyjnej obliczenia powinny działać w Web Workerze. Interfejs nie może zatrzymywać się podczas ponownego rozmieszczania kilkuset obiektów.

## 6. Routing linii i czytelność połączeń

To jest najważniejsza poprawka wizualna przed dalszą oceną.

### 6.1. Kształt linii

- Zamienić proste odcinki na łagodne krzywe cubic Bezier albo spline.
- Kończyć linię na krawędzi karty, a nie w jej środku.
- Dla relacji kierunkowych używać małej, wyraźnej groty umieszczonej przy celu.
- Dla wielu linii między tymi samymi obszarami stosować kontrolowane odsunięcie, aby nie nakładały się idealnie.
- Unikać linii przechodzących przez kartę; jeżeli trasa przecina kartę, zmienić port lub wyznaczyć dodatkowy punkt kontrolny.
- Nie dodawać stałych etykiet do każdej linii. Powód połączenia pokazujemy na hoverze, focusie i w inspektorze.

### 6.2. Redukcja szumu

Domyślnie widoczne powinny być:

- wszystkie relacje jawne,
- najsilniejsze relacje semantyczne,
- połączenia aktywnie wybranego obiektu.

Pozostałe połączenia są przygaszone albo dostępne po włączeniu konkretnej warstwy. Po wybraniu karty aktywujemy "soczewkę": wybrany obiekt i jego sąsiedzi pozostają w pełnej widoczności, reszta grafu schodzi do niskiej przezroczystości.

### 6.3. Informacja o przyczynie

Hover na krawędzi powinien pokazać mały tooltip:

```text
Powiązanie: silne
Wspólne tagi: #ui, #ux
Wspólny rodzic: Projects
Wspólny status: in-progress
Źródło: wnioskowanie lokalne, nie jest zapisanym linkiem
```

Panel inspektora powinien dodatkowo pokazywać wszystkie składowe wyniku oraz rozdzielać fakty od sugestii.

## 7. Zawijanie tekstu i zawartość kart

Obecne skracanie tytułu do jednej krótkiej linii jest zbyt agresywne. Karta powinna:

- zawijać tytuł do dwóch linii,
- używać `overflow-wrap: anywhere` dla długich nazw,
- stosować elipsę dopiero po drugiej linii,
- zachowywać pełny tytuł w `title`/tooltipie i inspektorze,
- rezerwować stałe miejsce na typ i status,
- ukrywać tagi, gdy karta jest zbyt mała, zamiast wypychać nimi tytuł.

W implementacji SVG można użyć `foreignObject` z bezpiecznymi elementami HTML. Alternatywnie można renderować karty jako osobną warstwę HTML nad SVG. Tekst tytułów powinien być wstawiany przez `textContent`, nigdy przez niesanitizowane `innerHTML`.

## 8. Proponowany model danych

Każdy obiekt powinien być znormalizowany do postaci podobnej do:

```ts
type SemanticObject = {
  id: string;
  title: string;
  type: string;
  status?: string;
  priority?: string;
  parentId?: string;
  tags: string[];
  keywords: string[];
  createdAt?: string;
  updatedAt?: string;
};

type SemanticEdge = {
  from: string;
  to: string;
  score: number;
  reasons: Array<{
    kind: "explicit" | "parent" | "tag" | "type" | "status" | "keyword" | "date" | "embedding";
    value: string;
    weight: number;
    source: "stored" | "derived";
  }>;
  directed: boolean;
  explicitKinds: string[];
};
```

W prototypie można zachować przejrzystą funkcję punktacji:

```text
score(a, b) =
  8.0 * explicitRelation
  + 4.0 * sharedTagCount
  + 2.2 * sameParent
  + 1.1 * sameStatus
  + 1.0 * sameType
  + 2.1 * sharedKeywordCount
  + 1.1 * dateProximity
```

Wagi są punktem startowym, a nie prawdą domenową. Najważniejsze jest przechowywanie `reasons[]`, ponieważ sam wynik liczbowy nie wystarcza do oceny jakości.

Dwa zabezpieczenia są szczególnie istotne:

- sam wspólny status lub typ nie powinien tworzyć mocnej krawędzi,
- sama bliskość dat nie powinna domyślnie tworzyć widocznej krawędzi.

## 9. Skalowanie do dużych zbiorów danych

### 9.1. Problem obliczeniowy

Porównanie każdej pary obiektów ma koszt `O(n²)`. Dla 67 obiektów jest niezauważalne, ale dla 10 000 obiektów oznacza około 50 milionów par przed filtrowaniem. Tego nie należy wykonywać w głównym wątku ani dla całego workspace'u przy każdym odświeżeniu.

### 9.2. Etap pierwszy: cechy strukturalne

Najpierw należy zbudować indeksy odwrócone:

- `tag -> objectIds`,
- `keyword -> objectIds`,
- `parentId -> objectIds`,
- `type -> objectIds`,
- `status -> objectIds`,
- przedziały czasowe dla `createdAt` i `updatedAt`.

Kandydaci do porównania są generowani tylko z tych grup. Każda para otrzymuje wynik z cech strukturalnych, a dla każdego obiektu zachowujemy top-k sąsiadów. Relacje jawne są zachowywane niezależnie od top-k.

### 9.3. Etap drugi: opcjonalna semantyka treści

Embeddingi mogą poprawić wykrywanie podobnych treści, ale powinny być osobną warstwą:

- domyślnie treść pozostaje lokalnie na urządzeniu,
- wysyłanie treści do zewnętrznego modelu wymaga wyraźnego ustawienia,
- embedding nie zastępuje tagów ani relacji jawnych,
- wynik hybrydowy może zaczynać się od `0.65 * cechy strukturalne + 0.35 * podobieństwo embeddingów`,
- użyte podobieństwo musi być widoczne w inspektorze jako "podobieństwo treściowe".

Dla większych zbiorów należy użyć indeksu przybliżonego wyszukiwania wektorowego, np. HNSW lub innej lokalnej struktury ANN. Nie ma sensu renderować wszystkich podobnych obiektów naraz.

### 9.4. Aktualizacje przyrostowe

Po zmianie jednego obiektu nie przeliczamy całego workspace'u:

1. obliczamy hash cech obiektu,
2. unieważniamy jego wpis oraz sąsiedztwo wynikające ze zmienionych tagów, rodzica, statusu i słów kluczowych,
3. przeliczamy tylko dotknięte kubełki indeksów,
4. aktualizujemy lokalny fragment grafu,
5. przeprowadzamy krótką, lokalną symulację układu.

Cache powinien być kluczowany przez `objectId`, `updatedAt` i hash cech. Dane pochodne mogą być przechowywane w pamięci wtyczki albo w jej storage, bez modyfikowania obiektów użytkownika.

### 9.5. Widok wielorozdzielczy

Dla 1 000+ obiektów nie pokazujemy pełnego grafu kart:

- poziom 1: obszary i superwęzły klastrów,
- poziom 2: projekty, typy i najważniejsze obiekty,
- poziom 3: szczegóły wybranego klastra,
- poziom 4: sąsiedztwo konkretnego obiektu.

Zoom powinien zmieniać poziom szczegółowości, a nie tylko pomniejszać tysiące elementów do nieczytelnej plamy.

## 10. Warstwa UI do wdrożenia

Panel nad grafem:

- tryb: `Mapa` / `Sąsiedztwo` / `Macierz`,
- grupowanie: rodzic, projekt, typ, tag, klaster,
- warstwy: jawne, tagi, status, słowa kluczowe, daty, embedding,
- próg siły relacji,
- limit sąsiadów,
- przycisk `Fit to view`, `Reset layout` i `Freeze layout`.

Po lewej lub w panelu bocznym:

- wyszukiwarka obiektów,
- lista aktywnych filtrów,
- legenda relacji,
- liczba obiektów i krawędzi po filtrze.

Panel inspektora:

- tytuł, typ, status, priorytet, projekt i tagi,
- daty utworzenia oraz modyfikacji,
- relacje zapisane w bazie,
- relacje wywnioskowane z powodami i wagami,
- akcja otwarcia obiektu w Notible.

Na małym ekranie domyślny powinien być widok "wybrany obiekt + sąsiedzi", a nie pełna mapa.

## 11. Plan implementacji

### P0 - czytelność i kontrola szumu

- krzywe zamiast prostych linii,
- routing z punktami końcowymi na obwodzie kart,
- karty z tytułem do dwóch linii,
- wyraźne rozróżnienie relacji jawnych i wywnioskowanych,
- soczewka wybranego obiektu,
- tooltip z powodem połączenia,
- top-k oraz próg relacji,
- stabilny seed pozycji.

### P1 - pole semantyczne

- centroidy klastrów,
- masa zależna od liczby obiektów i siły relacji,
- odpychanie prostokątów i collision detection,
- ograniczenie linii przechodzących przez karty,
- lokalna re-layout po przeciągnięciu karty,
- Web Worker dla obliczeń układu.

### P2 - pełny pipeline danych

- pobieranie całego workspace'u przez publiczne API kontekstu,
- normalizacja typów, statusów, tagów i dat,
- indeksy odwrócone,
- cache i aktualizacje przyrostowe po `workspace.changed`,
- osobna obsługa relacji jawnych z ich kierunkiem i typem.

Obecna powierzchnia API udostępnia listowanie relacji dla pojedynczego obiektu. Przy większych zbiorach warto dodać do warstwy Core masowe zapytanie relacji, aby uniknąć wykonywania wielu osobnych odczytów.

### P3 - skala i semantyka treści

- Web Worker dla budowy cech i scoringu,
- indeks top-k oraz ANN dla embeddingów,
- widok wielorozdzielczy,
- superwęzły klastrów,
- hybrydowe wyniki strukturalne + treściowe,
- diagnostyka czasu obliczeń i liczby odrzuconych krawędzi.

### P4 - produktowe domknięcie

- ustawienia wag i warstw,
- zapisywanie układu per workspace,
- eksport obrazu lub danych,
- tryb porównania dwóch snapshotów w czasie,
- opcjonalne rekomendacje: "obiekty, które warto połączyć".

## 12. Metoda ewaluacji

### Scenariusze testowe

1. Znalezienie wszystkich obiektów dotyczących problemu UI.
2. Wykrycie mostu między projektem a feedbackiem użytkownika.
3. Znalezienie osieroconego issue bez sensownego kontekstu.
4. Wyjaśnienie, dlaczego dwa obiekty są połączone.
5. Porównanie klasycznego grafu z grafem semantycznym dla tego samego obszaru.
6. Odszukanie obiektów podobnych treściowo, ale znajdujących się w innych folderach.

### Kryteria akceptacji wersji P1

- brak nakładania się kart w głównym widoku,
- tytuły są czytelne przy szerokości viewportu 736 px, 1024 px i 360 px,
- relacje jawne są rozpoznawalne bez otwierania inspektora,
- każda relacja wywnioskowana ma możliwe do odczytania uzasadnienie,
- ten sam snapshot i seed daje stabilny układ,
- liczba widocznych krawędzi po filtrze nie powoduje nieczytelnej plątaniny,
- układ potrafi zmniejszyć liczbę przecięć krawędzi względem obecnego prototypu,
- zmiana filtra nie blokuje interfejsu.

### Dane testowe

- snapshot rzeczywisty: 67 obiektów,
- fixture ręcznie opisany: 100-200 obiektów z oczekiwanymi relacjami,
- syntetyczny workspace: 1 000 obiektów,
- test obciążeniowy: 10 000 obiektów, tylko poziom klastrów i sąsiedztwo.

W fixture ręcznie opisanym można ocenić false positives. Wstępny cel dla relacji wywnioskowanych to maksymalnie 15% oczywiście błędnych wskazań w grupie top-k, ale wartość należy potwierdzić na kilku rzeczywistych workspace'ach.

## 13. Ryzyka i granice rozwiązania

- Podobieństwo nie jest dowodem relacji. UI musi używać języka "powiązane przez" lub "sugerowane przez", a nie "połączone" dla wszystkich krawędzi.
- Wspólny status, np. `open`, jest słabym sygnałem i nie powinien tworzyć ciężkich skupisk.
- Tagi ogólne, takie jak `#task` lub `#project`, mogą generować fałszywe połączenia. Potrzebne są limity popularności tagu i obniżanie jego wagi.
- Embeddingi zwiększają koszt, trudniej je debugować i mogą ujawniać treść, jeśli zostaną wysłane poza urządzenie.
- Pełny graf dużego workspace'u nie jest dobrym ekranem do czytania. Potrzebny jest zoom semantyczny i widok sąsiedztwa.
- Wtyczka nie powinna czytać bezpośrednio pliku bazy Notible w trybie produkcyjnym. Należy korzystać z API i respektować zakres danych udostępniony przez Core.
- Daty i statusy są kontekstem pomocniczym, a nie automatycznym dowodem przyczynowości.

## 14. Rekomendacja do dalszej oceny

Najrozsądniejszym kolejnym krokiem jest wdrożenie P0 i P1 na obecnym snapshotcie 67 obiektów, przy zachowaniu klasycznego grafu jako trybu awaryjnego. Dopiero po potwierdzeniu czytelności kart, routingu linii i jakości wyjaśnień warto dodawać embeddingi oraz obsługę tysięcy obiektów.

Kolejność decyzji powinna być następująca:

1. Czy użytkownik szybciej rozumie relacje dzięki kartom i obszarom niż dzięki kropkom?
2. Czy potrafi odróżnić fakt zapisany w bazie od sugestii algorytmu?
3. Czy layout jest stabilny i nie tworzy plątaniny linii?
4. Czy top-k pokazuje użyteczne sąsiedztwo, a nie tylko obiekty o wspólnym, zbyt ogólnym tagu?
5. Dopiero potem: czy analiza treściowa i embeddingi poprawiają wynik na tyle, by uzasadnić koszt i dodatkową złożoność?

Wniosek: graf semantyczny ma sens jako osobna warstwa analityczna Notible, ale jego wartość będzie wynikać przede wszystkim z jakości wyjaśnień, stabilnego layoutu i redukcji szumu. Sama liczba wykrytych połączeń nie jest celem.
