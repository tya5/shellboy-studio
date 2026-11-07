import { appTabKey } from "../../../ui-core/src/apps";
import { useEffect, useRef, useState } from "preact/hooks";
import { APP_TEMPLATES, formatRoute, readAppMessage, validAppInstance, type AppModel, type DesignContext, type OpenApp } from "../../../ui-core/src";
import { AppCard, AppFrame, AppTabs, AppRequest, Button, EmptyState, Field, GuideCopy, Notice } from "../system/components";

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
              {tab.thread && tab.threadState !== "missing" ? <Button disabled={tab.send.kind === "sending"} onClick={() => void apps.sendErrors(tab.name, tab.instance)}>{t("apps.sendErrors")}</Button> : null}
              <Button onClick={() => void apps.reload(tab.name, tab.instance)}>{t("apps.reopen")}</Button>
              <Button variant="link" onClick={() => apps.dismissErrors(tab.name, tab.instance)}>{t("apps.dismiss")}</Button>
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

function Instances({ model, name }: { model: AppModel; name: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const t = model.t.value;
  const apps = model.apps;
  useEffect(() => { void apps.loadInstances(name); }, [apps, name]);
  return <section class="sect"><h3>{t("apps.instances")}</h3>
    <Field ariaLabel={t("apps.instanceName")} value={value} onInput={(event) => setValue(event.currentTarget.value)} />
    <Button disabled={busy || !validAppInstance(value)} onClick={() => { setBusy(true); void apps.createInstance(name, value).then((ok) => { setBusy(false); if (ok) { model.navigate({ view: "apps", appName: name, appInstance: value }); setValue(""); } }); }}>{t("apps.instanceCreate")}</Button>
    {(apps.instances.value[name] ?? []).map((instance) => <div key={instance}><a href={formatRoute({ view: "apps", appName: name, appInstance: instance })}>{instance}</a></div>)}
  </section>;
}

function AppList({ model }: { model: AppModel }) {
  const t = model.t.value;
  const apps = model.apps;
  const list = apps.list.value;
  const rows = model.rowById.value;
  const failed = apps.openError.value;
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const templates = APP_TEMPLATES.map((x) => ({ id: x.id, title: x.title[model.lang.value], draft: x.draft[model.lang.value] }));
  useEffect(() => { if (creating) { void apps.loadFolders(); return () => apps.leaveFolders(); } }, [apps, creating]);
  return (
    <div class="apps-list">
      <div class="head">
        <h1>{t("view.apps")}</h1>
        <div class="app-list-actions"><Button onClick={() => { setDraft(""); setCreating(!creating); }}>{t("apps.new")}</Button><Button disabled={list.loading} onClick={() => void apps.refresh()}>{t("common.refresh")}</Button></div>
      </div>
      {creating ? <AppRequest key={draft} title={t("apps.createTitle")} requestLabel={t("apps.request")} cwdLabel={t("apps.cwd")} reviewLabel={t("apps.preview")} previewLabel={t("apps.previewLabel")} sendLabel={t("apps.createSend")} prompt={t("apps.prompt")} busy={model.appRequestState.value.kind === "sending"} disabled={model.connection.value !== "connected" || model.appRequestState.value.kind === "unconfirmed"} error={model.appRequestState.value.message ? t("apps.createError", { message: model.appRequestState.value.message }) : undefined} folders={model.appFolders.value} defaultCwd={model.selectedRow.value?.summary.cwd ?? ""} templates={templates} templatesLabel={t("apps.templates")} filterLabel={t("apps.folderFilter")} listLabel={t("apps.folderList")} manualLabel={t("apps.folderManual")} initialDraft={draft} onSend={(text, cwd) => model.createAppRequest(text, cwd)} /> : null}
      {creating && apps.folders.value.error ? <Notice tone="bad">{t("apps.folderReadError", { message: apps.folders.value.error })}</Notice> : null}
      {failed ? <Notice tone="bad">{t("apps.openFailed", { name: failed.name, message: failed.message })}</Notice> : null}
      {list.error ? <Notice tone="bad">{t("common.readError", { message: list.error.message })}</Notice> : null}
      {list.loaded && list.apps.length === 0 ? <><EmptyState icon="apps" title={t("apps.empty")} body={t("apps.emptyBody")} /><div>{t("apps.templates")}<div class="app-templates">{templates.map((item) => <Button key={item.id} onClick={() => { setDraft(item.draft); setCreating(true); }}>{item.title}</Button>)}</div></div></> : null}
      {list.apps.length > 0 ? (
        <div class="grid">
          {list.apps.map((a) => (
            <div key={a.name}><AppCard
              title={a.title}
              name={a.name}
              href={formatRoute({ view: "apps", appName: a.name })}
              openLabel={t("apps.open")}
              note={a.thread ? t("apps.bound", { title: rows.get(a.thread)?.summary.title ?? a.thread.slice(0, 8) }) : t("apps.unbound")}
              problem={a.problem ? t("apps.broken", { problem: a.problem }) : undefined}
            />{a.problem ? null : <Instances model={model} name={a.name} />}</div>
          ))}
        </div>
      ) : null}
      <GuideCopy collapsed title={t("guide.title")} line={t("guide.line")} note={t("guide.note")} copy={t("code.copy")} copied={t("code.copied")} failed={t("guide.copyFailed")} />
    </div>
  );
}

/**
 * Stays mounted once anything is open, so apps keep running in any view. Only messages from an app's own
 * frame count; their text is shown as text. This is also the relay for the app API.
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
  const instance = showing ? route.appInstance : undefined;

  useEffect(() => {
        // An opaque origin has no name to target, so "*": it goes to this frame's window and nowhere else.
    const send = (frame: HTMLIFrameElement, message: Record<string, unknown>) => frame.contentWindow?.postMessage({ shellboy: true, ...message }, "*");
    for (const tab of apps.tabs.peek()) {
      const frame = frames.current.get(appTabKey(tab.name, tab.instance));
      if (frame) send(frame, { type: "theme", theme });
    }
    const onMessage = (e: MessageEvent) => {
      // The frame identifies the app, never anything the page says.
      const tab = apps.tabs.peek().find((x) => frames.current.get(appTabKey(x.name, x.instance))?.contentWindow === e.source);
      if (!tab || e.origin !== "null") return;
      const frame = frames.current.get(appTabKey(tab.name, tab.instance));
      const message = readAppMessage(e.data);
      if (!frame || !message) return;
      if (message.type === "error") apps.report(tab.name, message, tab.instance);
      else if (message.type === "ready") { send(frame, { type: "theme", theme }); send(frame, { type: "instance", instance: tab.instance ?? null }); }
      else void apps.call(tab.name, message.op, message.args, tab.instance).then((reply) => {
        if (message.op === "app.info" && reply.ok && typeof reply.result === "object" && reply.result !== null) {
          reply = { ...reply, result: { ...reply.result, instance: tab.instance ?? null } };
        }
        send(frame, { type: "reply", id: message.id, ...reply });
      });
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [apps, theme]);

  if (!showing && tabs.length === 0) return null;
  const open = tabs.find((x) => x.name === current && x.instance === instance);
  return (
    <div class={showing ? "apps-host" : "apps-host off"}>
      <AppTabs
        label={t("apps.tabs")}
        allLabel={t("apps.all")}
        allHref={formatRoute({ view: "apps" })}
        allCurrent={showing && current === undefined}
        tabs={tabs.map((tab) => ({
            key: appTabKey(tab.name, tab.instance),
            title: tab.instance ? `${tab.title} / ${tab.instance}` : tab.title,
            href: formatRoute({ view: "apps", appName: tab.name, ...(tab.instance ? { appInstance: tab.instance } : {}) }),
            current: tab.name === current && tab.instance === instance,
            alert: tab.errors.length > 0,
            closeLabel: t("apps.close", { name: tab.title }),
            onClose: () => {
              apps.close(tab.name, tab.instance);
              if (tab.name === current && tab.instance === instance) model.navigate({ view: "apps" });
            },
          }))}
      />
      {open && apps.openError.value?.name === open.name ? <Notice tone="bad">{t("apps.openFailed", { name: open.name, message: apps.openError.value.message })}</Notice> : null}
      {open ? <div class="apps-toolbar"><Button label={t("apps.reloadTab", { name: open.title })} onClick={() => void apps.reload(open.name, open.instance)}>{t("apps.reloadTab", { name: open.title })}</Button></div> : null}
      {open ? <Alerts model={model} tab={open} /> : null}
      {current === undefined || !open ? <AppList model={model} /> : null}
      {tabs.map((tab) => (
        <AppFrame
          key={`${appTabKey(tab.name, tab.instance)}:${tab.url}`}
          title={tab.title}
          url={tab.url}
          hidden={tab.name !== current || tab.instance !== instance}
          frameRef={(el) => {
            if (el) frames.current.set(appTabKey(tab.name, tab.instance), el);
            else frames.current.delete(appTabKey(tab.name, tab.instance));
          }}
        />
      ))}
    </div>
  );
}
