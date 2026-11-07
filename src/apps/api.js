// The Shellboy app API, added to every HTML page by the gateway. Relative URLs only: an app never
// knows its origin. Errors go to the frame that hosts the app, which shows them.
(function () {
  "use strict";
  if (window.shellboy) return;
  const post = (message) => {
    if (window.parent !== window) window.parent.postMessage({ shellboy: true, ...message }, "*");
  };
  const fail = (kind, message, where) => post({ type: "error", kind, message: String(message).slice(0, 2000), where: where ? String(where).slice(0, 400) : undefined });
  window.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t !== window && (t.src || t.href)) fail("load", `Couldn't load ${t.src || t.href}`, t.tagName);
    else fail("script", e.message, e.filename ? `${e.filename}:${e.lineno}` : undefined);
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    fail("promise", r && r.message ? r.message : r, r && r.stack ? r.stack.split("\n")[1] : undefined);
  });
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || e.data.shellboy !== true) return;
    if (e.data.type === "theme" && typeof e.data.theme === "string") document.documentElement.dataset.ds = e.data.theme;
  });

  async function call(op, args) {
    let res;
    try {
      res = await fetch("/_shellboy/call", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ op, args: args || {} }) });
    } catch (cause) {
      throw Object.assign(new Error("The gateway isn't reachable"), { code: "gateway_unreachable", cause });
    }
    if (res.status === 401) {
      fail("session", "This app's session ended. Reopen it from Apps.");
      throw Object.assign(new Error("This app's session ended. Reopen it from Apps."), { code: "no_session" });
    }
    const body = await res.json();
    if (body.ok) return body.result;
    const error = body.error || {};
    throw Object.assign(new Error(error.message || op + " failed"), error);
  }

  const shellboy = {
    app: undefined,
    ready: undefined,
    data: {
      read: (path) => call("data.read", { path }),
      write: (path, text, options) => call("data.write", { path, text, ...(options && "hash" in options ? { hash: options.hash, check: true } : {}) }),
      list: (path) => call("data.list", path ? { path } : {}),
      onChange(fn) {
        let stopped = false;
        (async () => {
          let delay = 1000;
          let version;
          while (!stopped) {
            try {
              const out = await call("data.wait", version === undefined ? {} : { version });
              version = out.version;
              delay = 1000;
              if (!stopped && out.changed) fn(out);
            } catch (e) {
              if (e.code === "no_session") return;
              await new Promise((r) => setTimeout(r, delay));
              delay = Math.min(delay * 2, 10000);
            }
          }
        })();
        return () => { stopped = true; };
      },
    },
    thread: {
      send: (text, options) => call("thread.send", { text, ...options }),
      get: (thread) => call("thread.get", thread ? { thread } : {}),
      messages: (options) => call("thread.messages", options),
      onChange(fn, options) {
        let stopped = false;
        const watch = { ...(options && options.thread ? { thread: options.thread } : {}), list: !!(options && options.list) };
        (async () => {
          let delay = 1000;
          while (!stopped) {
            try {
              const out = await call("events.wait", watch);
              delay = 1000;
              if (!stopped && out.changed) fn(out);
            } catch (e) {
              if (e.code === "no_session") return;
              await new Promise((r) => setTimeout(r, delay));
              delay = Math.min(delay * 2, 10000);
            }
          }
        })();
        return () => { stopped = true; };
      },
    },
    threads: { list: (options) => call("threads.list", options) },
    run: (action, args, options) => call("run", { action, args: args === undefined ? null : args, ...(options && options.timeoutMs ? { timeout_ms: options.timeoutMs } : {}) }),
  };
  shellboy.ready = call("app.info").then((info) => { shellboy.app = info; return info; });
  shellboy.ready.catch(() => {});
  window.shellboy = shellboy;
  post({ type: "ready" });
})();
