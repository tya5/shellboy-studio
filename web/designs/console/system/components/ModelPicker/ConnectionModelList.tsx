import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button } from "../Button";
import { Field } from "../Field";

export type ConnectionModel = { connection: string; model: string };
export const modelLabel = ({ connection, model }: ConnectionModel) => `${connection} / ${model}`;

/** A filtered list of complete choices, independent of the operation that uses them. */
export function ConnectionModelList({ choices, selected, searchLabel, emptyLabel, disabled, onSelect }: {
  choices: readonly ConnectionModel[];
  selected: ConnectionModel;
  searchLabel: string;
  emptyLabel: string;
  disabled?: boolean;
  onSelect: (choice: ConnectionModel) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = choices.filter((choice) => modelLabel(choice).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <Field ariaLabel={searchLabel} placeholder={searchLabel} value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
    <div class="model-picker-list" role="group" aria-label={searchLabel}>
      {shown.length ? shown.map((choice) => <Button key={JSON.stringify(choice)} variant="link" disabled={disabled} aria-pressed={choice.connection === selected.connection && choice.model === selected.model} onClick={() => onSelect(choice)}>{modelLabel(choice)}</Button>) : <span role="status">{emptyLabel}</span>}
    </div>
  </>;
}

/** Catalog data is scoped to the open picker, never to saved settings. */
export function useConnectionModels(connections: readonly string[], load: (connection: string) => Promise<{ choices: string[]; error?: string }>) {
  const [catalog, setCatalog] = useState<{ choices: ConnectionModel[]; errors: string[]; loading: boolean }>({ choices: [], errors: [], loading: true });
  useEffect(() => {
    let active = true;
    void Promise.all(connections.map(async (connection) => {
      const { choices, error } = await load(connection);
      return { choices: [...new Set(choices)].sort().map((model) => ({ connection, model })), error };
    })).then((results) => {
      if (active) setCatalog({ choices: results.flatMap((item) => item.choices), errors: results.flatMap((item) => item.error ? [item.error] : []), loading: false });
    });
    return () => { active = false; };
  }, [connections, load]);
  return catalog;
}

export function ModelChooser({ label, trigger, open, disabled, onToggle, onClose, children }: {
  label: string; trigger: string; open: boolean; disabled?: boolean; onToggle: () => void; onClose: () => void; children: ComponentChildren;
}) {
  return <div class="model-picker-anchor">
    <Button aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={onToggle}>{trigger}</Button>
    {open ? <div class="model-picker" role="dialog" aria-label={label} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    }}>{children}</div> : null}
  </div>;
}
