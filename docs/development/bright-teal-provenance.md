# Approved Bright Teal integration

The brand assets and brand-only token values are selected from approved source
commit `e0b6271ba6bdeb4b2965ec11a342cd1d1a5c7100` (Add Bright Teal Studio icon).
This is a content-only import on public base
`f840a32d81db6ee7a0223519b13fbfbdf2ba9047`, not a merge/cherry-pick of the
source's private ancestry. Original refs are preserved.

Nine source SVG/PNG files are copied byte-for-byte. Generator scripts and ICO are
not imported; the existing approved 16/32 PNGs serve the browser favicon role,
180 PNG serves apple-touch-icon, and 192/512 PNGs serve the manifest icon role.
The master SVG remains the sidebar logo. Brand colors are theme-independent and
are not used as general UI colors. No character artwork or attachment/live logic
is changed.

Integration changes paths, not artwork: emitted files live under the existing
bridge `/assets/` route. The manifest retains the approved names, display and
colors, uses `/assets/brand/` icon URLs, and explicitly sets scope/start_url to `/`.
The bridge supplies PNG/manifest MIME types and permits same-origin manifests in
CSP. Stable brand/manifest names are revalidated rather than cached immutable;
hash-named JS/CSS/character assets retain their existing cache policy.

Vite emits only the explicit nine-file allowlist and manifest, so enabling the
whole public directory cannot accidentally ship unrelated files. `build.rs`
already recursively embeds `web/dist`, including nested brand files. The
owner-free ignored Rust test `assets::tests::embedded_bright_teal_http` exercises
real embedded HTTP handlers after a production web build. Browser checks use a
production-built fake-data App with matching asset routes/CSP and separately
validate favicon links, browser manifest parsing and manifest icon fetches.

No private main history is a parent. Independent delta/privacy review and final
release pairing tests remain required before adoption.
