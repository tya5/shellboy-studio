import { Icon } from "../Icon";
import { Button } from "../Button";

/** The strip over the app pane: the list, then each open app. Scrolls in itself, never the page. */
export function AppTabs({ label, tabs }: { label: string; tabs: { key: string; title: string; href: string; current: boolean; alert?: boolean; closeLabel?: string; onClose?: () => void; reloadLabel?: string; onReload?: () => void }[] }) {
  return (
    <nav class="apptabs" aria-label={label}>
      {tabs.map((t) => (
        <div key={t.key} class="apptab" aria-current={t.current ? "page" : undefined}>
          <a href={t.href} aria-current={t.current ? "page" : undefined}>
            {t.alert ? <span class="st bad"><span class="mark"><span class="dot" /></span></span> : null}
            {t.title}
          </a>
          {t.onReload ? <Button icon label={t.reloadLabel} onClick={t.onReload}><Icon name="retry" small /></Button> : null}
          {t.onClose ? (
            <button type="button" class="apptab-close" aria-label={t.closeLabel} onClick={t.onClose}>
              <Icon name="cross" small />
            </button>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
