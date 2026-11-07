// Entry point: session exchange, preferences, routing to the fragment, the selected design.
// The only module that touches browser globals besides the WebSocket transport and the design.
import { effect, signal } from "@preact/signals-core";
import { defaultBridgeUrl, ShellboyData, WebSocketTransport } from "../data/src";
import { DESIGNS } from "../designs/registry";
import { AppModel, loadPrefs, parseRoute, savePrefs, type DesignContext, type Prefs, type PrefStore } from "../ui-core/src";

const PREF_KEY = "shellboy-studio.prefs";
const TICK_MS = 1000;

const store: PrefStore = {
  read() {
    try {
      return localStorage.getItem(PREF_KEY);
    } catch {
      return null;
    }
  },
  write(value) {
    localStorage.setItem(PREF_KEY, value);
  },
};

async function exchangeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const fragment = /^#token=([^&]+)/.exec(location.hash);
  if (fragment?.[1]) {
    await exchangeToken(decodeURIComponent(fragment[1]));
    history.replaceState(null, "", location.pathname);
  }

  const prefs = signal<Prefs>(loadPrefs(store, DESIGNS));
  effect(() => {
    document.documentElement.dataset.ds = prefs.value.theme;
    document.documentElement.lang = prefs.value.lang;
  });

  const data = new ShellboyData({ transport: new WebSocketTransport({ url: defaultBridgeUrl }) });
  const model = new AppModel({
    data,
    lang: prefs.value.lang,
    onNavigate: (hash) => {
      if (location.hash !== hash) location.hash = hash;
    },
  });
  model.applyRoute(parseRoute(location.hash));
  addEventListener("hashchange", () => model.applyRoute(parseRoute(location.hash)));
  setInterval(() => model.tick(), TICK_MS);

  const context: DesignContext = {
    model,
    designs: DESIGNS,
    prefs,
    setPrefs(change) {
      const next = { ...prefs.value, ...change };
      prefs.value = next;
      model.lang.value = next.lang;
      savePrefs(store, next);
    },
    async submitToken(token) {
      const ok = await exchangeToken(token.trim());
      if (ok) {
        data.stop();
        data.start();
      }
      return ok;
    },
  };

  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");
  let unmount: (() => void) | undefined;
  let mounted: string | undefined;
  // Switching design replaces it in place. Its folder is fetched once, on selection.
  effect(() => {
    const name = prefs.value.design;
    if (name === mounted) return;
    mounted = name;
    const design = DESIGNS.find((d) => d.name === name) ?? DESIGNS[0]!;
    void design.load().then((module) => {
      if (mounted !== name) return;
      unmount?.();
      unmount = module.mount(root, context);
    });
  });
  model.start();
}

void main();
