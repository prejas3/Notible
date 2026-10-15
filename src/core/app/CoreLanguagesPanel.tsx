import { useCallback, useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { compareVersions } from "../extensions";
import { installLocale, removeLocale, type LocaleBundle } from "../data/core-data-api.ts";
import { fetchLanguagePack, fetchLanguageSources, repoFromInput, type LanguageSource } from "./marketSource.ts";
import { CORE_LANGUAGES, useCoreI18n, type CoreLanguage } from "./core-i18n.ts";

/**
 * Settings → Languages. Languages are packs anyone can publish as a GitHub
 * release carrying one `language.json`; they are listed here (never in the
 * plugin market) and installed with one click. Rust validates and re-writes the
 * file, so a pack can only ever be text for the interface.
 */
export function CoreLanguagesPanel({ installed, language, onUse, onChanged }: {
  installed: LocaleBundle[];
  language: CoreLanguage;
  onUse: (tag: CoreLanguage) => void;
  /** Re-read the installed languages after an install or removal. */
  onChanged: () => Promise<void>;
}) {
  const { t } = useCoreI18n();
  const [available, setAvailable] = useState<LanguageSource[] | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [repoInput, setRepoInput] = useState("");

  const loadCatalogue = useCallback(async () => {
    setProblem("");
    try { setAvailable(await fetchLanguageSources()); }
    catch (value) { setAvailable([]); setProblem(value instanceof Error ? value.message : String(value)); }
  }, []);
  useEffect(() => { void loadCatalogue(); }, [loadCatalogue]);

  const packByTag = new Map(installed.map((pack) => [pack.locale, pack]));

  async function install(repo: string, expectedTag?: string) {
    setBusy(repo);
    setNotice("");
    setProblem("");
    try {
      const text = await fetchLanguagePack(repo);
      // The catalogue promised a language; refuse a file that is another one.
      if (expectedTag) {
        const tag = (JSON.parse(text) as { locale?: unknown }).locale;
        if (tag !== expectedTag) throw new Error(t("That release is not the language the catalogue lists."));
      }
      const bundle = await installLocale(text);
      await onChanged();
      setNotice(t("Installed {name}.", { name: bundle.name }));
      setRepoInput("");
    } catch (value) {
      setProblem(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(null);
    }
  }

  async function remove(pack: LocaleBundle) {
    setBusy(pack.locale);
    setNotice("");
    setProblem("");
    try {
      await removeLocale(pack.locale);
      if (language === pack.locale) onUse("en");
      await onChanged();
      setNotice(t("Removed {name}.", { name: pack.name }));
    } catch (value) {
      setProblem(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(null);
    }
  }

  const toInstall = (available ?? []).filter((entry) => !packByTag.has(entry.locale) || (entry.version !== null && packByTag.get(entry.locale)?.version != null && compareVersions(entry.version, packByTag.get(entry.locale)!.version!) > 0));
  const builtIn = CORE_LANGUAGES.filter((option) => !packByTag.has(option.value) || option.value === "en");

  return (
    <article className="core-settings-section core-view-in">
      <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("Languages")}</p><h2>{t("Interface language")}</h2><p>{t("Install a language pack from the community, then pick it here. A pack is a single file of translated text.")}</p></div><span className="core-settings-mark"><Languages size={21} /></span></div>
      {problem && <p className="core-alert" role="alert">{problem}</p>}
      {notice && <p className="core-notice" role="status">{notice}</p>}

      <h3 className="core-lang-heading">{t("Installed")}</h3>
      <ul className="core-lang-list">
        {builtIn.map((option) => (
          <li key={option.value} className="core-lang-row">
            <div><strong>{option.label}</strong><small>{option.value} · {t("built in")}</small></div>
            {language === option.value ? <span className="core-lang-badge">{t("In use")}</span> : <button type="button" className="core-button" onClick={() => onUse(option.value)}>{t("Use")}</button>}
          </li>
        ))}
        {installed.map((pack) => (
          <li key={pack.locale} className="core-lang-row">
            <div><strong>{pack.name}</strong><small>{[pack.locale, pack.version ? `v${pack.version}` : null, pack.author].filter(Boolean).join(" · ")}</small></div>
            <div className="core-lang-actions">
              {language === pack.locale ? <span className="core-lang-badge">{t("In use")}</span> : <button type="button" className="core-button" onClick={() => onUse(pack.locale)}>{t("Use")}</button>}
              <button type="button" className="core-button" disabled={busy === pack.locale} onClick={() => void remove(pack)}>{t("Remove")}</button>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="core-lang-heading">{t("Available")}</h3>
      {available === null ? <p className="core-settings-hint">{t("Loading…")}</p> : toInstall.length === 0
        ? <p className="core-settings-hint">{t("No language packs are published yet. You can install one directly from GitHub below.")}</p>
        : <ul className="core-lang-list">
          {toInstall.map((entry) => (
            <li key={entry.locale} className="core-lang-row">
              <div><strong>{entry.name}</strong><small>{[entry.locale, entry.version ? `v${entry.version}` : null, entry.author].filter(Boolean).join(" · ")}</small>{entry.description && <small>{entry.description}</small>}</div>
              <button type="button" className="core-button core-button-primary" disabled={busy === entry.repo} onClick={() => void install(entry.repo, entry.locale)}>{packByTag.has(entry.locale) ? t("Update") : t("Install")}</button>
            </li>
          ))}
        </ul>}

      <h3 className="core-lang-heading">{t("Install from GitHub")}</h3>
      <div className="core-lang-github">
        <input type="text" aria-label={t("GitHub repository")} placeholder={t("e.g. someone/notible-german")} value={repoInput} onChange={(event) => setRepoInput(event.target.value)} />
        <button type="button" className="core-button core-button-primary" disabled={!repoFromInput(repoInput) || busy !== null} onClick={() => { const repo = repoFromInput(repoInput); if (repo) void install(repo); }}>{t("Install")}</button>
      </div>
      <p className="core-settings-hint">{t("For a translation someone shared with you: paste its GitHub address (the part after github.com/). Its latest release must include a language.json file.")}</p>
    </article>
  );
}
