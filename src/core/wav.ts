/**
 * WAV (RIFF, PCM) encoding for G2 microphone audio.
 *
 * The glasses deliver PCM as 16 kHz, signed 16-bit little-endian, mono, in chunks
 * (100 ms = 3,200 bytes in the simulator). The recorder collects chunks and the encoder writes a
 * canonical 44-byte header in front of them.
 */

export const G2_SAMPLE_RATE = 16_000;
export const G2_CHANNELS = 1;
export const G2_BITS_PER_SAMPLE = 16;
export const WAV_HEADER_BYTES = 44;

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export const G2_PCM: PcmFormat = {
  sampleRate: G2_SAMPLE_RATE,
  channels: G2_CHANNELS,
  bitsPerSample: G2_BITS_PER_SAMPLE,
};

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Bytes in one sample frame (all channels). */
export function blockAlign(format: PcmFormat): number {
  return format.channels * (format.bitsPerSample / 8);
}

/** Build a WAV file from raw little-endian PCM bytes. A trailing partial frame is dropped. */
export function encodeWav(pcm: Uint8Array, format: PcmFormat = G2_PCM): Uint8Array {
  const align = blockAlign(format);
  const dataBytes = pcm.length - (pcm.length % align);
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size for PCM
  view.setUint16(20, 1, true); // audio format 1 = PCM
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * align, true); // byte rate
  view.setUint16(32, align, true);
  view.setUint16(34, format.bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  out.set(pcm.subarray(0, dataBytes), WAV_HEADER_BYTES);
  return out;
}

/** Collects PCM chunks up to a maximum duration. */
export class PcmRecorder {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  readonly maxBytes: number;

  constructor(
    readonly maxDurationMs: number,
    readonly format: PcmFormat = G2_PCM,
  ) {
    const bytesPerMs = (format.sampleRate * blockAlign(format)) / 1000;
    this.maxBytes = Math.floor(maxDurationMs * bytesPerMs);
  }

  /** Append a chunk. Returns false once the maximum duration is reached (the excess is dropped). */
  push(chunk: Uint8Array): boolean {
    const room = this.maxBytes - this.bytes;
    if (room <= 0) return false;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(part.slice());
    this.bytes += part.length;
    return this.bytes < this.maxBytes;
  }

  get byteLength(): number {
    return this.bytes;
  }

  get durationMs(): number {
    return (this.bytes / (this.format.sampleRate * blockAlign(this.format))) * 1000;
  }

  get full(): boolean {
    return this.bytes >= this.maxBytes;
  }

  /** Concatenate everything recorded so far. */
  pcm(): Uint8Array {
    const out = new Uint8Array(this.bytes);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  toWav(): Uint8Array {
    return encodeWav(this.pcm(), this.format);
  }
}
