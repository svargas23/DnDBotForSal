# Quickstart for Sal (Server Deployment)

This is the fastest path to run this bot from your own fork on a Linux server.

## HI SAL! I HAD IT MAKE THIS FOR YOU, BUT MOST IMPORTANTLY JUST ASK QUESTIONS TO YOUR ai AS YOU TRY AND GET THIS RUNNING

## 1) Prerequisites

Install these on the server:

- `git`
- `node` 20+
- `npm`

Check versions:

```bash
node -v
npm -v
```

## 2) Fork and clone

On GitHub, fork this repo to your account, then on the server:

```bash
git clone <YOUR_FORK_GIT_URL> dnd-discord-bot
cd dnd-discord-bot
npm ci
```

## 3) Create Discord bot and invite it

In the Discord Developer Portal:

- Create an application and bot user
- Enable intent support needed by this project:
  - `GUILD VOICE STATES`
- Generate an invite URL with scopes:
  - `bot`
  - `applications.commands`
- Bot permissions (minimum):
  - `Connect`
  - `View Channels`
  - `Use Application Commands`
  - `Send Messages`

Invite the bot to your Discord server.

## 4) Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `OPENAI_API_KEY`

Optional tuning values are already documented in `.env.example`.

## 5) Register slash commands (run after env is set)

```bash
npm run register-commands
```

If this fails, double-check token/client ID/guild ID values.

## 6) Start the bot

```bash
npm start
```

You should see startup logs in the terminal.

## 7) Keep it running after logout (PM2)

```bash
npm install -g pm2
pm2 start src/bot.js --name dnd-bot
pm2 save
pm2 startup
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs dnd-bot
pm2 restart dnd-bot
```

## 8) First test in Discord

1. Join a voice channel.
2. Run `/session_start`.
3. Speak in voice.
4. Run `/transcript` or `/dmnotes`.
5. Run `/session_end`.

## 9) Logs and data locations

- Campaign state: `data/store.json`
- Command responses: `logging/command-responses.ndjson`
- Session logs: `logging/sessions/<guild-id>/<session-id>/...`

## 10) Updating from your fork

From the repo directory:

```bash
git pull
npm ci
npm run register-commands
pm2 restart dnd-bot
```

You only need `register-commands` when slash command definitions change, but it is safe to run.
