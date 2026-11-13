import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbNotes, MAX_SAVED_NOTES } from '../src/bridge/storage';

const note = (i: number) => ({
  id: `note-${i}`,
  createdAt: 1_000 + i,
  durationMs: 1000,
  wav: new Uint8Array([82, 73, 70, 70, i]),
  sent: i % 2 === 0,
});

describe('IndexedDbNotes', () => {
  it('stores notes newest first and keeps the bytes', async () => {
    const store = new IndexedDbNotes();
    await store.add(note(1));
    await store.add(note(2));
    const list = await store.list();
    expect(list.map((n) => n.id)).toEqual(['note-2', 'note-1']);
    expect(Array.from(list[1]!.wav)).toEqual([82, 73, 70, 70, 1]);
    await store.remove('note-2');
    expect((await store.list()).map((n) => n.id)).toEqual(['note-1']);
    await store.remove('note-1');
  });

  it(`keeps only the newest ${MAX_SAVED_NOTES}`, async () => {
    const store = new IndexedDbNotes();
    for (let i = 0; i < MAX_SAVED_NOTES + 3; i++) await store.add(note(i));
    const list = await store.list();
    expect(list).toHaveLength(MAX_SAVED_NOTES);
    expect(list[list.length - 1]!.id).toBe('note-3');
  });
});
