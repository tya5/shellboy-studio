# WorkElementRow

- **Use for:** Render an issued Work member for a tool, reasoning, notification or problem; use the caller's authorized detail body when present.
- **Do not use for:** Use StepRow for ordinary conversation tool rows and ListDivider for category headings; never infer a body or execution status.
- **Why:** Shared member chrome keeps kind metadata out of visible text and reuses only the issuer's actual status.
- **Source:** [Studio issued Work member contract](https://github.com/tya5/shellboy-studio/commit/20a911ad66068d0bc15ecc3965eb689447b0f6f9)

Pass an issued `WorkElementDisplay` through `formatWorkElementDisplay`. Preserve exact reason,
provenance and exit code; show only issued description/time, with kind in accessible text and
tooltip. Real detail policies require caller-owned open state and a bounded authorized body;
empty fragments do not prove a body. Keep watch, identity and lifecycle in the caller. Parent
headers and the wrapper separator stay outside this row. Use the shared 12px inset in Work
lists; the 40px minimum keeps StepRow compatibility. An absent or unavailable detail policy is
noninteractive. The toggle can provide its summary as the focus return target.

Styles: style.css in this directory
