import { setSubscriberContext } from "./subscriberContext";
import { runReactions } from "./reactionScheduler";
import type { ISubscriber } from "./types";

let txDepth = 0;

export const tx = <T>(fn: () => T): T => {
  txDepth += 1;
  try {
    return fn();
  } finally {
    txDepth -= 1;
    endTx();
  }
};

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

export const action = <T, Args extends any[]>(
  fn: (this: any, ...args: Args) => T
): ((...args: Args) => T) => {
  return function (this: any, ...args: Args): T {
    const oldSubscriber = setSubscriberContext(null);
    txDepth += 1;
    try {
      return fn.apply(this, args);
    } finally {
      txDepth -= 1;
      setSubscriberContext(oldSubscriber);
      endTx();
    }
  };
};

export const endTx = (): void => {
  if (!txDepth) {
    runReactions();
  }
};
