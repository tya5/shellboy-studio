# Studio v0.2.3 Release Preparation

The feature source is exactly `98a0f03f028b8b0b56eaae4b00a11b3a39922ed3`.
This preparation child changes only package version, its lockfile version and
this status note. Core remains pinned to published v0.11.2, exact
`942284c27e867091fe23d07babb0103c2cb6507a`.

The increment to v0.2.3 is required because v0.2.2 is already immutably tagged
at `84178ffb0e0fb2659bcd0c8a73adf8189824cf6f`. That tag and its private draft
remain preserved historical candidates, not current published or installed
releases. The new version does not authorize additional feature scope. The
v0.2.2 readiness note records that earlier candidate and is not current status.

The added store API qualifies one owned handle in an explicitly fixed non-App
diagnostic session. A single original token remains fixed; fresh accepted
references do not reacquire authority. This does not establish arbitrary App
navigation authority or continuous validity across lifecycle transitions.

Independent source/control acceptance of the API is not release acceptance.
Final release-child privacy/source review and fresh same-SHA all-OS CI are
required. Previous v0.2.2 CI and pixels are not same-source evidence. T may bind
the immutable feature source only after checking release-child product-tree
identity. Actual-root qualification remains a separate pending gate.

No new tag, publication or swap is authorized by this preparation. Preserve
all failed and unavailable measurements. The installed Studio version and
externally managed Core owners remain untouched; never signal, install,
restart or roll back a Core owner from an agent shell.
