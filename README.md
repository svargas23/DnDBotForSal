# DnD Voice Notes Discord Bot

A Discord bot for tabletop RPG groups that joins your voice channel, transcribes speech in real time with OpenAI Whisper, and generates lore-style campaign notes with GPT.

## Features

- **Live voice transcription** — captures each speaker individually via silence-based chunking
- **DM notes** (`/dmnotes`) — structured session notes with evidence tags from the transcript
- **Session tales** (`/session_end`) — narrative after-session recap in DM storyteller voice
- **Campaign continuity** — notes build on prior campaign state across sessions
- **Transcript viewer** (`/transcript`) — raw captured lines with speaker names and timestamps
- **Permission gating** — only Manage Server users can start/stop sessions and reset data
- **Consent notice** — visible recording disclosure posted when a session begins
- **Session logging** — full transcripts, summaries, and metadata saved per session

## Slash Commands

| Command | Permission | Description |
|---|---|---|
| `/session_start` | Manage Server | Join voice and start recording/transcribing |
| `/session_end` | Manage Server | Stop recording and generate a session summary |
| `/dmnotes` | Everyone | Generate structured DM notes from current transcript |
| `/transcript` | Everyone | Show captured transcript lines |
| `/reset_campaign` | Manage Server | Clear saved campaign state (confirmation required) |

## Requirements

- Node.js 20+
- Discord bot token + application client ID
- OpenAI API key

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `OPENAI_API_KEY`
- `DISCORD_GUILD_ID` (optional — only needed for `--guild` dev registration)

### Register Commands

**Global** (for production / marketplace — takes up to 1 hour to propagate):

```bash
npm run register-commands
```

**Guild-scoped** (for development — takes effect instantly):

```bash
npm run register-commands:guild
```

### Start

```bash
npm start
```

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, create a new **Blueprint** and connect your repo.
3. Render will auto-detect `render.yaml` and configure the service.
4. Set the required environment variables (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `OPENAI_API_KEY`) in Render's dashboard.
5. Deploy. The bot will start and the health check endpoint will confirm it's alive.

Or manually create a **Web Service** with:
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | — | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | — | Application client ID |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `DISCORD_GUILD_ID` | No | — | Guild ID for dev-mode command registration |
| `SUMMARY_MODEL` | No | `gpt-4o-mini` | GPT model for summaries |
| `TRANSCRIPTION_MODEL` | No | `whisper-1` | Whisper model |
| `TRANSCRIPTION_LANGUAGE` | No | `en` | Language hint for Whisper |
| `TRANSCRIPTION_PROMPT` | No | D&D terms | Context prompt for Whisper |
| `MIN_AUDIO_BYTES` | No | `30000` | Minimum audio chunk size |
| `PORT` | No | `10000` | Health check HTTP port |

## Data & Logging

- Campaign state: `data/store.json`
- Command logs: `logging/command-responses.ndjson`
- Session logs: `logging/sessions/<guild-id>/<session-id>/`
  - `metadata.json` — session metadata
  - `transcript.ndjson` — machine-readable transcript
  - `transcript.txt` — human-readable transcript
  - `session.json` — full session payload
  - `summary.md` — generated summary

## Notes

- The bot records voice only while a session is active (between `/session_start` and `/session_end`).
- Audio is sent to OpenAI for transcription and is not stored after processing.
- Keep this to private/consenting servers unless all participants agree to recording.

## Legal

- [Privacy Policy](PRIVACY_POLICY.md)
- [Terms of Service](TERMS_OF_SERVICE.md)
