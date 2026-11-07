import type { Ref } from "preact";

/** One app's page, on its own origin. Stays mounted while hidden, so the app keeps its state. */
export function AppFrame({ title, url, hidden, frameRef }: { title: string; url: string; hidden: boolean; frameRef?: Ref<HTMLIFrameElement> }) {
  return <iframe ref={frameRef} class={hidden ? "appframe off" : "appframe"} title={title} src={url} />;
}
