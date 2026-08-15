const KANA_SPEECH = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・、。！？?!.…〜～\s]+$/u;

export const DEFAULT_SPEECH_RATE = 0.82;

export function validateSpeechReading(value, label = "Speech reading") {
  if (typeof value !== "string" || !value.trim() || !KANA_SPEECH.test(value)) {
    throw new TypeError(`${label} must be authored in kana so the device voice never guesses a kanji reading.`);
  }
  return value;
}

export function japaneseVoiceFor(voices = []) {
  return [...voices]
    .filter((voice) => /^ja(?:-|_)/i.test(voice?.lang ?? ""))
    .sort((a, b) => Number(b.localService) - Number(a.localService)
      || Number(/^ja-JP$/i.test(b.lang)) - Number(/^ja-JP$/i.test(a.lang))
      || String(a.name ?? "").localeCompare(String(b.name ?? "")))[0] ?? null;
}

export function speechCapability({
  synthesis = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance
} = {}) {
  if (!synthesis || typeof synthesis.getVoices !== "function" || typeof synthesis.speak !== "function"
    || typeof Utterance !== "function") {
    return { status: "unavailable", voice: null, reason: "This browser does not expose device speech." };
  }
  const voices = synthesis.getVoices();
  if (!Array.isArray(voices) || voices.length === 0) {
    return { status: "loading", voice: null, reason: "Device voices are still loading." };
  }
  const voice = japaneseVoiceFor(voices);
  if (!voice) {
    return { status: "unavailable", voice: null, reason: "No Japanese device voice is installed." };
  }
  return { status: "ready", voice, reason: null };
}

export function speakJapanese(reading, {
  synthesis = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  rate = DEFAULT_SPEECH_RATE,
  onEnd,
  onError
} = {}) {
  validateSpeechReading(reading);
  const capability = speechCapability({ synthesis, Utterance });
  if (capability.status !== "ready") return { ok: false, ...capability };

  const utterance = new Utterance(reading);
  utterance.lang = "ja-JP";
  utterance.voice = capability.voice;
  utterance.rate = rate;
  utterance.pitch = 1;
  if (typeof onEnd === "function") utterance.onend = onEnd;
  if (typeof onError === "function") utterance.onerror = onError;
  synthesis.cancel?.();
  synthesis.speak(utterance);
  return { ok: true, status: "ready", voice: capability.voice, utterance };
}

export function stopJapaneseSpeech(synthesis = globalThis.speechSynthesis) {
  synthesis?.cancel?.();
}
