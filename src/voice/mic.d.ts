// Ambient declaration for the untyped `mic` package.
declare module 'mic' {
  import type { Readable } from 'stream';
  interface MicInstance {
    start(): void;
    stop(): void;
    getAudioStream(): Readable;
  }
  const mic: (opts: Record<string, string | number | boolean>) => MicInstance;
  export default mic;
}
