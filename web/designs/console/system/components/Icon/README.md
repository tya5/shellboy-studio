# Icon roles

Consumers use semantic `IconRole` names only. Glyph names, paths, and the role-to-glyph map are module-private in `Icon`; only the semantic role list is exported. A theme may reuse a glyph for distinct roles or assign a different glyph without changing call sites. Choose `size="default"`, `size="small"`, or `size="menu"`; the SVG dimensions come from `--size-icon`, `--size-icon-small` (15px), and `--size-icon-menu` (16px), respectively.

| IconRole | Meaning and use | Current glyph |
| --- | --- | --- |
| `action.archive` | Archive the current Thread; row action before it is archived. | `archive` |
| `action.unarchive` | Restore an archived Thread; archive-toggle row action. | `archiveRestore` |
| `action.stop` | Stop the active Run; row and Conversation stop controls. | `square` |
| `action.retry` | Retry a recoverable Run; recovery, Monitor, Analytics, and Settings compaction controls. | `retry` |
| `action.delete` | Delete a Thread after its exact preview is confirmed; destructive last row-menu item. | `trash` |
| `action.clearStatusFilter` | Remove one status filter chip in Monitor. | `cross` |
| `action.clearQueryFilter` | Clear the active query filter chip in Monitor. | `cross` |
| `action.clearArchiveFilter` | Remove the archive filter chip in Monitor. | `cross` |
| `row.menu` | Open a row’s action menu in the sidebar or Threads list. | `more` |
| `thread.create` | Create a new Thread from the sidebar. | `plus` |
| `thread.search` | Find a Thread in the sidebar list. | `search` |
| `settings.applicationPanel` | Open or close the application Settings panel from the main header. | `gear` |
| `organization.search` | Filter the Threads organization view. | `search` |
| `nav.conversation` | Navigate to Conversation. | `chat` |
| `nav.monitor` | Navigate to Monitor. | `monitor` |
| `nav.inbox` | Navigate to Inbox. | `inbox` |
| `nav.apps` | Navigate to Apps from the More menu. | `apps` |
| `nav.branches` | Navigate to Branches from the More menu. | `branch` |
| `nav.threads` | Navigate to Threads from the More menu. | `tree` |
| `nav.analytics` | Navigate to Analytics from the More menu. | `chart` |
| `nav.settings` | Navigate to Settings from the More menu. | `gear` |
| `nav.openThreadList` | Open the phone Thread-list drawer. | `menu` |
| `nav.more` | Open the phone More navigation menu. | `menu` |
| `panel.back` | Return from panel detail to its tab list. | `arrow-left` |
| `panel.work` | Open conversation activity. | `term` |
| `panel.reply_needed` | Identify a request this Thread should answer. | Lucide `reply` |
| `panel.awaiting_reply` | Identify a request awaiting another recipient. | Lucide `hourglass` |
| `panel.information` | Open Thread information. | Lucide `info` |
| `settings.category.start` | Identify the Getting started settings group. | `gear` |
| `settings.category.agent` | Identify the Agent settings group. | `bot` |
| `settings.category.display` | Identify the Display settings group. | `palette` |
| `settings.category.data` | Identify the Data settings group. | `database` |
| `settings.category.app` | Identify the This app settings group. | `apps` |
| `settings.appearance` | Identify Appearance settings. | `palette` |
| `settings.general` | Identify the General settings section. | `gear` |
| `settings.connections` | Identify the Connections settings section. | `plug` |
| `settings.compaction` | Identify the Compaction settings section. | `retry` |
| `settings.storage` | Identify the Storage settings section. | `file` |
| `settings.index` | Identify the Index settings section. | `database` |
| `settings.agent` | Identify the Agent settings section. | `file` |
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
| `empty.monitorNoMatches` | No Monitor rows match the current filters. | `monitor` |
| `empty.monitor` | Monitor has no rows. | `monitor` |
| `empty.branches` | No branches are available for the selected Thread. | `branch` |
| `work.group` | Expand or identify a grouped set of work records. | `layers` |
| `work.command` | Identify a command shown in the details pane. | `term` |
| `work.execution` | Default mark for a generic execution/work row. | `cube` |
| `work.notification` | Identify a notification or activity record in Conversation. | `inbox` |
| `work.unsupported` | Identify an unsupported or unavailable work record. | `file` |
| `work.tool` | Identify a tool call, result, or compressed tool record. | `cube` |
| `work.reasoning` | Identify reasoning metadata without exposing its content. | `bot` |
| `work.interruption` | Identify an interruption/problem record. | `cross` |
| `work.terminal` | Identify a terminal command or shell work record. | `term` |
| `monitor.childThreads` | Indicate child Threads in a Monitor card. | `tree` |
| `monitor.parentThread` | Indicate the parent Thread in a Monitor card. | `tree` |
| `monitor.openConversation` | Open the Monitor card's Conversation. | `arrow` |
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
- `status.running`: work in progress (circle dot).
- `status.awaiting`: needs a human answer (circle help).
- `status.complete`: completed (circle check), and `status.failed`: failed (circle alert).
- `status.idle`: no active Run (dot).
- `thread.pinned`: the pinned group or pin action.
- `thread.children`: the child disclosure and count.
- `group.directory`: a directory heading, not a navigation link.
- `sidebar.filter`: opens list filter controls.
`settings.close` identifies the action to leave Settings; it is rendered as `cross`.

- `group.expand`: expand one sidebar working-directory group; right-facing chevron.
- `group.collapse`: collapse one sidebar working-directory group; down-facing chevron.
