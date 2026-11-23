# StatusMark

- **Use for:** Show a Thread's attention category from `statusOfActivity`, plus the existing pending-reply projection. For shell execution use the shell variant and `statusOfShell`.
- **Do not use for:** Use unread title emphasis for new results and ContextRing for context use. Do not infer Retry from the error mark or infer shell outcomes from Thread marks.
- **Why:** Five shapes make active work and attention distinct at a glance without treating every way a Run ends as a new visual category.
- **Source:** [Approved Studio #83 decision](https://github.com/tya5/shellboy-studio/issues/83), [Conductor](https://www.conductor.build/), [Material circular indeterminate](https://mui.com/material-ui/react-progress/#circular-indeterminate), and [shadcn Spinner](https://ui.shadcn.com/docs/components/spinner).

| Thread mark | Meaning and shape |
| --- | --- |
| Running | Work in progress; accent arc, static but still gapped under reduced motion. |
| Awaiting | A person needs to answer; `wait` ring and question mark. |
| Error | Recovery or failed; `bad` ring and exclamation. Retry remains a separate owner-qualified action. |
| Waiting | The Run is inside its own `shellboy wait`; muted ring and center point. |
| No action needed | Completed, stopped, or idle; empty muted ring. |

Use a 15 px box. Static ring shapes use a 1.5 px non-scaling stroke. The running arc uses 2.4 in its 24-unit viewBox so the gap survives and the stroke resolves to 1.5 px in the 15 px box. The intentionally compact ChildrenChip keeps its existing sizing and row controls. Shell completed and failed remain distinct; conversation footer wording is unchanged.

Styles: style.css in this directory
