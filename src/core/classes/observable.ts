import { subscriberContext, trackSubscriber } from "../subscriberContext";
import { endTx } from "../transaction";
import type { IObservable, IRevision, ISubscriber, ISubscription } from "../types";
import { notify } from "./common";
import { Computed } from "./computed";
import { newRevision } from "./revision";

export class Observable<T = any> implements IObservable<T>, ISubscription {
  readonly _subscribers: Set<WeakRef<ISubscriber>> = new Set();

  private _revision: IRevision = newRevision();
 
  constructor(private _value: T) {}

  _updateRevision(): IRevision {
    return this._revision;
  }

  get(): T {
    trackSubscriber(this, this._revision);
    return this._value;
  }

  set(newValue: T): void {
    if (subscriberContext instanceof Computed) {
      throw new Error("Changing observable inside of computed");
    }

    if (this._value === newValue) return;

    this._value = newValue as T;
    this._revision = newRevision();

    notify(this._subscribers);
    endTx();
  }
}
