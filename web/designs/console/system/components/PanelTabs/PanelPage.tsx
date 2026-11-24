import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { tabStops } from "../../focus";

export function PanelPage({ id, hidden, children }: { id: string; hidden: boolean; children: ComponentChildren }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const page = ref.current;
    if (!page || hidden) return;
    const sync = () => {
      if (tabStops(page).length) page.removeAttribute("tabindex");
      else page.tabIndex = 0;
    };
    sync();
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target !== page)) sync();
    });
    observer.observe(page, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["aria-hidden", "class", "contenteditable", "disabled", "hidden", "href", "inert", "open", "style", "tabindex", "type"] });
    return () => { observer.disconnect(); page.removeAttribute("tabindex"); };
  }, [hidden]);
  return <section ref={ref} role="tabpanel" id={`panel-page-${id}`} aria-labelledby={`panel-tab-${id}`} hidden={hidden}>{children}</section>;
}
