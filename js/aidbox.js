export const boxSteps = [
  'Someone opens the green first aid box on the pole. A switch on the door tells the pole it was opened.',
  'They put on gloves and take out a sterile dressing.',
  'They go to the injured person while the pole speaker keeps talking them through it.',
  'They press the dressing firmly on the wound and keep pressing.',
  'They stay with the person. The pole has already asked the nearest hospital to restock the box.'
];

const STEP_MS = 2800;

// Each step adds a step-N class to the SVG; the CSS moves the parts.
export function createBoxAnimation(scene, { onStep, onDone }) {
  let timers = [];

  function reset() {
    timers.forEach(clearTimeout);
    timers = [];
    scene.classList.add('no-anim');
    boxSteps.forEach((_, i) => scene.classList.remove(`step-${i + 1}`));
    // Force a layout so the reset is not animated backwards.
    scene.getBoundingClientRect();
    scene.classList.remove('no-anim');
  }

  function play() {
    reset();
    boxSteps.forEach((text, i) => {
      timers.push(setTimeout(() => {
        scene.classList.add(`step-${i + 1}`);
        onStep(i, boxSteps.length, text);
      }, i * STEP_MS + 50));
    });
    timers.push(setTimeout(onDone, boxSteps.length * STEP_MS));
  }

  return { play };
}
