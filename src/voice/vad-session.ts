// Live voice-activity detection using Silero VAD.
//
// The @ricky0123/vad-node top-level export only ships NonRealTimeVAD (batch).
// We reach into the /_common submodule for the streaming primitives (Silero
// model + FrameProcessor + utils.encodeWAV). Deep import, but public within
// the package: its own index.js re-exports the same submodule.
//
// Frames are 1536 samples of Float32 (96 ms at 16 kHz). We convert the mic's
// Int16 PCM to Float32 in-line, buffer to frame boundaries, and dispatch to
// the FrameProcessor. On SpeechEnd we get a Float32Array of the speech segment
// (with preSpeechPadFrames of lookback) — encode to WAV and hand off.

import { createRequire } from 'module';
import fs from 'fs/promises';

// Deep-import CJS subpath — Node ESM requires the explicit .js extension when
// the target package has no `exports` map.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as vadCommon from '@ricky0123/vad-node/dist/_common/index.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as ort from 'onnxruntime-node';

const { Silero, FrameProcessor, Message, utils } = vadCommon as unknown as {
  Silero: { new: (ort: unknown, fetcher: () => Promise<ArrayBuffer>) => Promise<SileroInstance> };
  FrameProcessor: new (
    modelProcess: (frame: Float32Array) => Promise<unknown>,
    modelReset: () => unknown,
    options: FrameProcessorOpts,
  ) => FrameProcessorInstance;
  Message: { SpeechStart: string; SpeechEnd: string; VADMisfire: string };
  utils: { encodeWAV: (samples: Float32Array) => ArrayBuffer };
};

interface SileroInstance {
  process: (frame: Float32Array) => Promise<unknown>;
  reset_state: () => void;
}
interface FrameProcessorOpts {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionFrames: number;
  frameSamples: number;
  preSpeechPadFrames: number;
  minSpeechFrames: number;
  submitUserSpeechOnPause: boolean;
}
interface FrameProcessorInstance {
  resume(): void;
  process(frame: Float32Array): Promise<{ msg?: string; audio?: Float32Array }>;
  endSegment(): { msg?: string; audio?: Float32Array };
}

// createRequire gives us Node's CJS resolver — the cleanest way to locate the
// bundled ONNX model file inside the installed package from ESM.
const requireFromHere = createRequire(import.meta.url);

const FRAME_SAMPLES = 1536;

export interface VadOptions {
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionFrames?: number;
  preSpeechPadFrames?: number;
  minSpeechFrames?: number;
}

export interface VadSession {
  feed(pcm16: Buffer): Promise<void>;
  flush(): Promise<Buffer | null>;
  close(): void;
}

export interface VadCallbacks {
  onSpeechStart?(): void;
  onSpeechEnd(wav: Buffer): void;
  onMisfire?(): void;
}

export async function createVadSession(cb: VadCallbacks, opts: VadOptions = {}): Promise<VadSession> {
  const modelPath = requireFromHere.resolve('@ricky0123/vad-node/dist/silero_vad.onnx');
  const modelFetcher = async (): Promise<ArrayBuffer> => {
    const contents = await fs.readFile(modelPath);
    return contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength);
  };

  const silero = await Silero.new(ort, modelFetcher);

  const positive = opts.positiveSpeechThreshold ?? 0.5;
  const processor = new FrameProcessor(
    silero.process,
    silero.reset_state,
    {
      positiveSpeechThreshold: positive,
      negativeSpeechThreshold: opts.negativeSpeechThreshold ?? positive - 0.15,
      redemptionFrames: opts.redemptionFrames ?? 8,
      frameSamples: FRAME_SAMPLES,
      preSpeechPadFrames: opts.preSpeechPadFrames ?? 1,
      minSpeechFrames: opts.minSpeechFrames ?? 3,
      submitUserSpeechOnPause: false,
    },
  );
  processor.resume();

  let pcmTail: Buffer = Buffer.alloc(0);

  const processOne = async (frame: Float32Array): Promise<void> => {
    const { msg, audio } = await processor.process(frame);
    if (msg === Message.SpeechStart) {
      cb.onSpeechStart?.();
    } else if (msg === Message.SpeechEnd && audio) {
      const wav = Buffer.from(utils.encodeWAV(audio));
      cb.onSpeechEnd(wav);
    } else if (msg === Message.VADMisfire) {
      cb.onMisfire?.();
    }
  };

  return {
    async feed(pcm16: Buffer) {
      const combined = pcmTail.length === 0 ? pcm16 : Buffer.concat([pcmTail, pcm16]);
      const totalSamples = Math.floor(combined.length / 2);
      const wholeFrames = Math.floor(totalSamples / FRAME_SAMPLES);
      const usableBytes = wholeFrames * FRAME_SAMPLES * 2;

      pcmTail = combined.subarray(usableBytes);
      if (wholeFrames === 0) return;

      for (let i = 0; i < wholeFrames; i++) {
        const offset = i * FRAME_SAMPLES * 2;
        const frame = new Float32Array(FRAME_SAMPLES);
        for (let s = 0; s < FRAME_SAMPLES; s++) {
          const lo = combined[offset + s * 2];
          const hi = combined[offset + s * 2 + 1];
          const int16 = (hi << 8) | lo;
          const signed = int16 & 0x8000 ? int16 - 0x10000 : int16;
          frame[s] = signed / 32768;
        }
        await processOne(frame);
      }
    },

    async flush() {
      const { audio } = processor.endSegment();
      if (audio && audio.length >= FRAME_SAMPLES * (opts.minSpeechFrames ?? 3)) {
        return Buffer.from(utils.encodeWAV(audio));
      }
      return null;
    },

    close() {
      pcmTail = Buffer.alloc(0);
    },
  };
}
