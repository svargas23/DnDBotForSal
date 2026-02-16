import "dotenv/config";
import { REST, Routes } from "discord.js";
import { slashCommands } from "../src/commands.js";
import { config } from "../src/config.js";

const useGuild = process.argv.includes("--guild");

async function main() {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  if (useGuild) {
    if (!config.discordGuildId) {
      console.error("DISCORD_GUILD_ID is required when using --guild flag.");
      process.exit(1);
    }
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
      { body: slashCommands }
    );
    console.log(
      `Registered ${slashCommands.length} guild commands in ${config.discordGuildId}.`
    );
  } else {
    await rest.put(
      Routes.applicationCommands(config.discordClientId),
      { body: slashCommands }
    );
    console.log(
      `Registered ${slashCommands.length} global commands. They may take up to 1 hour to propagate.`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
