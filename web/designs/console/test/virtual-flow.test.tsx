// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { VirtualSpace } from "../system/components/VirtualSpace";

describe("virtual flow", () => {
  it("keeps growing rows and later rows in normal document flow", () => {
    const host = document.createElement("div");
    render(<VirtualSpace top={100} bottom={200}><div data-o="1">growing row</div><div data-o="2">next row</div></VirtualSpace>, host);
    const space = host.querySelector(".vspace")!;
    expect(Array.from(space.children).map((el) => el.textContent)).toEqual(["", "growing row", "next row", ""]);
    expect((space.firstElementChild as HTMLElement).style.height).toBe("100px");
    expect((space.lastElementChild as HTMLElement).style.height).toBe("200px");
    expect((space.children[1] as HTMLElement).style.position).not.toBe("absolute");
    render(null, host);
  });
});
