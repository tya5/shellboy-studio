import type { Ref } from "preact";

/** Without `allow-same-origin`, so the page has an opaque origin and can't reach this one. */
const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals allow-downloads";

/** One app's page. Stays mounted while hidden, so the app keeps its state. */
export function AppFrame({ title, url, hidden, frameRef }: { title: string; url: string; hidden: boolean; frameRef?: Ref<HTMLIFrameElement> }) {
  return <iframe ref={frameRef} class={hidden ? "appframe off" : "appframe"} title={title} src={url} sandbox={SANDBOX} />;
}
