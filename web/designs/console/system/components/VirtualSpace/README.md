# VirtualSpace and VirtualGap

Used by the long-thread reader. `VirtualSpace` is a block as tall as all rows together (measured heights plus an estimate for unmeasured ones) and places the rows being drawn at their offset inside it. `VirtualGap` stands in for a run of rows not read yet, at their estimated height, holding LoadingRows. Neither draws anything itself, and neither has a state, colour or motion. Heights are given in pixels because the scroller's arithmetic is in pixels; use no other component for this.
