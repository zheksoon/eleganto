import { State } from "../constants";
import { scheduleReaction } from "../reactionScheduler";
import { txInContext } from "../transaction";
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
import { runInContext } from "../subscriberContext";

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

  _shouldRun() {
    try {
      return this._state === State.DIRTY && revisionsChanged(this._subscriptions);
    } finally {
      this._state = State.CLEAN;
    }
  }

  _unsubscribeAndCleanup(): void {
    unsubscribeAndCleanup(this);
    this._destructor && runInContext(this._destructor, null);
    this._destructor = null;
  }

  destroy(): void {
    if (this._state === State.DESTROYED) return;
    this._state = State.DESTROYED;
    this._unsubscribeAndCleanup();
  }

  run(): void {
    this._state = State.CLEAN;
    this._unsubscribeAndCleanup();
    this._destructor = txInContext(this._fn, this);
  }
}
