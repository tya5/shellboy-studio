// Keyboard commands, as decisions over key facts. A design binds them to its elements.
import type { ViewName } from "./route";

export interface KeyFacts {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** An IME is composing: Enter confirms the conversion and must never send. */
  isComposing?: boolean;
}

export type ComposerAction = "send" | "none";

export function composerAction(e: KeyFacts): ComposerAction {
  if (e.key !== "Enter" || e.isComposing || e.shiftKey || e.altKey) return "none";
  return "send";
}

const VIEW_KEYS: Record<string, ViewName> = { "1": "conversation", "3": "inbox", "4": "analytics", "5": "settings", "6": "branches", "8": "apps" };

/** Alt+1 to Alt+8 switch views. `code`-independent digits only. */
export function viewShortcut(e: KeyFacts): ViewName | undefined {
  return e.altKey && !e.ctrlKey && !e.metaKey ? VIEW_KEYS[e.key] : undefined;
}

/** Cmd/Ctrl+B toggles the desktop navigation. */
export function navShortcut(e: KeyFacts): boolean {
  return (e.key === "b" || e.key === "B") && !e.altKey && !e.shiftKey && (e.ctrlKey !== e.metaKey) && !e.isComposing;
}

/** Alt+9 toggles the right panel, including its sheet at narrower widths. */
export function panelShortcut(e: KeyFacts): boolean {
  return e.key === "9" && !!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing;
}
