# ThreadDeleteDialog

The screen mounts one keyed dialog only while a target is selected. Preview state
lives in that dialog instance and is discarded on close. It renders typed selection
counts and translated blocker reasons; unknown counts remain unknown. Confirmation
is offered only when deletion is allowed and the exact preview marker exists, and
that marker is passed unchanged to `thread.delete`.
