# Eleganto - Reactivity You Can Understand

Software is complex. Today, it often becomes even more complex because a lot of code is generated quickly and then patched many times. The result may work, but it can be hard to read and hard to trust.

This is why clarity matters. A clear solution is often more useful than a larger or more clever one.

Some time ago, I tried to understand how reactivity works in MobX. I liked the idea, but the implementation was difficult for me to follow, layered with optimizations and legacy. So I started writing my own small versions to understand the basics.

After a few years, I found a shape that felt simple enough and still practical. I called it **Eleganto**.

Eleganto is not trying to be the fastest reactive library. Its main goal is to be clear. The core is small enough to keep in your head, but it still covers important parts: lazy computed values, dependency tracking, transactions, cleanup, recursion protection, and reaction scheduling.

The package is also small: about **1.4 KB gzip**, without minification or mangling, so all stack traces and fields are always transparent.

Let's look at how it works.

## 1. The Public API

Here is a small example:

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
```

There are three main primitives:

- An `Observable` stores a value.
- A `Computed` derives a value from observables or other computed values.
- A `Reaction` runs a side effect when the values it reads change.

There are also three helpers:

```ts
tx(() => {
  // batch updates
});

const save = action(() => {
  // untracked transaction
});

untracked(() => {
  // read without subscribing
});
```

This is almost the whole API.

Now let's build the mental model.

## 2. The Shape of Reactivity

When you read an observable inside a computed value or a reaction, the observable remembers who is reading it.

When the observable changes, it notifies those readers.

The flow looks like this:

```txt
Observable.set()
  -> notify subscribers
  -> Computed becomes dirty
  -> Reaction is scheduled
  -> transaction ends
  -> Reaction checks revisions
  -> Computed recomputes only if needed
```

The important detail is that computed values are lazy.

They do not recompute immediately when something changes. They only become dirty and recompute later, when someone asks for their value or when a reaction needs to check if it should run.

This keeps the system simple.

## 3. No Magic

Computed values and reactions automatically track the observables they use.

The mechanism is small. While a computed value or reaction is running, Eleganto stores it in a global context variable.

```ts
let subscriberContext: ISubscriber | null = null;
```

When an observable is read, it checks this context:

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
```

`trackSubscriber` builds two-way relation: writes the context reference to the observable `_subscribers` set, and adds the observable as context's `_subscriptions`, [along with the revision](#4-revisions).

> Why `WeakRef` is used here? Check out [Weak Subscribers](#14-weak-subscribers) part.

Inside `Observable.get()`, we call `trackSubscriber`.

```ts
class Observable<T> {
  readonly _subscribers = new Set<WeakRef<ISubscriber>>();

  get(): T {
    trackSubscriber(this, this._revision);
    return this._value;
  }
}
```

So when this code runs:

```ts
const fullName = new Computed(() => {
  return firstName.get() + " " + lastName.get();
});
```

both `firstName` and `lastName` know that `fullName` depends on them.

The computed value also knows what it depends on.

That second direction is important. It allows the computed value to unsubscribe before every recompute. Without this, old dependencies would stay forever. Here's how it's done:


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

For example:

```ts
const title = new Computed(() => {
  if (isAdmin.get()) {
    return adminTitle.get();
  }

  return userTitle.get();
});
```

If `isAdmin` changes from `true` to `false`, the computed value should stop listening to `adminTitle`.

This is why every subscriber has a subscriptions map.

## 4. Revisions

You may have noticed the word `revision`. A revision is a small token that changes when a value really changes.

In Eleganto, it is just a number, but it can be anything that supports strict equality (`a === b`):

```ts
let revision = 0;

export const newRevision = () => ++revision;
```

An observable has a revision:

```ts
class Observable<T> {
  private _revision = newRevision();

  set(newValue: T): void {
    if (this._value === newValue) return;

    this._value = newValue;
    this._revision = newRevision();

    notify(this._subscribers);
    endTx();
  }

  _updateRevision(): IRevision {
    return this._revision;
  }
}
```

When a subscriber reads an observable, it stores the observable and its current revision:

```ts
subscriberContext._subscriptions.set(subscription, revision);
```

Later, the subscriber can check one thing:

> Did any dependency move to a new revision?

The check is small:

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

This is one of the main ideas in Eleganto.

A dependency can notify you, but that does not always mean your final value changed.

Revisions make it possible to check that.

## 5. Notifying and Dirty State

When an observable changes, it notifies its subscribers:

```ts
export const notify = (subscribers: Set<WeakRef<ISubscriber>>): void => {
  for (const ref of subscribers) {
    ref.deref()?._notify();
  }
};
```

> As observable stores a `WeakRef` ([read here why](#14-weak-subscribers)), we need to call `.deref()` before.

A computed value does not recompute immediately.

It only becomes dirty and notifies its own subscribers:

```ts
class Computed<T> {
  _notify() {
    if (this._state === State.CLEAN) {
      this._state = State.DIRTY;
      notify(this._subscribers);
    }
  }
}
```

A reaction also becomes dirty, but it is scheduled for execution:

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

So updates can move through the graph quickly, while expensive work is delayed.

This is why lazy computed values are useful.

## 6. Lazy Computed Values

A computed value has four states:

```ts
type ComputedState =
  | State.CLEAN
  | State.NOT_INITIALIZED
  | State.COMPUTING
  | State.DIRTY;
```

Its revision update logic is the heart of the system:

```ts
class Computed<T> {
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

Step by step:

1. If it is clean, return the current revision.
2. If it was never computed, compute it.
3. If it is dirty, check if its dependencies really changed.
4. If they changed, recompute.
5. If the final value changed, assign a new revision.
6. Mark it clean.

That is the full lifecycle.

The computed value does not need to know which dependency changed. It only needs to know whether its final value is still the same.

## 8. When Reactions Run

A reaction should not run only because something notified it.

It should run when one of the values it observed has a new revision.

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
}
```

This matters when a computed value is dirty, but its final value is still the same.

Example:

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

1. `temperature` changed.
2. `isWarm` became dirty.
3. The reaction was scheduled.

But `isWarm` is still `true`, so its revision does not change. The reaction does not need to run again.

This is a small detail, but it enables complex optimization. For example, instead of strict equality there can be shallow or deep equality, reducing unnecesary re-renders.

## 9. Transactions

Without transactions, two updates can cause two reaction runs:

```ts
a.set(2);
b.set(3);
```

With a transaction, they cause one run:

```ts
tx(() => {
  a.set(2);
  b.set(3);
});
```

The implementation is a depth counter:

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

Nested transactions work because only the outer transaction flushes reactions.

```ts
tx(() => {
  a.set(1);

  tx(() => {
    b.set(2);
  });

  c.set(3);
});
```

The reaction queue flushes after the outer transaction ends.

## 10. Reaction Scheduling

The reaction queue is also small.

```ts
let reactionQueue: Reaction[] = [];
let isRunning = false;

export const scheduleReaction = (reaction: Reaction): void => {
  reactionQueue.push(reaction);
};
```

Reaction naturally cannot be scheduled twice because of `if (this._state === State.CLEAN` check in `_notify()` methos, so using a plain array is safe.

When a transaction ends, Eleganto runs scheduled reactions.

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

The queue swap is important.

If a reaction schedules more reactions while the current batch is running, those new reactions go to the next batch.

This keeps execution predictable.

The limit also protects the system from infinite reaction loops.

## 11. Actions

`action` is a convenience helper.

It runs a function as an untracked transaction.

```ts
const increment = action(() => {
  count.set(count.get() + 1);
});
```

Why untracked?

Because actions are commands. They mutate state. They should not become dependencies of the reaction or computed value that called them.

The implementation is still small:

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

This is useful in application code:

```ts
const addTodo = action((title: string) => {
  todos.set([...todos.get(), { title, done: false }]);
});
```

The reads inside the action do not subscribe the caller.

## 12. Untracked Reads

Sometimes you want to read a value without creating a dependency.

That is what `untracked` is for:

```ts
const reaction = new Reaction(() => {
  console.log("tracked:", a.get());

  untracked(() => {
    console.log("not tracked:", b.get());
  });
});
```

Changing `a` will run the reaction again.

Changing `b` will not.

The implementation is just context switching:

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

export const untracked = runInContext;
```

## 13. Reaction Cleanup

Reactions are used for side effects.

Side effects often need cleanup.

A reaction can return a destructor:

```ts
const reaction = new Reaction(() => {
  const controller = new AbortController();
  
  fetch(url.get(), { signal: controller.signal })
    .then(...)
    
  return () => controller.abort()
});
```

Before the reaction runs again, Eleganto calls the previous destructor.

```ts
class Reaction {
  private _destructor: Destructor = null;

  _unsubscribeAndCleanup(): void {
    unsubscribeAndCleanup(this);
    this._destructor && untracked(this._destructor);
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

This makes reactions safer for DOM events, timers, subscriptions, and other effects.

Call `destroy()` when the reaction is no longer needed.

## 14. Weak Subscribers

A simple version of this system can leak memory.

If every observable stores strong references to its subscribers, then unused computed values and reactions may never be garbage-collected.

Eleganto stores `WeakRef`s instead:

```ts
class Computed<T> implements ISubscriber {
  readonly _weakRef = new WeakRef(this);
  readonly _subscriptions = new Map<ISubscription, IRevision>();
}
```

Then observables store weak references:

```ts
readonly _subscribers = new Set<WeakRef<ISubscriber>>();
```

This means an observable does not keep a computed value or reaction alive forever.

To clean old weak references, Eleganto uses `FinalizationRegistry`:

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

`FinalizationRegistry` runs when the JavaScript engine decides - soon or later - but in average it removes the most of dead subscribers.

For reactions with side effects, you should still call `destroy()`.

Weak references help prevent memory leaks in the dependency graph, but explicit cleanup is still the right way to handle real side effects.

## 15. Robustness

Small code still needs guardrails.

Eleganto has a few important ones.

### Recursive computed values

A computed value should not read itself while it is computing.

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

This catches mistakes early.

### No mutations inside computed values

Computed values should be pure.

They should derive data. They should not change data.

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

This rule removes many difficult edge cases.

It also keeps the model clear:

- `Computed` is for derived values.
- `Reaction` is for side effects.
- `Action` is for mutations.

### Infinite reaction loops

A reaction can update its own dependency:

```ts
const count = new Observable(0);

const reaction = new Reaction(() => {
  count.set(count.get() + 1);
});
```

That would run forever.

The scheduler stops after a fixed number of iterations, as shown above.

## 16. Homework for the Reader

This architecture is enough to pass many tests from standard reactive framework test suite.

There are a few tests that do not pass out of the box. I leave them as homework for the reader.

### Revert of values

If an observable changes inside a transaction and then returns to its initial value before the transaction ends, reactions should not run.

Example:

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

In the current simple version, the observable gets a new revision when it changes to `2`. Then it gets another new revision when it changes back to `1`.

A smarter version can store the initial transaction value and initial transaction revision. At the end, if the value is equal to the initial value, it can restore the initial revision.

One possible direction:

- add `txInitialValue` to `Observable`;
- add `txInitialRevision` to `Observable`;
- remember them on the first change inside a transaction;
- compare the final value with the initial value in `_updateRevision()`
- restore the initial revision if they are equal.

This keeps reactions from running when the final visible value did not change.

### Nested reactions

Sometimes a reaction creates another reaction.

```ts
const outer = new Reaction(() => {
  const value = a.get();

  const inner = new Reaction(() => {
    console.log(b.get(), value);
  });

  inner.run();
});
```

When the outer reaction runs again, the old inner reaction should be destroyed.

A simple direction:

- add a `_children` array to `Reaction`;
- check if a reaction is created while another reaction is running;
- add the new reaction to the parent reaction;
- destroy old children before the parent reaction runs again;
- destroy children when the parent is destroyed.

This keeps nested side effects under control.
