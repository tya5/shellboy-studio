import { Icon } from "../Icon";

/** An app in the list. A broken one stays listed and says why, so its author can see it. */
export function AppCard({ title, name, note, href, openLabel, problem }: { title: string; name: string; note: string; href: string; openLabel: string; problem?: string | undefined }) {
  return (
    <div class={problem ? "card err" : "card"}>
      <h2>{title}</h2>
      <div class="mono muted caption">{name}</div>
      {problem ? <p class="excerpt">{problem}</p> : <p class="excerpt">{note}</p>}
      {problem ? null : (
        <div class="foot">
          <a class="btn link go" href={href}>
            {openLabel}
            <Icon name="arrow" small />
          </a>
        </div>
      )}
    </div>
  );
}
