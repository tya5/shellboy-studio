import type { ComponentChildren } from "preact";
import { SectionNav, type SectionNavItem } from "../SectionNav";

/**
 * A view with a second-level menu: section list beside one pane. The pane is keyed by section,
 * so switching starts it at the top; state that must survive a switch belongs in ui-core.
 */
export function SubView({ title, items, onSelect, children }: { title: string; items: SectionNavItem[]; onSelect: (key: string) => void; children: ComponentChildren }) {
  return (
    <div class="subview">
      <div class="subview-nav">
        <SectionNav title={title} items={items} onSelect={onSelect} />
      </div>
      <div class="subview-main" key={items.find((i) => i.current)?.key}>
        {children}
      </div>
    </div>
  );
}
