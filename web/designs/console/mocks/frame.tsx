// Shared scaffolding for static design mocks: theme rows, device frames and a static sheet.
// Mock-only. Product screens never import this file.
import { render, type ComponentChildren } from "preact";
import { Button } from "../system/components/Button";
import lightTokens from "../system/tokens/light.css?raw";
import "../system/tokens/console.css";
import "../system/components.css";
import "../system/layout.css";
import "./frame.css";

// The generated Light tokens are bound to :root. Re-scope the fixed Light block to one wrapper so the
// Console and Light themes render side by side on one page; the token values are unchanged.
function installLightScope() {
  if (document.getElementById("mock-light-tokens")) return;
  const style = document.createElement("style");
  style.id = "mock-light-tokens";
  const fixed = lightTokens.slice(0, lightTokens.indexOf("@media"));
  style.textContent = fixed.replace(':root[data-ds="light"]', ".mock-light");
  document.head.append(style);
}

export function ThemeRow({ light, children }: { light?: boolean; children: ComponentChildren }) {
  return <section class={`mock-theme${light ? " mock-light" : ""}`} aria-label={light ? "Light theme" : "Console theme (dark)"}>
    <h2 class="mock-theme-title">{light ? "Light" : "Console (dark)"}</h2>
    <div class="mock-frames">{children}</div>
  </section>;
}

export function Frame({ caption, phone, children }: { caption: string; phone?: boolean; children: ComponentChildren }) {
  return <figure class={`mock-figure${phone ? " mock-figure-phone" : " mock-figure-desktop"}`}>
    <figcaption>{caption}</figcaption>
    <div class={`mock-frame${phone ? " mock-frame-phone" : " mock-frame-desktop"}`}>{children}</div>
  </figure>;
}

/** A static, in-frame rendering of WorkSheet's markup, so a modal state can be shown beside other states. */
export function StaticSheet({ title, closeLabel, alert, children }: { title: string; closeLabel: string; alert?: boolean; children: ComponentChildren }) {
  return <>
    <div class="mock-scrim" aria-hidden="true" />
    <div class="work-sheet mock-static-sheet" role={alert ? "alertdialog" : "dialog"} aria-label={title}>
      <div class="work-sheet-head"><h2>{title}</h2><Button>{closeLabel}</Button></div>
      <div class="mock-sheet-body">{children}</div>
    </div>
  </>;
}

export function mountMock(page: ComponentChildren) {
  installLightScope();
  const root = document.getElementById("mock")!;
  render(page, root);
  root.dataset.mockReady = "";
}
