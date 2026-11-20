A shared row-end overflow menu for sidebar and Threads list rows. Keep the menu's
Manage entry first, then expose only actions allowed by the projected row state.
The Core-backed action handlers remain the mutation authority; this component owns
only mounted pending state, opener focus restoration, and the existing App notice
setter. Do not add direct row mutation controls or a second notification path.
