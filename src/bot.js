import {
  Client,
  GatewayIntentBits
} from "discord.js";
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel
} from "@discordjs/voice";
import prism from "prism-media";
import { config } from "./config.js";
import { createSessionSummaryTale, transcribeWav, summarizeDmNotes } from "./ai.js";
import { pcmToWav } from "./audio.js";
import { chunkDiscordMessage, discordTimestamp } from "./discord-utils.js";
import {
  appendSessionTranscriptLine,
  buildSessionId,
  finalizeSessionLogs,
  initSessionLogs,
  logCommandResponse
} from "./logging.js";
import { getGuildState, loadStore, saveStore } from "./store.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const activeVoiceSessions = new Map();

async function logInteractionResponse(interaction, commandName, responseText, metadata = {}) {
  try {
    await logCommandResponse({
      guildId: interaction.guildId,
      commandName,
      userId: interaction.user?.id,
      username: interaction.user?.tag || interaction.user?.username,
      responseText,
      metadata
    });
  } catch (error) {
    console.error("Failed to write command response log:", error);
  }
}

async function sendReply(interaction, commandName, text, metadata = {}) {
  await interaction.reply(text);
  await logInteractionResponse(interaction, commandName, text, {
    delivery: "reply",
    ...metadata
  });
}

async function sendEditReply(interaction, commandName, text, metadata = {}) {
  await interaction.editReply(text);
  await logInteractionResponse(interaction, commandName, text, {
    delivery: "editReply",
    ...metadata
  });
}

async function resolveSpeakerName(guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return userId;

  const member = guild.members.cache.get(userId);
  if (!member) return userId;
  return member.displayName || member.user.username || userId;
}

async function appendTranscriptLine(guildId, userId, text) {
  const speaker = await resolveSpeakerName(guildId, userId);
  const store = await loadStore();
  const guildState = getGuildState(store, guildId);
  if (!guildState.currentSession?.active) return;

  const transcriptLine = {
    timestamp: discordTimestamp(),
    userId,
    speaker,
    text
  };
  guildState.currentSession.transcript.push(transcriptLine);
  await saveStore(store);

  try {
    if (guildState.currentSession.sessionId) {
      await appendSessionTranscriptLine({
        guildId,
        sessionId: guildState.currentSession.sessionId,
        line: transcriptLine
      });
    }
  } catch (error) {
    console.error("Failed to write transcript log:", error);
  }

  console.log(`[${guildId}] ${speaker}: ${text}`);
}

function isIgnorableStreamError(error) {
  if (!error) return false;
  if (error.code === "ERR_STREAM_PUSH_AFTER_EOF") return true;
  const message = String(error.message || "");
  return message.includes("stream.push() after EOF");
}

function startReceiverForGuild(guildId, connection) {
  const runtime = {
    connection,
    streams: new Map()
  };

  activeVoiceSessions.set(guildId, runtime);
  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    if (runtime.streams.has(userId)) return;

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 700
      }
    });
    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48000
    });
    const state = {
      opusStream,
      decoder,
      pcmChunks: [],
      finished: false
    };

    runtime.streams.set(userId, state);
    opusStream.pipe(decoder);

    const finalize = async (reason) => {
      if (state.finished) return;
      state.finished = true;
      runtime.streams.delete(userId);

      try {
        opusStream.unpipe(decoder);
      } catch {
        // no-op
      }

      if (!opusStream.destroyed) opusStream.destroy();
      if (!decoder.destroyed) decoder.destroy();

      const pcm = Buffer.concat(state.pcmChunks);
      if (pcm.length < config.minAudioBytes) {
        return;
      }

      try {
        const wav = pcmToWav(pcm);
        const text = await transcribeWav(wav, `${guildId}-${userId}-${Date.now()}.wav`);
        if (!text) return;
        await appendTranscriptLine(guildId, userId, text);
      } catch (error) {
        console.error(`Transcription failure (${reason}):`, error);
      }
    };

    decoder.on("data", (chunk) => state.pcmChunks.push(chunk));
    decoder.once("end", () => {
      void finalize("decoder_end");
    });
    decoder.once("close", () => {
      void finalize("decoder_close");
    });
    decoder.on("error", (error) => {
      const message = String(error?.message || "");
      if (message.includes("Invalid packet")) {
        // Packet loss/corruption can happen in live voice; ignore and keep receiving.
        return;
      }
      console.error("Decoder error:", error);
      void finalize("decoder_error");
    });

    opusStream.once("end", () => {
      void finalize("opus_end");
    });
    opusStream.once("close", () => {
      void finalize("opus_close");
    });
    opusStream.on("error", (error) => {
      if (!isIgnorableStreamError(error)) {
        console.error("Opus stream error:", error);
      }
      void finalize("opus_error");
    });
  });
}

async function stopReceiverForGuild(guildId) {
  const runtime = activeVoiceSessions.get(guildId);
  if (!runtime) return;

  for (const { opusStream, decoder } of runtime.streams.values()) {
    opusStream.destroy();
    decoder.destroy();
  }
  runtime.streams.clear();
  runtime.connection.destroy();
  activeVoiceSessions.delete(guildId);
}

async function replyLong(interaction, commandName, text, metadata = {}) {
  const chunks = chunkDiscordMessage(text);
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply(chunks[0]);
  } else {
    await interaction.followUp(chunks[0]);
  }
  for (let i = 1; i < chunks.length; i += 1) {
    await interaction.followUp(chunks[i]);
  }

  await logInteractionResponse(interaction, commandName, text, {
    delivery: "chunked",
    chunkCount: chunks.length,
    ...metadata
  });
}

function formatTranscriptLines(lines) {
  return lines
    .map((line, index) => `${index + 1}. [${line.timestamp}] ${line.speaker}: ${line.text}`)
    .join("\n");
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "session_start") {
      if (!interaction.guild) {
        await sendReply(interaction, "session_start", "This command only works in a server.");
        return;
      }

      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        await sendReply(
          interaction,
          "session_start",
          "Join a voice channel first, then run /session_start."
        );
        return;
      }

      if (activeVoiceSessions.has(interaction.guildId)) {
        await sendReply(interaction, "session_start", "A session is already running for this server.");
        return;
      }

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      startReceiverForGuild(interaction.guildId, connection);

      const store = await loadStore();
      const guildState = getGuildState(store, interaction.guildId);
      const startedAt = new Date().toISOString();
      const sessionId = buildSessionId(startedAt);
      guildState.currentSession = {
        sessionId,
        active: true,
        startedAt,
        voiceChannelId: voiceChannel.id,
        transcript: []
      };
      await saveStore(store);
      try {
        await initSessionLogs({
          guildId: interaction.guildId,
          sessionId,
          startedAt,
          voiceChannelId: voiceChannel.id
        });
      } catch (error) {
        console.error("Failed to initialize session logs:", error);
      }

      await sendReply(
        interaction,
        "session_start",
        `Session started in **${voiceChannel.name}**. I am now recording and transcribing voice snippets.`,
        { sessionId }
      );
      return;
    }

    if (interaction.commandName === "session_end") {
      if (!interaction.guildId) {
        await sendReply(interaction, "session_end", "This command only works in a server.");
        return;
      }

      await interaction.deferReply();
      await stopReceiverForGuild(interaction.guildId);

      const store = await loadStore();
      const guildState = getGuildState(store, interaction.guildId);
      const session = guildState.currentSession;

      if (!session?.active) {
        await sendEditReply(interaction, "session_end", "No active session exists.");
        return;
      }

      const includeNextSegmentHint = Math.random() < 0.4;
      const summary = await createSessionSummaryTale({
        campaignState: guildState.campaignState,
        transcriptLines: session.transcript,
        includeNextSegmentHint
      });
      const hasTranscript = session.transcript.length > 0;
      const endedAt = new Date().toISOString();
      const sessionId = session.sessionId || buildSessionId(session.startedAt);

      guildState.history.unshift({
        startedAt: session.startedAt,
        endedAt,
        transcriptCount: session.transcript.length,
        transcript: session.transcript,
        sessionId,
        summary
      });
      if (hasTranscript) {
        guildState.campaignState = summary;
      }
      guildState.currentSession = null;
      await saveStore(store);
      try {
        await finalizeSessionLogs({
          guildId: interaction.guildId,
          sessionId,
          startedAt: session.startedAt,
          endedAt,
          transcript: session.transcript,
          summary
        });
      } catch (error) {
        console.error("Failed to finalize session logs:", error);
      }

      await sendEditReply(interaction, "session_end", "Session ended. Compiling final notes...", {
        sessionId,
        transcriptCount: session.transcript.length,
        includeNextSegmentHint
      });
      await replyLong(interaction, "session_end", `# Session Summary\n\n${summary}`, {
        sessionId,
        transcriptCount: session.transcript.length,
        includeNextSegmentHint
      });
      return;
    }

    if (interaction.commandName === "dmnotes") {
      if (!interaction.guildId) {
        await sendReply(interaction, "dmnotes", "This command only works in a server.");
        return;
      }

      await interaction.deferReply();
      const store = await loadStore();
      const guildState = getGuildState(store, interaction.guildId);
      const transcriptLines = guildState.currentSession?.transcript || [];

      const notes = await summarizeDmNotes({
        campaignState: guildState.campaignState,
        transcriptLines
      });
      const transcriptCount = transcriptLines.length;

      await sendEditReply(interaction, "dmnotes", "Compiling dungeon master notes...", {
        transcriptCount
      });
      await replyLong(
        interaction,
        "dmnotes",
        `# DM Notes\n\nTranscript lines in current session: **${transcriptCount}**\n\n${notes}`,
        { transcriptCount }
      );
      return;
    }

    if (interaction.commandName === "reset_campaign") {
      if (!interaction.guildId) {
        await sendReply(interaction, "reset_campaign", "This command only works in a server.");
        return;
      }

      const store = await loadStore();
      const guildState = getGuildState(store, interaction.guildId);
      guildState.campaignState = "";
      await saveStore(store);

      await sendReply(
        interaction,
        "reset_campaign",
        "Saved campaign state cleared. Future notes will be based on new transcript lines."
      );
      return;
    }

    if (interaction.commandName === "transcript") {
      if (!interaction.guildId) {
        await sendReply(interaction, "transcript", "This command only works in a server.");
        return;
      }

      await interaction.deferReply();
      const store = await loadStore();
      const guildState = getGuildState(store, interaction.guildId);
      const transcriptLines = guildState.currentSession?.transcript || [];
      const activeSession = Boolean(guildState.currentSession?.active);
      const fallbackHistoryLines = !activeSession
        ? guildState.history?.[0]?.transcript || []
        : [];
      const effectiveLines = transcriptLines.length ? transcriptLines : fallbackHistoryLines;
      const usingLastSession = !transcriptLines.length && Boolean(fallbackHistoryLines.length);

      if (!effectiveLines.length) {
        const guidance = activeSession
          ? "No transcript lines captured yet. Talk in voice for a few seconds and run /transcript again."
          : "No transcript snapshot available yet. Run /session_start in a voice channel first.";
        await sendEditReply(interaction, "transcript", guidance, {
          activeSession,
          capturedLines: 0
        });
        return;
      }

      const maxLines = 150;
      const start = Math.max(0, effectiveLines.length - maxLines);
      const visibleLines = effectiveLines.slice(start);
      const body = formatTranscriptLines(visibleLines);

      await sendEditReply(interaction, "transcript", "Fetching transcript snapshot...", {
        activeSession,
        capturedLines: effectiveLines.length
      });
      await replyLong(
        interaction,
        "transcript",
        [
          "# Transcript Snapshot",
          "",
          `Active session: **${activeSession ? "yes" : "no"}**`,
          `Source: **${usingLastSession ? "last completed session" : "current session"}**`,
          `Captured lines: **${effectiveLines.length}**`,
          `Showing latest: **${visibleLines.length}**`,
          "",
          body
        ].join("\n"),
        {
          activeSession,
          capturedLines: effectiveLines.length,
          visibleLines: visibleLines.length
        }
      );
      return;
    }
  } catch (error) {
    console.error("Command error:", error);
    const message = "Command failed. Check bot logs for details.";
    if (interaction.deferred) {
      await interaction.editReply(message);
    } else if (interaction.replied) {
      await interaction.followUp(message);
    } else {
      await interaction.reply(message);
    }
    await logInteractionResponse(interaction, interaction.commandName || "unknown", message, {
      delivery: interaction.deferred ? "editReply" : interaction.replied ? "followUp" : "reply",
      error: String(error?.message || error)
    });
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    for (const guildId of activeVoiceSessions.keys()) {
      await stopReceiverForGuild(guildId);
    }
    process.exit(0);
  });
}

client.login(config.discordToken);
