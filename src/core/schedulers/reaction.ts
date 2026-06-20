import type { Reaction } from "../classes";

const MAX_REACTION_ITERATIONS = 1000;

let reactionQueue = new Set<Reaction>();
let swapQueue = new Set<Reaction>();
let isReactionRunScheduled = false;

let reactionScheduler = (runner: () => void) => {
  Promise.resolve().then(runner).catch(reactionExceptionHandler);
};
let reactionExceptionHandler = (exception: any) => {
  console.error("Reaction exception:", exception);
};

export function setReactionScheduler(scheduler: typeof reactionScheduler) {
  reactionScheduler = scheduler;
}

export function setReactionExceptionHandler(
  handler: typeof reactionExceptionHandler,
) {
  reactionExceptionHandler = handler;
}

export function scheduleReaction(reaction: Reaction) {
  reactionQueue.add(reaction);
}

function runReactions(): void {
  try {
    let i = MAX_REACTION_ITERATIONS;

    while (reactionQueue.size > 0 && --i) {
      const reactions = reactionQueue;
      reactionQueue = swapQueue;

      for (const reaction of reactions) {
        try {
          reaction._maybeRun();
        } catch (exception: any) {
          reactionExceptionHandler(exception);
        }
      }

      reactions.clear();

      swapQueue = reactions;
    }

    if (!i) {
      throw new Error("Infinite reactions loop");
    }
  } finally {
    isReactionRunScheduled = false;
    reactionQueue.clear();
    swapQueue.clear();
  }
}

export function scheduleReactionRunner(): void {
  if (!isReactionRunScheduled && reactionQueue.size) {
    isReactionRunScheduled = true;
    reactionScheduler(runReactions);
  }
}
