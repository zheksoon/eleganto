import { IRevision, ISubscriber, ISubscription } from "./types";

type HeldValue = [WeakRef<ISubscriber>, Map<ISubscription, IRevision>];

const registry = new FinalizationRegistry<HeldValue>(([ref, subscriptions]) => {
  for (const [subscription] of subscriptions) {
    subscription._subscribers.delete(ref);
  }
});

export const registerSubscriber = (subscriber: ISubscriber): void => {
  registry.register(subscriber, [subscriber._weakRef, subscriber._subscriptions]);
};
