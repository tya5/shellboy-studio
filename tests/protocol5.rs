//! Owner-free, typed wire acceptance against the protocol-5 Core candidate.
#![cfg(feature = "next-shellboy")]
use serde_json::json;
use shellboy::protocol::{Command, ErrorCode, RunDetails, ThreadDetails, ThreadSummary};
use shellboy_studio::{
    allowlist::{Access, access},
    seam,
};

#[test]
fn exact_protocol_and_unified_thread_reply_shape() {
    assert_eq!(shellboy::protocol::PROTOCOL_VERSION, 5);
    let value = json!({"thread_id":"t", "title":"synthetic", "cwd":"/", "connection":"c",
    "model":"m", "agents_path":"AGENTS.md", "parent_id":"organization", "shells_count":1,
    "awaiting_replies":[
        {"message_id":"h", "recipient_kind":"human", "recipient_thread_id":"t", "excerpt":"Choose", "created_at":"2026-01-01T00:00:00Z", "elapsed_ms":0, "delivery_status":"accepted", "reminded":false},
        {"message_id":"q", "recipient_kind":"thread", "recipient_thread_id":"child", "excerpt":"Review", "created_at":"2026-01-01T00:00:00Z", "elapsed_ms":0, "delivery_status":"applied", "reminded":false}
    ]});
    let details: ThreadDetails = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(details.awaiting_replies.len(), 2);
    assert_eq!(details.shells_count, 1);
    assert_eq!(details.parent_id.as_deref(), Some("organization"));
    for removed in [
        "children_count",
        "awaiting_reply",
        "awaiting_human",
        "awaiting_thread_replies",
    ] {
        let mut invalid = value.clone();
        invalid[removed] = json!([]);
        // Results tolerate unknown additive fields; removed fields are not re-exposed.
        let decoded: ThreadDetails = serde_json::from_value(invalid).unwrap();
        assert!(
            serde_json::to_value(decoded)
                .unwrap()
                .get(removed)
                .is_none()
        );
    }
}

#[test]
fn human_overflow_is_a_lower_bound_and_default_exact_is_preserved() {
    let mut value = json!({"thread_id":"t","title":"synthetic","cwd":"/","state":"idle","activity":"idle",
        "latest_run_stop_reason":null,"updated_at":"2026-01-01T00:00:00Z","excerpt":"",
        "awaiting_human_count":16});
    let exact: ThreadSummary = serde_json::from_value(value.clone()).unwrap();
    assert!(exact.awaiting_human_count_exact);
    value["awaiting_human_count"] = json!(17);
    value["awaiting_human_count_exact"] = json!(false);
    let lower: ThreadSummary = serde_json::from_value(value).unwrap();
    assert!(!lower.awaiting_human_count_exact);
    assert_eq!(lower.awaiting_human_count, 17);
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
fn protocol_four_fails_closed_without_downgrade() {
    let command: Command =
        serde_json::from_value(json!({"command":"thread.get","args":{"thread_id":"t"}})).unwrap();
    let mut request = shellboy::protocol::Request::new("synthetic", command);
    assert!(request.validate().is_ok());
    request.protocol_version = 4;
    assert_eq!(
        request.validate().unwrap_err().code,
        ErrorCode::ProtocolMismatch
    );
    let mut response = shellboy::protocol::Response::success("synthetic", json!({}));
    response.protocol_version = 4;
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
    let decoded: shellboy::protocol::Response<serde_json::Value> = serde_json::from_slice(&encoded).unwrap();
    decoded.validate().unwrap();
    let frame = shellboy_studio::envelope::ServerFrame::Result {
        id: "call-id".into(),
        response: Some(serde_json::to_value(&decoded).unwrap()),
        error: None,
    };
    let bridged = serde_json::to_value(frame).unwrap();
    assert_eq!(bridged["response"]["result"], result);
    assert_eq!(bridged["response"]["result"]["items"][0]["items"][0]["execution_ids"], json!([]));
}
