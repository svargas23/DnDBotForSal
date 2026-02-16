import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  discordToken: required("DISCORD_BOT_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordGuildId: process.env.DISCORD_GUILD_ID || "",
  openaiApiKey: required("OPENAI_API_KEY"),
  summaryModel: process.env.SUMMARY_MODEL || "gpt-4o-mini",
  transcriptionModel: process.env.TRANSCRIPTION_MODEL || "whisper-1",
  transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE || "en",
  transcriptionPrompt: process.env.TRANSCRIPTION_PROMPT || "",
  minAudioBytes: Number(process.env.MIN_AUDIO_BYTES || 30000)
};
