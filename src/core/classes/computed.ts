import { State } from "../constants";
import { subscriberContext } from "../subscriberContext";
import { runInContext, withUntracked } from "../transaction";
import type {
  Equals,
  IComputed,
  IRevision,
  ISubscriber,
  ISubscription,
} from "../types";
import { notify, revisionsChanged, unsubscribeAndCleanup } from "./common";
import { registerSubscriber } from "../finalizationRegistry";
import { newRevision } from "./revision";

type ComputedState =
  | State.CLEAN
  | State.NOT_INITIALIZED
  | State.COMPUTING
  | State.DIRTY;

export class Computed<T = any> implements IComputed<T>, ISubscriber, ISubscription {
  readonly _weakRef = new WeakRef(this);
  readonly _subscriptions: Map<ISubscription, IRevision> = new Map();
  readonly _subscribers: Set<WeakRef<ISubscriber>> = new Set();

  private _value: T | undefined = undefined;
  private _revision: IRevision = newRevision();
  private _state: ComputedState = State.NOT_INITIALIZED;

  private readonly _fn: () => T;
  private readonly _equals: Equals<T>;

  constructor(fn: () => T, equals: Equals<T> = Object.is) {
    this._fn = fn;
    this._equals = withUntracked(equals);

    registerSubscriber(this);
  }

  _notify() {
    if (this._state === State.CLEAN) {
      this._state = State.DIRTY;
      notify(this._subscribers);
    }
  }

  _recomputeAndGetLatestRevision(): IRevision {
    if (this._state === State.CLEAN) {
      return this._revision;
    }

    if (this._state === State.NOT_INITIALIZED) {
      this._value = this._recompute();
      this._revision = newRevision();
    }

    if (this._state === State.DIRTY && revisionsChanged(this._subscriptions)) {
      const result = this._recompute();
      if (!this._equals(this._value!, result)) {
        this._value = result;
        this._revision = newRevision();
      }
    }

    this._state = State.CLEAN;

    return this._revision;
  }

  _recompute(): T {
    unsubscribeAndCleanup(this);
    this._state = State.COMPUTING;

    try {
      return runInContext(this._fn, this);
    } catch (err) {
      this.destroy();
      throw err;
    }
  }

  destroy(): void {
    unsubscribeAndCleanup(this);
    this._state = State.NOT_INITIALIZED;
    this._value = undefined;
  }

  get(): T {
    if (this._state === State.COMPUTING) {
      throw new Error("Recursive computed call");
    }

    const revision = this._recomputeAndGetLatestRevision();

    if (subscriberContext) {
      subscriberContext._subscriptions.set(this, revision);
      this._subscribers.add(subscriberContext._weakRef);
    }

    return this._value!;
  }
}
