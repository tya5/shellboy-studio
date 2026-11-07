import { Icon } from "../Icon";

/** A small link on a conversation row where branches leave. */
export function BranchMark({ href, label }: { href: string; label: string }) {
  return (
    <a class="bmark" href={href}>
      <Icon name="branch" small />
      {label}
    </a>
  );
}
