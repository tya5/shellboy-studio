// Approved e0b6271 silhouette and expression; colors use the existing theme tokens.
export function BrandLogo() {
  return <svg class="brand-logo" viewBox="0 0 390 390" aria-hidden="true" focusable="false">
    <rect width="390" height="390" rx="50" class="logo-tile" fill="var(--accent)" />
    <path d="M126 63 H263 C315 63 354 102 354 153 V222 C354 272 324 310 274 310 H208 L155 349 C141 359 126 350 126 333 L125 310 H124 C74 310 35 271 35 221 V154 C35 104 75 63 126 63 Z" class="logo-face" fill="var(--logo-face)" />
    <path d="M126 63 H263 C315 63 354 102 354 153 V222 C354 272 324 310 274 310 H208 L155 349 C141 359 126 350 126 333 L125 310 H124 C74 310 35 271 35 221 V154 C35 104 75 63 126 63 Z M125 98 H263 C296 98 320 120 320 150 V221 C320 253 302 276 271 276 H205 C199 276 197 277 192 281 L157 309 Q152 313 152 308 V284 Q152 276 145 276 H124 C93 276 71 253 71 220 V154 C71 122 93 98 125 98 Z" fill-rule="evenodd" class="logo-bubble" fill="var(--logo-bright)" />
    <path d="M134 161 L172 188 L134 216" stroke-width="21" stroke-linecap="round" stroke-linejoin="round" class="logo-wink" fill="none" stroke="var(--accent)" />
    <ellipse cx="246" cy="187" rx="21" ry="37" class="logo-eye" fill="var(--logo-bright)" />
  </svg>;
}
