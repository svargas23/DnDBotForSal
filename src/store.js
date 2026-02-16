import fs from "node:fs/promises";
import path from "node:path";

const STORE_PATH = path.resolve("data/store.json");

const emptyStore = {
  guilds: {}
};

async function ensureStoreFile() {
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(emptyStore, null, 2), "utf8");
  }
}

export async function loadStore() {
  await ensureStoreFile();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return structuredClone(emptyStore);
  }
}

export async function saveStore(store) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export function getGuildState(store, guildId) {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {
      campaignState: "",
      currentSession: null,
      history: []
    };
  }
  return store.guilds[guildId];
}
