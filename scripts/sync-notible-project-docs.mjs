import { Client } from "../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const PROJECT_ID = "60460bc1-430f-4337-a929-a960d9bf5a6b";
const marker = "Aktualizacja implementacji — 2026-07-19";
const specs = {
  "fdcf82ec-263f-4cc1-8863-e2751a9a888d": { state:"MVP ukończone w Notible 0.17.x.", done:["Osobny typ whiteboard i lokalny autosave.","Notatki, kształty, sekcje, obrazy, tabele, przeciąganie i połączenia.","Raport Markdown, eksport JSON oraz tworzenie podlinkowanych tasków."], left:["Zoom i pan, resize elementów, import tablic i bogatsze formatowanie."] },
  "08bdaa08-c48f-4b3c-88fd-d353cb01e209": { state:"Fundament AI i MCP działa; wbudowany czat nadal korzysta z analizy lokalnej.", done:["Kontekstowy dymek AI i AI work desk.","Lokalna priorytetyzacja, podsumowanie pracy i propozycje wymagające potwierdzenia.","Samowystarczalny serwer MCP w instalatorze 0.17.x."], left:["Podłączenie wbudowanego czatu do rzeczywistego modelu i narzędzi generowania treści."], code:{lang:"json",text:'{"mcpServers":{"notible":{"command":"<runtime>/node.exe","args":["<resources>/mcp-server/index.js"]}}}'} },
  "27f1e005-fd24-4db1-a600-4f8158e7b144": { state:"Kod synchronizacji jest gotowy do testu na prawdziwych kontach w 0.17.1.", done:["Google i Microsoft Authorization Code + PKCE S256.","Systemowa przeglądarka, losowy callback localhost i ochrona state.","Tokeny w Windows Credential Manager; odczyt kalendarzy per projekt."], left:["Test logowania Google i Microsoft oraz synchronizacji wielu kalendarzy."], code:{lang:"text",text:"Google: calendar.readonly\nMicrosoft: offline_access + Calendars.Read\nRedirect: http://localhost:<ephemeral-port>"} },
  "7ea08936-08fa-43e6-bc1f-237801714492": { state:"Podstawowy silnik automatyzacji v2 jest wdrożony.", done:["Triggery record-created, property-changed, date-reached i manual.","Warunki z query buildera, wiele akcji, dry-run i log wykonania.","Ochrona przed pętlami, limity akcji i bezpieczne wyłączanie błędnych reguł."], left:["Lepszy kreator if/then, szablony oraz cofanie operacji zbiorczych."], code:{lang:"json",text:'{"trigger":{"type":"property_changed","field":"status","value":"done"},"actions":[{"type":"set_property","field":"completed","value":true}]}'} },
  "ae824b53-c9e5-45d6-884d-4b3dd6abad1c": { state:"Lokalne sugestie tagów są wdrożone bez zewnętrznego AI.", done:["Analiza słów w treści, popularności w projekcie i podobnych rekordów.","Maksymalnie trzy sugestie; zapis dopiero po kliknięciu użytkownika."], left:["Reguły słownikowe per projekt, synonimy, wykluczenia i masowe przeliczanie."] },
  "3ec14a11-3428-4cc5-b914-b99747fce078": { state:"Bloki kodu i porównania są wdrożone w wersji 0.14.0.", done:["Automatyczne wykrywanie języka po wklejeniu i ręczny selektor.","Side-by-side diff z numerami linii i stanami add/remove/modify.","Bezpieczny tryb dla dużych danych oraz eksport Markdown."], left:["Dalszy polish UI, wybór motywu i porównywanie wersji dokumentów."], code:{lang:"typescript",text:'const result = diffLines(previousCode, nextCode);\n// deterministic, local and covered by regression tests'} },
  "78e72e72-134a-4113-88e7-d33052e443c6": { state:"Silnik zależności Gantta jest wdrożony; wizualna edycja wymaga dalszego rozwinięcia.", done:["Finish-to-start, start-to-start, finish-to-finish i blocks.","Walidacja self-linków i cykli.","Propagacja dat po drag/resize z obsługą milestone points."], left:["Czytelniejsze strzałki na wykresie, opóźnienia i bezpośrednie łączenie elementów."] },
  "d0051fa7-3151-41b2-820e-018f020b6a13": { state:"Elastyczny model danych ma działający fundament.", done:["Własne typy i schematy pól, relacje oraz trwałe migracje.","Reusable data sources, zagnieżdżone filtry AND/OR i zapisane widoki.","Lookup, rollup, formuły, miary nazwane i inspektor zależności."], left:["Jeden panel zarządzania zakresem local/shared/global i kontrolowane migracje schematów z UI."] },
  "4fa88488-5a96-401e-b553-2d37935eeda6": { state:"Podstawy raportowania działają, ale raporty przekrojowe pozostają otwarte.", done:["Dashboardy: statystyki, listy, tabele, wykresy i upcoming.","Saved data sources, filtry semantyczne i eksport CSV/XLSX/Markdown.","Project updates i raport całego Whiteboardu."], left:["Wiele źródeł w jednym raporcie, szablony, pivoty i drill-down."] },
  "65b588f4-ec60-4354-9f04-5f1abe6d7755": { state:"Podstawowy moduł finansowy jest ukończony; timesheety wymagają rozbudowy.", done:["Budżet, koszty, przychody, marża, burn rate, runway i forecast.","Time entries, stawki billable/cost, import arkuszy i eksport XLSX.","Prywatna granica MCP dla danych finansowych."], left:["Timesheet per osoba/rola/moduł i lepsze wykresy plan kontra wykonanie."] },
  "26182240-8490-4925-8b68-7bf45cab7e30": { state:"Istnieje lokalny katalog osób; pełne zespoły pozostają na później.", done:["Obiekty person, ponowne użycie nazw i autocomplete w polach ownership."], left:["Obiekty team, członkostwo, e-mail, role, konta, uprawnienia i powiadomienia."] },
  "73209d22-a707-408a-a36d-20c5578e76c9": { state:"Wiele praktyk agile jest już częścią modelu pracy.", done:["Triage, backlog, cykle, milestones, releases i zależności.","Estimate vs actual, capacity, velocity, rollover i health projektu.","Project updates oraz historia zmian zakresu."], left:["WIP limits, retrospektywy i spójne raporty delivery; zadanie warto rozbić na mniejsze audyty."] },
  "c2c99fbf-a809-40c7-91ec-6e010724a589": { state:"Częściowo rozwiązane przez widoki, filtry, Kanban i archiwizację.", done:["Osobny widok Done, zapisane widoki i możliwość ukrywania pustych kolumn."], left:["Domyślny filtr aktywnej pracy, Recently completed i licznik ukrytych rekordów."] },
  "03fefd57-6ec3-481d-a63f-897c82e7e242": { state:"Problemy opisane w issue zostały naprawione w 0.11.0.", done:["Date picker pozycjonowany względem viewportu i odporny na obcinanie.","Tooltipy dla uciętych wartości oraz poprawki szerokości panelu właściwości."], left:["Smoke test w jasnym i ciemnym motywie na małym oknie; po potwierdzeniu issue można zamknąć."] },
  "ae948ab0-355a-4efe-85e0-9faf21e8d0cd": { state:"Częściowo rozwiązane; issue obejmuje dwa niezależne obszary.", done:["Katalog osób i podpowiedzi ownership.","Zakresy project/selected-project/workspace dla milestones, cycles i releases."], left:["Pełne zespoły oraz jeden panel globalnych przełączników. Docelowo rozdzielić na dwa issues."] }
};

const paragraph = (text) => ({ type:"paragraph", content:text ? [{type:"text",text}] : [] });
const heading = (text, level=2) => ({ type:"heading", attrs:{level}, content:[{type:"text",text}] });
const bulletList = (items) => ({ type:"bulletList", content:items.map(text=>({type:"listItem",content:[paragraph(text)]})) });
function normalize(raw, fallback) {
  try { const doc=JSON.parse(raw); if(doc?.type==="doc" && Array.isArray(doc.content)) return doc; } catch {}
  return {type:"doc",content:fallback ? [paragraph(fallback)] : []};
}
function append(doc, spec) {
  const nodes=[{type:"horizontalRule"},heading(marker),paragraph(spec.state),heading("Zrobione",3),bulletList(spec.done),heading("Pozostało",3),bulletList(spec.left)];
  if(spec.code) nodes.push(heading("Przykład techniczny",3),{type:"codeBlock",attrs:{language:spec.code.lang},content:[{type:"text",text:spec.code.text}]});
  nodes.push(paragraph("Źródło weryfikacji: aktualny kod aplikacji, CHANGELOG oraz testy wydania 0.17.1."));
  return {...doc,content:[...(doc.content||[]),...nodes]};
}

const dbPath=process.env.NOTIBLE_DB_PATH;
if(!dbPath) throw new Error("NOTIBLE_DB_PATH is required");
const transport=new StdioClientTransport({command:process.execPath,args:["./mcp-server/index.js"],env:{...process.env,NOTIBLE_DB_PATH:dbPath},stderr:"pipe"});
const client=new Client({name:"notible-doc-sync",version:"1.0.0"});
await client.connect(transport);
const tool=async(name,args)=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(r.content[0].text);return JSON.parse(r.content[0].text)};
const applied=[];
for(const [id,spec] of Object.entries(specs)) {
  const current=await tool("get_note",{id});
  if(current.text.includes(marker)){applied.push({id,title:current.title,skipped:true});continue;}
  const probe=await tool("propose_object_update",{id,content:`${current.text}\n\n${marker}`,expectedUpdatedAt:current.updated_at});
  const doc=normalize(probe.before.content,current.text);
  const proposal=await tool("propose_object_update",{id,content:JSON.stringify(append(doc,spec)),expectedUpdatedAt:current.updated_at});
  const result=await tool("apply_object_update",{proposalId:proposal.proposalId});
  applied.push({id,title:current.title,historyId:result.historyId,skipped:false});
}
console.log(JSON.stringify({projectId:PROJECT_ID,count:applied.length,applied},null,2));
await client.close();
