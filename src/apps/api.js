// The Shellboy app API, added to every HTML page by the gateway. The page runs sandboxed with an opaque
// origin, so calls and errors go to the frame that hosts it, by postMessage.
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

  // The page has an opaque origin and no session of its own: every call goes through the parent frame.
  let nextId = 1;
  const waiting = new Map();
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || e.data.shellboy !== true || e.data.type !== "reply") return;
    const pending = waiting.get(e.data.id);
    if (!pending) return;
    waiting.delete(e.data.id);
    if (e.data.ok) pending.resolve(e.data.result);
    else {
      const error = e.data.error || {};
      pending.reject(Object.assign(new Error(error.message || "The call failed"), error));
    }
  });
  function call(op, args) {
    if (window.parent === window) return Promise.reject(Object.assign(new Error("Open this app from Apps in Shellboy."), { code: "no_host" }));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      post({ type: "call", id, op, args: args || {} });
    });
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
              if (e.code === "no_host") return;
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
              if (e.code === "no_host") return;
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
