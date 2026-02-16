import OpenAI, { toFile } from "openai";
import { config } from "./config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// ---------------------------------------------------------------------------
// Concurrency limiter – max 3 simultaneous Whisper calls.
// ---------------------------------------------------------------------------
const MAX_CONCURRENT_TRANSCRIPTIONS = 3;
let _activeTranscriptions = 0;
const _queue = [];

function _runNextInQueue() {
  while (_queue.length > 0 && _activeTranscriptions < MAX_CONCURRENT_TRANSCRIPTIONS) {
    const { resolve } = _queue.shift();
    _activeTranscriptions += 1;
    resolve();
  }
}

async function _acquireSlot() {
  if (_activeTranscriptions < MAX_CONCURRENT_TRANSCRIPTIONS) {
    _activeTranscriptions += 1;
    return;
  }
  await new Promise((resolve) => _queue.push({ resolve }));
}

function _releaseSlot() {
  _activeTranscriptions -= 1;
  _runNextInQueue();
}

// ---------------------------------------------------------------------------
// Retry helper – retries on 429 / 500 / 503 with exponential backoff.
// ---------------------------------------------------------------------------
async function withRetry(fn, { retries = 2, baseDelayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const status = error?.status || error?.response?.status;
      const isRetryable = [429, 500, 503].includes(status);
      if (!isRetryable || attempt >= retries) throw error;
      const delay = baseDelayMs * 2 ** attempt;
      console.warn(`Retryable API error (${status}), retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ---------------------------------------------------------------------------
// Transcript text helper.
// ---------------------------------------------------------------------------
function toTranscriptText(transcriptLines) {
  return transcriptLines
    .map((line, index) => `L${index + 1} [${line.timestamp}] ${line.speaker}: ${line.text}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------
export async function transcribeWav(wavBuffer, fileName = "speech.wav") {
  await _acquireSlot();
  try {
    return await withRetry(async () => {
      const file = await toFile(wavBuffer, fileName, { type: "audio/wav" });
      const response = await openai.audio.transcriptions.create({
        model: config.transcriptionModel,
        file,
        language: config.transcriptionLanguage,
        prompt: config.transcriptionPrompt || undefined
      });
      return response.text?.trim() || "";
    });
  } finally {
    _releaseSlot();
  }
}

export async function summarizeDmNotes({ campaignState, transcriptLines }) {
  if (!transcriptLines.length) {
    return "No transcript lines captured in the current session yet. Run /session_start, talk in voice, then check /transcript.";
  }

  const transcriptText = toTranscriptText(transcriptLines);

  const prompt = [
    "You are a strict D&D session notetaker.",
    "Hard rules:",
    "- Use only facts explicitly present in the transcript lines.",
    "- Do not invent names, places, quests, factions, or events.",
    "- If evidence is missing, write 'No explicit evidence in transcript.'",
    "- Prefer concise bullets.",
    "- If transcript is mostly out-of-game chatter, say so directly.",
    "- When you state a fact from transcript, include one evidence tag like [L3].",
    "",
    "Return markdown with these sections:",
    "1) Session Conversation Summary",
    "2) In-Game Canon Updates",
    "3) Table Talk / Logistics",
    "4) NPCs, Locations, and Quests Mentioned",
    "5) Open Questions and Next Steps",
    "",
    "Prior campaign state (context only; do not trust if unsupported):",
    campaignState || "None",
    "",
    "Transcript lines (source of truth):",
    transcriptText || "(none)"
  ].join("\n");

  return await withRetry(async () => {
    const response = await openai.responses.create({
      model: config.summaryModel,
      input: prompt
    });
    return response.output_text?.trim() || "I could not generate notes from the current transcript.";
  });
}

export async function createSessionSummaryTale({
  campaignState,
  transcriptLines,
  includeNextSegmentHint = false
}) {
  if (!transcriptLines.length) {
    return "No transcript lines captured in this session, so there is no tale to chronicle yet.";
  }

  const transcriptText = toTranscriptText(transcriptLines);
  const nextSegmentRule = includeNextSegmentHint
    ? "Include a final section titled '## Next Segment (Possible)' with 2-4 sentences describing a plausible next scene using cautious language (might, may, perhaps)."
    : "Do not include any next-segment prediction section.";

  const prompt = [
    "You are a dungeon master chronicler writing after-session narration.",
    "Write in a lore-forward, human storyteller voice, past tense, grounded in what was said.",
    "Hard rules:",
    "- Stay faithful to transcript facts.",
    "- Do not invent specific events, names, or outcomes that are not supported by transcript lines.",
    "- If the call was mostly planning/out-of-game chatter, still narrate that as table reality.",
    "- Preserve important names/terms exactly as heard where possible.",
    "",
    "Return markdown with these sections:",
    "## Tale of the Session",
    "2-4 short paragraphs in narrative form.",
    "## Threads Left in the Dark",
    "3-6 bullets of unresolved points or pending decisions.",
    nextSegmentRule,
    "",
    "Prior campaign state (context only):",
    campaignState || "None",
    "",
    "Transcript lines (source of truth):",
    transcriptText
  ].join("\n");

  return await withRetry(async () => {
    const response = await openai.responses.create({
      model: config.summaryModel,
      input: prompt
    });
    return response.output_text?.trim() || "I could not craft a session tale from the transcript.";
  });
}
