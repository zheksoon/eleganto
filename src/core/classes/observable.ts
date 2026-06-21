import { subscriberContext, trackSubscriber } from '../subscriberContext';
import { endTx, withUntracked } from '../transaction';
import type { Equals, IObservable, IRevision, ISubscriber, ISubscription } from '../types';
import { notify } from './common';
import { Computed } from './computed';
import { newRevision } from './revision';

export class Observable<T = any> implements IObservable<T>, ISubscription {
  readonly _subscribers: Set<WeakRef<ISubscriber>> = new Set();

  private _revision: IRevision = newRevision();
  private _value: T;
  private readonly _equals: Equals<T>;

  private _txInitialValue: T | null = null;
  private _txInitialRevision: IRevision | null = null;

  constructor(value: T, equals: Equals<T> = Object.is) {
    this._value = value;
    this._equals = withUntracked(equals);
  }

  _recomputeAndGetLatestRevision(): IRevision {
    if (this._txInitialRevision && this._equals(this._txInitialValue!, this._value)) {
      this._revision = this._txInitialRevision;
      this._txInitialRevision = null;
      this._txInitialValue = null;
    }

    return this._revision;
  }

  get(): T {
    trackSubscriber(this, this._revision);
    return this._value;
  }

  set(newValue: T): void {
    if (subscriberContext instanceof Computed) {
      throw new Error('Changing observable inside of computed');
    }

    if (this._equals(this._value, newValue)) {
      return;
    }

    if (this._txInitialRevision === null) {
      this._txInitialValue = this._value;
      this._txInitialRevision = this._revision;
    }

    this._value = newValue as T;
    this._revision = newRevision();

    notify(this._subscribers);
    endTx();
  }
}
