import { IdentityFn, MaybeSubscriber } from "./types";
import { setSubscriberContext } from "./subscriberContext";
import { scheduleReactionRunner } from "./schedulers";

let txDepth = 0;

export function tx(fn: () => void): void {
  txDepth += 1;
  try {
    fn();
  } finally {
    txDepth -= 1;
    endTx();
  }
}

export function utx<T>(fn: () => T, subscriber: MaybeSubscriber = null): T {
  const oldSubscriber = setSubscriberContext(subscriber);
  txDepth += 1;
  try {
    return fn();
  } finally {
    txDepth -= 1;
    setSubscriberContext(oldSubscriber);
    endTx();
  }
}

export function runInContext<T>(
  fn: () => T,
  subscriberContext: MaybeSubscriber = null,
): T {
  const oldSubscriber = setSubscriberContext(subscriberContext);
  try {
    return fn();
  } finally {
    setSubscriberContext(oldSubscriber);
  }
}

export function withUntracked<T extends Function>(fn: T): IdentityFn<T> {
  return function (this: any) {
    const oldSubscriber = setSubscriberContext(null);
    try {
      return fn.apply(this, arguments as any);
    } finally {
      setSubscriberContext(oldSubscriber);
    }
  } as IdentityFn<T>;
}

export function action<T extends Function>(fn: T): IdentityFn<T> {
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
}

export function endTx() {
  if (!txDepth) {
    scheduleReactionRunner();
  }
}
