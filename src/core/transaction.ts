import { IdentityFn, MaybeSubscriber } from "./types";
import { setSubscriberContext } from "./subscriberContext";
import { scheduleReactionRunner } from "./schedulers";

let txDepth = 0;

export const tx = (fn: () => void): void => {
  txDepth += 1;
  try {
    return fn();
  } finally {
    txDepth -= 1;
    endTx();
  }
};

export const txInContext = <T>(fn: () => T, subscriber: MaybeSubscriber = null): T => {
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

export const withUntracked = <T extends Function>(fn: T): IdentityFn<T> => {
  return function (this: any) {
    const oldSubscriber = setSubscriberContext(null);
    try {
      return fn.apply(this, arguments as any);
    } finally {
      setSubscriberContext(oldSubscriber);
    }
  } as IdentityFn<T>;
};

export const action = <T extends Function>(fn: T): IdentityFn<T> => {
  return function (this: any) {
    const oldSubscriber = setSubscriberContext(null);
    txDepth += 1;
    try {
      return fn.apply(this, arguments as any);
    } finally {
      txDepth -= 1;
      setSubscriberContext(oldSubscriber);
      endTx();
    }
  } as IdentityFn<T>;
};

export const endTx = (): void => {
  if (!txDepth) {
    scheduleReactionRunner();
  }
};
