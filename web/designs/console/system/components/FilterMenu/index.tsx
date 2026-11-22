import { effect } from "@preact/signals-core";
import type { ShellboyData } from "../../../../../data/src";
import { ThreadHeadings } from "../../../../../ui-core/src/headings";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { isMenuOpenKey, Menu, type MenuEntry } from "../Menu";

export function FilterMenu({ label, count, data, canTag, canCwd, entries }: {
  label: string; count: number; data: ShellboyData; canTag: boolean; canCwd: boolean;
  entries: (catalogs: { tags: readonly string[]; directories: readonly string[]; moreTags?: () => void; moreDirectories?: () => void }) => MenuEntry[];
}) {
  const [open, setOpen] = useState(false);
  const owner = data.owner.value;
  const catalogs = useMemo(() => {
    const names = () => new ThreadHeadings(data.operations, () => ({ mode: "exclude", query: "" }), () => {});
    return { tag: names(), cwd: names() };
  }, [data, owner]);
  useEffect(() => {
    if (!open || owner.state !== "connected") return;
    return effect(() => {
      data.listHint.value;
      if (canTag) void catalogs.tag.reload("tag");
      if (canCwd) void catalogs.cwd.reload("cwd");
      return () => { catalogs.tag.leave(); catalogs.cwd.leave(); };
    });
  }, [open, data, catalogs, owner, canTag, canCwd]);
  const tags = catalogs.tag.headings.value;
  const directories = catalogs.cwd.headings.value;
  const items = open ? entries({ tags: tags.names, directories: directories.names,
    moreTags: canTag && catalogs.tag.canLoadMoreNames() ? () => { if (!tags.loading) catalogs.tag.loadMoreNames(); } : undefined,
    moreDirectories: canCwd && catalogs.cwd.canLoadMoreNames() ? () => { if (!directories.loading) catalogs.cwd.loadMoreNames(); } : undefined,
  }) : [];
  const [method, setMethod] = useState<"keyboard" | "pointer">("pointer");
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  return <><Button icon label={count ? `${label} (${count})` : label} title={label} buttonRef={trigger} id={`${id}-trigger`} aria-expanded={open} aria-haspopup="menu" aria-controls={`${id}-filters`} onKeyDown={event => {
    if (!isMenuOpenKey(event.key)) return;
    event.preventDefault();
    if (!open) { setMethod("keyboard"); setOpen(true); }
  }} onClick={e => { setMethod(e.detail === 0 ? "keyboard" : "pointer"); setOpen(!open); }}>
    <Icon role="sidebar.filter" size="small" />{count || null}
  </Button><Menu open={open} anchor={trigger.current} returnFocusTo={trigger.current} openMethod={method} id={`${id}-filters`} labelledBy={`${id}-trigger`} entries={items} onClose={() => setOpen(false)} /></>;
}
