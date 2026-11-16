/**
 * Notices, confirmations and choices inside the app: a <dialog> instead of a native message box, so
 * it follows the theme. Esc and an outside click end as cancel. Buttons are made anew on each call.
 * Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author (src/dialog.ts).
 */

import { t } from "../i18n";

export interface Choice {
  value: string;
  label: string;
  /** primary: the suggested action (accent), danger: cannot be undone (red), none: plain */
  kind?: "primary" | "danger";
}

export interface ChoiceOptions {
  title: string;
  message: string;
  /** Long extra text that may wrap anywhere (a path, a list), in its own small box */
  detail?: string;
  choices: Choice[];
  /** Present: a cancel button (same as Esc: null). In a row, CSS puts it at the far left */
  cancelLabel?: string;
  /** Value of the choice to focus first. Default: primary, then the last choice */
  focus?: string;
  /** Stack the buttons when there are many */
  vertical?: boolean;
}

const dialog = document.querySelector<HTMLDialogElement>("#app-dialog")!;
const titleEl = dialog.querySelector<HTMLElement>("#dialog-title")!;
const messageEl = dialog.querySelector<HTMLElement>("#dialog-message")!;
const detailEl = dialog.querySelector<HTMLElement>("#dialog-detail")!;
const actions = dialog.querySelector<HTMLElement>(".dialog-actions")!;

function button(value: string, label: string, kind?: Choice["kind"]): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "submit";
  b.value = value;
  b.textContent = label;
  if (kind) b.className = kind;
  return b;
}

/** The chosen value; null for cancel, Esc or an outside click. */
export function showChoice(options: ChoiceOptions): Promise<string | null> {
  if (dialog.open) dialog.close();
  titleEl.textContent = options.title;
  messageEl.textContent = options.message;
  detailEl.textContent = options.detail ?? "";
  detailEl.hidden = !options.detail;

  const buttons = options.choices.map((c) => button(c.value, c.label, c.kind));
  const cancel = options.cancelLabel ? button("", options.cancelLabel) : null;
  actions.replaceChildren(...buttons, ...(cancel ? [cancel] : []));
  actions.classList.toggle("vertical", options.vertical === true);

  dialog.returnValue = "";
  dialog.showModal();
  const focusTarget =
    buttons.find((b) => b.value === options.focus) ??
    buttons.find((b) => b.classList.contains("primary")) ??
    cancel ??
    buttons[buttons.length - 1];
  focusTarget?.focus();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "" ? null : dialog.returnValue), { once: true });
  });
}

export interface DialogOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  /** Present: shows a cancel button (a confirmation) */
  cancelLabel?: string;
  /** Cannot be undone: red confirm button, first focus on cancel */
  danger?: boolean;
}

/** True when confirmed. A notice (no cancel button) just ends when closed. */
export async function showDialog(options: DialogOptions): Promise<boolean> {
  const picked = await showChoice({
    title: options.title,
    message: options.message,
    detail: options.detail,
    choices: [{ value: "ok", label: options.confirmLabel ?? t("dialog.ok"), kind: options.danger ? "danger" : "primary" }],
    cancelLabel: options.cancelLabel,
    focus: options.danger && options.cancelLabel ? "__cancel__" : "ok",
  });
  return picked === "ok";
}

export function isDialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

// An outside click (on the backdrop) cancels. Clicks inside have an inner element as target.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
