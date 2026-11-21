# ThreadDeleteDialog

The screen mounts one keyed dialog only while a target is selected. Preview state
lives in that dialog instance and is discarded synchronously on confirmation or
close. The dialog renders named typed counts, running and stopping Run counts,
and the preview-marker availability label. Unknown values remain `unknown`;
confirmation requires both `deletable_now` and the exact marker, passed unchanged
to `thread.delete`.
