# AppRequest

- **Use for:** Review the exact app request and working folder before creating its Thread.
- **Do not use for:** Use Composer for messages to an existing Thread.
- **Why:** Edits invalidate the review so the submitted request is the one the person actually saw. The caller owns submission and errors.
- **Source:** [Studio app-request review decision](https://github.com/tya5/shellboy-studio/commit/54c387dab0d6d0efb61f3ad17320deb65b8dbb58)

An explicit review step shows the exact request and working folder before a Thread is created. Inputs remain editable; changing either requires reviewing again. The caller owns submission and error state.

Styles are colocated in `system/components/AppRequest/style.css`.

Styles: style.css in this directory
