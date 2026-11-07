import type { JSX } from "preact";

const PATHS = {
  bot: <><path d="M12 2v3M5 9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM2.5 11v3M21.5 11v3M9 21h6" /><circle cx="9.5" cy="11" r="1.1" fill="currentColor" /><circle cx="14.5" cy="11" r="1.1" fill="currentColor" /><path d="M9.5 14.5h5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  chat: <path d="M21 12a8 8 0 0 1-8 8H4l1.8-3A8 8 0 1 1 21 12z" />,
  monitor: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 14l3-3 3 2 4-5" /></>,
  inbox: <path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1.5 3h5L16 13h5" />,
  term: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M12 15h5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  send: <path d="M4 12l16-8-6 16-2.5-6.5z" />,
  tree: <><circle cx="12" cy="5" r="2.2" /><circle cx="5.5" cy="19" r="2.2" /><circle cx="18.5" cy="19" r="2.2" /><path d="M12 7.2V12M5.5 16.8V12h13v4.8" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  square: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />,
  retry: <path d="M20 11a8 8 0 0 0-14-5l-2 2M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />,
  cube: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  file: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  palette: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18M12 3a9 9 0 0 1 0 18" fill="currentColor" /></>,
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg class={small ? "i s" : "i"} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
