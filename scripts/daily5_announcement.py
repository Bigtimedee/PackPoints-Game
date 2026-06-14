#!/usr/bin/env python3
"""
PackPTS Daily 5 Announcement Generator

Queries the PackPTS API for today's Daily 5 challenge info and yesterday's
results, then generates ready-to-post announcements for X, Discord, and
other channels.

Usage:
  python3 scripts/daily5_announcement.py --type morning
  python3 scripts/daily5_announcement.py --type recap

Output: JSON with platform-specific content ready for posting.
"""

import json
import sys
import os
import argparse
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError

SITE_URL = os.environ.get("PACKPTS_SITE_URL", "https://PackPTS.com")
API_BASE = os.environ.get("PACKPTS_API_BASE", "https://packpts.com")


def fetch_json(url: str) -> dict:
    """Fetch JSON from URL, return empty dict on failure."""
    try:
        req = Request(url, headers={"User-Agent": "PackPTS-Growth-Bot/1.0"})
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except (URLError, json.JSONDecodeError, Exception) as e:
        print(f"[WARN] Failed to fetch {url}: {e}", file=sys.stderr)
        return {}


def get_yesterday_str() -> str:
    """Get yesterday's date string in YYYY-MM-DD format."""
    return (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")


def get_today_str() -> str:
    """Get today's date string in YYYY-MM-DD format."""
    return datetime.utcnow().strftime("%Y-%m-%d")


def generate_morning_announcement() -> dict:
    """Generate the 8 AM ET Daily 5 announcement."""
    today = get_today_str()
    yesterday = get_yesterday_str()

    # Try to get yesterday's leaderboard for context
    yesterday_lb = fetch_json(f"{API_BASE}/api/daily5/leaderboard?date={yesterday}")
    top_score = None
    if yesterday_lb and isinstance(yesterday_lb, list) and len(yesterday_lb) > 0:
        top_entry = yesterday_lb[0]
        top_score = top_entry.get("totalScore") or top_entry.get("score")

    # Build platform-specific content
    top_score_line = f"Can you beat yesterday's top score of {top_score} pts?" if top_score else "Can you set today's high score?"

    x_post = (
        f"Today's Daily 5 is live.\n\n"
        f"5 cards. Same for everyone. Leaderboard resets at midnight.\n\n"
        f"{top_score_line}\n\n"
        f"{SITE_URL}/daily5?utm_source=x&utm_medium=post&utm_campaign=daily5&utm_content=morning\n"
        f"#PackPTS #Daily5"
    )

    discord_post = (
        f"**Daily 5 is live for {today}**\n\n"
        f"Same 5 cards for everyone. Play now and post your score.\n\n"
        f"{top_score_line}\n\n"
        f"{SITE_URL}/daily5"
    )

    return {
        "type": "morning_announcement",
        "date": today,
        "platforms": {
            "x": {"text": x_post, "char_count": len(x_post)},
            "discord": {"text": discord_post},
        },
        "metadata": {
            "yesterday_top_score": top_score,
        }
    }


def generate_recap() -> dict:
    """Generate the 9 PM ET Daily 5 recap."""
    today = get_today_str()

    # Get today's leaderboard
    leaderboard = fetch_json(f"{API_BASE}/api/daily5/leaderboard?date={today}")

    if not leaderboard or not isinstance(leaderboard, list) or len(leaderboard) == 0:
        # No data yet — generate a generic reminder
        x_post = (
            f"Today's Daily 5 challenge is still open.\n\n"
            f"5 cards. Same for everyone. How many can you name?\n\n"
            f"{SITE_URL}/daily5?utm_source=x&utm_medium=post&utm_campaign=daily5&utm_content=recap\n"
            f"#PackPTS #Daily5"
        )
        discord_post = (
            f"**Daily 5 — {today}**\n\n"
            f"Challenge is still open. Play before midnight.\n\n"
            f"{SITE_URL}/daily5"
        )
        return {
            "type": "recap",
            "date": today,
            "platforms": {
                "x": {"text": x_post, "char_count": len(x_post)},
                "discord": {"text": discord_post},
            },
            "metadata": {"entries": 0}
        }

    # Build leaderboard lines
    top_3 = leaderboard[:3]
    total_entries = len(leaderboard)

    lb_lines = []
    medals = ["🥇", "🥈", "🥉"]
    for i, entry in enumerate(top_3):
        username = entry.get("username", "Anonymous")
        score = entry.get("totalScore") or entry.get("score", 0)
        medal = medals[i] if i < 3 else f"{i+1}."
        lb_lines.append(f"{medal} {username} — {score} pts")

    lb_text = "\n".join(lb_lines)

    # Calculate average
    scores = [e.get("totalScore") or e.get("score", 0) for e in leaderboard]
    avg_score = round(sum(scores) / len(scores)) if scores else 0

    x_post = (
        f"Today's Daily 5 results:\n\n"
        f"{lb_text}\n\n"
        f"Total players: {total_entries}\n"
        f"Average score: {avg_score} pts\n\n"
        f"Tomorrow's challenge drops at 8 AM ET.\n\n"
        f"#PackPTS #Daily5"
    )

    discord_post = (
        f"**Daily 5 Results — {today}**\n\n"
        f"{lb_text}\n\n"
        f"Total players: {total_entries}\n"
        f"Average score: {avg_score} pts\n\n"
        f"New challenge at 8 AM ET tomorrow."
    )

    return {
        "type": "recap",
        "date": today,
        "platforms": {
            "x": {"text": x_post, "char_count": len(x_post)},
            "discord": {"text": discord_post},
        },
        "metadata": {
            "entries": total_entries,
            "avg_score": avg_score,
            "top_score": scores[0] if scores else 0,
            "top_player": top_3[0].get("username") if top_3 else None,
        }
    }


def main():
    parser = argparse.ArgumentParser(description="PackPTS Daily 5 content generator")
    parser.add_argument("--type", choices=["morning", "recap"], required=True,
                        help="Type of announcement to generate")
    parser.add_argument("--format", choices=["json", "text"], default="json",
                        help="Output format")
    args = parser.parse_args()

    if args.type == "morning":
        result = generate_morning_announcement()
    else:
        result = generate_recap()

    if args.format == "json":
        print(json.dumps(result, indent=2))
    else:
        # Plain text output for each platform
        for platform, content in result["platforms"].items():
            print(f"=== {platform.upper()} ===")
            print(content["text"])
            print()


if __name__ == "__main__":
    main()
