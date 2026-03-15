/**
 * Thin IndexedDB wrapper for session persistence.
 *
 * Bump SCHEMA_V whenever the StoredSession shape changes — old data is
 * silently discarded on next load rather than causing errors.
 */

import type { FigureBBox, Highlight, ParsedPaper } from "./types";

const DB_NAME   = "docent";
const STORE     = "session";
const KEY       = "current";
const SCHEMA_V  = 1; // ← bump to wipe stored data on breaking changes

export interface StoredSession {
  fileName:   string;
  fileSize:   number;
  pdfBlob:    Blob;
  paper:      ParsedPaper;
  highlights: Highlight[];
  figures:    FigureBBox[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function saveSession(data: StoredSession): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ schemaV: SCHEMA_V, ...data }, KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch { /* silently ignore — persistence is best-effort */ }
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const db = await openDb();
    return await new Promise<StoredSession | null>((resolve) => {
      const tx  = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        db.close();
        const val = req.result;
        if (!val || val.schemaV !== SCHEMA_V) { resolve(null); return; }
        const { schemaV: _, ...session } = val;
        resolve(session as StoredSession);
      };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch { return null; }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); resolve(); };
    });
  } catch { /* silently ignore */ }
}
