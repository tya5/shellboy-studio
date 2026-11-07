// The contract between the entry point and a design. A design receives this and draws.
import type { AppModel } from "./model";
import type { Prefs } from "./prefs";
import type { ReadonlySignal } from "@preact/signals-core";

export interface ThemeManifest {
  name: string;
  title: string;
}

export interface DesignManifest {
  name: string;
  title: string;
  themes: readonly ThemeManifest[];
}

export interface DesignContext {
  model: AppModel;
  designs: readonly DesignManifest[];
  prefs: ReadonlySignal<Prefs>;
  /** Stored per browser. A theme switch needs no reload. */
  setPrefs(change: Partial<Prefs>): void;
  /** Exchange a pasted token for a session and reconnect. False when the bridge rejects it. */
  submitToken(token: string): Promise<boolean>;
}

/** What a design's entry module exports. The return value unmounts it. */
export interface DesignModule {
  mount(target: unknown, context: DesignContext): () => void;
}
