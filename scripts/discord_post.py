#!/usr/bin/env python3
"""
Post a message to a Discord webhook.

Usage:
  echo "Hello" | python3 scripts/discord_post.py
  python3 scripts/discord_post.py --message "Hello world"
  python3 scripts/discord_post.py --file content.json --platform discord

Requires DISCORD_WEBHOOK_URL env var.
"""

import json
import sys
import os
import argparse
from urllib.request import urlopen, Request
from urllib.error import URLError


def post_to_discord(webhook_url: str, message: str) -> bool:
    """Post a message to a Discord webhook. Returns True on success."""
    payload = json.dumps({"content": message}).encode("utf-8")
    req = Request(
        webhook_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "PackPTS-Growth-Bot/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=15) as resp:
            status = resp.status
            if status in (200, 204):
                print(f"[OK] Posted to Discord (status {status})")
                return True
            else:
                print(f"[WARN] Discord returned status {status}", file=sys.stderr)
                return False
    except URLError as e:
        print(f"[ERROR] Failed to post to Discord: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Post to Discord webhook")
    parser.add_argument("--message", "-m", help="Message to post")
    parser.add_argument("--file", "-f", help="JSON file with platform content")
    parser.add_argument("--platform", default="discord", help="Platform key in JSON file")
    args = parser.parse_args()

    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        print("[ERROR] DISCORD_WEBHOOK_URL not set", file=sys.stderr)
        sys.exit(1)

    # Determine message source
    if args.message:
        message = args.message
    elif args.file:
        with open(args.file) as f:
            data = json.load(f)
        platform_data = data.get("platforms", {}).get(args.platform, {})
        message = platform_data.get("text")
        if not message:
            print(f"[ERROR] No text found for platform '{args.platform}' in {args.file}", file=sys.stderr)
            sys.exit(1)
    elif not sys.stdin.isatty():
        message = sys.stdin.read().strip()
    else:
        print("[ERROR] No message provided. Use --message, --file, or pipe to stdin.", file=sys.stderr)
        sys.exit(1)

    if not message:
        print("[ERROR] Empty message", file=sys.stderr)
        sys.exit(1)

    success = post_to_discord(webhook_url, message)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
