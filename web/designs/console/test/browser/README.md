# Browser fixture tooling

Browser checks use synthetic fixtures and a fresh, runner-owned profile. Every Chrome or Chromium launch must pass `--use-mock-keychain` and `--password-store=basic` so automation never prompts to access the user's macOS keychain. Never point a harness at the user's browser profile or attach it to an installed browser.

Screenshot files are generated evidence, not source artifacts; write them to a new temporary or explicitly supplied output directory and do not commit them. Each runner owns and stops the browser and any Vite server it starts, including on failure.
