import { Button } from "../Button";
import { Chip } from "../Chip";

export function FilterChips({ items, clearLabel, onClear }: { items: readonly { key: string; label: string; removeLabel: string; remove: () => void }[]; clearLabel: string; onClear: () => void }) {
  if (!items.length) return null;
  return <div class="filter-chip-list">{items.map(item => <Chip key={item.key} label={item.label} removeLabel={item.removeLabel} onClick={item.remove} />)}<Button variant="ghost" onClick={onClear}>{clearLabel}</Button></div>;
}
