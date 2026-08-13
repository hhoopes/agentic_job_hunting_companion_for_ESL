// Client for the local whisper sidecar (scripts/whisper_server.py).
// POST WAV bytes to /inference; get {text} back. Model stays resident on the
// Python side, so per-turn latency is transcribe-time only (no reload).

export interface WhisperTranscribeOptions {
  language?: string;                   // 'ar', 'es', 'en', ... — omit to autodetect
  task?: 'transcribe' | 'translate';   // 'translate' forces English output
  baseUrl?: string;                    // default: http://127.0.0.1:8080
  timeoutMs?: number;                  // default: 30000
}

export async function transcribeWav(wav: Buffer, opts: WhisperTranscribeOptions = {}): Promise<string> {
  const baseUrl = (opts.baseUrl || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const params = new URLSearchParams();
  if (opts.language) params.set('language', opts.language);
  if (opts.task) params.set('task', opts.task);
  const qs = params.toString();
  const url = `${baseUrl}/inference${qs ? '?' + qs : ''}`;

  const form = new FormData();
  // Node 20+ has global FormData/Blob; wrap the buffer in a Blob so multipart
  // encoding works without an external `form-data` dep.
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);

  try {
    const res = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`whisper sidecar ${res.status}: ${detail || res.statusText}`);
    }
    const json = await res.json() as { text?: string };
    return (json.text || '').trim();
  } finally {
    clearTimeout(timeoutId);
  }
}
