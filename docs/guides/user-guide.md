# Shellboy Studio: user guide

Shellboy Studio is a browser interface for a running Shellboy owner. Start the
owner, then run `shellboy-studio` and open the URL printed by the bridge. The URL
contains a credential: do not share it. By default the bridge listens only on
loopback; a remote bind is plain HTTP unless protected by a TLS tunnel.

Use the conversation view to send messages, inspect work and stop a Run. Apps
are small local web applications hosted by Studio. Open Apps to see the app
folder and its README. An agent can create an app there; inspect and test it
before trusting its actions. Actions execute on the Studio host with that
process's environment.

The agent guide is installed at `$SHELLBOY_DATA_DIR/studio/agent-guide.md` when
Studio starts. Studio rewrites it on every startup: edits to that installed copy
are lost. The Apps README is also rewritten. To read the bundled guides without
starting the bridge, run `shellboy-studio guide user` or
`shellboy-studio guide agent`.
