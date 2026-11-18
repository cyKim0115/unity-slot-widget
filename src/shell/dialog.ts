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
const inputEl = dialog.querySelector<HTMLInputElement>("#dialog-input")!;
const actions = dialog.querySelector<HTMLElement>(".dialog-actions")!;

function button(value: string, label: string, kind?: Choice["kind"]): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "submit";
  b.value = value;
  b.textContent = label;
  if (kind) b.className = kind;
  return b;
}

/** The answer of the question on screen. */
let settle: ((value: string | null) => void) | null = null;
/** Close events still queued for questions that a newer one replaced (they are not its answer). */
let staleCloses = 0;

dialog.addEventListener("close", () => {
  if (staleCloses > 0) {
    staleCloses--;
    return;
  }
  const done = settle;
  settle = null;
  done?.(dialog.returnValue === "" ? null : dialog.returnValue);
});

/** The chosen value; null for cancel, Esc or an outside click. */
export function showChoice(options: ChoiceOptions): Promise<string | null> {
  if (dialog.open) {
    // A new question replaces the one on screen: that one ends as cancelled
    const replaced = settle;
    settle = null;
    replaced?.(null);
    staleCloses++;
    dialog.close();
  }
  titleEl.textContent = options.title;
  messageEl.textContent = options.message;
  detailEl.textContent = options.detail ?? "";
  detailEl.hidden = !options.detail;
  // Only showPrompt shows the text box (after this)
  inputEl.hidden = true;

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
    settle = resolve;
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

export interface PromptOptions {
  title: string;
  message: string;
  /** Text in the box when it opens (selected) */
  value: string;
  placeholder?: string;
  maxLength?: number;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * One line of text: the text as typed (the caller trims it), or null for cancel, Esc or an outside
 * click. Enter saves (the form's first button). An empty text is an answer too.
 */
export async function showPrompt(options: PromptOptions): Promise<string | null> {
  const picked = showChoice({
    title: options.title,
    message: options.message,
    choices: [{ value: "ok", label: options.confirmLabel, kind: "primary" }],
    cancelLabel: options.cancelLabel,
  });
  inputEl.value = options.value;
  inputEl.placeholder = options.placeholder ?? "";
  if (options.maxLength) inputEl.maxLength = options.maxLength;
  else inputEl.removeAttribute("maxlength");
  inputEl.hidden = false;
  inputEl.focus();
  inputEl.select();
  const answer = await picked;
  const text = inputEl.value;
  // A newer question replaced this one: it decides about the box
  if (!dialog.open) inputEl.hidden = true;
  return answer === "ok" ? text : null;
}

export function isDialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

// An outside click (on the backdrop) cancels. Clicks inside have an inner element as target.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
