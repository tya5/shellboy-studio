import { formatBytes, formatClock, type AppModel, type CacheFact, type Translate } from "../../../ui-core/src";
import { BarList, Button, DataTable, FactList, Meter, Notice, Section, Stat } from "../system/components";
import { Rich } from "./Rich";

const cacheName = (t: Translate, name: string): string => (["body", "layout", "attachment", "replay"].includes(name) ? t(`res.cache.${name}` as "res.cache.body") : name);
const metricName = (t: Translate, name: string): string => (["footprint", "rss", "pss", "working_set", "private_bytes"].includes(name) ? t(`res.metric.${name}` as "res.metric.rss") : name);

function CacheMeter({ t, c }: { t: Translate; c: CacheFact }) {
  const name = cacheName(t, c.name);
  const used = c.retained !== undefined ? formatBytes(c.retained) : undefined;
  const limit = c.limit !== undefined ? formatBytes(c.limit) : "";
  const text =
    used === undefined
      ? t("res.cacheUnknown", { reason: c.reason ?? t("common.notReported"), limit })
      : c.entries !== undefined
        ? t("res.cacheEntries", { used, limit, entries: c.entries })
        : t("res.cacheText", { used, limit });
  return <Meter prose={used === undefined} label={name} value={c.retained} limit={c.limit} text={text} aria={t("res.cacheAria", { name, used: c.retained ?? "", limit: c.limit ?? "" })} />;
}

function Head({ t, title, sub, loading, onRefresh }: { t: Translate; title: string; sub: string; loading: boolean; onRefresh: () => void }) {
  return (
    <div class="head">
      <div class="pagehead">
        <h1>{title}</h1>
        <div class="muted">{sub}</div>
      </div>
      <Button disabled={loading} onClick={onRefresh}>{loading ? t("common.loading") : t("common.refresh")}</Button>
    </div>
  );
}

export function StoragePane({ model }: { model: AppModel }) {
  const t = model.t.value;
  const i = model.insights;
  const storage = i.storage.value;
  const receipts = i.receipts.value;
  const missing = t("common.notReported");
  const s = storage.value;
  const bytes = (n: number | undefined) => (n !== undefined ? { value: formatBytes(n), mono: true } : {});
  return (
    <>
      <Head t={t} title={t("res.storage")} sub={t("ana.sub.storage")} loading={storage.loading || receipts.loading} onRefresh={() => { i.refreshRead("storage"); i.refreshRead("receipts"); }} />
      <Section
        title={t("res.cat")}
        sub={<>{s ? t(s.limitReached ? "res.storageLimit" : s.warning ? "res.storageWarning" : "res.storageOk") : null}</>}
        source={<>{t("common.source", { source: "" })}<code>storage.status</code></>}
      >
        {storage.error ? <Notice tone="bad">{t("common.readError", { message: storage.error.message })}</Notice> : null}
        {s?.limitReached ? <Notice tone="bad">{t("res.storageLimit")}</Notice> : s?.warning ? <Notice tone="wait">{t("res.storageWarning")}</Notice> : null}
        {s ? (
          <>
            <div class="stats">
              <Stat label={t("res.db")} value={s.dbBytes !== undefined ? formatBytes(s.dbBytes) : missing} />
              <Stat label={t("res.live")} value={s.liveBytes !== undefined ? formatBytes(s.liveBytes) : missing} />
              <Stat label={t("res.free")} value={s.freeBytes !== undefined ? formatBytes(s.freeBytes) : missing} note={s.freeBytes === undefined ? t("res.freeMissing") : undefined} />
            </div>
            <BarList aria={t("res.cat")} rows={s.categories.map((c) => ({ key: c.name, label: t(`res.cat.${c.name}`), value: c.bytes, text: c.bytes !== undefined ? formatBytes(c.bytes) : missing }))} />
            <div class="muted caption">{t("res.storageNoLimit")}</div>
            <FactList missing={missing} facts={[
              { label: t("res.wal"), ...bytes(s.walBytes) },
              { label: t("res.logs"), ...bytes(s.logBytes) },
              { label: t("res.files"), ...bytes(s.managedFileBytes) },
              { label: t("res.reclaimable"), ...bytes(s.reclaimableBytes), ...(s.reclaimableIsLowerBound ? { note: t("res.reclaimableLower") } : {}) },
              { label: t("res.reusable"), ...bytes(s.reusableBytes) },
            ]} />
          </>
        ) : null}
      </Section>

      <Section title={t("res.receipts")} source={<>{t("common.source", { source: "" })}<code>status</code></>}>
        {receipts.error ? <Notice tone="bad">{t("common.readError", { message: receipts.error.message })}</Notice> : null}
        {receipts.value ? (
          <Meter label={t("res.receipts")} tone={receipts.value.atLimit ? "bad" : undefined} value={receipts.value.accounted} limit={receipts.value.limit} text={t("res.cacheText", { used: formatBytes(receipts.value.accounted ?? 0), limit: formatBytes(receipts.value.limit ?? 0) })} aria={t("res.cacheAria", { name: t("res.receipts"), used: receipts.value.accounted ?? "", limit: receipts.value.limit ?? "" })} />
        ) : null}
      </Section>

      <Section title={t("res.largest")}>
        <div class="muted"><Rich text={t("res.largestMissing")} /></div>
      </Section>

      <Section title={t("res.actions")} sub={t("res.actionsSub")}>
        <ul class="steps-list">
          <li><strong>{t("res.collectTitle")}</strong><span class="muted"><Rich text={t("res.collectBody")} /></span></li>
          <li><strong>{t("res.vacuumTitle")}</strong><span class="muted"><Rich text={t("res.vacuumBody")} /></span></li>
          <li><strong>{t("res.pruneTitle")}</strong><span class="muted"><Rich text={t("res.pruneBody")} /></span></li>
        </ul>
      </Section>
    </>
  );
}

export function MemoryPane({ model }: { model: AppModel }) {
  const t = model.t.value;
  const i = model.insights;
  const memory = i.memory.value;
  const bridge = i.bridge.value;
  const missing = t("common.notReported");
  return (
    <>
      <Head t={t} title={t("res.memory")} sub={t("ana.sub.memory")} loading={memory.loading || bridge.loading} onRefresh={() => { i.refreshRead("memory"); i.refreshRead("bridge"); }} />
      <Section
        title={t("res.process")}
        sub={memory.value?.observedAt ? t("res.memorySub", { at: formatClock(memory.value.observedAt, true) ?? "" }) : undefined}
        source={<>{t("common.source", { source: "" })}<code>status --memory</code></>}
      >
        {memory.error ? <Notice tone="bad">{t("common.readError", { message: memory.error.message })}</Notice> : null}
        {memory.value ? (
          <div class="stats">
            {memory.value.metrics.map((m) => (
              <Stat key={m.name} label={metricName(t, m.name)} value={m.bytes !== undefined ? formatBytes(m.bytes) : missing} note={m.bytes === undefined ? m.reason : undefined} />
            ))}
          </div>
        ) : null}
      </Section>
      <Section title={t("res.bridge")} sub={t("res.bridgeSub")} source={<>{t("common.source", { source: "" })}<code>bridge.memory</code></>}>
        {bridge.error ? <Notice tone="bad">{t("common.readError", { message: bridge.error.message })}</Notice> : null}
        {bridge.value ? (
          <div class="stats">
            <Stat label={t("res.bridgeRss")} value={bridge.value.rssBytes !== undefined ? formatBytes(bridge.value.rssBytes) : missing} note={bridge.value.reason} />
          </div>
        ) : null}
      </Section>
      {memory.value ? (
        <Section title={t("res.caches")} source={<>{t("common.source", { source: "" })}<code>status --memory</code></>}>
          <div class="meters">
            {memory.value.caches.map((c) => (
              <CacheMeter key={c.name} t={t} c={c} />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

export function IndexPane({ model }: { model: AppModel }) {
  const t = model.t.value;
  const i = model.insights;
  const index = i.index.value;
  const missing = t("common.notReported");
  return (
    <>
      <Head t={t} title={t("res.index")} sub={t("ana.sub.index")} loading={index.loading} onRefresh={() => i.refreshRead("index")} />
      <Section title={t("res.spaces")} sub={index.value ? t("res.indexCounts", { pending: index.value.pending ?? 0, running: index.value.running ?? 0, done: index.value.done ?? 0, failed: index.value.failed ?? 0, held: index.value.held ?? 0 }) : undefined} source={<>{t("common.source", { source: "" })}<code>index.status</code></>}>
        {index.error ? <Notice tone="bad">{t("common.readError", { message: index.error.message })}</Notice> : null}
        {index.value?.paused ? <Notice tone="wait">{t("res.indexPaused")}</Notice> : null}
        {index.value?.reason ? <div class="muted">{index.value.reason}</div> : null}
        {index.value && index.value.spaces.length > 0 ? (
          <DataTable
            caption={t("res.spaces")}
            columns={[{ label: t("res.space.model") }, { label: t("res.space.state") }, { label: t("res.space.dimension"), numeric: true }, { label: t("res.space.segments"), numeric: true }, { label: t("res.space.size"), numeric: true }]}
            rows={index.value.spaces.map((sp) => ({
              key: sp.id,
              cells: [
                <span class="mono">{sp.connection ?? ""} / {sp.model ?? ""}</span>,
                <>{sp.state ?? ""}{sp.selected ? <div class="muted caption">{t("res.space.selected")}</div> : null}</>,
                sp.dimension ?? missing,
                sp.segments?.toLocaleString("en-US") ?? missing,
                sp.vectorBytes !== undefined ? formatBytes(sp.vectorBytes) : missing,
              ],
            }))}
          />
        ) : index.value ? (
          <div class="muted">{t("res.noSpaces")}</div>
        ) : null}
        {index.value?.truncated ? <div class="muted caption">{t("res.spacesTruncated", { n: index.value.spaces.length, total: index.value.spacesTotal })}</div> : null}
      </Section>
      <Section title={t("res.indexTitle")}>
        <div class="muted"><Rich text={t("res.indexBody")} /></div>
      </Section>
    </>
  );
}
