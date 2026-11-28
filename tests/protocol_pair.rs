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
fn thread_details_have_directional_reply_counts_and_awaiting_own_ask() {
    let value = json!({"thread_id":"t", "title":"synthetic", "cwd":"/", "connection":"c",
        "model":"m", "agents_path":"AGENTS.md", "parent_thread_id":"organization", "shells_count":1,
        "summarizing":false, "pending_replies":{"owed_by":{"count":2,"exact":true},"asked_by":{"count":17,"exact":false},
        "awaiting_own_ask":[{"message_id":"duty","blocking_message_id":"question"}]}});
    let details: ThreadDetails = serde_json::from_value(value).unwrap();
    assert_eq!(details.pending_replies.owed_by.count, 2);
    assert!(!details.pending_replies.asked_by.exact);
    let waiting = &details.pending_replies.awaiting_own_ask;
    assert_eq!(waiting.len(), 1);
    assert_eq!(
        (
            waiting[0].message_id.as_str(),
            waiting[0].blocking_message_id.as_str()
        ),
        ("duty", "question")
    );
    let provenance: shellboy::protocol::MessageProvenance =
        serde_json::from_value(json!({"expect_reply":true,"reply_state":"awaiting_own_ask"}))
            .unwrap();
    assert_eq!(
        provenance.reply_state,
        Some(shellboy::protocol::MessageReplyState::AwaitingOwnAsk)
    );
    assert_eq!(details.shells_count, 1);
    assert_eq!(details.parent_thread_id.as_deref(), Some("organization"));
    assert_eq!(
        access(&Command::MessageList(shellboy::protocol::MessageListArgs {
            owed_by_thread_id: Some("t".into()),
            asked_by_thread_id: None,
            to: None,
            limit: 16,
            cursor: None,
        })),
        Access::Read
    );
}

#[test]
fn status_run_item_carries_stop_settlement_failure() {
    use shellboy::{protocol::RunStopSettlementFailure, status::WorkItem};
    let row = |failure: Option<serde_json::Value>| {
        let mut row = json!({"kind":"run","id":"run-s","state":"stopping","thread_id":"t",
            "thread_title":"synthetic","current_connection":"c","current_model":"m",
            "response_nodes":[],"response_nodes_truncated":false,"activity_at":"2026-11-26T00:00:00Z",
            "targets":[]});
        if let Some(failure) = failure {
            row["stop_settlement_failure"] = failure;
        }
        serde_json::from_value::<WorkItem>(row)
    };
    for (wire, typed) in [
        ("storage", RunStopSettlementFailure::Storage),
        ("invariant", RunStopSettlementFailure::Invariant),
    ] {
        assert_eq!(
            row(Some(json!(wire))).unwrap().stop_settlement_failure,
            Some(typed)
        );
    }
    assert_eq!(row(None).unwrap().stop_settlement_failure, None);
    assert_eq!(
        row(Some(serde_json::Value::Null))
            .unwrap()
            .stop_settlement_failure,
        None
    );
    assert!(row(Some(json!("disk"))).is_err());
}

#[test]
fn directional_exact_flags_distinguish_exact_counts_and_lower_bounds() {
    let mut value = json!({"thread_id":"t","title":"synthetic","cwd":"/","state":"idle","activity":"idle",
        "latest_run_stop_reason":null,"updated_at":"2026-01-01T00:00:00Z","excerpt":"",
        "awaiting_named_count":16,"awaiting_replies":16,"awaiting_thread_count":3,"excerpt_complete":true,
        "awaiting_named_count_exact":true,"awaiting_replies_count_exact":true,"awaiting_thread_count_exact":true});
    let exact: ThreadSummary = serde_json::from_value(value.clone()).unwrap();
    assert!(exact.awaiting_named_count_exact);
    assert!(exact.awaiting_replies_count_exact);
    assert!(exact.awaiting_thread_count_exact);
    assert!(exact.excerpt_complete);
    value["awaiting_replies_count_exact"] = json!(false);
    value["awaiting_thread_count_exact"] = json!(false);
    value["excerpt_complete"] = json!(false);
    let lower: ThreadSummary = serde_json::from_value(value.clone()).unwrap();
    assert!(!lower.awaiting_replies_count_exact);
    assert!(!lower.awaiting_thread_count_exact);
    assert!(!lower.excerpt_complete);
    value["awaiting_named_count"] = json!(17);
    value["awaiting_named_count_exact"] = json!(false);
    let lower: ThreadSummary = serde_json::from_value(value).unwrap();
    assert!(!lower.awaiting_named_count_exact);
    assert_eq!(lower.awaiting_named_count, 17);
    let history: shellboy::protocol::HistorySnippet = serde_json::from_value(json!({
        "node_id":"n", "kind":"assistant_response", "excerpt":"excerpt", "provenance":{"kind":"assistant_response","created_at":"2026-01-01T00:00:00Z","source_revision":1},
        "context":{"state":"completed"}, "selection":{"thread_id":"t","ordinal":0,"current_cwd":"/"},
        "execution_count":4,"execution_count_exact":false,"executions_truncated":true
    })).unwrap();
    assert_eq!(history.execution_count, 4);
    assert_eq!(history.execution_count_exact, Some(false));
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
        json!({"command":"thread.create","args":{"parent_thread_id":"organization"}}),
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
fn core_main_pin_exposes_operation_evidence_held_messages_delivery_wait_and_shell_tail() {
    use shellboy::protocol::{
        MessageDetails, MessageHeldBy, OperationReceiptDetails, WaitCondition,
    };

    let receipt: OperationReceiptDetails = serde_json::from_value(json!({
        "operation_id":"instance:op","instance_id":"instance","created_at":"2026-11-25T00:00:00Z",
        "current_instance":true,"state":"completed","outcome":{"accepted":true},"result_uncertain":false,
        "result_expired":false,"replay_policy":"return_saved_outcome","targets":{"message_id":"m"},
        "downstream":{"kind":"message","state":"accepted","hold_reason":"foreground_shell"}
    })).unwrap();
    assert_eq!(
        receipt.replay_policy,
        shellboy::protocol::OperationReplayPolicy::ReturnSavedOutcome
    );
    assert!(matches!(
        receipt.downstream,
        Some(shellboy::protocol::OperationReceiptDownstream::Message { .. })
    ));

    let held: MessageDetails = serde_json::from_value(json!({
        "sender":{"kind":"human"},"context":{"state":"running"},"message_id":"m","thread_id":"t",
        "delivery_status":"accepted","assignment":"pending","held_by":{"kind":"foreground_shell","execution_id":"exec"}
    })).unwrap();
    assert!(
        matches!(held.held_by, Some(MessageHeldBy::ForegroundShell { ref execution_id }) if execution_id == "exec")
    );
    let delivered: WaitCondition =
        serde_json::from_value(json!({"type":"message_delivered","message_id":"m"})).unwrap();
    assert!(
        matches!(delivered, WaitCondition::MessageDelivered { ref message_id } if message_id == "m")
    );
    let shell_read: shellboy::protocol::ShellReadArgs =
        serde_json::from_value(json!({"execution_id":"exec","tail":true})).unwrap();
    assert!(shell_read.tail);
    let background: Command = serde_json::from_value(
        json!({"command":"shell.background","args":{"execution_id":"exec"}}),
    )
    .unwrap();
    assert_eq!(access(&background), Access::Mutation);
}

#[test]
fn mismatched_protocol_fails_closed_without_downgrade() {
    let command: Command =
        serde_json::from_value(json!({"command":"thread.get","args":{"thread_id":"t"}})).unwrap();
    let mut request = shellboy::protocol::Request::new("synthetic", command);
    assert!(request.validate().is_ok());
    request.protocol_version = 43;
    assert_eq!(
        request.validate().unwrap_err().code,
        ErrorCode::ProtocolMismatch
    );
    let mut response = shellboy::protocol::Response::success("synthetic", json!({}));
    response.protocol_version = 43;
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
fn core_schedule_and_service_reads_require_a_thread() {
    for list in [Command::ScheduleList, Command::ServiceList] {
        assert_eq!(
            access(&list(ThreadTarget {
                thread_id: Some("t".into())
            })),
            Access::Read
        );
        for thread_id in [None, Some("".into())] {
            assert_eq!(access(&list(ThreadTarget { thread_id })), Access::Denied);
        }
    }
}

#[test]
fn message_acceptance_and_reply_match_the_pinned_result_schemas() {
    use shellboy::protocol::{MessageAccepted, MessageReplied};
    let schema: serde_json::Value =
        serde_json::from_str(&shellboy::protocol::schema_json()).unwrap();
    let results = &schema["operation_results"];
    assert_eq!(results["message.ask"], results["message.send"]);
    assert_eq!(results["message.ask"]["title"], "MessageAccepted");
    assert_eq!(results["message.reply"]["title"], "MessageReplied");
    assert!(
        results["message.reply"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "message_id")
    );
    assert!(
        results["message.reply"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "reply_to")
    );
    assert!(
        !results["message.reply"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "delivery")
    );

    let accepted: MessageAccepted = serde_json::from_value(json!({
        "message_id":"accepted","thread_id":"asking","delivery_status":"held",
        "assignment":"pending","expect_reply":true
    }))
    .unwrap();
    assert_eq!(accepted.message_id, "accepted");
    let standalone: MessageReplied = serde_json::from_value(json!({
        "message_id":"answer","reply_to":"request"
    }))
    .unwrap();
    assert!(standalone.delivery.is_none());
    let routed: MessageReplied = serde_json::from_value(json!({
        "message_id":"answer","reply_to":"request","delivery":{
            "message_id":"answer","thread_id":"asking","delivery_status":"held",
            "assignment":"pending","expect_reply":false
        }
    }))
    .unwrap();
    assert_eq!(routed.delivery.unwrap().message_id, "answer");
    // Serde maps null to None for Option, but the public schema's $ref requires an object.
    assert_eq!(
        results["message.reply"]["properties"]["delivery"]["$ref"],
        "#/definitions/MessageAccepted"
    );
}

#[test]
fn history_read_and_message_ask_use_the_pinned_wire_contract() {
    for args in [
        json!({"node_id":"n","limit_bytes":64,"cursor":"next"}),
        json!({"node_id":"n","parts":true}),
        json!({"node_id":"n","end_message_only":true}),
    ] {
        let command: Command =
            serde_json::from_value(json!({"command":"history.read","args":args})).unwrap();
        assert_eq!(access(&command), Access::Read);
    }
    assert!(
        serde_json::from_value::<Command>(json!({"command":"history.get","args":{"node_id":"n"}}))
            .is_err()
    );
    let wire = json!({"command":"message.ask","args":{"thread_id":"t","text":"synthetic","sender_label":"Studio probe"}});
    let command: Command = serde_json::from_value(wire).unwrap();
    assert_eq!(access(&command), Access::Denied);
    assert_eq!(
        serde_json::to_value(command).unwrap()["args"]["sender_label"],
        "Studio probe"
    );
}
