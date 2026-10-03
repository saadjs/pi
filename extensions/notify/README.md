# @saadjs/pi-notify

Focus-aware desktop notifications for [pi](https://pi.dev) in Ghostty on macOS.

## Usage

When pi finishes, Ghostty shows a banner and plays a notification sound only if the originating terminal surface is unfocused. Click the notification to return to that tab, window, or split.

Notifications include the project name, session name if set, and a short plain-text preview of the final response or error. Thinking and tool output are excluded. Manual cancellations are skipped, and notifications wait until retries, compaction, and queued follow-ups finish. No extra model calls or external dependencies.

Run `/notify test` to send a test notification after 5 seconds, giving you time to switch away.

> Response and error previews may contain sensitive text. Adjust macOS notification preview settings if needed.

## Requirements

- An interactive pi session directly in Ghostty on macOS. Other terminals, tmux, and non-interactive modes are skipped.
- A pi version with `agent_before_settle` and `agent_settled` extension events.
- Ghostty desktop notifications enabled (`desktop-notifications = true`, the default).
- Notifications and sounds allowed for Ghostty in **macOS System Settings → Notifications**. Focus / Do Not Disturb may suppress them.

## Install

```bash
pi install npm:@saadjs/pi-notify
```

To try locally from the monorepo root:

```bash
pi -e ./extensions/notify/index.ts
```

## Test

```bash
pnpm --filter @saadjs/pi-notify test
```

Automated tests capture escape sequences without sending notifications. Use `/notify test` to check native banners, sound, and focus behavior.
