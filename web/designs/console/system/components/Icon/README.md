# Icon roles

- **Use for:** Render semantic `IconRole` names with default, small or menu size tokens; see the role catalog below.
- **Do not use for:** Use StatusMark for state marks and BrandLogo for branding. Never pass glyph names or paths from callers.
- **Why:** The active theme can remap glyphs without changing what any caller means.
- **Source:** [Studio iconography](../../README.md#iconography) and [Console decisions](../../../../../../docs/design/design-system.md#the-console-design)

Consumers use semantic `IconRole` names only. Glyph names, paths, and the role-to-glyph map are module-private in `Icon`; only the semantic role list is exported. A theme may reuse a glyph for distinct roles or assign a different glyph without changing call sites. Choose `size="default"`, `size="small"`, or `size="menu"`; the SVG dimensions come from `--size-icon`, `--size-icon-small` (15px), and `--size-icon-menu` (16px), respectively.

| IconRole | Meaning and use | Current glyph |
| --- | --- | --- |
| `action.archive` | Archive the current Thread; row action before it is archived. | `archive` |
| `action.unarchive` | Restore an archived Thread; archive-toggle row action. | `archiveRestore` |
| `action.stop` | Stop the active Run; row and Conversation stop controls. | `square` |
| `action.retry` | Retry a recoverable Run; recovery, Analytics, and Settings compaction controls. | `retry` |
| `action.delete` | Delete a Thread after its exact preview is confirmed; destructive last row-menu item. | `trash` |
| `action.editTags` | Open the tag editor for a Thread from any shared row menu. | Lucide `tag` |
| `row.menu` | Open a row’s action menu in the sidebar. | `more` |
| `output.copy` | Copy a command or output to the clipboard. | `copy` |
| `output.copied` | Confirm a successful clipboard copy. | `check` |
| `output.wrap` | Toggle line wrapping in inline shell output. | `wrap` |
| `output.openDetails` | Open the shell execution in the Activity panel. | `openPanel` |
| `menu.checked` | Show that a toggle item in a menu (`menuitemcheckbox`) is on. | Lucide `check` |
| `composer.modelMenu` | Show that the composer model control opens its picker. | `chevronDown` |
| `composer.removeAttachment` | Remove one attachment token from the composer before sending. | `cross` |
| `thread.create` | Create a new Thread from the sidebar. | `plus` |
| `thread.search` | Find a Thread in the sidebar list. | `search` |
| `settings.applicationPanel` | Open or close the application Settings panel from the main header. | `gear` |
| `nav.conversation` | Navigate to Conversation. | `chat` |
| `nav.inbox` | Navigate to Inbox. | `inbox` |
| `nav.apps` | Navigate to Apps from the More menu. | `apps` |
| `nav.branches` | Navigate to Branches from the app navigation More menu. | `branch` |
| `nav.analytics` | Navigate to Analytics from the More menu. | `chart` |
| `nav.settings` | Navigate to Settings from the More menu. | `gear` |
| `nav.openThreadList` | Open the phone Thread-list drawer. | `menu` |
| `nav.more` | Open the phone More navigation menu. | `menu` |
| `panel.back` | Return from panel detail to its tab list. | `arrow-left` |
| `panel.work` | Open conversation activity. | `term` |
| `panel.reply_needed` | Identify a request this Thread should answer. | Lucide `reply` |
| `panel.awaiting_reply` | Identify a request awaiting another recipient. | Lucide `hourglass` |
| `panel.information` | Open Thread analytics. | Lucide `info` |
| `artifact.image` | Identify an artifact with a stored image MIME. | Image |
| `artifact.text` | Identify an artifact with a stored text MIME. | File text |
| `artifact.pdf` | Identify an artifact with a stored PDF MIME. | PDF |
| `artifact.unknown` | Identify an artifact without a recognized stored MIME. | File |
| `artifact.detail` | Open artifact details in the current panel. | Chevron right |
| `settings.appearance` | Identify Appearance settings. | `palette` |
| `settings.general` | Identify the General settings section. | `gear` |
| `settings.connections` | Identify the Connections settings section. | `plug` |
| `settings.compaction` | Identify the Compaction settings section. | `retry` |
| `settings.storage` | Identify the Storage settings section. | `file` |
| `settings.index` | Identify the Index settings section. | `database` |
| `settings.agent` | Identify the Guide registration section. | `file` |
| `settings.studio` | Identify the Studio settings section. | `gear` |
| `analytics.overview` | Identify Analytics overview. | `chart` |
| `analytics.tokens` | Identify token-usage analytics. | `layers` |
| `analytics.compaction` | Identify compaction analytics. | `retry` |
| `analytics.threads` | Identify Thread analytics. | `tree` |
| `analytics.storage` | Identify storage analytics. | `database` |
| `analytics.memory` | Identify memory analytics. | `cube` |
| `analytics.index` | Identify index analytics. | `search` |
| `inbox.openConversation` | Open the related Conversation from an Inbox item. | `arrow` |
| `empty.apps` | Empty Apps catalog state. | `apps` |
| `empty.threadArchive` | No archived Threads or archived Thread matches. | `tree` |
| `empty.organizationItems` | No matching organization tags or directories. | `tree` |
| `empty.inbox` | Empty Inbox state. | `inbox` |
| `empty.noThread` | No Thread is selected for Conversation. | `chat` |
| `empty.conversation` | The selected Conversation has no messages yet. | `chat` |
| `empty.branches` | No branches are available for the selected Thread. | `branch` |
| `empty.panelActivity` | Compact empty state of the conversation panel's Activity tab. | `term` |
| `empty.panelReplies` | Compact empty state of the Reply needed tab. | `reply` |
| `empty.panelAwaiting` | Compact empty state of the Awaiting reply tab. | `hourglass` |
| `empty.panelAttachments` | Compact empty state of the Possessions (attachments) tab. | `attachment` |
| `empty.panelCompactions` | Compact empty state of the compaction history in the panel's information tab. | `retry` |
| `work.group` | Expand or identify a grouped set of work records. | `layers` |
| `work.command` | Identify a command shown in the details pane. | `term` |
| `work.execution` | Default mark for a generic execution/work row. | `cube` |
| `work.notification` | Identify a notification or activity record in Conversation. | `inbox` |
| `conversation.outputLimit` | Identify a provider output-limit stop notice in Conversation. | Lucide `info` |
| `work.unsupported` | Identify an unsupported or unavailable work record. | `file` |
| `work.tool` | Identify a tool call, result, or compressed tool record. | `cube` |
| `work.reasoning` | Identify reasoning metadata without exposing its content. | `bot` |
| `work.interruption` | Identify an interruption/problem record. | `cross` |
| `work.terminal` | Identify a terminal command or shell work record. | `term` |
| `status.complete` | Completed status mark. | `check` |
| `status.failed` | Failed status mark. | `cross` |
| `message.user` | Identify a person as a message sender. | `user` |
| `composer.send` | Send the composed message. | `send` |
| `app.open` | Open an App card. | `arrow` |
| `branch.listItem` | Identify a branch row in Branches. | `branch` |
| `branch.mark` | Identify a branch link on a Conversation row. | `branch` |
| `summary.details` | Expand summary details in the Conversation. | `layers` |
| `tab.close` | Close an application tab. | `cross` |
| `tab.add` | Add an application tab. | `plus` |

Styles are colocated in `system/components/Icon/style.css`.

Styles: style.css in this directory

- `panel.attachment`: the Possessions tab and its attachment rows; denotes a saved attachment, not a download.

Sidebar and shared state roles (Orca sidebar and Lucide semantics):
- `status.running`: in-progress Thread or shell (open rotating arc; stationary when motion is reduced).
- `status.error`: Thread recovery or failure (circle and exclamation).
- `status.waiting`: a Run inside its own wait (circle and center dot).
- `status.awaiting`: needs a human answer (circle help; same outer diameter as every StatusMark).
- `status.complete`: completed (circle check), and `status.failed`: failed (circle alert); all use the same outer diameter.
- `status.idle`: no Thread action needed (empty circle for completed, stopped and idle).
- `thread.pinned`: the pin action.
- `thread.children`: the child disclosure and count.
- `sidebar.filter`: opens list filter controls.
`settings.close` identifies the action to leave Settings; it is rendered as `cross`.

- `group.expand`: expand one sidebar band (Pinned, All or Archive); right-facing chevron.
- `group.collapse`: collapse one sidebar band (Pinned, All or Archive); down-facing chevron.

| `thread.rename` | Edit a Thread title. | `pencil` |

- `panel.threadSettings`: the editable settings for the selected Thread, not application settings.
