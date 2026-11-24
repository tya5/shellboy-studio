# ThreadCard

- **Use for:** Summarize one Thread for scanning in Monitor: status, title, relationships and the relevant action.
- **Do not use for:** Use MonitorTile for a live tail preview and ThreadItem for the sidebar.
- **Why:** A compact card supports scanning many Threads without opening each conversation.
- **Source:** [Studio #83](https://github.com/tya5/shellboy-studio/issues/83)

Summarizes one Thread on the Monitor view.

Provide the state, elapsed time, title, a one-line description, recent activity lines and the parent or child count. Use `lead` for a Thread with children, `need` when it awaits a person, `err` for error (recovery or failed). Keep at most three activity lines. Offer the action the state calls for.

Styles: style.css in this directory
