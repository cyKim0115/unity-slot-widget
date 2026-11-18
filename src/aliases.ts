/**
 * Project nicknames: widget.json `projectAliases` (src-tauri/src/settings.rs), by the name the core
 * reports (the list group). A long English repository name can get a short Korean one. Only what
 * people read changes: group heads, the projects panel, titles, menu labels and the find box use
 * the nickname; item keys, the project filter, copied cleanup text and core calls keep the real
 * name, and tooltips show it. An empty nickname clears it (the real name shows again).
 */

/** Longest nickname kept, in characters (src-tauri/src/settings.rs ALIAS_MAX_CHARS). */
export const ALIAS_MAX_CHARS = 40;

let aliases: ReadonlyMap<string, string> = new Map();

/** Same cleaning as the Rust side: control characters become spaces, ends trimmed, cut to the limit. */
export function cleanAlias(text: string): string {
  const line = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  return [...line].slice(0, ALIAS_MAX_CHARS).join("").trimEnd();
}

/** Takes the map `get_project_aliases` / `set_project_alias` return. True when something changed. */
export function receiveAliases(value: unknown): boolean {
  const next = new Map<string, string>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [name, alias] of Object.entries(value as Record<string, unknown>)) {
      if (typeof alias !== "string" || !name) continue;
      const clean = cleanAlias(alias);
      if (clean && clean !== name) next.set(name, clean);
    }
  }
  const same = next.size === aliases.size && [...next].every(([k, v]) => aliases.get(k) === v);
  aliases = next;
  return !same;
}

/** The nickname, or null when the project shows its own name. */
export function projectAlias(name: string): string | null {
  return aliases.get(name) ?? null;
}

/** What the screens show for a project: its nickname, else its name. */
export function projectLabel(name: string): string {
  return aliases.get(name) ?? name;
}

/** The find box: the name or the nickname contains `text` (already lower case). */
export function projectMatches(name: string, text: string): boolean {
  if (name.toLowerCase().includes(text)) return true;
  const alias = aliases.get(name);
  return alias !== undefined && alias.toLowerCase().includes(text);
}
