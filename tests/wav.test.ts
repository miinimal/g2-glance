import { describe, expect, it } from 'vitest';
import { G2_PCM, PcmRecorder, WAV_HEADER_BYTES, encodeWav } from '../src/core/wav';

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

describe('encodeWav', () => {
  const pcm = new Uint8Array([1, 0, 255, 127, 0, 128, 2, 0]); // 4 samples
  const wav = encodeWav(pcm);
  const view = new DataView(wav.buffer);

  it('writes a canonical 44-byte PCM header', () => {
    expect(wav.length).toBe(WAV_HEADER_BYTES + pcm.length);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + pcm.length);
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(pcm.length);
  });

  it('copies samples unchanged after the header', () => {
    expect(Array.from(wav.subarray(WAV_HEADER_BYTES))).toEqual(Array.from(pcm));
    expect(view.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(32767);
    expect(view.getInt16(WAV_HEADER_BYTES + 4, true)).toBe(-32768);
  });

  it('drops a trailing partial sample', () => {
    const odd = encodeWav(new Uint8Array([1, 2, 3]));
    expect(odd.length).toBe(WAV_HEADER_BYTES + 2);
    expect(new DataView(odd.buffer).getUint32(40, true)).toBe(2);
  });

  it('encodes an empty recording as a valid empty file', () => {
    const empty = encodeWav(new Uint8Array());
    expect(empty.length).toBe(WAV_HEADER_BYTES);
    expect(new DataView(empty.buffer).getUint32(4, true)).toBe(36);
  });

  it('supports other formats', () => {
    const stereo = encodeWav(new Uint8Array(8), { sampleRate: 48_000, channels: 2, bitsPerSample: 16 });
    const v = new DataView(stereo.buffer);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(28, true)).toBe(192_000);
    expect(v.getUint16(32, true)).toBe(4);
  });
});

describe('PcmRecorder', () => {
  const chunk = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

  it('collects 100 ms chunks and reports duration', () => {
    const r = new PcmRecorder(10_000);
    r.push(chunk(3200));
    r.push(chunk(3200, 2));
    expect(r.byteLength).toBe(6400);
    expect(r.durationMs).toBe(200);
    const pcm = r.pcm();
    expect(pcm[0]).toBe(1);
    expect(pcm[6399]).toBe(2);
  });

  it('stops at the maximum duration and drops the excess', () => {
    const r = new PcmRecorder(250, G2_PCM); // 8,000 bytes
    expect(r.maxBytes).toBe(8000);
    expect(r.push(chunk(3200))).toBe(true);
    expect(r.push(chunk(3200))).toBe(true);
    expect(r.push(chunk(3200))).toBe(false);
    expect(r.full).toBe(true);
    expect(r.byteLength).toBe(8000);
    expect(r.push(chunk(3200))).toBe(false);
    expect(r.byteLength).toBe(8000);
  });

  it('copies chunks so later reuse of the host buffer cannot corrupt the note', () => {
    const r = new PcmRecorder(1000);
    const buf = chunk(4, 7);
    r.push(buf);
    buf.fill(0);
    expect(Array.from(r.pcm())).toEqual([7, 7, 7, 7]);
  });

  it('produces a WAV with the recorded data', () => {
    const r = new PcmRecorder(1000);
    r.push(chunk(3200));
    const wav = r.toWav();
    expect(wav.length).toBe(WAV_HEADER_BYTES + 3200);
  });
});
