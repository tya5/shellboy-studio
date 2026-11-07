import { useEffect, useRef } from "preact/hooks";
import { formatRoute, readAppMessage, type AppModel, type DesignContext, type OpenApp } from "../../../ui-core/src";
import { AppCard, AppFrame, AppTabs, Button, EmptyState, KeyValue, Notice, Section } from "../system/components";

function Alerts({ model, tab }: { model: AppModel; tab: OpenApp }) {
  const t = model.t.value;
  const apps = model.apps;
  const count = tab.errors.length;
  return (
    <div class="apps-alerts">
      {tab.threadState === "missing" ? <Notice tone="wait">{t("apps.threadMissing")}</Notice> : null}
      {tab.threadState === "archived" ? <Notice>{t("apps.threadArchived")}</Notice> : null}
      {count > 0 ? (
        <Notice
          tone="bad"
          title={t("apps.errors", { n: count })}
          actions={
            <>
              {tab.thread && tab.threadState !== "missing" ? <Button disabled={tab.send.kind === "sending"} onClick={() => void apps.sendErrors(tab.name)}>{t("apps.sendErrors")}</Button> : null}
              <Button onClick={() => void apps.reload(tab.name)}>{t("apps.reopen")}</Button>
              <Button variant="link" onClick={() => apps.dismissErrors(tab.name)}>{t("apps.dismiss")}</Button>
            </>
          }
        >
          {tab.errors.slice(-3).map((e, i) => (
            <div key={i} class="mono caption">{e.kind}: {e.message}{e.where ? ` (${e.where})` : ""}</div>
          ))}
          {!tab.thread || tab.threadState === "missing" ? <div class="caption">{t("apps.noThreadToSend")}</div> : null}
        </Notice>
      ) : null}
      {tab.send.kind === "sent" ? <Notice>{t("apps.sent")}</Notice> : null}
      {tab.send.kind === "failed" ? <Notice tone="bad">{t("apps.sendFailed", { message: tab.send.message })}</Notice> : null}
    </div>
  );
}

function AppList({ model }: { model: AppModel }) {
  const t = model.t.value;
  const apps = model.apps;
  const list = apps.list.value;
  const rows = model.rowById.value;
  const failed = apps.openError.value;
  return (
    <div class="apps-list">
      <div class="head">
        <div class="pagehead">
          <h1>{t("view.apps")}</h1>
          <div class="muted">{t("apps.sub")}</div>
        </div>
        <Button disabled={list.loading} onClick={() => void apps.refresh()}>{t("common.refresh")}</Button>
      </div>
      {failed ? <Notice tone="bad">{t("apps.openFailed", { name: failed.name, message: failed.message })}</Notice> : null}
      {list.error ? <Notice tone="bad">{t("common.readError", { message: list.error.message })}</Notice> : null}
      {list.loaded && list.apps.length === 0 ? <EmptyState icon="apps" title={t("apps.empty")} body={t("apps.emptyBody")} /> : null}
      {list.apps.length > 0 ? (
        <div class="grid">
          {list.apps.map((a) => (
            <AppCard
              key={a.name}
              title={a.title}
              name={a.name}
              href={formatRoute({ view: "apps", appName: a.name })}
              openLabel={t("apps.open")}
              note={a.thread ? t("apps.bound", { title: rows.get(a.thread)?.summary.title ?? a.thread.slice(0, 8) }) : t("apps.unbound")}
              problem={a.problem ? t("apps.broken", { problem: a.problem }) : undefined}
            />
          ))}
        </div>
      ) : null}
      {list.dir ? (
        <Section title={t("apps.folder")} sub={t("apps.source")}>
          <KeyValue rows={[{ key: t("apps.folder"), value: list.dir, mono: true }, ...(list.guide ? [{ key: t("apps.guide"), value: list.guide, mono: true }] : [])]} />
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Stays mounted once anything is open, so apps keep running in any view. Only messages from an app's own
 * frame and origin count; their text is shown as text.
 */
export function AppsHost({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const apps = model.apps;
  const route = model.route.value;
  const tabs = apps.tabs.value;
  const theme = context.prefs.value.theme;
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const showing = route.view === "apps";
  const current = showing ? route.appName : undefined;

  useEffect(() => {
    const send = (frame: HTMLIFrameElement, origin: string) => frame.contentWindow?.postMessage({ shellboy: true, type: "theme", theme }, origin);
    for (const tab of apps.tabs.peek()) {
      const frame = frames.current.get(tab.name);
      if (frame) send(frame, tab.origin);
    }
    const onMessage = (e: MessageEvent) => {
      const tab = apps.tabs.peek().find((x) => x.origin === e.origin && frames.current.get(x.name)?.contentWindow === e.source);
      if (!tab) return;
      const message = readAppMessage(e.data);
      if (message?.type === "error") apps.report(tab.name, message);
      else if (message?.type === "ready") {
        const frame = frames.current.get(tab.name);
        if (frame) send(frame, tab.origin);
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [apps, theme]);

  if (!showing && tabs.length === 0) return null;
  const open = tabs.find((x) => x.name === current);
  return (
    <div class={showing ? "apps-host" : "apps-host off"}>
      <AppTabs
        label={t("apps.tabs")}
        tabs={[
          { key: "", title: t("apps.all"), href: formatRoute({ view: "apps" }), current: showing && current === undefined },
          ...tabs.map((tab) => ({
            key: tab.name,
            title: tab.title,
            href: formatRoute({ view: "apps", appName: tab.name }),
            current: tab.name === current,
            alert: tab.errors.length > 0,
            closeLabel: t("apps.close", { name: tab.title }),
            onClose: () => {
              apps.close(tab.name);
              if (tab.name === current) model.navigate({ view: "apps" });
            },
          })),
        ]}
      />
      {open ? <Alerts model={model} tab={open} /> : null}
      {current === undefined || !open ? <AppList model={model} /> : null}
      {tabs.map((tab) => (
        <AppFrame
          key={`${tab.name}:${tab.url}`}
          title={tab.title}
          url={tab.url}
          hidden={tab.name !== current}
          frameRef={(el) => {
            if (el) frames.current.set(tab.name, el);
            else frames.current.delete(tab.name);
          }}
        />
      ))}
    </div>
  );
}
