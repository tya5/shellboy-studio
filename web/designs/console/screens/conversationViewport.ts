import { createContext } from "preact";
import type { ViewportGeometry } from "./viewportGeometry";

export interface MountedViewport {
  geometry: ViewportGeometry;
  first: number;
  end: number;
  ordinals: readonly (number | undefined)[];
  before: HTMLDivElement | null;
  after: HTMLDivElement | null;
}
export interface ConversationViewport {
  top: number;
  height: number;
  following: boolean;
  fallback: number;
  commit: (viewport: MountedViewport | undefined) => void;
  mount: (key: string, element: HTMLElement | null) => void;
}
export const conversationViewport = createContext<ConversationViewport | undefined>(undefined);
