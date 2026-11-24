import { useEffect, useRef, useState } from "preact/hooks";
import type { MessageKey, Translate } from "../../../ui-core/src/i18n";
import { Button, Section, SettingRow } from "../system/components";

const details = {
  on: "studio.startup.on", off: "studio.startup.off", approval: "studio.startup.approval",
  unknown: "studio.startup.unknown", unavailable: "studio.startup.unavailable",
  no_desktop_launcher: "studio.startup.noLauncher",
} as const satisfies Record<string, MessageKey>;
type Status = keyof typeof details;
type Readback = { state: Status; refused: boolean };

async function readOS(signal: AbortSignal, enabled?: boolean): Promise<Readback> {
  try {
    const response = await fetch("/login-startup", enabled === undefined ? { signal } : {
      signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
    });
    if (enabled === undefined && response.status === 404) return { state: "unavailable", refused: false };
    if (response.ok) {
      const body = await response.json();
      if (typeof body?.state === "string" && Object.hasOwn(details, body.state) && typeof body.refused === "boolean") {
        return { state: body.state, refused: body.refused };
      }
    }
  } catch { /* A failed read is not evidence for Off. */ }
  return { state: "unknown", refused: enabled !== undefined };
}

export function LoginStartup({ t }: { t: Translate }) {
  const [result, show] = useState<Readback>();
  const [busy, pending] = useState(true);
  const current = useRef<AbortController>();
  const writing = useRef(false);

  async function refresh(enabled?: boolean) {
    if (writing.current) return;
    current.current?.abort();
    const request = new AbortController();
    current.current = request;
    writing.current = enabled !== undefined;
    pending(true);
    const next = await readOS(request.signal, enabled);
    if (request.signal.aborted) return;
    writing.current = false;
    show(next);
    pending(false);
  }

  useEffect(() => {
    const onFocus = () => { void refresh(); };
    onFocus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      current.current?.abort();
      writing.current = false;
    };
  }, []);

  const label = t("studio.startup.open");
  const state = result?.state;
  const known = state === "on" || state === "off" || state === "approval";
  return <Section title={t("studio.startup.title")}>
    <SettingRow settingId="studio.startup" label={label} description={t("studio.startup.hint")}
      feedback={<span role="status">{busy ? t("studio.startup.checking") : <>
        {result?.refused ? `${t("studio.startup.refused")} ` : ""}{state ? t(details[state]) : null}
      </>}</span>}
      control={known && <Button role="switch" aria-label={label} aria-checked={state === "on"}
        disabled={busy || state === "approval"} onClick={() => void refresh(state !== "on")}>
        {t(state === "on" ? "studio.startup.on" : "studio.startup.off")}
      </Button>} />
  </Section>;
}
