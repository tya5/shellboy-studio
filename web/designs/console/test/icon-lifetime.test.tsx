// @vitest-environment happy-dom
import { render, type VNode } from "preact";
import { expect, it } from "vitest";
import { Icon, ICON_ROLES } from "../system/components/Icon";

function nodes(children: unknown): VNode[] {
  if (Array.isArray(children)) return children.flatMap(nodes);
  if (!children || typeof children !== "object" || !("props" in children)) return [];
  const node = children as VNode<{ children?: unknown }>;
  return [node, ...nodes(node.props.children)];
}

it("never gives a new render a previously mounted glyph VNode", () => {
  const host = document.createElement("div");
  const issued = new Set<VNode>();
  try {
    for (let update = 0; update < 12; update++) {
      const icons = ICON_ROLES.map(role => Icon({ role }));
      for (const icon of icons) {
        const glyph = nodes(icon.props.children);
        expect(glyph.length).toBeGreaterThan(0);
        for (const node of glyph) {
          expect(issued.has(node)).toBe(false);
          issued.add(node);
        }
      }
      render(<section key={update}>{icons}</section>, host);
      expect(host.querySelectorAll("svg")).toHaveLength(ICON_ROLES.length);
    }
  } finally {
    render(null, host);
  }
});
