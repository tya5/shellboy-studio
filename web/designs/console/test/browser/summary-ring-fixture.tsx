import { signal } from "@preact/signals-core";
import { mount } from "../../index";
import { DESIGNS } from "../../../registry";
import { fixtureModel, settle } from "../../../../ui-core/test/fixture";
import type { Prefs } from "../../../../ui-core/src";

const f = await fixtureModel({ route: "conversation", threadId: "lead", lang: "ja" });
const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "console";
document.documentElement.dataset.ds = theme;
const prefs = signal<Prefs>({ design: "console", theme, lang: "ja", weights: { cached: 0.1, output: 5 } });
mount(document.getElementById("app")!, { model: f.model, designs: DESIGNS, prefs, setPrefs: change => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });
await settle(f.t, f.db);
Object.assign(window, { setSummaryActivity: async (summarizing: boolean) => {
  f.db.details.lead = { ...f.db.details.lead!, summarizing };
  f.t.push({ t: "changed", thread_ids: ["lead"], list: false, config_changed: false });
  await settle(f.t, f.db);
} });
