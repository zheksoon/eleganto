import { IRevision, ISubscriber, ISubscription } from "../types";

export const revisionsChanged = (subscriptions: Map<ISubscription, IRevision>): boolean => {
  for (const [subscription, revision] of subscriptions) {
    if (subscription._updateRevision() !== revision) {
      return true;
    }
  }

  return false;
};

export const unsubscribeAndCleanup = (subscriber: ISubscriber): void => {
  for (const [subscription] of subscriber._subscriptions) {
    subscription._subscribers.delete(subscriber._weakRef);
  }
  subscriber._subscriptions.clear();
};

export const notify = (subscribers: Set<WeakRef<ISubscriber>>): void => {
  for (const ref of subscribers) {
    ref.deref()?._notify();
  }
};
