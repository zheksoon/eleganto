import { IRevision, ISubscription, MaybeSubscriber } from "./types";

export let subscriberContext: MaybeSubscriber = null;

export const setSubscriberContext = (newSubscriber: MaybeSubscriber): MaybeSubscriber => {
  const oldSubscriber = subscriberContext;

  subscriberContext = newSubscriber;

  return oldSubscriber;
};

export const trackSubscriber = (subscription: ISubscription, revision: IRevision): void => {
  if (subscriberContext) {
    subscription._subscribers.add(subscriberContext._weakRef);
    subscriberContext._subscriptions.set(subscription, revision);
  }
};

export const runInContext = <T>(fn: () => T, subscriberContext: MaybeSubscriber = null): T => {
  const oldSubscriber = setSubscriberContext(subscriberContext);
  try {
    return fn();
  } finally {
    setSubscriberContext(oldSubscriber);
  }
};
