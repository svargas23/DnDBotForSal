export function chunkDiscordMessage(text, maxLength = 1900) {
  if (!text) return ["(empty)"];
  if (text.length <= maxLength) return [text];

  const parts = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex < maxLength * 0.6) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex < 1) splitIndex = maxLength;

    parts.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length) parts.push(remaining);
  return parts;
}

export function discordTimestamp(date = new Date()) {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
