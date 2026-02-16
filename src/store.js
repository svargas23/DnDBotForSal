import fs from "node:fs/promises";
import path from "node:path";

const STORE_PATH = path.resolve("data/store.json");
const MAX_HISTORY = 50;

const emptyStore = {
  guilds: {}
};

// Simple promise-based mutex to prevent concurrent read-modify-write races.
let _lock = Promise.resolve();
function withLock(fn) {
  const next = _lock.then(fn, fn);
  _lock = next.catch(() => {});
  return next;
}

async function ensureStoreFile() {
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(emptyStore, null, 2), "utf8");
  }
}

async function _loadStore() {
  await ensureStoreFile();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return structuredClone(emptyStore);
  }
}

async function _saveStore(store) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Load the store, apply a mutator function, then save atomically.
 * All callers share a single lock so concurrent writes never clobber each other.
 *
 * @param {(store: object) => Promise<any> | any} mutator - receives the store, mutates it, and
 *   optionally returns a value that `withStore` will pass through.
 * @returns {Promise<any>} whatever the mutator returned.
 */
export async function withStore(mutator) {
  return withLock(async () => {
    const store = await _loadStore();
    const result = await mutator(store);
    await _saveStore(store);
    return result;
  });
}

/**
 * Read-only store access (still goes through the lock to avoid reading mid-write).
 */
export async function readStore() {
  return withLock(() => _loadStore());
}

export function getGuildState(store, guildId) {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {
      campaignState: "",
      currentSession: null,
      history: []
    };
  }
  const guild = store.guilds[guildId];

  // Cap history to prevent unbounded growth.
  if (guild.history.length > MAX_HISTORY) {
    guild.history = guild.history.slice(0, MAX_HISTORY);
  }

  return guild;
}
