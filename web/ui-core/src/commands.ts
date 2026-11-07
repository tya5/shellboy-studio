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

const VIEW_KEYS: Record<string, ViewName> = { "1": "conversation", "2": "monitor", "3": "inbox", "4": "analytics", "5": "settings", "6": "branches", "7": "threads", "8": "apps" };

/** Alt+1 to Alt+8 switch views. `code`-independent digits only. */
export function viewShortcut(e: KeyFacts): ViewName | undefined {
  return e.altKey && !e.ctrlKey && !e.metaKey ? VIEW_KEYS[e.key] : undefined;
}

/** Alt+0 toggles the desktop navigation. */
export function navShortcut(e: KeyFacts): boolean {
  return e.key === "0" && !!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing;
}
