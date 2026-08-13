// Thin wrapper over the `mic` npm package (which spawns sox on macOS).
// Produces 16 kHz / 16-bit signed / mono little-endian PCM — exactly what Silero
// VAD and Whisper both consume without resampling.

import type { Readable } from 'stream';
// `mic` is a CJS package with `module.exports = factoryFn`. Node's ESM/CJS
// interop maps that to a default import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import micDefault from 'mic';

interface MicInstance {
  start(): void;
  stop(): void;
  getAudioStream(): Readable;
}
type MicFactory = (opts: Record<string, string | number | boolean>) => MicInstance;

const micFactory: MicFactory = micDefault as unknown as MicFactory;

export interface MicStreamOptions {
  device?: string;      // sox device string; undefined = system default
  debug?: boolean;
}

export function startMic(opts: MicStreamOptions = {}): { stream: Readable; stop: () => void } {
  const instance = micFactory({
    rate: 16000,
    channels: 1,
    bitwidth: 16,
    encoding: 'signed-integer',
    endian: 'little',
    ...(opts.device ? { device: opts.device } : {}),
    debug: opts.debug ?? false,
  });

  const stream = instance.getAudioStream();
  instance.start();

  return {
    stream,
    stop: () => {
      try { instance.stop(); } catch { /* mic throws if already stopped */ }
    },
  };
}
