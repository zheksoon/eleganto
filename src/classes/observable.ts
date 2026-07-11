import { subscriberContext, trackSubscriber } from "../subscriberContext";
import { endTx } from "../transaction";
import type { IObservable, IRevision, ISubscriber, ISubscription } from "../types";
import { notify } from "./common";
import { Computed } from "./computed";
import { newRevision } from "./revision";

export class Observable<T = any> implements IObservable<T>, ISubscription {
  readonly _subscribers: Set<WeakRef<ISubscriber>> = new Set();

  private _revision: IRevision = newRevision();
  private _txInitialRevision: IRevision | null = null;
  private _txInitialValue: T | null = null;

  constructor(private _value: T) {}

  _updateRevision(): IRevision {
    if (this._txInitialValue === this._value) {
      this._revision = this._txInitialRevision!;
    }

    this._txInitialValue = null;
    this._txInitialRevision = null;

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

    if (this._txInitialRevision === null) {
      this._txInitialRevision = this._revision;
      this._txInitialValue = this._value;
    }

    this._value = newValue as T;
    this._revision = newRevision();

    notify(this._subscribers);
    endTx();
  }
}
