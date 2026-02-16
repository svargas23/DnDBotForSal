# Privacy Policy — DnD Voice Notes Discord Bot

**Last Updated:** February 16, 2026

This Privacy Policy describes how the DnD Voice Notes Discord Bot ("the Bot", "we", "our") collects, uses, and handles your information when you interact with the Bot in a Discord server.

---

## 1. Information We Collect

### Voice Audio
When a server administrator starts a recording session via `/session_start`, the Bot captures voice audio from participants in the active voice channel. Audio is captured only while a session is explicitly active.

### Transcription Data
Voice audio is converted to text transcriptions. Transcriptions include:
- The text content of what was spoken
- The speaker's Discord display name
- Timestamps

### Server Metadata
- Discord server (guild) ID
- Voice channel ID
- User IDs of participants who speak during a session

### Command Usage
- Which slash commands are executed, by whom, and the Bot's responses

---

## 2. How We Use Your Information

| Data | Purpose | Retention |
|---|---|---|
| Voice audio | Sent to OpenAI's Whisper API for speech-to-text transcription | **Not stored.** Audio is streamed to OpenAI and discarded immediately after transcription. |
| Transcriptions | Used to generate campaign notes and session summaries | Stored locally on the Bot's host server in session log files and the data store. |
| Server metadata | Associates sessions and campaign state with the correct server | Stored locally alongside session data. |
| Command logs | Debugging and operational monitoring | Stored locally in log files. |

---

## 3. Third-Party Services

### OpenAI
Voice audio chunks are sent to the **OpenAI API** (Whisper model) for transcription, and transcript text is sent to OpenAI's GPT models for note generation. OpenAI's use of this data is governed by [OpenAI's API data usage policies](https://openai.com/policies/api-data-usage-policies). As of this writing, OpenAI does not use API inputs/outputs for training.

We do not share your data with any other third parties.

---

## 4. Data Storage & Security

- All data is stored locally on the server hosting the Bot.
- Data is stored in JSON files on disk and is not encrypted at rest.
- No data is transmitted to any service other than OpenAI (for transcription and summarization) and Discord (for delivering command responses).

---

## 5. Data Retention

- **Voice audio:** Not retained. Discarded immediately after transcription.
- **Transcriptions and summaries:** Retained indefinitely on the host server unless manually deleted by the server operator.
- **Session history:** The most recent 50 sessions per server are retained in the active data store. Older sessions may persist in log files.

---

## 6. User Rights & Control

- **Starting/stopping recording:** Only users with the **Manage Server** permission can start or stop recording sessions.
- **Consent notice:** The Bot posts a visible notice in the channel when recording begins.
- **Data deletion:** Server administrators can request deletion of their server's data by contacting the Bot operator.
- **Opting out:** Users who do not wish to be recorded should leave the voice channel before a session is started, or request the server administrator not to start a session.

---

## 7. Children's Privacy

The Bot is not directed at children under 13. We do not knowingly collect information from children under 13. Discord's own Terms of Service require users to be at least 13 years old.

---

## 8. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected by updating the "Last Updated" date at the top of this document. Continued use of the Bot after changes constitutes acceptance of the updated policy.

---

## 9. Contact

If you have questions about this Privacy Policy or wish to request data deletion, please contact the Bot operator via the support server or repository linked in the Bot's Discord profile.
