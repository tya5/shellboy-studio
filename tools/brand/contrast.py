#!/usr/bin/env python3
"""WCAG sRGB contrast for all logo adjacency pairs; failed targets stay visible.

3:1 is an engineering target for graphical distinctions, not a claim that this
noninteractive decorative logo is an accessible control. Text thresholds do not
apply. Antialiased edge pixels are excluded from nominal color calculations.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def luminance(value):
    values = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
    return sum(v * weight for v, weight in zip(linear, [.2126, .7152, .0722]))


def ratio(a, b):
    x, y = sorted([luminance(a), luminance(b)])
    return (y + .05) / (x + .05)


def table():
    tokens = json.loads((ROOT / "web/designs/console/system/tokens.json").read_text())
    colors = {token["name"]: token["value"] for token in tokens["color"]["tokens"]}
    rows = []
    for theme in ["console", "light", "terminal"]:
        accent, face, bright, panel = [colors[name][theme] for name in ["accent", "logo-face", "logo-bright", "panel"]]
        for pair, a, b, role in [
            ("wink/face", accent, face, "expression"),
            ("eye/face and bubble/face", bright, face, "expression and inner contour"),
            ("tile/panel", accent, panel, "logo tile location"),
            ("bubble/tile", bright, accent, "outer contour, genuinely adjacent"),
        ]:
            value = ratio(a, b)
            rows.append(dict(theme=theme, pair=pair, foreground=a, background=b, ratio=round(value, 4), target=3, passes=value >= 3, role=role))
    return rows


if __name__ == "__main__":
    print(json.dumps({"target": "3:1 graphical distinction (not text)", "rows": table(), "oldLightWinkFace": round(ratio("#0369a1", "#023239"), 4), "newLightWinkFace": round(ratio("#0369a1", "#000810"), 4)}, indent=2))
