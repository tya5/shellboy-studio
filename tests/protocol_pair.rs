//! Owner-free, typed wire acceptance for the pinned Core protocol.
#![cfg(feature = "next-shellboy")]
use serde_json::json;
use shellboy::protocol::{
    Command, ErrorCode, IdKind, IdResolveArgs, RunDetails, ThreadDetails, ThreadSummary,
    ThreadTarget,
};
use shellboy_studio::{
    allowlist::{Access, access},
    seam,
};

#[test]
fn thread_list_accepts_created_order_and_cursor() {
    use shellboy::protocol::{ThreadListArgs, ThreadListOrder};
    let args: ThreadListArgs =
        serde_json::from_value(json!({"order":"created","cursor":"next"})).unwrap();
    assert_eq!(args.order, ThreadListOrder::Created);
    assert_eq!(args.cursor.as_deref(), Some("next"));
    let targeted: ThreadListArgs =
        serde_json::from_value(json!({"thread_ids":["t1","t2"]})).unwrap();
    assert_eq!(
        targeted.thread_ids.as_deref(),
        Some(["t1".to_owned(), "t2".to_owned()].as_slice())
    );
}

#[test]
fn exact_protocol_twenty_two_has_directional_reply_counts() {
    assert_eq!(shellboy::protocol::PROTOCOL_VERSION, 22);
    let value = json!({"thread_id":"t", "title":"synthetic", "cwd":"/", "connection":"c",
        "model":"m", "agents_path":"AGENTS.md", "parent_id":"organization", "shells_count":1,
        "summarizing":false, "pending_replies":{"owed_by":{"count":2,"exact":true},"asked_by":{"count":17,"exact":false}}});
    let details: ThreadDetails = serde_json::from_value(value).unwrap();
    assert_eq!(details.pending_replies.owed_by.count, 2);
    assert!(!details.pending_replies.asked_by.exact);
    assert_eq!(details.shells_count, 1);
    assert_eq!(details.parent_id.as_deref(), Some("organization"));
    assert_eq!(
        access(&Command::MessageList(shellboy::protocol::MessageListArgs {
            owed_by: Some("t".into()),
            asked_by: None,
            to: None,
            limit: 16,
            cursor: None,
        })),
        Access::Read
    );
}

#[test]
fn human_overflow_is_a_lower_bound_and_default_exact_is_preserved() {
    let mut value = json!({"thread_id":"t","title":"synthetic","cwd":"/","state":"idle","activity":"idle",
        "latest_run_stop_reason":null,"updated_at":"2026-01-01T00:00:00Z","excerpt":"",
        "awaiting_named_count":16});
    let exact: ThreadSummary = serde_json::from_value(value.clone()).unwrap();
    assert!(exact.awaiting_named_count_exact);
    value["awaiting_named_count"] = json!(17);
    value["awaiting_named_count_exact"] = json!(false);
    let lower: ThreadSummary = serde_json::from_value(value).unwrap();
    assert!(!lower.awaiting_named_count_exact);
    assert_eq!(lower.awaiting_named_count, 17);
}

#[test]
fn old_run_ownership_and_create_inputs_are_not_wire_aliases() {
    let run = json!({"context":{"state":"completed"},"run_id":"r","thread_id":"t","state":"completed","owned_execution_ids":["shell"]});
    let parsed: RunDetails = serde_json::from_value(run.clone()).unwrap();
    assert_eq!(parsed.owned_execution_ids, ["shell"]);
    for field in ["owner_run_id", "owned_run_ids"] {
        let mut invalid = run.clone();
        invalid[field] = json!([]);
        let decoded: RunDetails = serde_json::from_value(invalid).unwrap();
        assert!(serde_json::to_value(decoded).unwrap().get(field).is_none());
    }
    for field in ["owner_run_id", "owned_run_ids"] {
        let mut args = json!({});
        args[field] = json!("old");
        assert!(
            serde_json::from_value::<Command>(json!({"command":"thread.create","args":args}))
                .is_err()
        );
    }
    let reply: Command = serde_json::from_value(
        json!({"command":"message.reply","args":{"message_id":"h","text":"yes"}}),
    )
    .unwrap();
    assert_eq!(access(&reply), Access::Mutation);
    let create: Command = serde_json::from_value(
        json!({"command":"thread.create","args":{"parent_id":"organization"}}),
    )
    .unwrap();
    assert_eq!(access(&create), Access::Mutation);
    assert_eq!(
        serde_json::to_value(ErrorCode::SelfWait).unwrap(),
        "self_wait"
    );
    assert!(serde_json::from_value::<ErrorCode>(json!("wait_cycle")).is_err());
    // This task does not enable a new reasoning stream or change live rendering.
    assert!(!seam::events_args(None, 1).include_reasoning_activity);
}

#[test]
fn protocol_nine_fails_closed_without_downgrade() {
    let command: Command =
        serde_json::from_value(json!({"command":"thread.get","args":{"thread_id":"t"}})).unwrap();
    let mut request = shellboy::protocol::Request::new("synthetic", command);
    assert!(request.validate().is_ok());
    request.protocol_version = 9;
    assert_eq!(
        request.validate().unwrap_err().code,
        ErrorCode::ProtocolMismatch
    );
    let mut response = shellboy::protocol::Response::success("synthetic", json!({}));
    response.protocol_version = 9;
    assert_eq!(
        response.validate().unwrap_err().code,
        ErrorCode::ProtocolMismatch
    );
}

#[test]
fn structural_tool_descriptor_survives_pinned_response_value_and_bridge_frame() {
    // The real IPC/Owner seam is Response<Value>, not HistoryWindow<HistoryItem>.
    // Exercise the pinned envelope decode and the exact websocket encode types,
    // without starting a Core, opening a database or making a provider request.
    let result = json!({"thread_id":"synthetic","revision":"r","total":1,"items":[{
        "node_id":"actual-node","kind":"assistant_response","selection":{"ordinal":0},
        "items":[{"kind":"tool_call","item_identity":"[\"actual-node\",\"/output/0\"]","execution_ids":[],
            "descriptor":{"call_id":"actual-call","call_id_state":"available","name":"lookup","name_state":"available"},
            "detail_availability":"unavailable"}]
    }]});
    let original = shellboy::protocol::Response::success("synthetic-operation", result.clone());
    let encoded = serde_json::to_vec(&original).unwrap();
    let decoded: shellboy::protocol::Response<serde_json::Value> =
        serde_json::from_slice(&encoded).unwrap();
    decoded.validate().unwrap();
    let frame = shellboy_studio::envelope::ServerFrame::Result {
        id: 298,
        response: Some(serde_json::to_value(&decoded).unwrap()),
        error: None,
    };
    let bridged = serde_json::to_value(frame).unwrap();
    assert_eq!(bridged["response"]["result"], result);
    assert_eq!(
        bridged["response"]["result"]["items"][0]["items"][0]["execution_ids"],
        json!([])
    );
}

#[test]
fn cli_id_resolution_is_not_exposed_to_the_browser() {
    let command = Command::IdResolve(IdResolveArgs {
        kind: IdKind::Thread,
        prefix: "12345678".into(),
        include_pending_duties: false,
    });
    assert_eq!(access(&command), Access::Denied);
}

#[test]
fn core_schedule_commands_remain_denied_without_a_studio_surface() {
    let command = Command::ScheduleList(ThreadTarget {
        thread_id: Some("t".into()),
    });
    assert_eq!(access(&command), Access::Denied);
}
