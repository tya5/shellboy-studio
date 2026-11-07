import type { ComponentChildren } from "preact";

export interface DataColumn {
  label: string;
  /** Numbers align right, in the mono face. */
  numeric?: boolean;
}

export function DataTable({ caption, columns, rows }: { caption: string; columns: DataColumn[]; rows: { key: string; cells: ComponentChildren[] }[] }) {
  return (
    <div class="tbl-wrap" tabIndex={0} role="group" aria-label={caption}>
      <table class="tbl">
        <caption class="vh">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} scope="col" class={c.numeric ? "num" : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => (
                <td key={i} class={columns[i]?.numeric ? "num" : undefined}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
