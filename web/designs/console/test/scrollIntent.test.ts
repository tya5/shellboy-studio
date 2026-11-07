import { describe, expect, it } from "vitest";
import { ScrollIntent } from "../screens/scrollIntent";

const box = () => ({ scrollTop: 950, scrollHeight: 1050, clientHeight: 100 }) as HTMLElement;
describe("scroll intent", () => {
  it("detaches immediately on an upward wheel even near the bottom", () => {
    const intent = new ScrollIntent(), el = box();
    intent.program(el, 950);
    intent.scroll(el);
    intent.wheel(-1);
    el.scrollTop = 949;
    expect(intent.scroll(el)).toBe(false);
    el.scrollTop = 950;
    expect(intent.scroll(el)).toBe(true);
  });
  it("distinguishes programmatic adjustment and explicit upward input", () => {
    const intent = new ScrollIntent(), el = box();
    intent.program(el, 700);
    expect(intent.scroll(el)).toBe(true);
    intent.key("PageUp");
    expect(intent.following).toBe(false);
    intent.following = true;
    intent.touchStart(10);
    intent.touchMove(20);
    expect(intent.following).toBe(false);
  });
});
