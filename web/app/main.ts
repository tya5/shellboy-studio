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
  const pair = /^#pair=([a-f0-9]{64})$/.exec(location.hash);
  if (pair?.[1]) {
    history.replaceState(null, "", location.pathname);
    try { await fetch("/pairing/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair[1] }) }); } catch { /* The normal login prompt remains available. */ }
  }
  const fragment = /^#token=([^&]+)/.exec(location.hash);
  if (fragment?.[1]) {
    await exchangeToken(decodeURIComponent(fragment[1]));
    history.replaceState(null, "", location.pathname);
  }

  const prefs = signal<Prefs>(loadPrefs(store, DESIGNS));
  const guidePreferenceReady = signal(false);
  async function readGuidePreference(): Promise<void> {
    guidePreferenceReady.value = false;
    try {
      const response = await fetch("/guide-preference", { credentials: "same-origin" });
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (typeof value !== "object" || value === null || !("enabled" in value) || typeof value.enabled !== "boolean") return;
      prefs.value = { ...prefs.value, guideOptOut: !value.enabled };
      guidePreferenceReady.value = true;
    } catch { /* Do not register until the bridge preference is available. */ }
  }
  await readGuidePreference();
  effect(() => {
    document.documentElement.dataset.ds = prefs.value.theme;
    document.documentElement.lang = prefs.value.lang;
  });

  // Live text is shown once per animation frame, however many frames arrived in between.
  const data = new ShellboyData({
    transport: new WebSocketTransport({ url: defaultBridgeUrl }),
    schedule: (callback) => void requestAnimationFrame(() => callback()),
  });
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
      if (change.guideOptOut !== undefined) {
        const desired = change.guideOptOut;
        model.guideRegistration.state.value = { ...model.guideRegistration.state.peek(), busy: true, error: undefined };
        void fetch("/guide-preference", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !desired }) }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const next = { ...prefs.value, guideOptOut: desired };
          prefs.value = next;
          savePrefs(store, next);
          model.guideRegistration.state.value = { ...model.guideRegistration.state.peek(), busy: false };
        }).catch((error: unknown) => {
          model.guideRegistration.state.value = { ...model.guideRegistration.state.peek(), busy: false, error: error instanceof Error ? error.message : String(error) };
        });
        return;
      }
      const next = { ...prefs.value, ...change };
      prefs.value = next;
      model.lang.value = next.lang;
      savePrefs(store, next);
    },
    async submitToken(token) {
      const ok = await exchangeToken(token.trim());
      if (ok) {
        await readGuidePreference();
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
  effect(() => {
    const owner = data.owner.value;
    const dir = data.dataDir.value;
    const optedOut = prefs.value.guideOptOut === true;
    if (guidePreferenceReady.value && owner.state === "connected" && data.capabilities.value.includes("config.edit")) model.guideRegistration.update(dir, !optedOut);
  });
  model.start();
}

void main();
