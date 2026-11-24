# Static design mocks

- **Schedules panel:** `cd web && npm ci && npm run dev`, then open `http://127.0.0.1:5173/schedules-mock.html`. Uses current system `PanelTabs`, `ListRow`, `Button`, `StatusMark`, `Icon`, and `WorkSheet` components with static fixture data. No owner or Core connection is used. See `docs/design/schedules-panel-research.md` for sources, rationale and proposal.

Mocks are design-only previews; their local interactions do not invoke product commands.
