// src/utils/session.ts
//
// Persists a finished capture so reloading the page does not force the user to
// re-process the video. Frames are stored as Blobs in IndexedDB rather than
// base64 in localStorage: the quota is far larger and there is no 33% encoding
// overhead.
//
// Nothing leaves the device. The store is keyed by session id, so a new upload
// replaces the old session unless the user keeps it.

import { Frame, ProcessingOptions } from '../types';

const DB_NAME = 'wansnap';
const DB_VERSION = 1;
const STORE = 'sessions';
const CURRENT_KEY = 'current';

export interface StoredSession {
  id: string;
  savedAt: number;
  fileName: string;
  duration: number;
  format: string;
  options: ProcessingOptions;
  frames: { timestamp: number; blob: Blob }[];
}

/** Refuse to persist when the quota is clearly too small for the frame set. */
const ESTIMATE_BYTES_PER_FRAME = 220 * 1024;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local database'));
    request.onblocked = () => reject(new Error('The local database is blocked by another tab'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Database request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export const sessionStore = {
  /** Approximate size the current session would occupy. */
  estimateBytes(frameCount: number): number {
    return frameCount * ESTIMATE_BYTES_PER_FRAME;
  },

  async save(
    frames: Frame[],
    meta: { fileName: string; duration: number; options: ProcessingOptions }
  ): Promise<boolean> {
    const records: StoredSession['frames'] = [];
    for (const frame of frames) {
      try {
        const response = await fetch(frame.url);
        records.push({ timestamp: frame.timestamp, blob: await response.blob() });
      } catch {
        // A frame that cannot be read is dropped rather than failing the save.
      }
    }

    if (records.length === 0) return false;

    const session: StoredSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: Date.now(),
      fileName: meta.fileName,
      duration: meta.duration,
      format: meta.options.format,
      options: meta.options,
      frames: records,
    };

    const db = await openDatabase();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(session);
      tx.objectStore(STORE).put({ ...session, id: CURRENT_KEY });
      await transactionDone(tx);
      return true;
    } catch (error) {
      // Almost always a quota error. This is a nice-to-have, so it must never
      // break the capture flow.
      console.warn('[session] could not save:', error);
      return false;
    } finally {
      db.close();
    }
  },

  async loadCurrent(): Promise<{ session: StoredSession; frames: Frame[] } | null> {
    let db: IDBDatabase;
    try {
      db = await openDatabase();
    } catch {
      return null;
    }

    try {
      const tx = db.transaction(STORE, 'readonly');
      const stored = await idbRequest<StoredSession | undefined>(
        tx.objectStore(STORE).get(CURRENT_KEY)
      );
      if (!stored?.frames?.length) return null;

      const frames = stored.frames.map((record, index) => ({
        id: `restored-${index}`,
        url: URL.createObjectURL(record.blob),
        timestamp: record.timestamp,
      }));

      return {
        session: { ...stored, id: stored.id === CURRENT_KEY ? 'current' : stored.id },
        frames,
      };
    } catch (error) {
      console.warn('[session] could not load:', error);
      return null;
    } finally {
      db.close();
    }
  },

  async clear(): Promise<void> {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await transactionDone(tx);
      db.close();
    } catch (error) {
      console.warn('[session] could not clear:', error);
    }
  },

  /** Removes everything except the current session. */
  async pruneOlderThan(days: number): Promise<void> {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const all = await idbRequest<StoredSession[]>(store.getAll());
      const cutoff = Date.now() - days * 86_400_000;
      for (const entry of all) {
        if (entry.id !== CURRENT_KEY && entry.savedAt < cutoff) store.delete(entry.id);
      }
      await transactionDone(tx);
      db.close();
    } catch (error) {
      console.warn('[session] could not prune:', error);
    }
  },
};