import { artifactContent, artifactRevealPlatform, revealArtifact, Cancel, type ArtifactRevealError, type ArtifactRevealPlatform, type ArtifactContentTarget, type ArtifactSelected, type ArtifactVersion } from "../../../data/src";
import { parseTime, type AppModel } from "../../../ui-core/src";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../system/components/Button";
import { CopyButton } from "../system/components/CopyButton";
import { Disclosure } from "../system/components/Disclosure";
import { Icon } from "../system/components/Icon";
import { KeyValue } from "../system/components/KeyValue";
import { ListDivider } from "../system/components/ListDivider";
import { ListRow } from "../system/components/ListRow";
import { Tooltip } from "../system/components/Tooltip";
import type { IconRole } from "../system/components/Icon";

import { Markdown } from "../system/components/Message";

const media = (mime: string | null) => mime?.split(";", 1)[0]?.trim().toLowerCase();
function artifactIcon(mime: string | null): IconRole {
  const kind = media(mime);
  return kind?.startsWith("image/") ? "artifact.image" : kind?.startsWith("text/") ? "artifact.text"
    : kind === "application/pdf" ? "artifact.pdf" : "artifact.unknown";
}

function time(iso: string, lang: string): string {
  const at = parseTime(iso);
  return at === undefined ? iso : new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(at);
}

export function useArtifactReveal(active: boolean, owner: AppModel["data"]["owner"]["value"]) {
  const [capability, setCapability] = useState<{ owner: typeof owner; platform: ArtifactRevealPlatform }>();
  useEffect(() => {
    if (!active || owner.state !== "connected") return;
    const abort = new AbortController();
    setCapability(undefined);
    void artifactRevealPlatform(abort.signal).then(platform => {
      if (platform && !abort.signal.aborted) setCapability({ owner, platform });
    }, () => {});
    return () => abort.abort();
  }, [active, owner]);
  return active && capability?.owner === owner ? capability.platform : undefined;
}

function fileArtifact(uri: string, platform: ArtifactRevealPlatform): boolean {
  if (platform === "explorer" ? /^[a-z]:[\\/]/i.test(uri) : uri.startsWith("/")) return true;
  try {
    const url = new URL(uri);
    return url.protocol === "file:" && !url.host && !url.search && !url.hash
      && (platform !== "explorer" || /^\/[a-z]:\//i.test(url.pathname));
  } catch { return false; }
}

function RevealButton({ model, target, platform }: { model: AppModel; target: ArtifactContentTarget; platform: ArtifactRevealPlatform }) {
  const t = model.t.value;
  const label = t(`artifact.reveal.${platform}`);
  const request = useRef<AbortController>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [status, setStatus] = useState<ArtifactRevealError | "busy_request" | "revealed">();
  useEffect(() => () => { request.current?.abort(); clearTimeout(timer.current); }, []);
  const reveal = async () => {
    if (request.current) return;
    const abort = new AbortController();
    request.current = abort;
    clearTimeout(timer.current);
    setStatus("busy_request");
    let error: ArtifactRevealError | undefined;
    try { error = await revealArtifact(target, abort.signal); }
    catch { error = "reveal_failed"; }
    if (abort.signal.aborted) return;
    request.current = undefined;
    setStatus(error ?? "revealed");
    if (!error) timer.current = setTimeout(() => setStatus(undefined), 1500);
  };
  return <><Tooltip label={label}><Button variant="ghost" icon label={label} disabled={status === "busy_request"} onClick={() => void reveal()}><Icon role="artifact.reveal" size="small" /></Button></Tooltip>
    <span role="status" data-artifact-reveal-status="" class={status === "revealed" ? "artifact-reveal-message" : undefined}>{status === "revealed" ? t("artifact.reveal.revealed") : null}</span>
    {status && status !== "busy_request" && status !== "revealed" ? <span role="alert" class="artifact-reveal-message">{t(`artifact.reveal.${status}`)}</span> : null}</>;
}

export function ArtifactList({ model, platform, onSelect }: { model: AppModel; platform: ArtifactRevealPlatform | undefined; onSelect: (id: string, opener: HTMLButtonElement) => void }) {
  const t = model.t.value;
  const page = model.artifacts.list.state.value;
  const lang = model.lang.value;
  return <section>
    <ListDivider label={t("artifact.band")} />
    {page.items.map(row => <ListRow key={row.artifact_id} id={row.artifact_id} title={row.latest.title} icon={artifactIcon(row.latest.mime)}
      subtitle={`${row.latest.version > 1 ? `v${row.latest.version} · ` : ""}${time(row.updated_at, lang)}`}
      selected={model.panelOpener.value.possessions?.kind === "artifact" && model.panelOpener.value.possessions.id === row.artifact_id}
      afterActions={platform && fileArtifact(row.latest.uri, platform) ? <RevealButton key={row.latest.version} model={model} platform={platform} target={{ thread_id: row.thread_id, artifact_id: row.artifact_id, version: row.latest.version }} /> : null}
      onSelect={opener => onSelect(row.artifact_id, opener)}><Icon role="artifact.detail" size="small" /></ListRow>)}
    {page.loading && !page.loaded || page.loadingMore ? <p role="status">{t("artifact.loading")}</p> : null}
    {page.error ? <p role="alert">{t("artifact.failed")}</p> : null}
    {!page.items.length && !(page.loading && !page.loaded) && !page.error ? <p class="muted caption">{t("artifact.empty")}</p> : null}
    {page.cursor !== undefined ? <Button variant="ghost" disabled={page.loading} onClick={() => model.artifacts.list.more()}>{t("panel.attachmentsMore")}</Button> : null}
    {page.capped ? <p class="muted caption">{t("artifact.capped")}</p> : null}
  </section>;
}

function artifactAction(version: ArtifactVersion, desktop: boolean) {
  const mime = media(version.mime);
  if (!mime) return;
  try {
    const url = new URL(version.uri);
    if (url.protocol === "https:" || url.protocol === "http:") return { kind: "link", href: url.href } as const;
  } catch { /* Plain absolute paths are not URLs. */ }
  const local = /^(?:file:|\/|[a-z]:[\\/])/i.test(version.uri);
  if (!local) return;
  if (mime.startsWith("image/") || mime.startsWith("text/") && mime !== "text/html") return { kind: "preview", mime } as const;
  if (desktop && (mime === "application/pdf" || mime === "text/html")) return { kind: "open" } as const;
}

function Preview({ model, target, mime, title }: { model: AppModel; target: ArtifactContentTarget; mime: string; title: string }) {
  const t = model.t.value;
  const [content, setContent] = useState<{ kind: "image" | "text"; value: string } | "unavailable">();
  const { thread_id, artifact_id, version } = target;
  useEffect(() => {
    const cancel = new AbortController();
    void (async () => {
      try {
        const response = await artifactContent({ thread_id, artifact_id, version }, "preview", cancel.signal);
        if (response.status !== 200) throw new Error("No preview");
        if (mime.startsWith("image/")) {
          const bytes = await response.blob();
          if (cancel.signal.aborted) return;
          const value = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(bytes.slice(0, bytes.size, mime));
          });
          if (!cancel.signal.aborted) setContent({ kind: "image", value });
        } else {
          const text = await response.text();
          if (!cancel.signal.aborted) setContent({ kind: "text", value: text });
        }
      } catch {
        if (!cancel.signal.aborted) setContent("unavailable");
      }
    })();
    return () => cancel.abort();
  }, [thread_id, artifact_id, version, mime]);
  return <div class="artifact-preview" aria-label={t("artifact.preview")}>
    {content === undefined ? <p role="status">{t("artifact.loading")}</p> : content === "unavailable" ? <p role="status">{t("artifact.noPreview")}</p>
      : content.kind === "image" ? <img src={content.value} alt={title} />
      : mime === "text/markdown" ? <Markdown text={content.value} copyLabel={t("code.copy")} copiedLabel={t("code.copied")} copyFailedLabel={t("output.copyFailed")} />
      : <pre>{content.value}</pre>}
  </div>;
}

export function ArtifactDetail({ model, platform }: { model: AppModel; platform: ArtifactRevealPlatform | undefined }) {
  const t = model.t.value;
  const lang = model.lang.value;
  const cut = model.artifacts.history.state.value;
  const row = cut.header;
  const [selection, setSelection] = useState<number>();
  const [loaded, setLoaded] = useState<ArtifactSelected>();
  const [failure, setFailure] = useState<number>();
  const [openFailed, setOpenFailed] = useState(false);
  const thread = row?.thread_id;
  const artifact = row?.artifact_id;
  const owner = model.data.owner.value;
  useEffect(() => {
    if (thread === undefined || artifact === undefined || selection === undefined) return;
    const cancel = new Cancel();
    setFailure(undefined);
    void model.data.operations.artifactVersion(thread, artifact, selection, { cancel }).then(out => {
      if (cancel.cancelled || model.data.owner.peek() !== owner) return;
      if (out.ok) setLoaded(out.value);
      else setFailure(selection);
    });
    return () => cancel.cancel();
  }, [model, owner, thread, artifact, selection]);
  const version = selection === undefined ? row?.latest
    : loaded?.artifact_id === artifact && loaded?.thread_id === thread && loaded?.version.version === selection ? loaded.version : undefined;
  const desktop = model.data.desktop.value;
  const action = version ? artifactAction(version, desktop) : undefined;
  const target = thread && artifact && version ? { thread_id: thread, artifact_id: artifact, version: version.version } : undefined;
  if (!row) return <p role={cut.error ? "alert" : "status"}>{t(cut.error ? "artifact.failed" : "artifact.loading")}</p>;
  return <>
    <h3 class="artifact-detail-title">{row.latest.title}</h3>
    <KeyValue rows={[
      { key: "MIME", value: version?.mime ?? t("artifact.unknownMime") },
      { key: t("artifact.created"), value: time(row.created_at, lang) },
      { key: t("artifact.updated"), value: time(row.updated_at, lang) },
    ]} />
    {selection !== undefined ? <Button variant="ghost" onClick={() => { setSelection(undefined); setLoaded(undefined); }}>{t("artifact.latest")}</Button> : null}
    {version ? <>
      <KeyValue rows={[{ key: `v${version.version} · URI`, value: <bdi class="mono artifact-uri">{version.uri}</bdi> }]} />
      <CopyButton text={version.uri} label={t("artifact.copyPath")} copiedLabel={t("code.copied")} failedLabel={t("guide.copyFailed")} />
      {target && platform && fileArtifact(version.uri, platform) ? <RevealButton key={version.version} model={model} platform={platform} target={target} /> : null}
      {action?.kind === "link" ? <a class="nav-link" href={action.href} target="_blank" rel="noopener noreferrer">{t("artifact.open")}</a> : null}
      {target && action?.kind === "preview" ? <Preview key={JSON.stringify([target, action.mime])} model={model} target={target} mime={action.mime} title={version.title} /> : null}
      {target && action?.kind === "open" ? <Button variant="ghost" onClick={() => {
        setOpenFailed(false);
        void artifactContent(target, "open").then(res => { if (res.status !== 200) setOpenFailed(true); }, () => setOpenFailed(true));
      }}>{t("artifact.open")}</Button> : null}
      {openFailed ? <p role="alert">{t("artifact.openFailed")}</p> : null}
    </> : <p role={selection === failure ? "alert" : "status"}>{t(selection === failure ? "artifact.failed" : "artifact.loading")}</p>}
    {row.latest.version > 1 ? <Disclosure>
      <summary>{t("artifact.versions")} ({row.latest.version - 1})</summary>
      {cut.items.filter(item => item.version < row.latest.version).map(item => <ListRow key={item.version} id={`${row.artifact_id}:v${item.version}`}
        title={`v${item.version}`} subtitle={time(item.created_at, lang)} selected={selection === item.version}
        onSelect={() => { if (selection !== item.version) { setLoaded(undefined); setSelection(item.version); } }} />)}
      {cut.error ? <p role="alert">{t("artifact.failed")}</p> : null}
      {cut.cursor !== undefined ? <Button variant="ghost" disabled={cut.loading} onClick={() => model.artifacts.history.more()}>{t("panel.attachmentsMore")}</Button> : null}
      {cut.capped ? <p class="muted caption">{t("artifact.capped")}</p> : null}
    </Disclosure> : null}
  </>;
}
