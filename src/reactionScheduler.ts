import type { Reaction } from "./classes";

const MAX_REACTION_ITERATIONS = 1000;

let reactionQueue: Reaction[] = [];
let isRunning = false;

export const scheduleReaction = (reaction: Reaction): void => {
  reactionQueue.push(reaction);
};

export const runReactions = (): void => {
  if (isRunning) return;
  isRunning = true;

  let i = 0;
  try {
    while (reactionQueue.length > 0) {
      const reactions = reactionQueue;
      reactionQueue = [];

      if (++i > MAX_REACTION_ITERATIONS) {
        throw new Error("Infinite reactions loop");
      }

      for (const reaction of reactions) {
        try {
          reaction._maybeRun();
        } catch (exception: any) {
          console.error("Reaction exception", exception);
        }
      }
    }
  } finally {
    isRunning = false;
  }
};
