import { describe, expect, it } from "vitest";
import { HeadingAnchor, ScrollIntent } from "../screens/scrollIntent";

const box = () => ({ scrollTop: 950, scrollHeight: 1050, clientHeight: 100 }) as HTMLElement;
describe("tool heading anchor", () => {
  it("compensates for the measured movement of the operated heading", () => {
    let top = 140;
    const heading = { isConnected: true, getBoundingClientRect: () => ({ top }) } as HTMLElement;
    const anchor = new HeadingAnchor();
    anchor.capture(heading);
    top = 175;
    expect(anchor.correction()).toBe(35);
    expect(anchor.correction()).toBeUndefined();
  });
});

describe("scroll intent", () => {
  it.each(["wheel", "touch", "key"])("stays following when %s cannot move a short conversation", (gesture) => {
    const intent = new ScrollIntent();
    const el = { scrollTop: 0, scrollHeight: 80, clientHeight: 100 } as HTMLElement;
    intent.scroll(el);
    if (gesture === "wheel") intent.wheel(-1);
    if (gesture === "touch") { intent.touchStart(10); intent.touchMove(20); }
    if (gesture === "key") intent.key("PageUp");
    expect(intent.following).toBe(true);
    expect(intent.scroll(el)).toBe(true);
  });

  it("detaches after actual upward movement even near the bottom", () => {
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
    expect(intent.following).toBe(true);
    el.scrollTop = 650;
    expect(intent.scroll(el)).toBe(false);
    intent.following = true;
    intent.touchStart(10);
    intent.touchMove(20);
    expect(intent.following).toBe(true);
    el.scrollTop = 600;
    expect(intent.scroll(el)).toBe(false);
  });
});

describe("layout is not upward input", () => {
  it("does not detach when shrinking content clamps the scroll offset", () => {
    const intent = new ScrollIntent(), el = box();
    intent.program(el, 950); intent.scroll(el);
    Object.assign(el, { scrollHeight: 850, scrollTop: 750 });
    expect(intent.scroll(el)).toBe(true);
  });
  it("does not detach when a taller viewport clamps the scroll offset", () => {
    const intent = new ScrollIntent(), el = box();
    intent.program(el, 950); intent.scroll(el);
    Object.assign(el, { clientHeight: 200, scrollTop: 850 });
    expect(intent.scroll(el)).toBe(true);
  });
  it.each(["wheel", "touch", "key"])("waits for actual motion after %s, then detaches", (gesture) => {
    const intent = new ScrollIntent(), el = box();
    intent.program(el, 950); intent.scroll(el);
    if (gesture === "wheel") intent.wheel(-1);
    if (gesture === "touch") { intent.touchStart(10); intent.touchMove(20); }
    if (gesture === "key") intent.key("PageUp");
    expect(intent.following).toBe(true);
    el.scrollTop = 900;
    expect(intent.scroll(el)).toBe(false);
  });
  it("treats scrollbar motion as motion without a preceding wheel or key event", () => {
    const intent = new ScrollIntent(), el = box();
    intent.program(el, 950); intent.scroll(el);
    el.scrollTop = 500;
    expect(intent.scroll(el)).toBe(false);
  });
  it("resumes following when detached content now fits the viewport", () => {
    const intent = new ScrollIntent(), el = box();
    intent.program(el, 950); intent.scroll(el);
    el.scrollTop = 500; intent.scroll(el);
    Object.assign(el, { scrollHeight: 80, clientHeight: 100, scrollTop: 0 });
    expect(intent.scroll(el)).toBe(true);
  });
});
