import type { ComponentChildren } from "preact";

export interface DataColumn {
  label: string;
  /** Numbers align right, in the mono face. */
  numeric?: boolean;
}

export function DataTable({ caption, columns, rows, flat }: { caption: string; columns: DataColumn[]; rows: { key: string; cells: ComponentChildren[] }[]; /** Keep columns on a phone: only for tables known to fit. */ flat?: boolean }) {
  return (
    <div class="tbl-wrap">
      <table class={flat ? "tbl" : "tbl stack"}>
        <caption class="vh">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" class={c.numeric ? "num" : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => (
                <td key={i} class={columns[i]?.numeric ? "num" : undefined} data-label={columns[i]?.label}>
                  <div class="cell">{cell}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
