#!/usr/bin/env python3
"""
PackPTS Daily 5 Evening Recap → Discord

Generates the evening Daily 5 recap with leaderboard and posts to Discord.
Designed for Hermes cron: prints the Discord text to stdout for delivery.
Silent (no stdout) if no leaderboard data exists.

Requires: DISCORD_WEBHOOK_URL env var (for direct posting) or omit to
just emit the text for Hermes to deliver.
"""
import json
import sys
import os
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import URLError

SITE_URL = os.environ.get("PACKPTS_SITE_URL", "https://PackPTS.com")
API_BASE = os.environ.get("PACKPTS_API_BASE", "https://packpts.com")


def fetch_json(url):
    try:
        req = Request(url, headers={"User-Agent": "PackPTS-Growth-Bot/1.0"})
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"[WARN] {e}", file=sys.stderr)
        return {}


def post_to_discord(webhook_url, message):
    payload = json.dumps({"content": message, "username": "PackPTS"}).encode()
    req = Request(webhook_url, data=payload,
                  headers={"Content-Type": "application/json",
                           "User-Agent": "PackPTS-Growth-Bot/1.0"},
                  method="POST")
    try:
        with urlopen(req, timeout=15) as resp:
            return resp.status in (200, 204)
    except Exception as e:
        print(f"[ERROR] Discord post failed: {e}", file=sys.stderr)
        return False


def main():
    today = datetime.utcnow().strftime("%Y-%m-%d")

    leaderboard = fetch_json(f"{API_BASE}/api/daily5/leaderboard?date={today}")

    if not leaderboard or not isinstance(leaderboard, list) or len(leaderboard) == 0:
        # No data — stay silent (watchdog pattern: empty stdout = no delivery)
        return

    top_3 = leaderboard[:3]
    total_entries = len(leaderboard)

    medals = ["🥇", "🥈", "🥉"]
    lb_lines = []
    for i, entry in enumerate(top_3):
        username = entry.get("username", "Anonymous")
        score = entry.get("totalScore") or entry.get("score", 0)
        medal = medals[i] if i < 3 else f"{i+1}."
        lb_lines.append(f"{medal} {username} — {score} pts")

    lb_text = "\n".join(lb_lines)

    scores = [e.get("totalScore") or e.get("score", 0) for e in leaderboard]
    avg_score = round(sum(scores) / len(scores)) if scores else 0

    message = (
        f"**Daily 5 Results — {today}**\n\n"
        f"{lb_text}\n\n"
        f"Total players: {total_entries}\n"
        f"Average score: {avg_score} pts\n\n"
        f"New challenge at 8 AM ET tomorrow."
    )

    webhook = os.environ.get("DISCORD_WEBHOOK_URL")
    if webhook:
        if post_to_discord(webhook, message):
            print(message)
    else:
        print(message)


if __name__ == "__main__":
    main()
