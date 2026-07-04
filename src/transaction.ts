import { setSubscriberContext } from "./subscriberContext";
import { runReactions } from "./reactionScheduler";
import type { ISubscriber } from "./types";

let txDepth = 0;

export const txInContext = <T>(fn: () => T, subscriber: ISubscriber | null = null): T => {
  const oldSubscriber = setSubscriberContext(subscriber);
  txDepth += 1;
  try {
    return fn();
  } finally {
    txDepth -= 1;
    setSubscriberContext(oldSubscriber);
    endTx();
  }
};

export const endTx = (): void => {
  if (!txDepth) {
    runReactions();
  }
};
