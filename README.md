# Eleganto - Reactivity You Finally Understand

Software is complex. Software in the age of AI is even more complex - the code is created quickly and then modified many times, often making it hard to reason without AI tools.

Elegant solutions matter. It's often more preferable to have a clean, readable one than one optimized and layered with edge cases and defensive programming.

Once I tried to understand how MobX works. This is indeed a very cool library for reactive state management, and the concept was quite clear. But the implementation wasn't - with micro-optimizations all around, and legacy compatibility.

I started to build my own just to understand the idea - and there were many of them. `dipole`, `eveline`, `onek` - they all had one goal - a nice, small, full-featured implementation. But each time it missed some kind of beauty I was aiming for. And finally, after some years of the idea boiling in my head, I found a shape that felt right. I called it **Eleganto**.

Eleganto isn't yet another library marketed as "the only blazing-fast state management you should use". Eleganto is made to be **understandable** - the idea should fit in your head in 15 minutes, while being perfectly functional. I won't put bundlephobia badge on it because it shouldn't be included in your bundle - it should be included in your head. And only then, if you want, you can build something with it.

## The API

Let's start with a simple, almost ubiquitous example of reactive building blocks:

```ts
import { Observable, Computed, Reaction, tx } from "eleganto";

const a = new Observable(1);
const b = new Observable(2);

const c = new Computed(() => a.get() + b.get());

const printer = new Reaction(() => {
  console.log("C is", c.get());
});

printer.run(); // C is 3

a.set(5);  // C is 7
b.set(10); // C is 15

// transaction batches updates
tx(() => {
  a.set(2);
  b.set(3);
});
// C is 5

printer.destroy(); // printer won't run anymore
```

If you have ever used MobX, preact-signals, SolidJS - this all looks familiar to you, there is absolutely nothing new.

If not, here's a brief explanation of what is happening:

* `Observable` creates a reactive value. It has `.get()` and `.set()` methods
* `Computed` creates a reactive value derived from other observable or computed values. It has `.get()` method. Computed values are lazy and don't get evaluated before `.get()`
* `Reaction` is a side effect that runs when observed values change. It's synchronous and needs to run explicitly for the first time using `.run()` method. It can be destroyed with `.destroy()` method.
* `tx` is transaction - it batches updates of observable values and runs reactions at the end.

There are also some convenient helpers:

```ts

const increment = action(() => {
  // some mutation logic
});

untracked(() => a.get()); // a doesn't get tracked
```

They will be explained in [Actions and untracked reads](#actions-and-untracked-reads).

## No Magic

So, let's dive into how observable change triggers reaction. When you run reaction for the first time with `.run()`, it sets itself as a global context for all `.get()` operations inside this reaction run:

```ts
let subscriberContext: ISubscriber | null = null;
```

When an observable or computed is read, it checks this context:

```ts
export const trackSubscriber = (
  subscription: ISubscription,
  revision: IRevision
): void => {
  if (subscriberContext) {
    subscription._subscribers.add(subscriberContext._weakRef);
    subscriberContext._subscriptions.set(subscription, revision);
  }
};

class Observable<T> {
  readonly _subscribers = new Set<WeakRef<ISubscriber>>();

  get(): T {
    trackSubscriber(this, this._revision);
    return this._value;
  }
}
```

> We will frequently use words "subscriber" and "subscription" in the article. The intuition is as simple as in your favorite YouTube channel - if you are a "subscriber", you will get notifications about new "videos" (i.e. new values) from your "subscriptions".

Here's the TypeScript definition of `ISubscriber` and `ISubscription` interfaces we used above:

```ts
interface ISubscriber {
  readonly _weakRef: WeakRef<ISubscriber>;
  readonly _subscriptions: Map<ISubscription, IRevision>;

  _notify(): void;
}

interface ISubscription {
  readonly _subscribers: Set<WeakRef<ISubscriber>>;
  _updateRevision(): IRevision;
}

type IRevision = number;
```

`trackSubscriber` function builds the `subscriber <-> subscription` relation. The WeakRef to `subscriberContext` is added to `_subscribers` of observable, and the observable (and its revision) is added to `_subscriptions` map of the subscriber.

> Why `WeakRef`? We will answer this question later in the [Weak Subscribers](#weak-subscribers) section

This way, computeds and reactions know to what observable values they are subscribed, and observable values know who to notify about changes.

Quick example:

```ts
const fullName = new Computed(() => {
  return firstName.get() + " " + lastName.get();
});
```

`firstName` and `lastName` will include `fullName` as a subscriber, and `fullName` will include both in its subscriptions map.

When computed or reaction runs again, the first thing they do is **unsubscribe** from their subscriptions:

```ts
const unsubscribeAndCleanup = (subscriber: ISubscriber): void => {
  for (const [subscription] of subscriber._subscriptions) {
    subscription._subscribers.delete(subscriber._weakRef);
  }

  subscriber._subscriptions.clear();
};

class Computed<T> {
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
}
```

Why is this needed? The reason is simple - in the new run subscriptions may change. For example:

```ts
const title = new Computed(() => {
  if (isAdmin.get()) {
    return adminTitle.get();
  }

  return userTitle.get();
});
```

Here `isAdmin` flag controls what subscriptions the computed will have. If it's true, it will subscribe to `isAdmin` and `adminTitle`; if it's false - to `isAdmin` and `userTitle`. There is no special graph diff - we just drop the old list and collect a new one.

Above, in `_recompute()` method, we used `runInContext` helper. Here's how it's defined:

```ts
export const runInContext = <T>(
  fn: () => T,
  subscriberContext: MaybeSubscriber = null
): T => {
  const oldSubscriber = setSubscriberContext(subscriberContext);

  try {
    return fn();
  } finally {
    setSubscriberContext(oldSubscriber);
  }
};
```

This simple helper allows to easily run a function in specific context. `_recompute()` sets the Computed instance as the context, so all `.get()` operations there will be correctly tracked.

## Notifying and Dirty State

When observable changes, it notifies its subscribers:

```ts
export const notify = (subscribers: Set<WeakRef<ISubscriber>>): void => {
  for (const ref of subscribers) {
    ref.deref()?._notify();
  }
};

class Observable {
  set(newValue: T): void {
    // ...
    notify(this._subscribers);
    endTx();
  }
}
```

> `endTx()` runs scheduled reactions - more on this later.

`_notify` method of a Computed subscriber is simple - just sets its state to `State.DIRTY` and propagates to other subscribers:

```ts
type ComputedState =
  | State.CLEAN
  | State.NOT_INITIALIZED
  | State.COMPUTING
  | State.DIRTY;

class Computed<T> {
  _notify() {
    if (this._state === State.CLEAN) {
      this._state = State.DIRTY;
      notify(this._subscribers);
    }
  }
}
```

DIRTY state signals about a **possible change** - so we don't rush to recompute things there. Computed values are **lazy**, and real recomputation happens later in backward pass.

Reaction also has simple implementation - change state and schedule itself for execution:

```ts
class Reaction {
  _notify(): void {
    if (this._state === State.CLEAN) {
      this._state = State.DIRTY;
      scheduleReaction(this);
    }
  }
}
```

The reaction queue doesn't need deduplication because scheduling happens only once due to CLEAN state condition.

## Revisions

I briefly mentioned that subscribers store their subscriptions along with **revision**:

```ts
subscriberContext._subscriptions.set(subscription, revision);
```

What is revision? **Revision** is an immutable token that follows a simple rule: same value - same revision, different value - different revision. Ordering doesn't matter, the only thing we need is strict equality `a === b`. For simplicity it's just a number:

```ts
let revision = 0;

export const newRevision = () => ++revision;
```

When we assign a new value to observable, we update its revision:

```ts
class Observable<T> {
  private _revision = newRevision();

  set(newValue: T): void {
    if (this._value === newValue) return;

    this._value = newValue;
    this._revision = newRevision();
    // ...
  }
}
```

Why is this needed? Basically, using revisions is a very simple way to know that something changed in your subscriptions:

```ts
function revisionsChanged(
  subscriptions: Map<ISubscription, IRevision>
): boolean {
  for (const [subscription, revision] of subscriptions) {
    if (subscription._updateRevision() !== revision) {
      return true;
    }
  }

  return false;
}
```

This function will return `true` if some revision doesn't match the one we recorded, meaning we should recompute or re-run. Notification says something may have changed. Revision check says whether it really matters.

## Updating Computed revision

All subscriptions (i.e. Observable and Computed instances) have `_updateRevision()` method that returns the current revision. In Observable, it's very simple:

```ts
class Observable {
  _updateRevision(): IRevision {
    return this._revision;
  }
}
```

No action, just return the current one.

Let's see what happens in Computed:

```ts
class Computed {
  _updateRevision(): IRevision {
    if (this._state === State.CLEAN) {
      return this._revision;
    }

    if (this._state === State.NOT_INITIALIZED) {
      this._value = this._recompute();
      this._revision = newRevision();
    }

    if (this._state === State.DIRTY && revisionsChanged(this._subscriptions)) {
      const result = this._recompute();
      
      if (this._value !== result) {
        this._value = result;
        this._revision = newRevision();
      }
    }

    this._state = State.CLEAN;

    return this._revision;
  }
}
```

This is the central piece in the whole library. Let's read it line by line:

1. If we are in CLEAN state, return the current revision - no action needed.
2. If we are NOT_INITIALIZED yet, recompute and assign a new revision.
3. If we are in DIRTY state (means someone has notified us about a change), check subscription revisions.
4. If subscription revisions changed, recompute.
5. If the computed result changed for real, assign a new revision.
6. Finally set a CLEAN state, so if the method runs again, it will follow condition from step 1.

This is it. Let's now see how reactions use revisions to determine when they should run.

The `_updateRevision()` is called on each `.get()` operation of the computed as well:

```ts
class Computed {
  get(): T {
    if (this._state === State.COMPUTING) {
      throw new Error("Recursive computed call");
    }

    const revision = this._updateRevision();

    trackSubscriber(this, revision);

    return this._value!;
  }
}
```

Notice the order: computed first updates its own revision, then tracks itself. This is how computed values can depend on other computed values.

Updating the revision before each `.get()` keeps the value fresh. Even if you read a computed value in the middle of a transaction, it still gives the current value.

This is an important property: reads are transparent. You do not need to know whether the value is stored or derived.

## When Reactions Run

Reaction has `_maybeRun()` method that checks if it really needs to run:

```ts
class Reaction {
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

  run(): void {
    this._state = State.CLEAN;
    this._unsubscribeAndCleanup();
    this._destructor = txInContext(this._fn, this);
  }
}
```

> Reactions scheduled by notifications might not run - this is the central point of revisions check and computed laziness.

It uses the same `revisionsChanged` function to determine if some subscription has changed. Here's an example:

```ts
const temperature = new Observable(20);

const isWarm = new Computed(() => {
  return temperature.get() > 15;
});

const reaction = new Reaction(() => {
  console.log("warm:", isWarm.get());
});

reaction.run(); // warm: true

temperature.set(21);
```

What will happen in this case? Let's track:

1. Observable has a new value `21` and a new revision.
2. Computed gets notified.
3. Reaction gets notified and scheduled.
4. Scheduled reaction runs `_maybeRun()` method and checks the revision of computed.
5. Computed checks revision of `temperature` in `_updateRevision()` - it's changed - and recomputes.
6. `if (this._value !== result)` check runs - and because the result is still `true`, new revision is not assigned in computed.
7. Reaction gets the old revision, `revisionsChanged()` returns false
8. The reaction body is not run, reaction is back to CLEAN

This way, the reaction is effectively cancelled because `isWarm` hasn't changed.

## Transactions

Setting two observables will run reaction two times after each:

```ts
a.set(2); // reaction runs
b.set(3); // reaction runs
```

To batch the changes and run reactions only once, we introduce **transactions** (`tx`):

```ts
tx(() => {
  a.set(2);
  b.set(3);
});
```

The implementation is just a depth counter:

```ts
let txDepth = 0;

export const tx = <T>(fn: () => T): T => {
  txDepth += 1;

  try {
    return fn();
  } finally {
    txDepth -= 1;
    endTx();
  }
};

export const endTx = (): void => {
  if (!txDepth && !isRunning) {
    runReactions();
  }
};
```

`endTx` is called when all transactions are completed:

```ts
tx(() => {
  a.set(1);

  tx(() => {
    b.set(2);
  }); // txDepth is still 1

  c.set(3);
}); // txDepth is 0, run reactions
```

Outside `tx`, each `.set()` behaves like a transaction of one update:

```ts
class Observable {
  set(newValue: T): void {
    // ...
    notify(this._subscribers);
    endTx();  // this is no-op then inside transaction
  }
}
```

`txInContext` (used in Reaction's `.run()` method) is a simple combination of `runInContext` and `tx`:

```ts
export const txInContext = <T>(
  fn: () => T,
  subscriber: ISubscriber | null = null
): T => {
  const oldSubscriber = setSubscriberContext(subscriber);
  txDepth += 1;

  try {
    return fn();
  } finally {
    txDepth -= 1;
    setSubscriberContext(oldSubscriber);
    endTx();
  }
};
```

Reaction body runs in a transaction because effects may update observable values. If they do, nested updates are batched and flushed after the body finishes.

## Reaction Scheduling

When a reaction gets notified, it's scheduled for execution in the reaction queue:

```ts
let reactionQueue: Reaction[] = [];
let isRunning = false;

export const scheduleReaction = (reaction: Reaction): void => {
  reactionQueue.push(reaction);
};
```

`endTx` then runs `runReactions`:

```ts
const MAX_REACTION_ITERATIONS = 1000;

let isRunning = false;

export const runReactions = (): void => {
  isRunning = true;

  let i = 0;

  try {
    while (reactionQueue.length > 0) {
      const reactions = reactionQueue;
      reactionQueue = [];

      if (++i > MAX_REACTION_ITERATIONS) {
        throw new Error("Infinite reactions loop");
      }

      for (const reaction of reactions) {
        try {
          reaction._maybeRun();
        } catch (exception) {
          console.error("Reaction exception", exception);
        }
      }
    }
  } finally {
    isRunning = false;
  }
};
```

Let's read it:

1. We introduce `isRunning` flag that protects the runner from recursion. It's set in the beginning and reset in `finally` block. The check happens in `endTx`.
2. In `while` loop, we take the reactions queue and swap it with new empty array. This way, newly scheduled reactions go to the new queue, leaving the current reaction batch running without changes.
3. For reactions from the batch, we run `_maybeRun()` method with try/catch.
4. If after running all reactions there are newly scheduled reactions, we repeat the loop of queue swap.
5. If there were too many iterations of queue swapping, we then consider that something is wrong and throw an exception.

Example of an infinite reaction that will throw this way:

```ts
const r = new Reaction(() => {
  a.set(a.get() + 1);
});

r.run();  // throws
```

## Reaction Cleanup

Like `useEffect` in React, reaction body can return a cleanup function:

```ts
const reaction = new Reaction(() => {
  const controller = new AbortController();
  
  fetch(url.get(), { signal: controller.signal })
    .then(...)
    
  return () => controller.abort();
});
```

We capture it in the `_destructor` field of reaction and run it before each body run:

```ts
class Reaction {
  private _destructor: Destructor = null;

  _unsubscribeAndCleanup(): void {
    unsubscribeAndCleanup(this);
    this._destructor && runInContext(this._destructor, null);
    this._destructor = null;
  }

  run(): void {
    this._state = State.CLEAN;
    this._unsubscribeAndCleanup();
    this._destructor = txInContext(this._fn, this);
  }

  destroy(): void {
    if (this._state === State.DESTROYED) return;

    this._state = State.DESTROYED;
    this._unsubscribeAndCleanup();
  }
}
```

You should explicitly call `.destroy()` when the reaction isn't needed anymore.

## Weak Subscribers

So, why do we store `WeakRef` to the subscriber, not the object itself?

One big problem all reactive libraries are trying to solve is **garbage collection**. If we store strong references to computed or reactions, they will never go away:

```ts
const a = new Observable(1);

{
  const b = new Computed(() => a.get() * 2);

  b.get();  // a will have b as subscriber
}

// b is not accessible anymore but still referenced from a
// so it will stay forever
```

It's 2026, so modern solution to it is using **weak references**. They don't prevent subscribers from being garbage-collected. Each subscriber stores a WeakRef to itself that is used to reference it:

```ts
class Computed<T> implements ISubscriber {
  readonly _weakRef = new WeakRef(this);
  readonly _subscriptions = new Map<ISubscription, IRevision>();
}

class Observable {
  readonly _subscribers = new Set<WeakRef<ISubscriber>>();
}
```

But still there is a problem - if computed or reaction was garbage-collected, the WeakRef still exists in each `_subscribers` set of its subscriptions. 

To solve it, we will use **FinalizationRegistry**. It allows us to run a function when object is garbage-collected. We pass the WeakRef and subscriptions map as held value, and then execute a simple loop over each subscription inside the finalization function:

```ts
type HeldValue = [WeakRef<ISubscriber>, Map<ISubscription, IRevision>];

const registry = new FinalizationRegistry<HeldValue>(([ref, subscriptions]) => {
  for (const [subscription] of subscriptions) {
    subscription._subscribers.delete(ref);
  }
});

export const registerSubscriber = (subscriber: ISubscriber): void => {
  registry.register(subscriber, [
    subscriber._weakRef,
    subscriber._subscriptions,
  ]);
};
```

FinalizationRegistry isn't deterministic, but on average it removes the most dead subscribers from the corresponding `_subscribers`. This is a safety net, not lifecycle management.

## Robustness

Having a nice little core is good, but sometimes having extra checks and restrictions is needed to survive real code. Let's review some.

### Recursive computed values

Computed values should not be accessed when they are still in COMPUTING state:

```ts
class Computed<T> {
  get(): T {
    if (this._state === State.COMPUTING) {
      throw new Error("Recursive computed call");
    }

    const revision = this._updateRevision();
    trackSubscriber(this, revision);

    return this._value!;
  }
}
```

Example:

```ts
const a = new Computed(() => a.get());

a.get(); // throws
```

### No mutations inside computed values

Computed values should also not mutate other Observables. They should only derive information:

```ts
class Observable<T> {
  set(newValue: T): void {
    if (subscriberContext instanceof Computed) {
      throw new Error("Changing observable inside of computed");
    }

    // apply value
  }
}
```

This keeps the system one-directional: computed derives, reaction effects.

## Actions and untracked reads

If you used MobX or preact-signals, you have seen actions. **Action** is just a function that wraps any given `fn` in an untracked transaction: 

```ts
export const action = <T, Args extends any[]>(
  fn: (this: any, ...args: Args) => T
): ((...args: Args) => T) => {
  return function (this: any, ...args: Args): T {
    const oldSubscriber = setSubscriberContext(null);
    txDepth += 1;

    try {
      return fn.apply(this, args);
    } finally {
      txDepth -= 1;
      setSubscriberContext(oldSubscriber);
      endTx();
    }
  };
};
```

Why it's needed and sometimes even enforced (like in MobX)? **Actions** mutate the application state, and they can read other observable values to achieve its goal. Without action wrapper it will track the `.get()` operations in the reaction. To avoid this, action sets `null` context, making all reads needed for the mutation isolated from reaction that calls it:

```ts
const increment = action(() => {
  count.set(count.get() + 1);
});

// if called inside a reaction,
// count.get() inside increment is not tracked by that reaction
increment();
```

`untracked` is just an alias to `runInContext`:

```ts
export const untracked = runInContext;
```

## Homework for the Reader

That's all! In the current state it passes **almost** all tests from reactive frameworks test suite, but some edge cases are left as exercises:

### Revert of values

When an observable returns to its initial value by the end of a transaction, reactions should not run:

```ts
const count = new Observable(1);

const reaction = new Reaction(() => {
  console.log(count.get());
});

reaction.run();

tx(() => {
  count.set(2);
  count.set(1);
});
```

Hint: add two fields to Observable class: `txInitialValue` and `txInitialRevision`. On first `.set()` call, set these fields to current value and revision. Then, in `_updateRevision()` check if current value is equal to `txInitialValue`, and revert the revision to initial.

### Nested reactions

Reactions can create nested reactions:

```ts
const outer = new Reaction(() => {
  const value = a.get();

  const inner = new Reaction(() => {
    console.log(b.get(), value);
  });

  inner.run();
});
```

We need to destroy nested reactions before a new run of the outer reaction.

Hint: add `_children` field to Reaction. In `.run()` method, check if current context is Reaction and record itself to the context's `_children`. In `._unsubscribeAndCleanup()` loop over child reactions and destroy them before own destruction.

