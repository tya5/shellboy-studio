/** Stands in for rows not read yet: as many as are known to be missing, at about their height. */
export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div class="loadrows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} class="loadrow" aria-hidden="true" />
      ))}
    </div>
  );
}
