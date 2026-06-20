import { MaybeSubscriber } from "./types";

export let subscriberContext: MaybeSubscriber = null;

export function setSubscriberContext(newSubscriber: MaybeSubscriber): MaybeSubscriber {
  const oldSubscriber = subscriberContext;

  subscriberContext = newSubscriber;

  return oldSubscriber;
}
