const DB_NAME = "mls_gm_2026_db";
const STORE = "saves";
const LS_PREFIX = "mls_gm_2026_slot_";

function hasIndexedDb() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function lsKey(slot) {
  return `${LS_PREFIX}${slot}`;
}

function listLocalSlots() {
  try {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LS_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      out.push(parsed);
    }
    return out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  } catch {
    return [];
  }
}

function saveLocalSlot(slot, data) {
  const payload = { slot, updatedAt: new Date().toISOString(), data };
  localStorage.setItem(lsKey(slot), JSON.stringify(payload));
  return true;
}

function loadLocalSlot(slot) {
  const raw = localStorage.getItem(lsKey(slot));
  if (!raw) return null;
  return JSON.parse(raw)?.data || null;
}

function deleteLocalSlot(slot) {
  localStorage.removeItem(lsKey(slot));
  return true;
}

function openDb() {
  if (!hasIndexedDb()) return Promise.reject(new Error("indexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "slot" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSlot(slot, data) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        slot,
        updatedAt: new Date().toISOString(),
        data,
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return saveLocalSlot(slot, data);
  }
}

export async function loadSlot(slot) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(slot);
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return loadLocalSlot(slot);
  }
}

export async function listSlots() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return listLocalSlots();
  }
}

export async function deleteSlot(slot) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(slot);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return deleteLocalSlot(slot);
  }
}
