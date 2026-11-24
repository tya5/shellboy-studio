# Panel detail drill-in

The panel detail is the single selected-record view opened from a right-panel row. Its Back control returns to the same selected section and restores focus to the opener. At phone width it occupies the screen; at wider widths it remains docked in the selected panel. Do not use this variant for route-level navigation or a second independently scrollable overlay.

The existing detail renderer is still screen-owned; extracting its markup into a standalone system component remains design-system debt for #128.
