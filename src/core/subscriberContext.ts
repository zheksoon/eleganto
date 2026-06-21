import { IRevision, ISubscription, MaybeSubscriber } from './types';

export let subscriberContext: MaybeSubscriber = null;

export function setSubscriberContext(newSubscriber: MaybeSubscriber): MaybeSubscriber {
  const oldSubscriber = subscriberContext;

  subscriberContext = newSubscriber;

  return oldSubscriber;
}

export function trackSubscriber(subscription: ISubscription, revision: IRevision) {
  if (subscriberContext) {
    subscription._subscribers.add(subscriberContext._weakRef);
    subscriberContext._subscriptions.set(subscription, revision);
  }
}

export function runInContext<T>(fn: () => T, subscriberContext: MaybeSubscriber = null): T {
  const oldSubscriber = setSubscriberContext(subscriberContext);
  try {
    return fn();
  } finally {
    setSubscriberContext(oldSubscriber);
  }
}
