export const scripts = {
  en: {
    lang: 'en-IN',
    steps: [
      'Call 112 now. Tell them where you are and what happened.',
      'If someone is bleeding, press firmly on the wound with a clean cloth. Keep pressing.',
      'If the person does not respond and is not breathing normally, start hands-only CPR.',
      'Put both hands on the centre of the chest. Push hard and fast, about two pushes every second. Do not stop until help arrives.',
      'Do not move the person unless they are in danger where they are, for example from traffic or fire.',
      'Stay with them until the ambulance arrives.'
    ]
  },
  hi: {
    lang: 'hi-IN',
    // TODO: Hindi script, to be written and checked by a native speaker with first-aid training.
    steps: [
      'TODO (Hindi): step 1 - call 112',
      'TODO (Hindi): step 2 - press on bleeding with a clean cloth',
      'TODO (Hindi): step 3 - hands-only CPR if unresponsive and not breathing normally',
      'TODO (Hindi): step 4 - centre of chest, push hard and fast',
      'TODO (Hindi): step 5 - do not move the person unless in danger',
      'TODO (Hindi): step 6 - stay until the ambulance arrives'
    ]
  }
};

const isPlaceholder = text => text.startsWith('TODO');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const readingTime = text => Math.max(2500, text.split(' ').length * 380);

function loadVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  const voices = speechSynthesis.getVoices();
  if (voices.length) return Promise.resolve(voices);
  // Chrome fills the voice list a moment after page load.
  return new Promise(resolve => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1000);
  });
}

async function pickVoice(lang) {
  const voices = await loadVoices();
  const base = lang.slice(0, 2);
  const norm = v => v.lang.replace('_', '-').toLowerCase();
  return voices.find(v => norm(v) === lang.toLowerCase()) ??
    voices.find(v => norm(v).startsWith(base)) ?? null;
}

function speak(text, voice) {
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.95;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    // Some browsers never fire onend; don't let captions hang on that.
    setTimeout(resolve, readingTime(text) + 4000);
    speechSynthesis.speak(utterance);
  });
}

export function createFirstAid({ onStep, onNote, onDone }) {
  let run = 0;

  function stop() {
    run++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  async function play(langKey, captionsOnly) {
    stop();
    const id = run;
    const script = scripts[langKey];
    const placeholder = script.steps.some(isPlaceholder);
    const voice = captionsOnly || placeholder ? null : await pickVoice(script.lang);

    if (placeholder) onNote('Hindi script not written yet. Showing placeholders as captions, nothing is spoken.');
    else if (captionsOnly) onNote('Captions only.');
    else if (!voice) onNote('No voice for this language in this browser. Showing captions only.');
    else onNote(`Speaking with ${voice.name}.`);

    for (let i = 0; i < script.steps.length; i++) {
      if (id !== run) return;
      const text = script.steps[i];
      onStep(i, script.steps.length, text);
      if (voice) await speak(text, voice);
      else await wait(readingTime(text));
      await wait(500);
    }
    if (id === run) onDone();
  }

  return { play, stop };
}
