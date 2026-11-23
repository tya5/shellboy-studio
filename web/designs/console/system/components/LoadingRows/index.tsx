/** Stands in for rows not read yet: as many as are known to be missing, at about their height. */
export function LoadingRows({ label, rows = 3, announce = true }: { label: string; rows?: number; announce?: boolean }) {
  return (
    <div class="loadrows" {...(announce ? { role: "status", "aria-label": label } : { "aria-hidden": "true" })}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} class="loadrow" aria-hidden="true" />
      ))}
    </div>
  );
}

/**
 * Stands in for a count that has not been read yet, so no "0" shows before the first read settles.
 * `small` matches the size-chip-height token; `onRaised` keeps it visible on a raised surface such as a
 * ButtonGroup. Mark the owning control `aria-busy` while it shows.
 */
export function LoadingCount({ small, onRaised }: { small?: boolean; onRaised?: boolean }) {
  return <span class={["loadcount", small ? "loadcount-small" : "", onRaised ? "loadcount-on-raised" : ""].filter(Boolean).join(" ")} aria-hidden="true" />;
}
