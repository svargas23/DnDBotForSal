# DnD Voice Notes Discord Bot (Local MVP)

Quick-and-dirty Discord bot that:
- joins your voice channel with `/session_start`
- transcribes speech snippets with Whisper
- generates lore-style campaign notes with `/dmnotes`
- shows raw captured text with `/transcript`
- clears saved note memory with `/reset_campaign`
- finalizes with a narrative tale (and sometimes a next-segment hook) via `/session_end`
- writes session and command logs under `logging/`

## What You Need

- Node.js 20+
- Discord bot token + app client ID + a test guild (server) ID
- OpenAI API key (used for Whisper transcription and summary generation)

## 1) Create and Configure Discord Bot

In Discord Developer Portal:
- Create application + bot user
- Enable Gateway Intents:
  - `GUILD VOICE STATES` (voice state intent is not a privileged toggle but is required by code)
- OAuth2 URL scopes:
  - `bot`
  - `applications.commands`
- Bot permissions (minimum):
  - `Connect`
  - `View Channels`
  - `Use Application Commands`
  - `Send Messages`

Invite the bot to your test server.

## 2) Local Setup

```bash
npm install
cp .env.example .env
```

Fill `.env`:
- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `OPENAI_API_KEY`

Register slash commands in your test server:

```bash
npm run register-commands
```

Start bot:

```bash
npm start
```

## 3) Test Flow (Local)

1. Join a voice channel in your Discord server.
2. Run `/session_start`.
3. Talk normally in the call.
4. Run `/transcript` to confirm captured transcript lines.
5. Run `/dmnotes` to get current campaign summary.
6. Run `/session_end` to stop recording and persist final summary.
7. If notes are polluted by old state, run `/reset_campaign`.

## Notes / Limitations

- Discord does not provide a direct transcript API. This bot captures live voice audio while connected.
- The bot cannot transcribe voice from before `/session_start`.
- Transcripts and campaign state are stored locally in `data/store.json`.
- This MVP captures chunks per active speaker after short silence and sends each chunk to Whisper.
- If lines are not appearing quickly, lower `MIN_AUDIO_BYTES` in `.env` (example: `15000`).
- Improve STT consistency by setting:
  - `TRANSCRIPTION_LANGUAGE=en`
  - `TRANSCRIPTION_PROMPT` with your campaign's character/place names
- Native opus decode is attempted via optional `@discordjs/opus` when available for better stability.
- Keep this to private/test servers unless all participants consent to recording/transcription.

## Logging Output

Runtime logs are stored locally in:
- `logging/command-responses.ndjson` (every command response)
- `logging/sessions/<guild-id>/<session-id>/metadata.json`
- `logging/sessions/<guild-id>/<session-id>/transcript.ndjson`
- `logging/sessions/<guild-id>/<session-id>/transcript.txt`
- `logging/sessions/<guild-id>/<session-id>/summary.md`
- `logging/sessions/<guild-id>/<session-id>/session.json`
