import "dotenv/config";
import { REST, Routes } from "discord.js";
import { slashCommands } from "../src/commands.js";
import { config } from "../src/config.js";

async function main() {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: slashCommands }
  );

  console.log(
    `Registered ${slashCommands.length} commands in guild ${config.discordGuildId}.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
