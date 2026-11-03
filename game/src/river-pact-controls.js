// A normal player action: run at most five actual turns, then remain paused.
// Stop at a council decision or outcome, even in the middle of a batch.
export function advanceRiverTurns(engine, pact, count = 5) {
  if (!pact || !pact.canAdvance || engine.state.outcome) return 0;
  engine.state.speed = 0;
  let steps = 0;
  while (steps < Math.min(5, Math.max(0, Math.floor(count))) && pact.canAdvance && !engine.state.outcome) {
    engine.tick();
    pact.update();
    steps++;
  }
  return steps;
}
