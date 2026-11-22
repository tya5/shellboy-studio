import type { ComponentChildren } from "preact";

/** A titled block of one subject, with where its numbers come from. */
export function Section({ settingId, title, sub, source, actions, children }: { settingId?: string; title: string; sub?: ComponentChildren; source?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <section class="sect" aria-label={title} data-setting-id={settingId}>
      <div class="sect-head">
        <div class="sect-title">
          <h3>{title}</h3>
          {sub ? <div class="muted caption">{sub}</div> : null}
        </div>
        {actions}
      </div>
      {children}
      {source ? <div class="sect-source">{source}</div> : null}
    </section>
  );
}
