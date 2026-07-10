export interface ISubscriber {
  readonly _weakRef: WeakRef<ISubscriber>;
  readonly _subscriptions: Map<ISubscription, IRevision>;

  _notify(): void;
}

export interface ISubscription {
  readonly _subscribers: Set<WeakRef<ISubscriber>>;
  _updateRevision(): IRevision;
}

export type IRevision = number;

export type MaybeSubscriber = ISubscriber | null;

export interface IObservable<T> {
  get(): T;
  set(newValue: T): void;
}

export interface IComputed<T> {
  get(): T;
}

export type Destructor = (() => void) | null | undefined | void;
export type ReactionFn = () => Destructor;

export interface IReaction {
  destroy(): void;
  run(): void;
}
