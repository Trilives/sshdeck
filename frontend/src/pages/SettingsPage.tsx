import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/ui/select";
import { t } from "../i18n";
import { languageLabels } from "../i18n";
import type { AppSettings, CloseBehavior, Language, LogLevel, UpdateChannel, UpdateState } from "../types";

const displayModes = [
  { value: "light", label: "themeLight", icon: Sun },
  { value: "dark", label: "themeDark", icon: Moon },
  { value: "system", label: "themeSystem", icon: Monitor },
] as const;

const accentColors = [
  { value: "blue", label: "accentBlue" },
  { value: "violet", label: "accentViolet" },
  { value: "teal", label: "accentTeal" },
  { value: "orange", label: "accentOrange" },
  { value: "monochrome", label: "accentMonochrome" },
] as const;

const appearanceOption = "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-600 transition hover:border-blue-300 peer-checked:border-blue-300 peer-checked:bg-blue-50 peer-checked:text-blue-800 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-blue-700 dark:peer-checked:border-blue-700 dark:peer-checked:bg-blue-950 dark:peer-checked:text-blue-200";

function AppearanceSettings({ settings, onChange }: {
  settings: AppSettings;
  onChange: (settings: Partial<Pick<AppSettings, "theme" | "accentColor">>) => void;
}) {
  const { language, theme, accentColor } = settings;
  return (
    <section className="mb-1 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Palette size={16} className="text-blue-600 dark:text-blue-300" aria-hidden />
        {t(language, "appearance")}
      </h3>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300" aria-hidden>{t(language, "theme")}</span>
        <fieldset aria-label={t(language, "theme")} className="flex min-w-0 flex-wrap gap-2">
          {displayModes.map(({ value, label, icon: Icon }) => (
            <label key={value}>
              <input
                type="radio"
                name="display-mode"
                checked={theme === value}
                onChange={() => onChange({ theme: value })}
                className="peer sr-only"
              />
              <span className={appearanceOption}>
                <Icon size={15} aria-hidden />
                {t(language, label)}
              </span>
            </label>
          ))}
        </fieldset>
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300" aria-hidden>{t(language, "accentColor")}</span>
        <fieldset aria-label={t(language, "accentColor")} className="flex min-w-0 flex-wrap gap-2">
          {accentColors.map(({ value, label }) => (
            <label key={value}>
              <input
                type="radio"
                name="accent-color"
                checked={accentColor === value}
                onChange={() => onChange({ accentColor: value })}
                className="peer sr-only"
              />
              <span className={appearanceOption}>
                <span data-accent={value} className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-blue-600 text-white" aria-hidden>
                  {accentColor === value && <Check size={11} strokeWidth={3} />}
                </span>
                {t(language, label)}
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  );
}

function SettingSelect(props: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[160px_240px] items-center gap-4 text-sm font-medium text-slate-600 dark:text-slate-300">
      {props.label}
      <Select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.children}
      </Select>
    </label>
  );
}

function SettingToggle(props: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 text-sm">
      <span className="pt-0.5 font-medium text-slate-600 dark:text-slate-300">{props.label}</span>
      <div className="space-y-1">
        <label className="relative inline-flex cursor-pointer items-center has-[:disabled]:cursor-default has-[:disabled]:opacity-50">
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            aria-label={props.label}
            aria-describedby={descriptionId}
            checked={props.checked}
            disabled={props.disabled}
            onChange={(event) => props.onChange(event.target.checked)}
          />
          <span className="h-5 w-9 rounded-full bg-slate-300 transition after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 dark:bg-slate-700" />
        </label>
        <p id={descriptionId} className="whitespace-pre-line text-slate-500 dark:text-slate-400">{props.description}</p>
      </div>
    </div>
  );
}

function LaunchAtLoginSetting({ lang }: { lang: Language }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void api.getLaunchAtLogin().then(
      (value) => { if (current) setEnabled(value); },
      (err) => { if (current) setError(String(err)); },
    );
    return () => { current = false; };
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setError("");
    try {
      setEnabled(await api.setLaunchAtLogin(next));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SettingToggle
        label={t(lang, "launchAtLogin")}
        description={t(lang, "launchAtLoginDesc")}
        checked={enabled === true}
        disabled={enabled === null || busy}
        onChange={toggle}
      />
      {error && <p role="alert" className="ml-44 mt-1 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

function UpdateSection(props: {
  lang: Language;
  appVersion: string;
  update: UpdateState;
  autoUpdate: boolean;
  updateChannel: UpdateChannel;
  onSetAutoUpdate: (value: boolean) => void;
  onSetChannel: (value: UpdateChannel) => void;
  onCheck: () => void;
  onInstall: () => void;
}) {
  const { lang, update } = props;
  const busy = update.status === "checking" || update.status === "downloading" || update.status === "restarting";

  return (
    <div className="mt-2 grid grid-cols-[160px_1fr] items-start gap-4 border-t border-slate-200/70 pt-5 text-sm dark:border-slate-800">
      <span className="font-medium text-slate-600 dark:text-slate-300">{t(lang, "updates")}</span>
      <div className="space-y-3">
        <div className="text-slate-500 dark:text-slate-400">
          {t(lang, "currentVersion")}: <span className="font-mono text-slate-700 dark:text-slate-200">{props.appVersion || "—"}</span>
        </div>

        <label className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
          <span className="w-32 font-medium">{t(lang, "updateChannel")}</span>
          <Select value={props.updateChannel} onChange={(e) => props.onSetChannel(e.target.value as UpdateChannel)} className="w-40">
            <option value="stable">{t(lang, "channelStable")}</option>
            <option value="preview">{t(lang, "channelPreview")}</option>
          </Select>
        </label>

        <label className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
          <span className="w-32 font-medium">{t(lang, "autoUpdate")}</span>
          <Select value={props.autoUpdate ? "on" : "off"} onChange={(e) => props.onSetAutoUpdate(e.target.value === "on")} className="w-40">
            <option value="on">{t(lang, "autoUpdateOn")}</option>
            <option value="off">{t(lang, "autoUpdateOff")}</option>
          </Select>
        </label>

        {update.status === "checking" && <p className="text-slate-500 dark:text-slate-400">{t(lang, "checkingUpdate")}</p>}
        {update.status === "uptodate" && <p className="text-emerald-600 dark:text-emerald-400">{t(lang, "upToDate")}</p>}
        {update.status === "downloading" && <p className="text-slate-500 dark:text-slate-400">{t(lang, "downloadingUpdate")}</p>}
        {update.status === "restarting" && <p className="text-slate-500 dark:text-slate-400">{t(lang, "restartingUpdate")}</p>}
        {update.status === "error" && (
          <p className="whitespace-pre-wrap text-rose-600 dark:text-rose-400">
            {t(lang, "updateFailed").replace("{error}", update.error ?? "")}
          </p>
        )}

        {update.status === "available" && (
          <div className="space-y-2">
            <p className="font-medium text-blue-600 dark:text-blue-400">
              {t(lang, "updateAvailable").replace("{version}", update.version ?? "")}
            </p>
            {update.notes && (
              <div className="rounded-xl border border-slate-200/70 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/50">
                <div className="mb-1 font-medium text-slate-500 dark:text-slate-400">{t(lang, "releaseNotes")}</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans text-slate-600 dark:text-slate-300">{update.notes}</pre>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={props.onCheck} disabled={busy}>
            {t(lang, "checkUpdate")}
          </Button>
          {update.status === "available" && (
            <Button onClick={props.onInstall} disabled={busy}>
              {t(lang, "downloadInstall")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsPage(props: {
  settings: AppSettings;
  setSettings: (settings: Partial<AppSettings>) => void;
  appVersion: string;
  update: UpdateState;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const setAutoUpdate = (value: boolean) => props.setSettings({ autoUpdate: value });
  const setChannel = (value: UpdateChannel) => props.setSettings({ updateChannel: value });
  const lang = props.settings.language;
  return (
    <div className="grid min-w-0 max-w-3xl gap-4">
      <PageHeader page="settings">{t(lang, "settingsTitle")}</PageHeader>
      <Card>
        <div className="grid gap-4">
          <AppearanceSettings settings={props.settings} onChange={props.setSettings} />
          <SettingSelect label={t(lang, "language")} value={props.settings.language} onChange={(v) => props.setSettings({ language: v as Language })}>
            {Object.entries(languageLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SettingSelect>
          <SettingSelect label={t(lang, "logLevel")} value={props.settings.logLevel} onChange={(v) => props.setSettings({ logLevel: v as LogLevel })}>
            <option value="debug">{t(lang, "logDebug")}</option>
            <option value="info">{t(lang, "logInfo")}</option>
            <option value="warning">{t(lang, "logWarning")}</option>
            <option value="error">{t(lang, "logError")}</option>
          </SettingSelect>
          <SettingSelect label={t(lang, "closeBehavior")} value={props.settings.closeBehavior} onChange={(v) => props.setSettings({ closeBehavior: v as CloseBehavior })}>
            <option value="ask">{t(lang, "closeBehaviorAsk")}</option>
            <option value="minimize">{t(lang, "closeBehaviorMinimize")}</option>
            <option value="exit">{t(lang, "closeBehaviorExit")}</option>
          </SettingSelect>
          <LaunchAtLoginSetting lang={lang} />
          <SettingToggle
            label={t(lang, "autoSortHosts")}
            description={t(lang, "autoSortHostsDesc")}
            checked={props.settings.autoSortHosts}
            onChange={(autoSortHosts) => props.setSettings({ autoSortHosts })}
          />
          <SettingToggle
            label={t(lang, "twoColumnHosts")}
            description={t(lang, "twoColumnHostsDesc")}
            checked={props.settings.twoColumnHosts}
            onChange={(twoColumnHosts) => props.setSettings({ twoColumnHosts })}
          />
          <UpdateSection
            lang={lang}
            appVersion={props.appVersion}
            update={props.update}
            autoUpdate={props.settings.autoUpdate}
            updateChannel={props.settings.updateChannel}
            onSetAutoUpdate={setAutoUpdate}
            onSetChannel={setChannel}
            onCheck={props.onCheckUpdate}
            onInstall={props.onInstallUpdate}
          />
        </div>
      </Card>
    </div>
  );
}
