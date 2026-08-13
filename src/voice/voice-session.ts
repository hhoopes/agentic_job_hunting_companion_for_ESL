// Composes mic → VAD → Whisper into one always-on listener.
// Consumer supplies `onText(text)`; we invoke it once per completed utterance.

import { startMic } from './mic-stream.js';
import { createVadSession, type VadOptions } from './vad-session.js';
import { transcribeWav, type WhisperTranscribeOptions } from './whisper-client.js';

export interface VoiceSessionOptions {
  language?: string;                        // Whisper lang hint (also tunes VAD if you want)
  task?: 'transcribe' | 'translate';
  whisperBaseUrl?: string;
  micDevice?: string;                       // usually omit — sox default is fine
  vad?: VadOptions;                         // override thresholds
  onSpeechStart?(): void;                   // UI hint: "listening..."
  onText(text: string): Promise<void> | void;
  onError?(err: unknown): void;
}

export interface VoiceSession {
  stop(): void;
}

export async function startVoiceSession(opts: VoiceSessionOptions): Promise<VoiceSession> {
  const whisperOpts: WhisperTranscribeOptions = {
    language: opts.language,
    task: opts.task ?? 'transcribe',
    baseUrl: opts.whisperBaseUrl,
  };

  // Fail fast if the sidecar isn't up — better than a mysterious silence.
  await pingSidecar(whisperOpts.baseUrl ?? 'http://127.0.0.1:8080');

  const vad = await createVadSession(
    {
      onSpeechStart: () => opts.onSpeechStart?.(),
      onSpeechEnd: async (wav) => {
        try {
          const text = await transcribeWav(wav, whisperOpts);
          if (text) await opts.onText(text);
        } catch (err) {
          opts.onError?.(err);
        }
      },
    },
    opts.vad ?? {},
  );

  const mic = startMic({ device: opts.micDevice });

  let closed = false;
  // Serialize feeds: Silero VAD carries recurrent hidden state that MUST be
  // updated in strict frame order. If we let mic.on('data') fire concurrent
  // feed() calls (which happens naturally after any long await elsewhere in
  // the process — e.g. an LLM call between turns), the model state gets
  // scrambled and speech detection stops working. Chain-await guarantees
  // one-at-a-time processing without dropping chunks.
  let feedChain: Promise<void> = Promise.resolve();
  mic.stream.on('data', (chunk: Buffer) => {
    if (closed) return;
    feedChain = feedChain
      .then(() => vad.feed(chunk))
      .catch((err) => opts.onError?.(err));
  });
  mic.stream.on('error', (err) => opts.onError?.(err));

  return {
    stop() {
      if (closed) return;
      closed = true;
      mic.stop();
      vad.close();
    },
  };
}

async function pingSidecar(baseUrl: string): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`sidecar health ${res.status}`);
  } catch (err) {
    throw new Error(
      `Cannot reach whisper sidecar at ${baseUrl}. ` +
      `Start it with:  python scripts/whisper_server.py --model small`,
    );
  }
}
