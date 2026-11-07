import { useState } from "preact/hooks";
import { Icon } from "../Icon";

type Tab = { key: string; title: string; href: string; current: boolean; alert?: boolean; closeLabel: string; onClose: () => void; onOpenNamed: (name: string) => void };

/** The list entrance stays fixed while the open tabs scroll. */
export function AppTabs({ label, allLabel, allHref, allCurrent, tabs, addLabel, nameLabel, openLabel, validName }: { label: string; allLabel: string; allHref: string; allCurrent: boolean; tabs: Tab[]; addLabel: string; nameLabel: string; openLabel: string; validName: (value: string) => boolean }) {
  const [editing, setEditing] = useState<string | undefined>();
  const [value, setValue] = useState("");
  return <nav class="apptabs" aria-label={label}>
    <a class="apptabs-all" href={allHref} aria-current={allCurrent ? "page" : undefined}>{allLabel}</a>
    <div class="apptabs-scroll">
      {tabs.map((t) => <div key={t.key} class="apptab-group">
        <div class="apptab" aria-current={t.current ? "page" : undefined}>
          <a href={t.href} aria-current={t.current ? "page" : undefined}>{t.alert ? <span class="st bad"><span class="mark"><span class="dot" /></span></span> : null}{t.title}</a>
          <button type="button" class="apptab-close" aria-label={t.closeLabel} onClick={t.onClose}><Icon name="cross" small /></button>
        </div>
        <button type="button" class="apptab-add" aria-label={addLabel} onClick={() => { setEditing(editing === t.key ? undefined : t.key); setValue(""); }}><Icon name="plus" small /></button>
        {editing === t.key ? <form class="apptab-name" onSubmit={(event) => { event.preventDefault(); if (validName(value)) { t.onOpenNamed(value); setEditing(undefined); setValue(""); } }}>
          <input autoFocus aria-label={nameLabel} value={value} onInput={(event) => setValue(event.currentTarget.value)} />
          <button class="btn" type="submit" disabled={!validName(value)}>{openLabel}</button>
        </form> : null}
      </div>)}
    </div>
  </nav>;
}
