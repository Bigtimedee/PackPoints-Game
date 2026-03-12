# Discord Community Server Setup

A Discord server gives PackPTS players a community hub for daily challenges, leaderboard chat, and set requests.

## Step 1: Create the Server

1. Open Discord and click the **+** button in the server list
2. Choose **Create My Own** → **For a club or community**
3. Name it: **PackPTS Community**
4. Upload a server icon (use the PackPTS logo)

## Step 2: Set Up Channels

Create these channels:

### Information
- `#announcements` — New features, set drops, maintenance (admin-only posting)
- `#rules` — Community guidelines
- `#getting-started` — How to play PackPTS

### Game Talk
- `#daily-5-results` — Share your Daily 5 scores
- `#leaderboard` — Weekly leaderboard screenshots
- `#streaks` — Celebrate your login streaks
- `#general` — General chat

### Cards
- `#set-requests` — Request new card sets to be added
- `#card-of-the-day` — Daily mystery card discussion
- `#marketplace` — Card buying/selling (community)

### Support
- `#help` — Technical support
- `#feedback` — Suggestions and bug reports

## Step 3: Configure Roles

Create these roles (Settings → Roles):
- **Admin** — Server administrators
- **Moderator** — Community moderators
- **PackPTS Pro** — Pro subscribers (grant via bot integration)
- **Streak Legend** — Users with 30+ day streaks
- **Member** — Default role for all verified members

## Step 4: Set Up the Welcome Bot

1. Invite MEE6 or Carl-bot to your server
2. Configure auto-role: assign **Member** role when users join
3. Set up a welcome message in `#getting-started`

Welcome message template:
```
Welcome to PackPTS!

What is PackPTS? A sports card trivia game where you guess players from card images and earn real rewards.

Play at: https://packpts.com

Rules: Check #rules before chatting

Get started: Share your first score in #daily-5-results!
```

## Step 5: Add Webhook for Bot Posting (Optional)

To have PackPTS automatically post leaderboard updates and announcements:

1. Go to your Discord server → Settings → Integrations → Webhooks
2. Create a webhook for `#announcements`
3. Copy the webhook URL
4. Add to Railway env vars:
   ```
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```
5. The app will automatically post:
   - Weekly leaderboard updates
   - New card set announcements
   - Maintenance notifications

## Step 6: Add Discord Link to PackPTS

After setting up your server, get the invite link:
1. Server Settings → Invites → Create new invite
2. Set expiry to **Never**
3. Add to Railway env vars: `DISCORD_INVITE_URL=https://discord.gg/...`

The Discord join button will appear on the PackPTS home page automatically.

## Recommended Bots

| Bot | Purpose | Link |
|-----|---------|------|
| MEE6 | Welcome messages, leveling | [mee6.xyz](https://mee6.xyz) |
| Carl-bot | Reaction roles, logging | [carl.gg](https://carl.gg) |
| Statbot | Server analytics | [statbot.net](https://statbot.net) |

## Discord Community Best Practices

- Post in `#announcements` for every new card set addition
- Run weekly "Hardest Card" polls in `#general`
- Celebrate users who hit streak milestones
- Share Daily 5 in `#daily-5-results` to encourage participation
- Use `#set-requests` to prioritize which card sets to add next
