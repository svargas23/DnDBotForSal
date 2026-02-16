import fs from "node:fs/promises";
import path from "node:path";

const LOG_ROOT = path.resolve("logging");

function safeSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function appendLine(filePath, line) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${line}\n`, "utf8");
}

function sessionDir(guildId, sessionId) {
  return path.join(LOG_ROOT, "sessions", safeSegment(guildId), safeSegment(sessionId));
}

export function buildSessionId(isoTimestamp = new Date().toISOString()) {
  return isoTimestamp.replace(/[:.]/g, "-");
}

export async function initSessionLogs({ guildId, sessionId, startedAt, voiceChannelId }) {
  const dir = sessionDir(guildId, sessionId);
  await ensureDir(dir);

  const metadata = {
    guildId,
    sessionId,
    startedAt,
    voiceChannelId,
    createdAt: new Date().toISOString()
  };

  await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
}

export async function appendSessionTranscriptLine({ guildId, sessionId, line }) {
  const dir = sessionDir(guildId, sessionId);
  const ndjsonPath = path.join(dir, "transcript.ndjson");
  const textPath = path.join(dir, "transcript.txt");

  await appendLine(ndjsonPath, JSON.stringify(line));
  await appendLine(textPath, `[${line.timestamp}] ${line.speaker}: ${line.text}`);
}

export async function finalizeSessionLogs({
  guildId,
  sessionId,
  startedAt,
  endedAt,
  transcript,
  summary
}) {
  const dir = sessionDir(guildId, sessionId);
  await ensureDir(dir);

  const payload = {
    guildId,
    sessionId,
    startedAt,
    endedAt,
    transcriptCount: transcript.length,
    transcript,
    summary
  };

  await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "summary.md"), summary || "", "utf8");
}

export async function logCommandResponse({
  guildId,
  commandName,
  userId,
  username,
  responseText,
  metadata = {}
}) {
  const entry = {
    timestamp: new Date().toISOString(),
    guildId: guildId || "dm",
    commandName,
    userId: userId || "unknown",
    username: username || "unknown",
    responseText,
    metadata
  };

  const logPath = path.join(LOG_ROOT, "command-responses.ndjson");
  await appendLine(logPath, JSON.stringify(entry));
}
