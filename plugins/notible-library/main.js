export const LIBRARY_TYPE = "notible.library.library";
export const ITEM_TYPE = "notible.library.item";
export const KINDS = ["book", "film", "series", "game", "other"];
export const STATUSES = ["wishlist", "in-progress", "done", "dropped"];
// I18N (Hive #28): labels built from KINDS/STATUSES and the layout table reach
// t() as variables; tr() only lists them for scripts/plugin-locale-check.mjs.
const tr = (key) => key;
void [tr("Book"), tr("Film"), tr("Series"), tr("Game"), tr("Other"), tr("Wishlist"), tr("In progress"), tr("Done"), tr("Dropped"), tr("Grid"), tr("List")];
const MEDIA = /^media\/[0-9a-f-]{36}\.(png|jpg|jpeg|gif|webp|bmp)$/;
const emptyDocument = () => JSON.stringify({ type: "doc", content: [] });
const parseProps = (item) => { try { return JSON.parse(item?.props || "{}"); } catch { return {}; } };
const labelOf = (value) => value[0].toUpperCase() + value.slice(1).replace(/-/g, " ");
export const clampRating = (value) => { const rating = Math.round(Number(value)); return Number.isFinite(rating) && rating >= 1 ? Math.min(5, rating) : 0; };
export const stars = (value) => "★".repeat(clampRating(value)) + "☆".repeat(5 - clampRating(value));
export function filterItems(items, filters) {
  return items.filter((item) => {
    const props = parseProps(item);
    return (!filters.kind || props.kind === filters.kind)
      && (!filters.status || props.status === filters.status)
      && (!filters.tag || (Array.isArray(props.tags) && props.tags.includes(filters.tag)));
  }).sort((a, b) => filters.sort === "rating"
    ? clampRating(parseProps(b).rating) - clampRating(parseProps(a).rating) || b.updated_at - a.updated_at
    : b.updated_at - a.updated_at);
}
export function defaultLibraryForPicker(libraries, parentId) {
  return libraries.find((library) => library.id === parentId)?.id || libraries[0]?.id || "";
}
export function normalizeIsbn(value) {
  const compact = String(value || "").replace(/[\s-]/g, "").toUpperCase();
  return /^(?:\d{13}|\d{9}[\dX])$/.test(compact) ? compact : "";
}
const emptyValue = (value) => value === undefined || value === null || value === "";
export function mergeEmptyFields(current, incoming) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) if (emptyValue(merged[key]) && !emptyValue(value)) merged[key] = value;
  return merged;
}
const requestHeaders = { Accept: "application/json", "User-Agent": "Notible-Library/0.3.0 (Open Library lookup)" };
const jsonRequest = async (fetchImpl, url) => {
  const response = await fetchImpl(url, { headers: requestHeaders });
  if (!response.ok) throw Object.assign(new Error(`Open Library HTTP ${response.status}`), { status: response.status });
  return response.json();
};
const workKeyOf = (value) => typeof value === "string" && value.startsWith("/works/") ? value : "";
const descriptionOf = (value) => typeof value === "string" ? value : typeof value?.value === "string" ? value.value : "";
const yearOf = (value) => { const match = String(value || "").match(/\b(\d{4})\b/); return match ? Number(match[1]) : undefined; };
export function normalizeSearchDocument(doc) {
  const workKey = workKeyOf(doc.key) || workKeyOf(doc.works?.[0]?.key);
  return {
    title: String(doc.title || "").trim(),
    creator: Array.isArray(doc.author_name) ? doc.author_name.filter(Boolean).join(", ") : String(doc.creator || "").trim(),
    year: Number(doc.first_publish_year) || yearOf(doc.publish_date),
    isbn: normalizeIsbn(Array.isArray(doc.isbn) ? doc.isbn.find((value) => normalizeIsbn(value)) : doc.isbn),
    coverId: Number(doc.cover_i || (Array.isArray(doc.covers) ? doc.covers.find(Number.isFinite) : 0)) || undefined,
    workKey,
    link: workKey ? `https://openlibrary.org${workKey}` : "",
    description: descriptionOf(doc.description),
  };
}
export async function searchOpenLibrary(query, fetchImpl = fetch) {
  const isbn = normalizeIsbn(query);
  if (isbn) {
    const edition = await jsonRequest(fetchImpl, `https://openlibrary.org/isbn/${isbn}.json`).catch((error) => { if (error.status === 404) return null; throw error; });
    if (!edition) return [];
    const result = normalizeSearchDocument({ ...edition, isbn });
    if (!result.creator && Array.isArray(edition.authors)) {
      const authors = await Promise.all(edition.authors.slice(0, 4).map((author) => jsonRequest(fetchImpl, `https://openlibrary.org${author.key}.json`).catch(() => null)));
      result.creator = authors.map((author) => author?.name).filter(Boolean).join(", ");
    }
    return result.title ? [result] : [];
  }
  const payload = await jsonRequest(fetchImpl, `https://openlibrary.org/search.json?q=${encodeURIComponent(String(query || "").trim())}&limit=10&fields=key,title,author_name,first_publish_year,isbn,cover_i`);
  return (Array.isArray(payload.docs) ? payload.docs : []).slice(0, 10).map(normalizeSearchDocument).filter((result) => result.title);
}
export async function loadOpenLibraryChoice(context, result, fetchImpl = fetch, current = {}) {
  let description = result.description || "";
  if (!description && !String(current.description || "").trim() && result.workKey) {
    const work = await jsonRequest(fetchImpl, `https://openlibrary.org${result.workKey}.json`).catch(() => null);
    description = descriptionOf(work?.description);
  }
  let cover = "";
  if (result.coverId && !current.cover) cover = await context.data.media.importImageFromUrl(`https://covers.openlibrary.org/b/id/${result.coverId}-L.jpg?default=false`).catch(() => "");
  return { title: result.title, creator: result.creator, year: result.year, description, cover, link: result.link, isbn: result.isbn };
}
export async function migrateLooseItems(context) {
  const [items, libraries] = await Promise.all([context.data.objects.query({ type: ITEM_TYPE, limit: 5000 }), context.data.objects.query({ type: LIBRARY_TYPE, limit: 5000 })]);
  const libraryIds = new Set(libraries.map((library) => library.id));
  const loose = items.filter((item) => !item.parent_id || !libraryIds.has(item.parent_id));
  if (!loose.length) return { moved: 0, library: null };
  let target = libraries.find((library) => parseProps(library)._defaultLibrary === true);
  if (!target) target = await context.data.objects.create({ type: LIBRARY_TYPE, title: context.i18n.t("My library"), content: emptyDocument(), props: JSON.stringify({ kind: "other", _defaultLibrary: true }) });
  for (const item of loose) await context.data.objects.move(item.id, target.id);
  return { moved: loose.length, library: target };
}
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

async function imageUrl(context, ref) {
  if (!MEDIA.test(ref || "")) return null;
  try {
    const data = await context.data.media.read(ref);
    const ext = ref.split(".").pop().replace("jpg", "jpeg");
    return `data:image/${ext};base64,${data}`;
  } catch { return null; }
}

function select(context, value, options, onChange, label) {
  const host = el("span", "nlib-select");
  const control = context.ui.mountSelect(host, { value, options, onChange, ariaLabel: label });
  return { host, dispose: () => control.dispose() };
}

function ratingControl(t, value, onChange) {
  const root = el("div", "nlib-rating"); const buttons = el("span", "nlib-rating-stars"); let current = clampRating(value); let preview = 0;
  const draw = () => [...buttons.children].forEach((button, index) => { button.textContent = index < (preview || current) ? "★" : "☆"; });
  for (let index = 1; index <= 5; index += 1) { const button = el("button", "nlib-star", "☆"); button.type = "button"; button.setAttribute("aria-label", t("{rating} stars").replace("{rating}", String(index))); button.onmouseenter = () => { preview = index; draw(); }; button.onmouseleave = () => { preview = 0; draw(); }; button.onclick = () => { current = index; preview = 0; draw(); onChange(current); }; buttons.append(button); }
  const clear = el("button", "nlib-rating-clear", t("Clear rating")); clear.type = "button"; clear.onclick = () => { current = 0; preview = 0; draw(); onChange(0); };
  root.append(el("span", "nlib-rating-label", t("Rating")), buttons, clear); draw(); return { root, set(value) { current = clampRating(value); draw(); } };
}

function onlineLookup(context, getKind, getValues, applyValues) {
  const t = (key) => context.i18n.t(key); const root = el("section", "nlib-lookup"); const row = el("div", "nlib-lookup-row");
  const button = el("button", "", t("Find online")); button.type = "button"; const message = el("small", "nlib-lookup-message"); const results = el("div", "nlib-lookup-results");
  row.append(button, el("small", "", t("Data from Open Library"))); root.append(row, message, results);
  const setKind = (kind) => { root.hidden = kind !== "book"; };
  button.onclick = async () => {
    const values = getValues(); const query = normalizeIsbn(values.isbn) || normalizeIsbn(values.title) || values.title.trim();
    results.replaceChildren(); if (!query) { message.textContent = t("Enter a title or ISBN first"); return; }
    button.disabled = true; message.textContent = t("Searching Open Library…");
    try {
      const found = await searchOpenLibrary(query); message.textContent = found.length ? "" : t("No books found");
      for (const result of found) {
        const pick = el("button", "nlib-lookup-result"); pick.type = "button"; const placeholder = el("span", "nlib-lookup-placeholder", "▧"); const copy = el("span", "");
        copy.append(el("strong", "", result.title), el("small", "", [result.creator, result.year].filter(Boolean).join(" · "))); pick.append(placeholder, copy);
        pick.onclick = async () => { pick.disabled = true; message.textContent = t("Adding book details…"); try { const details = await loadOpenLibraryChoice(context, result, fetch, getValues()); applyValues(details); message.textContent = details.cover ? t("Book details and cover added") : t("Book details added; no cover available"); results.replaceChildren(); } catch { message.textContent = t("Open Library is unavailable. You can keep editing manually."); } finally { pick.disabled = false; } };
        results.append(pick);
      }
    } catch { message.textContent = t("Open Library is unavailable. You can keep editing manually."); }
    finally { button.disabled = false; }
  };
  setKind(getKind()); return { root, setKind };
}

function itemForm(context, library, onSaved, item = null) {
  const t = (key) => context.i18n.t(key); const libraryProps = parseProps(library); const existing = parseProps(item); const form = el("form", "nlib-item-form");
  const title = document.createElement("input"); title.placeholder = t("Title"); title.required = true; title.maxLength = 200; title.value = item?.title || ""; title.dataset.field = "title";
  const creator = document.createElement("input"); creator.placeholder = t("Creator"); creator.value = existing.creator || ""; creator.dataset.field = "creator";
  const year = document.createElement("input"); year.type = "number"; year.placeholder = t("Year"); year.min = "0"; year.max = "9999"; year.value = existing.year || ""; year.dataset.field = "year";
  const isbn = document.createElement("input"); isbn.placeholder = t("ISBN"); isbn.value = existing.isbn || ""; isbn.dataset.field = "isbn";
  const link = document.createElement("input"); link.type = "url"; link.placeholder = t("Link"); link.value = existing.link || ""; link.dataset.field = "link";
  const tags = document.createElement("input"); tags.placeholder = t("Tags separated by commas"); tags.value = Array.isArray(existing.tags) ? existing.tags.join(", ") : "";
  const description = document.createElement("textarea"); description.placeholder = t("Description"); description.value = existing.description || ""; description.dataset.field = "description";
  let kind = KINDS.includes(existing.kind) ? existing.kind : KINDS.includes(libraryProps.kind) ? libraryProps.kind : "book"; let status = STATUSES.includes(existing.status) ? existing.status : "wishlist"; let rating = clampRating(existing.rating); let coverRef = existing.cover || ""; let finishedDate = existing.finishedDate || "";
  let lookup;
  const kindControl = select(context, kind, KINDS.map((value) => ({ value, label: t(labelOf(value)) })), (value) => { kind = value; lookup?.setKind(value); }, t("Kind"));
  const statusControl = select(context, status, STATUSES.map((value) => ({ value, label: t(labelOf(value)) })), (value) => { status = value; }, t("Status"));
  const dateHost = el("span", "nlib-date"); const dateControl = context.ui.mountDatePicker(dateHost, { value: finishedDate, ariaLabel: t("Finished date"), onChange: (value) => { finishedDate = value; } });
  const ratingField = ratingControl(t, rating, (value) => { rating = value; });
  const cover = el("button", "", coverRef ? `✓ ${t("Choose cover")}` : t("Choose cover")); cover.type = "button"; cover.onclick = async () => { const ref = await context.data.media.pickImage(); if (ref) { coverRef = ref; cover.textContent = `✓ ${t("Choose cover")}`; } };
  const values = () => ({ title: title.value, creator: creator.value, year: year.value, isbn: isbn.value, description: description.value, link: link.value, cover: coverRef });
  const applyValues = (incoming) => { const typedIsbn = normalizeIsbn(title.value); if (typedIsbn) { title.value = ""; if (!isbn.value.trim()) isbn.value = typedIsbn; } const merged = mergeEmptyFields(values(), incoming); title.value = merged.title || ""; creator.value = merged.creator || ""; year.value = merged.year || ""; isbn.value = merged.isbn || ""; description.value = merged.description || ""; link.value = merged.link || ""; if (!coverRef && merged.cover) { coverRef = merged.cover; cover.textContent = `✓ ${t("Choose cover")}`; } };
  lookup = onlineLookup(context, () => kind, values, applyValues);
  const submit = el("button", "nlib-primary", item ? t("Save item") : t("Add item")); submit.type = "submit";
  const heading = el("div", "nlib-form-head"); heading.append(el("strong", "", item ? t("Edit item") : t("New item")), el("small", "", item ? t("Update this library item") : t("Add it directly to this library")));
  const fields = el("div", "nlib-form-grid"); fields.append(title, kindControl.host, creator, year, isbn, statusControl.host, link, tags, dateHost, description);
  form.append(heading, fields, lookup.root, ratingField.root, cover, submit);
  form.onsubmit = async (event) => { event.preventDefault(); const value = title.value.trim(); if (!value) return; const props = JSON.stringify({ ...existing, kind, creator: creator.value.trim(), year: Number(year.value) || undefined, isbn: normalizeIsbn(isbn.value) || isbn.value.trim() || undefined, description: description.value.trim(), status, rating, cover: coverRef, link: link.value.trim(), tags: tags.value.split(",").map((tag) => tag.trim()).filter(Boolean), finishedDate }); if (item) await context.data.objects.update(item.id, { title: value, props }, item.updated_at); else await context.data.objects.create({ type: ITEM_TYPE, title: value, parentId: library.id, content: emptyDocument(), props }); if (!item) { title.value = ""; creator.value = ""; year.value = ""; isbn.value = ""; description.value = ""; link.value = ""; tags.value = ""; rating = 0; coverRef = ""; ratingField.set(0); cover.textContent = t("Choose cover"); } await onSaved(); if (!item) title.focus(); };
  return { form, focus: () => title.focus(), dispose: () => { kindControl.dispose(); statusControl.dispose(); dateControl.dispose(); } };
}

function mountLibrary(context, container, libraryId) {
  const t = (key) => context.i18n.t(key); const root = el("section", "nlib"); container.append(root); const state = { kind: "", status: "", tag: "", sort: "date", layout: "grid" };
  let alive = true; let controls = []; let formMount = null; let renderGeneration = 0;
  const cleanup = () => { controls.forEach((item) => item.dispose()); controls = []; formMount?.dispose(); formMount = null; };
  const render = async () => { const generation = ++renderGeneration; cleanup(); root.replaceChildren(); const [library, all] = await Promise.all([context.data.objects.get(libraryId), context.data.objects.query({ type: ITEM_TYPE, parentId: libraryId, limit: 5000 })]); if (!alive || generation !== renderGeneration || !library) return;
    const tags = [...new Set(all.flatMap((item) => parseProps(item).tags || []))].sort(); const head = el("header", "nlib-head"); const title = el("div", "nlib-library-heading"); const back = el("button", "nlib-back", `← ${t("Back to libraries")}`); back.type = "button"; back.onclick = () => void context.ui.openView("libraries"); title.append(back, el("small", "nlib-eyebrow", t("Library")), el("h1", "", library.title)); head.append(title); const actions = el("div", "nlib-actions");
    for (const [key, label] of [["grid", "Grid"], ["list", "List"]]) { const button = el("button", state.layout === key ? "is-active" : "", t(label)); button.type = "button"; button.onclick = () => { state.layout = key; void render(); }; actions.append(button); } head.append(actions); root.append(head);
    formMount = itemForm(context, library, render); root.append(formMount.form); if (context.storage.get("new-item-library") === libraryId) { context.storage.delete("new-item-library"); queueMicrotask(() => formMount?.focus()); }
    const filters = el("div", "nlib-filters"); const defs = [["kind", t("Kind"), [["", t("All kinds")], ...KINDS.map((value) => [value, t(labelOf(value))])]], ["status", t("Status"), [["", t("All statuses")], ...STATUSES.map((value) => [value, t(labelOf(value))])]], ["tag", t("Tag"), [["", t("All tags")], ...tags.map((value) => [value, value])]], ["sort", t("Sort"), [["date", t("Recently updated")], ["rating", t("Rating")]]]];
    for (const [key, label, pairs] of defs) { const control = select(context, state[key], pairs.map(([value, name]) => ({ value, label: name })), (value) => { state[key] = value; void render(); }, label); controls.push(control); filters.append(control.host); } root.append(filters);
    const items = filterItems(all, state); if (!items.length) { root.append(el("p", "nlib-empty", t("No items yet"))); return; } const shelf = el("div", `nlib-shelf nlib-shelf--${state.layout}`); root.append(shelf); const coverLoads = [];
    for (const item of items) { const props = parseProps(item); const card = el("button", "nlib-card"); card.type = "button"; card.onclick = () => void context.ui.openObject(item.id); const cover = el("span", "nlib-cover", (item.title || "?").slice(0, 2).toUpperCase()); const copy = el("span", "nlib-copy"); copy.append(el("strong", "", item.title), el("span", "nlib-stars", stars(props.rating)), el("small", "", [props.creator, props.year, props.kind].filter(Boolean).join(" · "))); card.append(cover, copy); shelf.append(card); coverLoads.push(imageUrl(context, props.cover).then((url) => { if (!url || !alive || generation !== renderGeneration) return; const img = document.createElement("img"); img.src = url; img.alt = ""; cover.replaceChildren(img); })); } await Promise.all(coverLoads);
  };
  const stop = context.events.on("workspace.changed", () => void render()); void render(); return { dispose() { alive = false; renderGeneration += 1; stop.dispose(); cleanup(); root.remove(); } };
}

function mountLibraries(context, container, openObject) {
  const t = (key) => context.i18n.t(key); const root = el("section", "nlib nlib-index"); container.append(root); let alive = true;
  const render = async () => { const libraries = await context.data.objects.query({ type: LIBRARY_TYPE, limit: 5000 }); if (!alive) return; root.replaceChildren(); const head = el("header", "nlib-head"); head.append(el("h1", "", t("Libraries"))); root.append(head); const form = el("form", "nlib-library-create"); const input = document.createElement("input"); input.placeholder = t("Library name"); input.required = true; const submit = el("button", "nlib-primary", t("New library")); submit.type = "submit"; form.append(input, submit); root.append(form); form.onsubmit = async (event) => { event.preventDefault(); const name = input.value.trim(); if (!name) return; const library = await context.data.objects.create({ type: LIBRARY_TYPE, title: name, content: emptyDocument(), props: JSON.stringify({ kind: "other" }) }); await openObject(library.id); }; const list = el("div", "nlib-library-list"); for (const library of libraries) { const button = el("button", "nlib-library-row"); button.type = "button"; button.append(el("strong", "", library.title), el("small", "", t("Open library"))); button.onclick = () => void openObject(library.id); list.append(button); } root.append(list); };
  const stop = context.events.on("workspace.changed", () => void render()); void render(); return { dispose() { alive = false; stop.dispose(); root.remove(); } };
}

async function chooseLibrary(context, parentId) { const libraries = await context.data.objects.query({ type: LIBRARY_TYPE, limit: 5000 }); const preferred = defaultLibraryForPicker(libraries, parentId); if (preferred && preferred === parentId) return libraries.find((library) => library.id === preferred); return context.ui.suggest(libraries, (library) => library.title, { placeholder: context.i18n.t("Choose a library") }); }

function mountItemToolbar(context, container, objectId) { let alive = true; const root = el("div", "nlib-item-toolbar"); container.append(root); void (async () => { const object = await context.data.objects.get(objectId); if (!alive || object?.type !== ITEM_TYPE || !object.parent_id) return; const library = await context.data.objects.get(object.parent_id); if (!library || library.type !== LIBRARY_TYPE) return; const t = (key) => context.i18n.t(key); const back = el("button", "nlib-back", `← ${t("Back to library")}`); back.type = "button"; back.onclick = () => void context.ui.openObject(library.id); const rating = ratingControl(t, parseProps(object).rating, async (value) => { const current = await context.data.objects.get(objectId); if (current) await context.data.objects.update(objectId, { props: JSON.stringify({ ...parseProps(current), rating: value || undefined }) }, current.updated_at); }); root.append(back, rating.root); })(); return { dispose() { alive = false; root.remove(); } }; }

function mountItemDetails(context, container, objectId) {
  const root = el("section", "nlib nlib-item-details"); container.append(root); let alive = true; let formMount = null;
  void (async () => {
    const item = await context.data.objects.get(objectId); if (!alive || item?.type !== ITEM_TYPE || !item.parent_id) return;
    const library = await context.data.objects.get(item.parent_id); if (!library || library.type !== LIBRARY_TYPE || !alive) return;
    formMount = itemForm(context, library, async () => { const saved = await context.data.objects.get(objectId); if (saved) item.updated_at = saved.updated_at; }, item); root.append(formMount.form);
  })();
  return { dispose() { alive = false; formMount?.dispose(); root.remove(); } };
}

let migration = Promise.resolve();
const scheduleMigration = (context) => { migration = migration.then(() => migrateLooseItems(context), () => migrateLooseItems(context)); return migration; };

export default {
  manifest:{id:"notible.library",name:"Library",version:"0.3.0",apiVersion:"1.28",permissions:["data.read","data.write","media.read","media.write","network","workspace.ui"],networkHosts:["openlibrary.org","covers.openlibrary.org","archive.org","*.archive.org"]},
  async onload(context){
    await context.data.types.upsert(LIBRARY_TYPE,JSON.stringify({fields:{kind:{type:"select",options:KINDS}},behaviour:{container:true}}),"library");
    await context.data.types.upsert(ITEM_TYPE,JSON.stringify({fields:{kind:{type:"select",options:KINDS},creator:{type:"text"},year:{type:"number"},isbn:{type:"text"},description:{type:"text"},status:{type:"select",options:STATUSES},rating:{type:"number"},cover:{type:"text"},link:{type:"url"},tags:{type:"tags"},finishedDate:{type:"date"}},behaviour:{treeHidden:true}}),"library");
    await scheduleMigration(context);
    context.events.on("object.created",({type})=>{if(type===ITEM_TYPE)void scheduleMigration(context);});
    context.views.register({id:"libraries",title:context.i18n.t("Libraries"),nav:true,navIcon:"file-text",mount:({container,openObject})=>mountLibraries(context,container,openObject)});
    context.views.registerObjectTab({id:"library",label:context.i18n.t("Library"),objectTypes:[LIBRARY_TYPE],order:0,mount:(container,tab)=>mountLibrary(context,container,tab.objectId)});
    context.views.registerObjectTab({id:"item-details",label:context.i18n.t("Library details"),objectTypes:[ITEM_TYPE],order:0,mount:(container,tab)=>mountItemDetails(context,container,tab.objectId)});
    context.ui.registerSlot("editor.toolbar",{id:"item-library-tools",mount:({container,objectId})=>objectId?mountItemToolbar(context,container,objectId):undefined});
    context.commands.register({id:"new-library",name:context.i18n.t("New library"),creates:{objectType:LIBRARY_TYPE,label:context.i18n.t("Library"),icon:"library",slashMenu:false},execute:(input)=>{const value=input&&typeof input==="object"?input:{};return context.data.objects.create({type:LIBRARY_TYPE,title:typeof value.title==="string"&&value.title.trim()?value.title.trim():context.i18n.t("New library"),parentId:typeof value.parentId==="string"?value.parentId:undefined,content:emptyDocument(),props:JSON.stringify({kind:"other"})});}});
    context.commands.register({id:"new-item",name:context.i18n.t("New library item"),creates:{objectType:ITEM_TYPE,label:context.i18n.t("Library item"),icon:"library",slashMenu:false},execute:async(input)=>{const value=input&&typeof input==="object"?input:{};const library=await chooseLibrary(context,typeof value.parentId==="string"?value.parentId:undefined);if(!library)throw new Error(context.i18n.t("Choose a library"));context.storage.set("new-item-library",library.id);return library;}});
  }
};
