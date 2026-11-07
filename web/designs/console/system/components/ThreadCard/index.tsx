import type { ComponentChildren } from "preact";

/** `lead`: has children. `need`: awaits a person. `err`: recovery wait. */
export function ThreadCard({ tone, status, age, title, excerpt, foot }: { tone?: "lead" | "need" | "err" | undefined; status: ComponentChildren; age?: string | undefined; title: string; excerpt?: string | undefined; foot: ComponentChildren }) {
  return (
    <article class={tone ? `card ${tone}` : "card"}>
      <div class="r">
        {status}
        {age ? <span class="muted mono">{age}</span> : null}
      </div>
      <h2>{title}</h2>
      {excerpt ? <p class="excerpt">{excerpt}</p> : null}
      <div class="foot">{foot}</div>
    </article>
  );
}
