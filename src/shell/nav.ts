/**
 * Left side panel, opened and closed with the toggle at the left end of the title bar
 * (Ctrl+Shift+E). Square icon tabs in its header pick the panel; the panels' content is the app's.
 * The width animation is CSS. Below 1000px the panel opens over the list and an outside click
 * closes it. Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author
 * (src/nav.ts; the recent-file list and the file opener are left out, ←/→/Home/End move between tabs).
 */

import { t } from "../i18n";
import { isBoolean, isString, readPref, writePref } from "./prefs";

export interface Nav {
  toggle(): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /** Opens the panel on that tab. */
  show(tab: string): void;
  selectTab(tab: string): void;
  current(): string;
  /** Number badge on a tab; 0 or less hides it. `level` colors it (critical, warn, info). */
  setBadge(tab: string, count: number, level?: string): void;
  /** Writes the toggle's title again (language change). */
  relabel(): void;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** `overlay`: true while the panel opens over the list (narrow window). */
export function initNav(overlay: MediaQueryList): Nav {
  const app = $("#app");
  const nav = $("#nav");
  const toggleButton = $<HTMLButtonElement>("#nav-toggle");
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("#nav-tabs [role='tab']"));

  const isOpen = (): boolean => app.dataset.nav === "open";

  const relabel = (): void => {
    const text = t(isOpen() ? "nav.close" : "nav.open");
    toggleButton.title = `${text} (Ctrl+Shift+E)`;
    toggleButton.setAttribute("aria-label", text);
  };

  function setOpen(open: boolean): void {
    app.dataset.nav = open ? "open" : "closed";
    nav.inert = !open;
    toggleButton.setAttribute("aria-expanded", String(open));
    relabel();
    writePref("navOpen", open);
  }
  const toggle = (): void => setOpen(!isOpen());
  toggleButton.addEventListener("click", toggle);

  function selectTab(name: string): void {
    const tab = tabs.find((b) => b.dataset.tab === name) ?? tabs[0];
    for (const b of tabs) {
      const selected = b === tab;
      b.setAttribute("aria-selected", String(selected));
      b.tabIndex = selected ? 0 : -1;
      document.getElementById(b.getAttribute("aria-controls")!)!.hidden = !selected;
    }
    writePref("navTab", tab.dataset.tab);
  }
  for (const b of tabs) b.addEventListener("click", () => selectTab(b.dataset.tab!));

  // Roving tab index: arrows move between the tabs and pick the one they land on
  $("#nav-tabs").addEventListener("keydown", (event) => {
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let next = -1;
    if (event.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(tabs[next].dataset.tab!);
    tabs[next].focus();
  });

  // Over the list (narrow window): a press outside the panel and its toggle closes it
  document.addEventListener("pointerdown", (event) => {
    if (!overlay.matches || !isOpen()) return;
    const target = event.target as Element;
    if (target.closest("#nav, #nav-toggle, #context-menu, dialog")) return;
    setOpen(false);
  });

  function setBadge(tab: string, count: number, level = ""): void {
    const badge = tabs.find((b) => b.dataset.tab === tab)?.querySelector<HTMLElement>(".nav-badge");
    if (!badge) return;
    badge.hidden = count <= 0;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.dataset.level = level;
  }

  selectTab(readPref("navTab", tabs[0]?.dataset.tab ?? "", isString));
  setOpen(readPref("navOpen", false, isBoolean));

  return {
    toggle,
    setOpen,
    isOpen,
    show(tab) {
      setOpen(true);
      selectTab(tab);
    },
    selectTab,
    current: () => tabs.find((b) => b.getAttribute("aria-selected") === "true")?.dataset.tab ?? "",
    setBadge,
    relabel,
  };
}
