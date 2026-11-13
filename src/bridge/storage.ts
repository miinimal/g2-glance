import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { KeyValueStore, NoteStore, SavedNote } from '../app/controller';

/** Plugin storage provided by the Even App. */
export class BridgeStore implements KeyValueStore {
  constructor(private readonly bridge: EvenAppBridge) {}

  async get(key: string): Promise<string | null> {
    const value = await this.bridge.getLocalStorage(key);
    return value === '' || value === undefined || value === null ? null : value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.bridge.setLocalStorage(key, value);
  }
}

/** Browser storage, used when the page is opened outside the Even App. */
export class BrowserStore implements KeyValueStore {
  async get(key: string): Promise<string | null> {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable (private mode); settings then last for this session only.
    }
  }
}

const DB_NAME = 'g2-glance';
const STORE = 'notes';
/** Notes kept on the phone; the oldest are removed first. */
export const MAX_SAVED_NOTES = 20;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Voice notes saved in the WebView's IndexedDB on the phone. */
export class IndexedDbNotes implements NoteStore {
  async add(note: SavedNote): Promise<void> {
    const db = await open();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(note);
      await done(tx);
      const all = await this.list();
      const extra = all.slice(MAX_SAVED_NOTES);
      if (extra.length > 0) {
        const del = db.transaction(STORE, 'readwrite');
        for (const n of extra) del.objectStore(STORE).delete(n.id);
        await done(del);
      }
    } finally {
      db.close();
    }
  }

  /** Newest first. */
  async list(): Promise<SavedNote[]> {
    const db = await open();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      const notes = await new Promise<SavedNote[]>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as SavedNote[]);
        req.onerror = () => reject(req.error);
      });
      return notes.sort((a, b) => b.createdAt - a.createdAt);
    } finally {
      db.close();
    }
  }

  async remove(id: string): Promise<void> {
    const db = await open();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      await done(tx);
    } finally {
      db.close();
    }
  }
}
