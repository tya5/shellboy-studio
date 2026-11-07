import { Icon } from "../Icon";

/** The strip over the app pane: the list, then each open app. Scrolls in itself, never the page. */
export function AppTabs({ label, allLabel, allHref, allCurrent, tabs }: { label: string; allLabel: string; allHref: string; allCurrent: boolean; tabs: { key: string; title: string; href: string; current: boolean; alert?: boolean; closeLabel?: string; onClose?: () => void; }[] }) {
  return (
    <nav class="apptabs" aria-label={label}>
      <a class="apptabs-all" href={allHref} aria-current={allCurrent ? "page" : undefined}>{allLabel}</a>
      <div class="apptabs-scroll">
      {tabs.map((t) => (
        <div key={t.key} class="apptab" aria-current={t.current ? "page" : undefined}>
          <a href={t.href} aria-current={t.current ? "page" : undefined}>
            {t.alert ? <span class="st bad"><span class="mark"><span class="dot" /></span></span> : null}
            {t.title}
          </a>
          {t.onClose ? (
            <button type="button" class="apptab-close" aria-label={t.closeLabel} onClick={t.onClose}>
              <Icon name="cross" small />
            </button>
          ) : null}
        </div>
      ))}
      </div>
    </nav>
  );
}
