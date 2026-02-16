import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  GatewayIntentBits,
  PermissionFlagsBits
} from "discord.js";
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel
} from "@discordjs/voice";
import prism from "prism-media";
import http from "node:http";
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
import { getGuildState, withStore, readStore } from "./store.js";

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

function requireManageGuild(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return "You need the **Manage Server** permission to use this command.";
  }
  return null;
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

  const transcriptLine = {
    timestamp: discordTimestamp(),
    userId,
    speaker,
    text
  };

  const sessionId = await withStore((store) => {
    const guildState = getGuildState(store, guildId);
    if (!guildState.currentSession?.active) return null;
    guildState.currentSession.transcript.push(transcriptLine);
    return guildState.currentSession.sessionId;
  });

  if (sessionId === null) return;

  try {
    if (sessionId) {
      await appendSessionTranscriptLine({
        guildId,
        sessionId,
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

// ~60 seconds of 48kHz stereo 16-bit PCM.
const MAX_PCM_BYTES = 48000 * 2 * 2 * 60;

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
      pcmByteCount: 0,
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

    decoder.on("data", (chunk) => {
      state.pcmChunks.push(chunk);
      state.pcmByteCount += chunk.length;
      // If we hit the buffer cap, flush immediately instead of waiting for silence.
      if (state.pcmByteCount >= MAX_PCM_BYTES) {
        void finalize("buffer_cap");
      }
    });
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

/**
 * Attach reconnect handling to a voice connection.
 * On disconnect, attempt to reconnect within 5 seconds.
 * On permanent failure, notify the text channel and clean up.
 */
function attachReconnectHandler(guildId, connection, textChannelId) {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Try to reconnect within 5 seconds.
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
      // Reconnection in progress — voice library handles it from here.
    } catch {
      // Permanent disconnect — clean up.
      console.error(`[${guildId}] Voice connection lost permanently.`);
      await stopReceiverForGuild(guildId);

      // Notify channel if possible.
      try {
        const channel = client.channels.cache.get(textChannelId);
        if (channel?.isTextBased()) {
          await channel.send(
            "⚠️ Voice connection lost. The recording session has been stopped. Use `/session_end` to save any captured transcript, then `/session_start` to begin a new session."
          );
        }
      } catch (notifyError) {
        console.error("Failed to send disconnect notice:", notifyError);
      }
    }
  });
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

      const permError = requireManageGuild(interaction);
      if (permError) {
        await sendReply(interaction, "session_start", permError);
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
      attachReconnectHandler(interaction.guildId, connection, interaction.channelId);

      const startedAt = new Date().toISOString();
      const sessionId = buildSessionId(startedAt);

      await withStore((store) => {
        const guildState = getGuildState(store, interaction.guildId);
        guildState.currentSession = {
          sessionId,
          active: true,
          startedAt,
          voiceChannelId: voiceChannel.id,
          transcript: []
        };
      });

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
        `Session started in **${voiceChannel.name}**. I am now recording and transcribing voice snippets.\n\n⚠️ **Notice:** Voice in this channel is being recorded and transcribed. Audio is processed via OpenAI's Whisper API and is not stored after transcription.`,
        { sessionId }
      );
      return;
    }

    if (interaction.commandName === "session_end") {
      if (!interaction.guildId) {
        await sendReply(interaction, "session_end", "This command only works in a server.");
        return;
      }

      const permError = requireManageGuild(interaction);
      if (permError) {
        await sendReply(interaction, "session_end", permError);
        return;
      }

      await interaction.deferReply();
      await stopReceiverForGuild(interaction.guildId);

      // Read current session snapshot.
      const sessionSnapshot = await withStore((store) => {
        const guildState = getGuildState(store, interaction.guildId);
        const session = guildState.currentSession;
        if (!session?.active) return null;
        // Return a copy so we can do async GPT work outside the lock.
        return {
          sessionId: session.sessionId || buildSessionId(session.startedAt),
          startedAt: session.startedAt,
          transcript: [...session.transcript],
          campaignState: guildState.campaignState
        };
      });

      if (!sessionSnapshot) {
        await sendEditReply(interaction, "session_end", "No active session exists.");
        return;
      }

      const { sessionId, startedAt, transcript, campaignState } = sessionSnapshot;
      const includeNextSegmentHint = Math.random() < 0.4;
      const summary = await createSessionSummaryTale({
        campaignState,
        transcriptLines: transcript,
        includeNextSegmentHint
      });
      const hasTranscript = transcript.length > 0;
      const endedAt = new Date().toISOString();

      // Commit final state under the lock.
      await withStore((store) => {
        const guildState = getGuildState(store, interaction.guildId);
        guildState.history.unshift({
          startedAt,
          endedAt,
          transcriptCount: transcript.length,
          transcript,
          sessionId,
          summary
        });
        if (hasTranscript) {
          guildState.campaignState = summary;
        }
        guildState.currentSession = null;
      });

      try {
        await finalizeSessionLogs({
          guildId: interaction.guildId,
          sessionId,
          startedAt,
          endedAt,
          transcript,
          summary
        });
      } catch (error) {
        console.error("Failed to finalize session logs:", error);
      }

      await sendEditReply(interaction, "session_end", "Session ended. Compiling final notes...", {
        sessionId,
        transcriptCount: transcript.length,
        includeNextSegmentHint
      });
      await replyLong(interaction, "session_end", `# Session Summary\n\n${summary}`, {
        sessionId,
        transcriptCount: transcript.length,
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

      const snapshot = await readStore().then((store) => {
        const guildState = getGuildState(store, interaction.guildId);
        return {
          campaignState: guildState.campaignState,
          transcriptLines: guildState.currentSession?.transcript || []
        };
      });

      const notes = await summarizeDmNotes(snapshot);
      const transcriptCount = snapshot.transcriptLines.length;

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

      const permError = requireManageGuild(interaction);
      if (permError) {
        await sendReply(interaction, "reset_campaign", permError);
        return;
      }

      const confirmButton = new ButtonBuilder()
        .setCustomId("confirm_reset_campaign")
        .setLabel("Yes, reset campaign")
        .setStyle(ButtonStyle.Danger);

      const cancelButton = new ButtonBuilder()
        .setCustomId("cancel_reset_campaign")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

      const confirmMsg = await interaction.reply({
        content: "\u26a0\ufe0f **Are you sure?** This will permanently clear all saved campaign state. Session history and logs are not affected.",
        components: [row],
        fetchReply: true
      });

      try {
        const buttonPress = await confirmMsg.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === interaction.user.id,
          time: 30_000
        });

        if (buttonPress.customId === "confirm_reset_campaign") {
          await withStore((store) => {
            const guildState = getGuildState(store, interaction.guildId);
            // Backup before clearing.
            if (guildState.campaignState) {
              guildState.lastCampaignBackup = guildState.campaignState;
            }
            guildState.campaignState = "";
          });

          await buttonPress.update({
            content: "\u2705 Campaign state cleared. Future notes will be based on new transcript lines.",
            components: []
          });
          await logInteractionResponse(interaction, "reset_campaign", "Campaign state cleared (confirmed).");
        } else {
          await buttonPress.update({
            content: "Reset cancelled.",
            components: []
          });
          await logInteractionResponse(interaction, "reset_campaign", "Reset cancelled by user.");
        }
      } catch {
        // Timeout — no button pressed within 30 seconds.
        await interaction.editReply({
          content: "Reset timed out (no response within 30 seconds). Campaign state was not changed.",
          components: []
        });
        await logInteractionResponse(interaction, "reset_campaign", "Reset timed out.");
      }
      return;
    }

    if (interaction.commandName === "transcript") {
      if (!interaction.guildId) {
        await sendReply(interaction, "transcript", "This command only works in a server.");
        return;
      }

      await interaction.deferReply();

      const snapshot = await readStore().then((store) => {
        const guildState = getGuildState(store, interaction.guildId);
        return {
          transcriptLines: guildState.currentSession?.transcript || [],
          activeSession: Boolean(guildState.currentSession?.active),
          fallbackHistoryLines: !guildState.currentSession?.active
            ? guildState.history?.[0]?.transcript || []
            : []
        };
      });

      const { transcriptLines, activeSession, fallbackHistoryLines } = snapshot;
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

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

// Tiny HTTP server for Render health checks.
const healthPort = Number(process.env.PORT) || 10000;
http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(healthPort, () => {
  console.log(`Health check listening on port ${healthPort}`);
});

client.login(config.discordToken);
