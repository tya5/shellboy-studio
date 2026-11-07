// Live model text is on only when the bridge says it can carry it (a build with the Cargo feature
// `next-shellboy`, against a Shellboy that has #243 E3). On v0.10.0 the Conversation shows saved
// messages only, as before. The data layer's `Preview` holds the text (data/src/live.ts).
export const CAPABILITY_LIVE_TEXT = "live.text";
