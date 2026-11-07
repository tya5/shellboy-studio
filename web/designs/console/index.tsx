// Console design entry: loaded only through the registry.
import "@preact/signals"; // components re-render on the signals they read
import { render } from "preact";
import type { DesignContext, DesignModule } from "../../ui-core/src";
import { App } from "./screens/App";
import "./system/tokens/console.css";
import "./system/tokens/light.css";
import "./system/tokens/terminal.css";
import "./system/components.css";
import "./system/layout.css";

export const mount: DesignModule["mount"] = (target, context: DesignContext) => {
  const element = target as HTMLElement;
  render(<App context={context} />, element);
  return () => render(null, element);
};
