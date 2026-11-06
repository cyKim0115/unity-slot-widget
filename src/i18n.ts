import ko from "./i18n/ko.json";
import en from "./i18n/en.json";

export type Lang = "ko" | "en";
type Strings = Record<string, string>;

const TABLES: Record<Lang, Strings> = { ko, en };
let lang: Lang = "en";

export function resolveLang(setting: string | undefined): Lang {
  if (setting === "ko" || setting === "en") return setting;
  const nav = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
  return nav.startsWith("ko") ? "ko" : "en";
}

export function setLang(next: Lang) {
  lang = next;
  document.documentElement.lang = next;
}

export function currentLang(): Lang {
  return lang;
}

/** `t("header.open", { open: 3, max: 6 })`. A missing key shows the key itself. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const text = TABLES[lang][key] ?? TABLES.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

/** Elapsed time, the two largest units: "38초", "2시간 5분", "1일 4시간". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t("dur.s", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("dur.m", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? t("dur.hm", { h, m: m % 60 }) : t("dur.h", { n: h });
  const d = Math.floor(h / 24);
  return h % 24 ? t("dur.dh", { d, h: h % 24 }) : t("dur.d", { n: d });
}

function locale(): string {
  return lang === "ko" ? "ko-KR" : "en-US";
}

/** Time of day for today, "MM-DD HH:mm" otherwise. */
export function formatWhen(iso: string | null | undefined, now: Date): string {
  if (!iso) return t("detail.none");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t("detail.none");
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false });
  if (sameDay) return time;
  const day = date.toLocaleDateString(locale(), { month: "2-digit", day: "2-digit" });
  return `${day} ${time}`;
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return t("detail.none");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t("detail.none");
  return date.toLocaleDateString(locale(), { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatGb(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return t("detail.none");
  return value.toFixed(1);
}
