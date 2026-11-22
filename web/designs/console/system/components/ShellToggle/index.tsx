export function ShellFooter({ side, children }: { side: "left" | "right"; children: preact.ComponentChildren }) {
  return <div class={`shell-footer shell-footer-${side}`}>{children}</div>;
}

export function ShellToggle({ panel, expanded, label, title, onClick }: { panel: boolean; expanded: boolean; label: string; title?: string; onClick: () => void }) {
  return <button type="button" class={`shell-toggle${panel ? " shell-toggle-panel" : " shell-toggle-sidebar"}`} aria-label={label} aria-expanded={expanded} title={title ?? label} onClick={onClick}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path class={`${expanded ? "shell-toggle-strip filled" : "shell-toggle-strip"}${panel ? " right" : ""}`} d={panel ? "M20 6a1 1 0 0 0-1-1h-3v14h3a1 1 0 0 0 1-1z" : "M4 6a1 1 0 0 1 1-1h3v14H5a1 1 0 0 1-1-1z"} />
    </svg>
  </button>;
}
