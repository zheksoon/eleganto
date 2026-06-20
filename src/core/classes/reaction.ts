import { State } from "../constants";
import { scheduleReaction } from "../schedulers";
import { utx } from "../transaction";
import type {
  Destructor,
  IReaction,
  IRevision,
  ISubscriber,
  ISubscription,
  ReactionFn,
} from "../types";
import { revisionsChanged, unsubscribeAndCleanup } from "./common";
import { registerSubscriber } from "../finalizationRegistry";

type ReactionState = State.CLEAN | State.DIRTY | State.DESTROYED;

export class Reaction implements IReaction, ISubscriber {
  readonly _weakRef = new WeakRef(this);
  readonly _subscriptions: Map<ISubscription, IRevision> = new Map();

  private _destructor: Destructor = null;
  private _state: ReactionState = State.CLEAN;

  constructor(private _fn: ReactionFn) {
    registerSubscriber(this);
  }

  _notify(): void {
    if (this._state === State.CLEAN) {
      this._state = State.DIRTY;
      scheduleReaction(this);
    }
  }

  _maybeRun() {
    if (this._state === State.DESTROYED) {
      return;
    }

    if (this._state === State.DIRTY && revisionsChanged(this._subscriptions)) {
      this.run();
    } else {
      this._state = State.CLEAN;
    }
  }

  _unsubscribeAndCleanup(): void {
    unsubscribeAndCleanup(this);
    this._destructor && utx(this._destructor);
    this._destructor = null;
    this._state = State.CLEAN;
  }

  destroy(): void {
    this._unsubscribeAndCleanup();
    this._state = State.DESTROYED;
  }

  run(): void {
    this._unsubscribeAndCleanup();
    this._destructor = utx(this._fn, this);
  }
}
