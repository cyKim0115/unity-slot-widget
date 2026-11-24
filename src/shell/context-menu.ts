/**
 * Right-click and button menus, drawn as a popover so they follow the theme. popover="auto": an
 * outside click and Esc close it (the browser does). Items are made anew on every call.
 * Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author (src/context-menu.ts),
 * plus separators, disabled and danger items, and checked items as menuitemcheckbox.
 */

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  /** Red text: quits or cannot be undone. */
  danger?: boolean;
  /** Present: a checkbox item (role menuitemcheckbox, aria-checked). */
  checked?: boolean;
  /** Shortcut shown at the right, for example "F5". */
  shortcut?: string;
}

export type MenuEntry = MenuItem | "separator";

export interface MenuPoint {
  x: number;
  y: number;
}

const menu = document.querySelector<HTMLElement>("#context-menu")!;
/** Focus before opening; given back when the menu closes from inside (Esc, a choice). */
let returnFocus: HTMLElement | null = null;
/** The button the open menu hangs from (null for a right-click menu). */
let anchor: HTMLElement | null = null;
/**
 * The anchor that was open when the last pointer went down. The popover's light dismiss closes the
 * menu before the button's click, so the click would open it again; this tells that click apart.
 */
let openAnchorAtPointerDown: HTMLElement | null = null;

const items = (): HTMLButtonElement[] => Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));

export function hideContextMenu(): void {
  if (menu.matches(":popover-open")) menu.hidePopover();
}

export function isContextMenuOpen(): boolean {
  return menu.matches(":popover-open");
}

function entryElement(entry: MenuEntry): HTMLElement {
  if (entry === "separator") {
    const hr = document.createElement("div");
    hr.className = "menu-separator";
    hr.setAttribute("role", "separator");
    return hr;
  }
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("role", entry.checked === undefined ? "menuitem" : "menuitemcheckbox");
  if (entry.checked !== undefined) b.setAttribute("aria-checked", String(entry.checked));
  if (entry.danger) b.classList.add("danger");
  b.disabled = entry.disabled === true;
  const text = document.createElement("span");
  text.className = "menu-label";
  text.textContent = entry.label;
  b.append(text);
  if (entry.shortcut) {
    const key = document.createElement("span");
    key.className = "menu-shortcut";
    key.textContent = entry.shortcut;
    b.append(key);
  }
  b.addEventListener("click", () => {
    hideContextMenu();
    entry.action();
  });
  return b;
}

/**
 * Opens the menu at the pointer of `at` (a mouse event, whose default is prevented) or at a point.
 * Near the window edge it opens toward the other side.
 */
export function showContextMenu(at: MouseEvent | MenuPoint, entries: MenuEntry[]): void {
  if (at instanceof MouseEvent) at.preventDefault();
  hideContextMenu();
  const x0 = at instanceof MouseEvent ? at.clientX : at.x;
  const y0 = at instanceof MouseEvent ? at.clientY : at.y;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  anchor = null;
  // No separator at either end or twice in a row
  const cleaned = entries.filter((e, i, all) => e !== "separator" || (i > 0 && i < all.length - 1 && all[i - 1] !== "separator"));
  menu.replaceChildren(...cleaned.map(entryElement));
  menu.showPopover();
  const { width, height } = menu.getBoundingClientRect();
  const x = x0 + width > innerWidth ? x0 - width : x0;
  const y = y0 + height > innerHeight ? y0 - height : y0;
  menu.style.left = `${Math.max(0, x)}px`;
  menu.style.top = `${Math.max(0, y)}px`;
  items()[0]?.focus();
}

/** Opens the menu under a button (title bar menus, status bar items). */
export function showMenuBelow(button: HTMLElement, entries: MenuEntry[]): void {
  const r = button.getBoundingClientRect();
  showContextMenu({ x: r.left, y: r.bottom + 2 }, entries);
  anchor = button;
}

/**
 * A menu button's click: opens the menu under it, or closes it when it is already open from this
 * button (also when the press itself has just closed it by light dismiss).
 */
export function toggleMenuBelow(button: HTMLElement, entries: () => MenuEntry[]): void {
  const dismissedByThisPress = openAnchorAtPointerDown === button;
  openAnchorAtPointerDown = null;
  if (isContextMenuOpen()) hideContextMenu();
  else if (!dismissedByThisPress) showMenuBelow(button, entries());
}

/** Opens the menu above a button (status bar items). */
export function showMenuAbove(button: HTMLElement, entries: MenuEntry[]): void {
  const r = button.getBoundingClientRect();
  // Start below the bottom edge so the edge rule flips it upward, ending just above the button
  showContextMenu({ x: r.left, y: innerHeight }, entries);
  const { height } = menu.getBoundingClientRect();
  menu.style.top = `${Math.max(0, r.top - height - 2)}px`;
  anchor = button;
}

// Capture runs before the popover's light dismiss, which closes the menu on pointerup
document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target instanceof Node ? event.target : null;
    openAnchorAtPointerDown = isContextMenuOpen() && anchor !== null && target !== null && anchor.contains(target) ? anchor : null;
  },
  true,
);

menu.addEventListener("beforetoggle", (event) => {
  if ((event as ToggleEvent).newState === "closed" && menu.contains(document.activeElement)) returnFocus?.focus();
});

menu.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    hideContextMenu();
    return;
  }
  const list = items();
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  let next = -1;
  if (event.key === "ArrowDown") next = (i + 1) % list.length;
  else if (event.key === "ArrowUp") next = (i - 1 + list.length) % list.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = list.length - 1;
  if (next < 0) return;
  event.preventDefault();
  list[next]?.focus();
});

// Like a native menu it closes when the window loses focus, or is resized or scrolled
window.addEventListener("blur", hideContextMenu);
window.addEventListener("resize", hideContextMenu);
document.addEventListener("scroll", hideContextMenu, true);
