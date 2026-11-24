# Studio animation CPU harness

Manual synthetic browser fixture only; it is not part of standard checks or CI. From `web/`, run:

```sh
REPEATS=5 CAPTURE_MS=10000 node ../scripts/studio-cpu/measure.mjs
```

Set `CHROME_BIN` to select Chrome. Results are written to `/tmp/studio144-status-cpu.json`. The fixture exercises an idle synthetic conversation, 1/3/8 running sidebar marks, the reported five-arc/three-dot running-conversation mix, a separate summarizing ContextRing case, and an experimental wrapper treatment. No private or live owner data is read.

This uses headless Chrome, whose software-compositing path does not reproduce the user tab's GPU/compositor behavior or CPU figures. Its numbers are exploratory only and are not a gate for the fix. Do not use this harness to claim a real-tab CPU improvement; the user will check the product change in their real tab.
