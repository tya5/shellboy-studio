import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export function SidebarTree({ name, children }: { name: string; children: ComponentChildren }) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<string>();
  const items = () => [...(root.current?.querySelectorAll<HTMLAnchorElement>('[role="treeitem"]') ?? [])];
  const setStop = (nodes: HTMLAnchorElement[], target?: HTMLAnchorElement) => {
    current.current = target?.id;
    for (const node of nodes) node.tabIndex = node === target ? 0 : -1;
  };
  useLayoutEffect(() => {
    const nodes = items();
    setStop(nodes, nodes.find(node => node.id === current.current) ?? nodes.find(node => node.hasAttribute("aria-current")) ?? nodes[0]);
  });
  return <div ref={root} role="tree" aria-label={name} onFocusIn={event => {
    const nodes = items();
    const target = nodes.find(node => node === event.target);
    if (target) setStop(nodes, target);
  }} onKeyDown={event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const nodes = items();
    const i = nodes.findIndex(node => node === event.target);
    if (i < 0) return;
    const node = nodes[i]!;
    const level = Number(node.getAttribute("aria-level"));
    let target: HTMLAnchorElement | undefined;
    switch (event.key) {
      case "ArrowDown": target = nodes[i + 1]; break;
      case "ArrowUp": target = nodes[i - 1]; break;
      case "Home": target = nodes[0]; break;
      case "End": target = nodes.at(-1); break;
      case "ArrowRight": if (Number(nodes[i + 1]?.getAttribute("aria-level")) > level) target = nodes[i + 1]; break;
      case "ArrowLeft": target = nodes.slice(0, i).reverse().find(candidate => Number(candidate.getAttribute("aria-level")) < level); break;
      default: return;
    }
    event.preventDefault();
    target?.focus();
  }}>{children}</div>;
}

/** Input is the complete band in preorder, including currently collapsed children. */
export function siblingPositions(rows: readonly { depth: number }[], partial: boolean) {
  const groups: number[][] = [];
  const parents: number[] = [];
  const siblings = new Map<number, number[]>();
  rows.forEach(({depth}, index) => {
    const parent = depth === 0 ? -1 : parents[depth - 1] ?? -1;
    const cohort = siblings.get(parent) ?? [];
    cohort.push(index);
    siblings.set(parent, cohort);
    parents[depth] = index;
    groups[index] = cohort;
  });
  const ranks = new Map<number[], number>();
  return groups.map(cohort => {
    const posinset = (ranks.get(cohort) ?? 0) + 1;
    ranks.set(cohort, posinset);
    return { posinset, setsize: partial ? -1 : cohort.length };
  });
}
