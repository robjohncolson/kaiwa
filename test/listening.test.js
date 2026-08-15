import test from "node:test";
import assert from "node:assert/strict";

import {
  japaneseVoiceFor,
  speechCapability,
  speakJapanese,
  validateSpeechReading
} from "../src/listening.js";

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

test("speech answer keys must be kana-authored", () => {
  assert.equal(validateSpeechReading("なんじでもいいよ。"), "なんじでもいいよ。");
  assert.equal(validateSpeechReading("エスエックスシーワン"), "エスエックスシーワン");
  assert.throws(() => validateSpeechReading("何時でもいいよ。"), /kana/);
  assert.throws(() => validateSpeechReading("SXC-1"), /kana/);
});

test("Japanese local voices are selected deterministically", () => {
  const remote = { name: "A remote", lang: "ja-JP", localService: false };
  const local = { name: "B local", lang: "ja-JP", localService: true };
  const english = { name: "English", lang: "en-US", localService: true };
  assert.equal(japaneseVoiceFor([remote, english, local]), local);
  assert.equal(japaneseVoiceFor([english]), null);
});

test("device speech uses the reviewed kana and degrades without a Japanese voice", () => {
  const spoken = [];
  const voice = { name: "Japanese", lang: "ja-JP", localService: true };
  const synthesis = {
    getVoices: () => [voice],
    cancel: () => spoken.push("cancel"),
    speak: (utterance) => spoken.push(utterance)
  };
  assert.equal(speechCapability({ synthesis, Utterance: FakeUtterance }).status, "ready");
  const result = speakJapanese("へんきん", { synthesis, Utterance: FakeUtterance });
  assert.equal(result.ok, true);
  assert.equal(spoken[1].text, "へんきん");
  assert.equal(spoken[1].lang, "ja-JP");
  assert.equal(spoken[1].voice, voice);
  assert.equal(speechCapability({ synthesis: { ...synthesis, getVoices: () => [] }, Utterance: FakeUtterance }).status, "loading");
  assert.equal(speechCapability({ synthesis: { ...synthesis, getVoices: () => [{ lang: "en-US" }] }, Utterance: FakeUtterance }).status, "unavailable");
});
