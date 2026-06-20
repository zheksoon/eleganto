export type IdentityFn<T> = T extends (...args: infer Args) => infer R
  ? (...args: Args) => R
  : never;

export interface ISubscriber {
  readonly _weakRef: WeakRef<ISubscriber>;
  readonly _subscriptions: Map<ISubscription, IRevision>;

  _notify(): void;
}

export interface ISubscription {
  readonly _subscribers: Set<WeakRef<ISubscriber>>;
  _recomputeAndGetLatestRevision(): IRevision;
}

export type IRevision = number;

export type MaybeSubscriber = ISubscriber | null;

export interface IObservable<T> {
  get(): T;
  set(newValue: T): void;
  notify(): void;
}

export interface IComputed<T> {
  get(): T;
  destroy(): void;
}

export type Destructor = (() => void) | null | undefined | void;
export type ReactionFn = () => Destructor;

export interface IReaction {
  destroy(): void;
  run(): void;
}

export type Equals<T> = (prev: T, next: T) => boolean;

export type IOptions = {
  reactionScheduler?: (runner: () => void) => void;
  reactionExceptionHandler?: (exception: Error) => void;
};
