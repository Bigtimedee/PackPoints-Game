#!/usr/bin/env python3
"""
PackPTS Daily 5 Morning Announcement → Discord

Generates the morning Daily 5 announcement and posts it to Discord.
Designed for Hermes cron: prints the Discord text to stdout for delivery.
Silent (no stdout) on failure so the cron watchdog pattern works.

Requires: DISCORD_WEBHOOK_URL env var (for direct posting) or omit to
just emit the text for Hermes to deliver.
"""
import json
import sys
import os
from datetime import datetime, timedelta
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
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")

    yesterday_lb = fetch_json(f"{API_BASE}/api/daily5/leaderboard?date={yesterday}")
    top_score = None
    if yesterday_lb and isinstance(yesterday_lb, list) and len(yesterday_lb) > 0:
        top_score = yesterday_lb[0].get("totalScore") or yesterday_lb[0].get("score")

    top_line = f"Can you beat yesterday's top score of {top_score} pts?" if top_score else "Can you set today's high score?"

    message = (
        f"**Daily 5 is live for {today}**\n\n"
        f"Same 5 cards for everyone. Play now and post your score.\n\n"
        f"{top_line}\n\n"
        f"{SITE_URL}/daily5"
    )

    # If webhook URL is set, post directly
    webhook = os.environ.get("DISCORD_WEBHOOK_URL")
    if webhook:
        if post_to_discord(webhook, message):
            print(message)
        # Silent on failure (watchdog pattern)
    else:
        # Just emit for Hermes delivery
        print(message)


if __name__ == "__main__":
    main()
