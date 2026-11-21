import { describe, expect, it } from "vitest";
import { flush } from "../../data/test/harness";
import { createBoundWindow, rig } from "./window-owner";
import { canonicalAttemptId } from "../../data/test/work-fixture";
import { captureConversationInput, captureCurrentWork } from "../src/conversation-input";

describe("production accepted window live retirement", () => {
  it("consumes the captured public history window for the original live attempt", async () => {
    const captured = {
  "original_attempt_id": "43e63032-8cbf-4fda-af1a-f28841228f76",
  "request": {
    "after": 0,
    "before": 99,
    "excerpt_chars": 4096,
    "items": true,
    "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963"
  },
  "result": {
    "items": [
      {
        "context": {
          "created_at": "2026-11-19T09:50:23.687405+00:00",
          "node_id": "9c0b69a4-ccaa-49c4-8eda-56b661d9ea1b",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "state": "present",
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "excerpt": "hi",
        "execution_count": 0,
        "executions_truncated": false,
        "items": [
          {
            "item_identity": "[\"9c0b69a4-ccaa-49c4-8eda-56b661d9ea1b\",\"/content/0\"]",
            "kind": "text",
            "text": "hi",
            "text_complete": true
          }
        ],
        "kind": "user",
        "node_id": "9c0b69a4-ccaa-49c4-8eda-56b661d9ea1b",
        "payload_chars": 61,
        "provenance": {
          "created_at": "2026-11-19T09:50:23.687405+00:00",
          "kind": "user",
          "message": {
            "expect_reply": false
          },
          "origin_thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "sender": {
            "kind": "human",
            "label": "web"
          },
          "source_revision": 0,
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "selection": {
          "current_cwd": "/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03",
          "ordinal": 0,
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963"
        }
      },
      {
        "context": {
          "created_at": "2026-11-19T09:50:23.692897+00:00",
          "node_id": "event-b3ed45d4-6ca3-4768-8c8b-b51cde34d4fe",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "state": "present",
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "excerpt": "Shellboy event v1: {\"event_id\":\"b3ed45d4-6ca3-4768-8c8b-b51cde34d4fe\",\"kind\":\"context_changed\",\"payload\":{\"actor\":{\"kind\":\"human\"},\"change\":{\"run_id\":\"8bc9da13-6c85-411c-ae82-29a5c9568bd2\"},\"kind\":\"run_started\",\"observed_at\":\"2026-11-19T09:50:23.687405+00:00\",\"timezone\":\"+09:00\"}}",
        "execution_count": 0,
        "executions_truncated": false,
        "items": [
          {
            "item_identity": "[\"event-b3ed45d4-6ca3-4768-8c8b-b51cde34d4fe\",\"/content/0\"]",
            "kind": "text",
            "text": "Shellboy event v1: {\"event_id\":\"b3ed45d4-6ca3-4768-8c8b-b51cde34d4fe\",\"kind\":\"context_changed\",\"payload\":{\"actor\":{\"kind\":\"human\"},\"change\":{\"run_id\":\"8bc9da13-6c85-411c-ae82-29a5c9568bd2\"},\"kind\":\"run_started\",\"observed_at\":\"2026-11-19T09:50:23.687405+00:00\",\"timezone\":\"+09:00\"}}",
            "text_complete": true
          }
        ],
        "kind": "event",
        "node_id": "event-b3ed45d4-6ca3-4768-8c8b-b51cde34d4fe",
        "payload_chars": 429,
        "provenance": {
          "created_at": "2026-11-19T09:50:23.692897+00:00",
          "kind": "event",
          "origin_thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "source_revision": 0,
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "selection": {
          "current_cwd": "/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03",
          "ordinal": 1,
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963"
        }
      },
      {
        "context": {
          "created_at": "2026-11-19T09:50:23.693266+00:00",
          "node_id": "event-e5b68b30-a87a-4acc-a3e4-31cee8d67987",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "state": "present",
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "excerpt": "Shellboy event v1: {\"event_id\":\"e5b68b30-a87a-4acc-a3e4-31cee8d67987\",\"kind\":\"context_changed\",\"payload\":{\"actor\":{\"kind\":\"shellboy\"},\"change\":{\"previous_turn_ended_at\":null,\"run_id\":\"8bc9da13-6c85-411c-ae82-29a5c9568bd2\",\"turn_id\":\"8ec11ffd-8c8b-4330-8501-b6a1af5d2173\"},\"kind\":\"turn_started\",\"observed_at\":\"2026-11-19T09:50:23.687405+00:00\",\"timezone\":\"+09:00\"}}",
        "execution_count": 0,
        "executions_truncated": false,
        "items": [
          {
            "item_identity": "[\"event-e5b68b30-a87a-4acc-a3e4-31cee8d67987\",\"/content/0\"]",
            "kind": "text",
            "text": "Shellboy event v1: {\"event_id\":\"e5b68b30-a87a-4acc-a3e4-31cee8d67987\",\"kind\":\"context_changed\",\"payload\":{\"actor\":{\"kind\":\"shellboy\"},\"change\":{\"previous_turn_ended_at\":null,\"run_id\":\"8bc9da13-6c85-411c-ae82-29a5c9568bd2\",\"turn_id\":\"8ec11ffd-8c8b-4330-8501-b6a1af5d2173\"},\"kind\":\"turn_started\",\"observed_at\":\"2026-11-19T09:50:23.687405+00:00\",\"timezone\":\"+09:00\"}}",
            "text_complete": true
          }
        ],
        "kind": "event",
        "node_id": "event-e5b68b30-a87a-4acc-a3e4-31cee8d67987",
        "payload_chars": 518,
        "provenance": {
          "created_at": "2026-11-19T09:50:23.693266+00:00",
          "kind": "event",
          "notification": {
            "kind": "turn_started"
          },
          "origin_thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "source_revision": 0,
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "selection": {
          "current_cwd": "/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03",
          "ordinal": 2,
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963"
        }
      },
      {
        "context": {
          "created_at": "2026-11-19T09:50:23.693545+00:00",
          "node_id": "event-6ddeb06a-6093-49e9-93d2-c48faae8485d",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "state": "present",
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "excerpt": "Shellboy event v1: {\"event_id\":\"6ddeb06a-6093-49e9-93d2-c48faae8485d\",\"kind\":\"context_changed\",\"payload\":{\"actor\":{\"kind\":\"shellboy\"},\"change\":{\"after\":{\"active_space\":null,\"active_state\":null,\"dimension\":null,\"model\":null,\"pause_id\":null,\"pause_kind\":null,\"paused\":false,\"paused_at\":null,\"profile\":null},\"before\":null},\"kind\":\"index_state\",\"observed_at\":\"2026-11-19T09:50:23.691927+00:00\",\"timezone\":\"+09:00\"}}",
        "execution_count": 0,
        "executions_truncated": false,
        "items": [
          {
            "item_identity": "[\"event-6ddeb06a-6093-49e9-93d2-c48faae8485d\",\"/content/0\"]",
            "kind": "text",
            "text": "Shellboy event v1: {\"event_id\":\"6ddeb06a-6093-49e9-93d2-c48faae8485d\",\"kind\":\"context_changed\",\"payload\":{\"actor\":{\"kind\":\"shellboy\"},\"change\":{\"after\":{\"active_space\":null,\"active_state\":null,\"dimension\":null,\"model\":null,\"pause_id\":null,\"pause_kind\":null,\"paused\":false,\"paused_at\":null,\"profile\":null},\"before\":null},\"kind\":\"index_state\",\"observed_at\":\"2026-11-19T09:50:23.691927+00:00\",\"timezone\":\"+09:00\"}}",
            "text_complete": true
          }
        ],
        "kind": "event",
        "node_id": "event-6ddeb06a-6093-49e9-93d2-c48faae8485d",
        "payload_chars": 577,
        "provenance": {
          "created_at": "2026-11-19T09:50:23.693545+00:00",
          "kind": "event",
          "origin_thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "source_revision": 0,
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "selection": {
          "current_cwd": "/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03",
          "ordinal": 3,
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963"
        }
      },
      {
        "context": {
          "created_at": "2026-11-19T09:50:23.696906+00:00",
          "node_id": "event-d05ebe13-5fde-4248-8dc0-bc8724d3c2ed",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "state": "present",
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "excerpt": "Shellboy event v1: {\"event_id\":\"d05ebe13-5fde-4248-8dc0-bc8724d3c2ed\",\"kind\":\"context_changed\",\"payload\":{\"actor\":{\"kind\":\"shellboy\",\"run_id\":\"8bc9da13-6c85-411c-ae82-29a5c9568bd2\"},\"change\":{\"after\":{\"hash\":\"instruction-bundle-v1:sha256:787b7232bc2c2fa208c738993d369bf0b0cea4b50dec1dd66adf9a645acabec2\",\"path\":\"/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03/AGENTS.md\",\"present\":true},\"before\":null},\"kind\":\"instructions_observed\",\"observed_at\":\"2026-11-19T09:50:23.695860+00:00\",\"timezone\":\"+09:00\"}}",
        "execution_count": 0,
        "executions_truncated": false,
        "items": [
          {
            "item_identity": "[\"event-d05ebe13-5fde-4248-8dc0-bc8724d3c2ed\",\"/content/0\"]",
            "kind": "text",
            "text": "Shellboy event v1: {\"event_id\":\"d05ebe13-5fde-4248-8dc0-bc8724d3c2ed\",\"kind\":\"context_changed\",\"payload\":{\"actor\":{\"kind\":\"shellboy\",\"run_id\":\"8bc9da13-6c85-411c-ae82-29a5c9568bd2\"},\"change\":{\"after\":{\"hash\":\"instruction-bundle-v1:sha256:787b7232bc2c2fa208c738993d369bf0b0cea4b50dec1dd66adf9a645acabec2\",\"path\":\"/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03/AGENTS.md\",\"present\":true},\"before\":null},\"kind\":\"instructions_observed\",\"observed_at\":\"2026-11-19T09:50:23.695860+00:00\",\"timezone\":\"+09:00\"}}",
            "text_complete": true
          }
        ],
        "kind": "event",
        "node_id": "event-d05ebe13-5fde-4248-8dc0-bc8724d3c2ed",
        "payload_chars": 715,
        "provenance": {
          "created_at": "2026-11-19T09:50:23.696906+00:00",
          "kind": "event",
          "notification": {
            "kind": "instructions_observed",
            "observation": "first_seen"
          },
          "origin_thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "source_revision": 0,
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "selection": {
          "current_cwd": "/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03",
          "ordinal": 4,
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963"
        }
      },
      {
        "context": {
          "created_at": "2026-11-19T09:50:23.697156+00:00",
          "node_id": "context-ee840f73-8865-4f6c-a0c3-1fd2e704fd14",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "state": "present",
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "excerpt": "Shellboy context v1: thread=14f6e9d8-21e8-40e3-87fb-480d5ae0d963 run=8bc9da13-6c85-411c-ae82-29a5c9568bd2 turn=8ec11ffd-8c8b-4330-8501-b6a1af5d2173 cwd=/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03 connection=local model=mock effort=None; AGENTS reference=/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03/AGENTS.md",
        "execution_count": 0,
        "executions_truncated": false,
        "items": [
          {
            "item_identity": "[\"context-ee840f73-8865-4f6c-a0c3-1fd2e704fd14\",\"/content/0\"]",
            "kind": "text",
            "text": "Shellboy context v1: thread=14f6e9d8-21e8-40e3-87fb-480d5ae0d963 run=8bc9da13-6c85-411c-ae82-29a5c9568bd2 turn=8ec11ffd-8c8b-4330-8501-b6a1af5d2173 cwd=/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03 connection=local model=mock effort=None; AGENTS reference=/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03/AGENTS.md",
            "text_complete": true
          }
        ],
        "kind": "context",
        "node_id": "context-ee840f73-8865-4f6c-a0c3-1fd2e704fd14",
        "payload_chars": 479,
        "provenance": {
          "created_at": "2026-11-19T09:50:23.697156+00:00",
          "kind": "context",
          "origin_thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "source_revision": 0,
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "selection": {
          "current_cwd": "/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03",
          "ordinal": 5,
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963"
        }
      },
      {
        "context": {
          "created_at": "2026-11-19T09:50:23.707429+00:00",
          "node_id": "01acdd4a-18cd-4201-93a5-2d37caa39a9a",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "state": "present",
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "excerpt": "Hello world",
        "execution_count": 0,
        "executions_truncated": false,
        "items": [
          {
            "item_identity": "[\"01acdd4a-18cd-4201-93a5-2d37caa39a9a\",\"/output/0/content/0\"]",
            "kind": "text",
            "text": "Hello world",
            "text_complete": true
          }
        ],
        "kind": "assistant_response",
        "node_id": "01acdd4a-18cd-4201-93a5-2d37caa39a9a",
        "payload_chars": 172,
        "provenance": {
          "attempt_id": "43e63032-8cbf-4fda-af1a-f28841228f76",
          "created_at": "2026-11-19T09:50:23.707429+00:00",
          "kind": "assistant_response",
          "origin_thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
          "run_id": "8bc9da13-6c85-411c-ae82-29a5c9568bd2",
          "source_revision": 0,
          "turn_id": "8ec11ffd-8c8b-4330-8501-b6a1af5d2173"
        },
        "selection": {
          "current_cwd": "/tmp/studio24-producer-capture.JTMAKX/tmp/shellboy-studio-it-c9c3db30-2947-44a7-9d1d-64e748160c03",
          "ordinal": 6,
          "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963"
        }
      }
    ],
    "revision": 7,
    "thread_id": "14f6e9d8-21e8-40e3-87fb-480d5ae0d963",
    "total": 7
  }
};
    const f = await rig(0, { threadId: captured.result.thread_id });
    const attempt = captured.original_attempt_id;
    const unmatchedAttempt = "unmatched-live-sentinel";
    try {
      f.w.bindCurrentThread(f.handle);
      f.t.push({ t: "live", thread_id: captured.result.thread_id, attempt_id: unmatchedAttempt, gap: false, deltas: [{ offset: 0, reasoning: false, text: "UNMATCHED_LIVE_SENTINEL" }] });
      await flush(8);
      expect(f.handle.handoff.value.filter(record => record.attemptId === unmatchedAttempt)).toHaveLength(1);
      const call = f.calls().find(item => item.command === "history.window" && !f.owner.answered.has(item.id));
      expect(call).toBeDefined();
      expect(call!.args).toEqual(captured.request);
      f.t.push({ t: "live", thread_id: captured.result.thread_id, attempt_id: attempt, gap: false, deltas: [{ offset: 0, reasoning: false, text: "captured live" }] });
      await flush(8);
      expect(f.handle.handoff.value.filter(record => record.attemptId === attempt)).toHaveLength(1);
      f.owner.answered.add(call!.id);
      f.t.ok(call!.id, captured.result);
      await flush(8);
      const saved = captured.result.items.filter((item: any) => item.kind === "assistant_response" && item.excerpt === "Hello world");
      expect(saved).toHaveLength(1);
      const savedNode = saved.at(0);
      expect(savedNode).toBeDefined();
      if (!savedNode) throw new Error("expected saved assistant response");
      const savedId = savedNode.node_id;
      expect(savedNode.provenance?.attempt_id).toBe(attempt);
      const afterSources = f.w.acceptedView.peek().displayPlan?.entries.map(entry => entry.item.source) ?? [];
      const prose = afterSources.flatMap(source =>
        !("domain" in source) && source.nodeId === savedId && source.kind === "text" ? [source.text] : []
      );
      expect(prose).toEqual(["Hello world"]);
      expect(f.handle.handoff.value.filter(record => record.attemptId === attempt)).toHaveLength(0);
      expect(f.handle.handoff.value.filter(record => record.attemptId === unmatchedAttempt)).toHaveLength(1);
      const tail = f.w.acceptedView.peek().displayPlan?.localRegion.tailRows;
      expect(tail?.flatMap(row => row.kind === "live" ? [row.item.source.attemptId] : [])).toEqual([unmatchedAttempt]);
    } finally { f.w.dispose(); f.data.stop(); }
  });
  it("releases the matching live attempt only after accepted saved rows commit", async () => {
    const f = await rig(20);
    f.owner.decorate = (i, item) => i === 19 ? { ...item, kind: "assistant_response", provenance: { attempt_id: canonicalAttemptId(1) } } : item;
    f.w.bindCurrentThread(f.handle);
    f.t.push({ t: "live", thread_id: "t", attempt_id: canonicalAttemptId(1), gap: false, deltas: [{ offset: 0, reasoning: false, text: "live answer" }] });
    await flush();
    expect(f.handle.handoff.value.some(record => record.attemptId === canonicalAttemptId(1))).toBe(true);
    f.w.changed();
    await f.settle();
    expect(f.handle.handoff.value.some(record => record.attemptId === canonicalAttemptId(1))).toBe(false);
    f.w.dispose();
    f.data.stop();
  });

  it("accepted plan multiplicity retires one matching live record from one to zero", async () => {
    const f = await rig(20);
    const attempt = canonicalAttemptId(1);
    f.w.bindCurrentThread(f.handle);
    f.w.bindConversationInput(snapshot => captureConversationInput(snapshot, {
      scope: "history", threadId: "t", records: f.handle.handoff.value,
      work: captureCurrentWork("t", undefined), current: () => true,
    }));
    f.t.push({ t: "live", thread_id: "t", attempt_id: attempt, gap: false, deltas: [{ offset: 0, reasoning: false, text: "live answer" }] });
    await flush();
    f.w.changed();
    await f.settle();
    const liveEntries = () => f.w.acceptedView.peek().displayPlan?.localRegion.tailRows.filter(entry => {
      if (entry.kind !== "live") return false;
      const source = entry.item.source;
      return "domain" in source && source.domain === "live" && source.attemptId === attempt;
    }) ?? [];
    expect(liveEntries()).toHaveLength(1);
    expect(f.handle.handoff.value.filter(record => record.attemptId === attempt)).toHaveLength(1);
    f.owner.decorate = (i, item) => i === 19 ? { ...item, kind: "assistant_response", provenance: { attempt_id: attempt } } : item;
    f.w.changed();
    await f.settle();
    const accepted = f.w.acceptedView.peek();
    expect(accepted.rows.filter(row => row.node_id === f.owner.nodeId(19))).toHaveLength(1);
    expect(accepted.displayPlan?.entries.filter(entry => entry.item.source.nodeId === f.owner.nodeId(19))).toHaveLength(1);
    expect(liveEntries()).toHaveLength(0);
    expect(f.handle.handoff.value.filter(record => record.attemptId === attempt)).toHaveLength(0);
    f.w.dispose();
    f.data.stop();
  });
});


it('preserves missing, mismatched, foreign-scope, and revoked live records while retiring only the matching attempt',async()=>{
 const f=await rig(2);const match=canonicalAttemptId(1),other=canonicalAttemptId(2);f.w.bindCurrentThread(f.handle);
 f.t.push({t:'live',thread_id:'t',attempt_id:match,gap:false,deltas:[{offset:0,reasoning:false,text:'matching'}]});
 f.t.push({t:'live',thread_id:'t',attempt_id:other,gap:false,deltas:[{offset:0,reasoning:false,text:'other'}]});await flush();
 expect(f.handle.handoff.value.map(record=>record.attemptId)).toEqual(expect.arrayContaining([match,other]));
 f.owner.decorate=(i,item)=>i===1?{...item,kind:'assistant_response',provenance:{attempt_id:match}}:item;f.w.changed();await f.settle();
 expect(f.handle.handoff.value.some(record=>record.attemptId===match)).toBe(false);expect(f.handle.handoff.value.some(record=>record.attemptId===other)).toBe(true);
 const before=f.handle.handoff.value.length;f.w.acceptedView.revoke();f.owner.append(1);f.w.changed();await f.settle();
 expect(f.handle.handoff.value.length).toBeGreaterThanOrEqual(before);f.w.dispose();f.data.stop();
});


async function liveCase(attempt:string){const f=await rig(2);f.w.bindCurrentThread(f.handle);f.t.push({t:'live',thread_id:'t',attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:attempt}]});await flush();return f}

it('missing attempt provenance preserves live identity through production commit',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'}}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});
it('different attempt preserves live identity through production commit',async()=>{const attempt=canonicalAttemptId(1),other=canonicalAttemptId(2),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:other}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});
it('foreign current handle does not retire the old live identity',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt),foreign=await rig(2);try{const before=f.handle.handoff.value[0]!;expect(f.w.bindCurrentThread(foreign.handle)).toBe(false);f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:attempt}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop();foreign.w.dispose();foreign.data.stop()}});
it('revoke preserves live identity before a publication reply arrives',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.w.acceptedView.revoke();f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:attempt}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true);expect(f.w.acceptedView.isCurrent(f.w.acceptedView.peek())).toBe(false)}finally{f.w.dispose();f.data.stop()}});


it("semantic lease cancellation rejects publication and preserves accepted ref/live identity", async () => {
 const attempt=canonicalAttemptId(1),f=await rig(2);let w!:typeof f.w;try{
 f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:"live"}]});await flush();f.w.dispose();
 let armed=false,phase="idle";
 const input={state:f.producer,capture:(snapshot:import("../src/window").WindowAcceptedSnapshot)=>captureConversationInput(snapshot,{scope:f.handle.threadId,threadId:f.handle.threadId,records:f.handle.handoff.value,work:captureCurrentWork(f.handle.threadId,f.handle.work.value.value),current:()=>{
  if(!armed)return w.isCurrentThread(f.handle);
  if(phase==="capture"){phase="lease";return w.isCurrentThread(f.handle);}
  f.handle.cancelReads();return true;
 }})};
 w=createBoundWindow({read:(args,cancel)=>f.handle.readWindow(args,cancel)},f.handle,input);await f.settle();
 const beforeRef=w.acceptedView.peek(),beforeRows=beforeRef.rows,before=f.handle.handoff.value[0]!;
 f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:canonicalAttemptId(2),gap:false,deltas:[{offset:0,reasoning:false,text:"semantic change"}]});await flush();
 const afterSecond=f.handle.handoff.value.slice();expect(beforeRows.length).toBeGreaterThan(0);expect(afterSecond).toHaveLength(2);expect(w.acceptedView.isCurrent(beforeRef)).toBe(true);
 armed=true;phase="capture";expect(w.refreshConversationInput(beforeRef)).toBe(false);expect(w.acceptedView.peek()).toBe(beforeRef);expect(w.acceptedView.peek().rows).toBe(beforeRows);expect(f.handle.handoff.value).toHaveLength(afterSecond.length);expect(f.handle.handoff.value[0]).toBe(afterSecond[0]);expect(f.handle.handoff.value[1]).toBe(afterSecond[1]);
 }finally{w?.dispose();f.data.stop();}
});

it("semantic callback rebind rejection preserves accepted ref/rows/live identity", async () => {
 const attempt=canonicalAttemptId(1),f=await rig(2),foreign=await rig(2);let w!:typeof f.w;try{
 f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:"live"}]});await flush();f.w.dispose();let armed=false,phase="idle",callbackHits=0;
 const input={state:f.producer,capture:(snapshot:import("../src/window").WindowAcceptedSnapshot)=>captureConversationInput(snapshot,{scope:f.handle.threadId,threadId:f.handle.threadId,records:f.handle.handoff.value,work:captureCurrentWork(f.handle.threadId,f.handle.work.value.value),current:()=>{callbackHits++;if(!armed)return w.isCurrentThread(f.handle);if(phase==="capture"){phase="lease";return w.isCurrentThread(f.handle);}expect(w.bindCurrentThread(foreign.handle)).toBe(false);return true;}})};
 w=createBoundWindow({read:(args,cancel)=>f.handle.readWindow(args,cancel)},f.handle,input);await f.settle();f.producer.advance(canonicalAttemptId(2));await flush();expect(w.bindCurrentThread(f.handle)).toBe(true);const beforeRef=w.acceptedView.peek(),beforeRows=beforeRef.rows,before=f.handle.handoff.value[0]!;expect(beforeRows.length).toBeGreaterThan(0);armed=true;phase="capture";expect(w.refreshConversationInput(beforeRef)).toBe(false);expect(w.acceptedView.peek()).toBe(beforeRef);expect(w.acceptedView.peek().rows).toBe(beforeRows);expect(f.handle.handoff.value.some(record=>record===before)).toBe(true);expect(callbackHits).toBeGreaterThanOrEqual(2);
 }finally{w?.dispose();f.data.stop();foreign.w.dispose();foreign.data.stop();}
});

it("semantic false rejects publication with seeded accepted ref/live identity", async () => {
 const attempt=canonicalAttemptId(1),f=await rig(2);let w!:typeof f.w;try{f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:"live"}]});await flush();f.w.dispose();let armed=false;
 const input={state:f.producer,capture:(snapshot:import("../src/window").WindowAcceptedSnapshot)=>captureConversationInput(snapshot,{scope:f.handle.threadId,threadId:f.handle.threadId,records:f.handle.handoff.value,work:captureCurrentWork(f.handle.threadId,f.handle.work.value.value),current:()=>armed?false:w.isCurrentThread(f.handle)})};
 w=createBoundWindow({read:(args,cancel)=>f.handle.readWindow(args,cancel)},f.handle,input);await f.settle();
 const beforeRef=w.acceptedView.peek(),before=f.handle.handoff.value[0]!;armed=true;expect(w.refreshConversationInput(beforeRef)).toBe(false);expect(w.acceptedView.peek()).toBe(beforeRef);expect(f.handle.handoff.value.some(record=>record===before)).toBe(true);}finally{w?.dispose();f.data.stop();}
});

it('rejected publication reply preserves accepted ref and live identity',async()=>{
 const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const beforeRef=f.w.acceptedView.peek(),before=f.handle.handoff.value[0]!;f.owner.append(1);f.w.changed();await flush();const call=f.calls().filter(item=>item.command==='history.window'&&!f.owner.answered.has(item.id)).at(-1);expect(call).toBeDefined();f.w.acceptedView.revoke();f.owner.answered.add(call!.id);const answer=f.owner.answer(call!);expect(answer.ok).toBe(true);if(answer.ok)f.t.ok(call!.id,answer.result);await flush(8);expect(f.w.acceptedView.peek()).toBe(beforeRef);expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});

it("preserves canonical prefix and captured live suffix across accepted replacement", async () => {
 const f=await rig(18),a=canonicalAttemptId(1),b=canonicalAttemptId(2),c=canonicalAttemptId(3);
 try {
  f.w.bindCurrentThread(f.handle);
  for (const attempt of [a,b,c]) f.t.push({t:"live",thread_id:"t",attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:attempt}]});
  await flush();f.w.changed();await f.settle();
  const ids = () => {
   const plan = f.w.acceptedView.peek().displayPlan!;
   return [...plan.entries.map(entry => entry.item.source.nodeId), ...plan.localRegion.tailRows.flatMap(row => row.kind === "live" && "domain" in row.item.source ? [row.item.source.recordId] : [])];
  };
  const before=ids(), prefix=before.slice(0,18), liveA=`handoff:${a}`,liveB=`handoff:${b}`,liveC=`handoff:${c}`;
  expect(before).toEqual([...prefix,liveA,liveB,liveC]);
  const beforeB=f.handle.handoff.value.find(record=>record.attemptId===b)!,beforeC=f.handle.handoff.value.find(record=>record.attemptId===c)!;
  f.owner.append(2);
  f.owner.decorate=(i,item)=>i===18?{...item,kind:"assistant_response",provenance:{attempt_id:a},items:[{kind:"text",item_identity:"first",text:"A1",text_complete:true},{kind:"text",item_identity:"second",text:"A2",text_complete:true}]}:i===19?{...item,kind:"user",items:[{kind:"text",item_identity:"next",text:"Next user",text_complete:true}]}:item;
  f.w.changed();await f.settle(()=>f.w.acceptedView.peek().revision===f.owner.revision && f.w.acceptedView.peek().rows.some(row=>row.node_id===f.owner.nodeId(18)));
  const savedA=f.owner.nodeId(18),nextUser=f.owner.nodeId(19),expected=[...prefix,savedA,savedA,nextUser,liveB,liveC];
  expect(ids()).toEqual(expected);expect(f.handle.handoff.value.find(record=>record.attemptId===a)).toBeUndefined();
  expect(f.handle.handoff.value.find(record=>record.attemptId===b)).toBe(beforeB);expect(f.handle.handoff.value.find(record=>record.attemptId===c)).toBe(beforeC);
  f.w.changed();await f.settle();expect(ids()).toEqual(expected);expect(f.handle.handoff.value.find(record=>record.attemptId===b)).toBe(beforeB);expect(f.handle.handoff.value.find(record=>record.attemptId===c)).toBe(beforeC);
 } finally { f.w.dispose();f.data.stop(); }
});

it("observes actual batch visibility across a live delta and fresh same-window cut", async () => {
 const a=canonicalAttemptId(1),f=await liveCase(a);let w!:typeof f.w;
 try {
  f.w.dispose();let armed=false,phase=0,leaseChecks=0;const trace:string[]=[];
  const input={state:f.producer,capture:(snapshot:import("../src/window").WindowAcceptedSnapshot)=>{const records=f.handle.handoff.value;trace.push(`capture:${records.length}`);return captureConversationInput(snapshot,{scope:f.handle.threadId,threadId:f.handle.threadId,records,work:captureCurrentWork(f.handle.threadId,f.handle.work.value.value),current:()=>{const current=w.isCurrentThread(f.handle)&&f.handle.handoff.peek()===records;if(!armed)return current;if(phase===0){phase=1;trace.push("capture-current");return current;}if(phase===1){phase=2;leaseChecks++;trace.push(`lease-current:${records.length}`);return current;}return current;}})}};
  w=createBoundWindow({read:(args,cancel)=>f.handle.readWindow(args,cancel)},f.handle,input);await f.settle();
  const beforeRef=w.acceptedView.peek(),beforeRecords=f.handle.handoff.value,beforeRecord=beforeRecords.find(record=>record.attemptId===a)!;const beforeEpoch=f.handle.liveEpoch(),beforeCapability=w.acceptedView.currentCapability;expect(beforeRef.rows.length).toBeGreaterThan(0);expect(beforeRecords.length).toBeGreaterThan(0);expect(beforeRecord.text).toBe(a);armed=true;f.producer.emitLive(a,Array.from(beforeRecord.text).length,`-delta`);trace.push("delta-event");
  const committed=w.refreshConversationInput(beforeRef);trace.push(`commit:${committed}`);expect(committed).toBe(true);expect(phase).toBe(2);expect(leaseChecks).toBe(1);const duringRef=w.acceptedView.peek(),duringRecords=f.handle.handoff.value;expect(duringRef).not.toBe(beforeRef);expect(w.acceptedView.isCurrent(beforeRef)).toBe(false);expect(f.handle.liveEpoch()).toBe(beforeEpoch);expect(w.acceptedView.currentCapability).toBe(beforeCapability);
  await flush();const afterRecords=f.handle.handoff.value,afterRecord=afterRecords.find(record=>record.attemptId===a)!;trace.push(`after-batch:${afterRecords.length}`);expect(afterRecord.text).toContain(`${a}-delta`.slice(0,3));expect(afterRecords).not.toBe(beforeRecords);expect(duringRecords).toBe(afterRecords);expect(trace).toContain("delta-event");
  expect(w.refreshConversationInput(duringRef)).toBe(true);expect(w.acceptedView.peek().displayPlan?.localRegion.tailRows.some(entry=>entry.kind==="live"&&entry.item.source.attemptId===a)).toBe(true);expect(w.acceptedView.isCurrent(duringRef)).toBe(true);expect(f.handle.liveEpoch()).toBe(beforeEpoch);expect(w.acceptedView.currentCapability).toBe(beforeCapability);
 } finally { w?.dispose();f.data.stop(); }
});

it("collapses a saved tool association without leaving a matching live preview", async () => {
 const attempt=canonicalAttemptId(4),f=await rig(3);
 try {
  f.producer.advance(attempt);await flush();f.w.changed();await f.settle();const beforeRef=f.w.acceptedView.peek(),beforeRecord=f.handle.handoff.value.find(record=>record.attemptId===attempt)!;expect(beforeRecord).toBeDefined();
  f.owner.append(1);
  f.owner.decorate=(i,item)=>i===0?{...item,kind:"assistant_response",items:[{kind:"tool_call",item_identity:"tool",execution_ids:["shared"]}]}:i===3?{...item,kind:"assistant_response",provenance:{attempt_id:attempt},items:[{kind:"tool_call",item_identity:"tool",execution_ids:["shared"]}]}:item;
  f.w.changed();await f.settle(()=>f.w.acceptedView.peek().revision===f.owner.revision&&f.w.acceptedView.peek().rows.some(row=>row.node_id===f.owner.nodeId(3)));
  const entries=f.w.acceptedView.peek().displayPlan?.entries ?? [];
  expect(entries.some(entry=>"domain" in entry.item.source&&entry.item.source.attemptId===attempt)).toBe(false);
  expect(entries.filter(entry=>entry.item.source.nodeId===f.owner.nodeId(0)&&entry.item.source.kind==="tool")).toHaveLength(1);expect(f.w.acceptedView.peek()).not.toBe(beforeRef);
  expect(entries.some(entry=>entry.item.source.nodeId===f.owner.nodeId(2))).toBe(true);
  expect(f.handle.handoff.value.some(record=>record.attemptId===attempt)).toBe(false);
 }finally{f.w.dispose();f.data.stop();}
});
