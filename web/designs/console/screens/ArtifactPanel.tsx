import type { ArtifactSelected } from "../../../data/src";
import { Cancel } from "../../../data/src";
import { parseTime, type AppModel } from "../../../ui-core/src";
import { useEffect, useState } from "preact/hooks";
import { Button, Disclosure, Icon, KeyValue, ListDivider, ListRow } from "../system/components";
import type { IconRole } from "../system/components/Icon";

export const CAPABILITY_ARTIFACTS = "artifact.list.page";

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

export function ArtifactList({ model, onSelect }: { model: AppModel; onSelect: (id: string, opener: HTMLButtonElement) => void }) {
  const t = model.t.value;
  const page = model.artifacts.list.state.value;
  const lang = model.lang.value;
  return <section>
    <ListDivider label={t("artifact.band")} />
    {page.items.map(row => <ListRow key={row.artifact_id} id={row.artifact_id} title={row.latest.title} icon={artifactIcon(row.latest.mime)}
      subtitle={`${row.latest.version > 1 ? `v${row.latest.version} · ` : ""}${time(row.updated_at, lang)}`}
      selected={model.panelOpener.value.possessions?.kind === "artifact" && model.panelOpener.value.possessions.id === row.artifact_id}
      touchRow onSelect={opener => onSelect(row.artifact_id, opener)}><Icon role="artifact.detail" size="small" /></ListRow>)}
    {page.loading ? <p role="status">{t("artifact.loading")}</p> : null}
    {page.error ? <p role="alert">{t("artifact.failed")}</p> : null}
    {!page.items.length && !page.loading && !page.error ? <p class="muted caption">{t("artifact.empty")}</p> : null}
    {page.cursor !== undefined ? <Button disabled={page.loading} onClick={() => model.artifacts.list.more()}>{t("panel.attachmentsMore")}</Button> : null}
    {page.capped ? <p class="muted caption">{t("artifact.capped")}</p> : null}
  </section>;
}

function webUrl(uri: string, mime: string | null): string | undefined {
  if (!media(mime)) return;
  try {
    const url = new URL(uri);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch { /* An opaque URI is still available to copy. */ }
}

export function ArtifactDetail({ model }: { model: AppModel }) {
  const t = model.t.value;
  const lang = model.lang.value;
  const cut = model.artifacts.history.state.value;
  const row = cut.header;
  const [selection, setSelection] = useState<number>();
  const [loaded, setLoaded] = useState<ArtifactSelected>();
  const [failure, setFailure] = useState<number>();
  const [copyFailed, setCopyFailed] = useState(false);
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
  const url = version ? webUrl(version.uri, version.mime) : undefined;
  if (!row) return <p role={cut.error ? "alert" : "status"}>{t(cut.error ? "artifact.failed" : "artifact.loading")}</p>;
  return <>
    <h3>{row.latest.title}</h3>
    <KeyValue rows={[
      { key: "MIME", value: row.latest.mime ?? t("artifact.unknownMime") },
      { key: t("artifact.created"), value: time(row.created_at, lang) },
      { key: t("artifact.updated"), value: time(row.updated_at, lang) },
    ]} />
    {selection !== undefined ? <Button onClick={() => { setSelection(undefined); setLoaded(undefined); }}>{t("artifact.latest")}</Button> : null}
    {version ? <>
      <KeyValue rows={[{ key: `v${version.version} · URI`, value: <bdi class="mono">{version.uri}</bdi> }]} />
      <Button onClick={() => { setCopyFailed(false); void navigator.clipboard.writeText(version.uri).catch(() => setCopyFailed(true)); }}>{t("code.copy")}</Button>
      {copyFailed ? <p role="status">{t("guide.copyFailed")}</p> : null}
      {url ? <Button onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>{t("artifact.open")}</Button> : null}
    </> : <p role={selection === failure ? "alert" : "status"}>{t(selection === failure ? "artifact.failed" : "artifact.loading")}</p>}
    {row.latest.version > 1 ? <Disclosure>
      <summary>{t("artifact.versions")} ({row.latest.version - 1})</summary>
      {cut.items.filter(item => item.version < row.latest.version).map(item => <ListRow key={item.version} id={`${row.artifact_id}:v${item.version}`}
        title={`v${item.version}`} subtitle={time(item.created_at, lang)} selected={selection === item.version} touchRow
        onSelect={() => { if (selection !== item.version) { setLoaded(undefined); setSelection(item.version); } }} />)}
      {cut.error ? <p role="alert">{t("artifact.failed")}</p> : null}
      {cut.cursor !== undefined ? <Button disabled={cut.loading} onClick={() => model.artifacts.history.more()}>{t("panel.attachmentsMore")}</Button> : null}
      {cut.capped ? <p class="muted caption">{t("artifact.capped")}</p> : null}
    </Disclosure> : null}
  </>;
}
