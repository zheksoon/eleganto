import type { Reaction } from "./classes";

const MAX_REACTION_ITERATIONS = 1000;

let reactionQueue: Reaction[] = [];
export let isRunning = false;

export const scheduleReaction = (reaction: Reaction): void => {
  reactionQueue.push(reaction);
};

export const runReactions = (): void => {
  isRunning = true;

  let i = 0;
  try {
    while (reactionQueue.length > 0) {
      const reactions = reactionQueue;
      reactionQueue = [];

      if (++i > MAX_REACTION_ITERATIONS) {
        for (const reaction of reactions) {
          reaction._shouldRun();
        }

        throw new Error("Infinite reactions loop");
      }

      for (const reaction of reactions) {
        try {
          reaction._shouldRun() && reaction.run();
        } catch (exception: any) {
          console.error("Reaction exception", exception);
        }
      }
    }
  } finally {
    isRunning = false;
  }
};
