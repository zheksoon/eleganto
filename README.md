# Eleganto – Reactivity You Finally Understand

Software is complex. Software in the age of AI is even more complex, often layered with "vibecode" and lacking elegance. An elegant solution is much more valuable than a verbose one, even if it trades off some performance.

I once tried to understand how reactivity works in MobX, but I failed. It was too complex and verbose. I began writing my own implementations just to grasp the concepts. After many variants, the outcome was always the same: too many edge cases. After a few years, I finally found the formula. I called it Eleganto.

The main goal of Eleganto is readability and clarity. It relies on pure semantics rather than micro-optimizations. It is small enough to fit in your head in 15 minutes, yet comprehensive enough to pass a rigorous test suite. Let me show you how.

## 1. Primitives
All of reactivity in a nutshell:
```typescript
const a = new Observable(1);
const b = new Observable(2);
const c = new Computed(() => a.get() + b.get());

const printer = new Reaction(() => {
  console.log('C is ', c.get());
});

printer.run();  // Prints `C is 3`
a.set(5);       // prints `C is 7`
b.set(10);      // prints `C is 15`

// batch changes with transaction
tx(() => {
  a.set(2); // doesn't print
  b.set(3); // doesn't print
});
// prints `C is 5` on transaction end
```

The flow is quite clear. Instead of just logging to the console, we can mutate DOM elements or trigger other useful side effects.

## 2. No Magic

Computed values and reactions automatically track all the observables (or other computeds) they use. The mechanism is simple: when executing a reaction or computed body, a global "context" variable is set to point to it. Inside the Observable.get() method, we add this context as a "subscriber" so it can be notified of changes. We then add the observable to the "subscriptions" list of the computed or reaction, allowing it to easily unsubscribe

```typescript
let subscriberContext: ISubscriber | null = null;

export const trackSubscriber = (subscription: ISubscription, revision: IRevision): void => {
  if (subscriberContext) {
    subscription._subscribers.add(subscriberContext._weakRef);
    subscriberContext._subscriptions.set(subscription, revision);
  }
};

class Observable<T> implements ISubscription {
  readonly _subscribers = new Set<WeakRef<ISubscriber>>();
  // ...
  get(): T {
    trackSubscriber(this, this._revision);
    return this._value;
  }
}

class Computed<T> implements ISubscriber {
  readonly _weakRef = new WeakRef(this);
  // ...
  _recompute() {
    const previousContext = subscriberContext;
    subscriberContext = this;
    try {
      return this._fn();
    } finally {
      subscriberContext = previousContext;
    }
  }
}
```


If implemented naively, this approach will leak memory. Subscribers hold strong references, meaning an unused computed or reaction will stay in memory forever. We are in 2026, so we keep it simple: we store a WeakRef to the subscriber. To automatically remove the WeakRef from all subscriptions, we use a FinalizationRegistry. It runs a cleanup function when the subscriber is garbage-collected, and holding a WeakRef alongside a subscriptions map won't block the garbage collector.

```typescript
type HeldValue = [WeakRef<ISubscriber>, Map<ISubscription, IRevision>];

const registry = new FinalizationRegistry<HeldValue>(([ref, subscriptions]) => {
  for (const [subscription] of subscriptions) {
    subscription._subscribers.delete(ref);
  }
});

export const registerSubscriber = (subscriber: ISubscriber): void => {
  registry.register(subscriber, [subscriber._weakRef, subscriber._subscriptions]);
};
```

You might have noticed revision. It operates on a simple logic: no change means the same revision, while a change yields a new revision. For simplicity, it is implemented as a number, but it can be anything that supports equality checks (a === b). We record revisions when adding subscriptions, ensuring that the subscriber (whether a computed or a reaction) always knows the exact revision of the subscription it had during execution.

## 3. Notifying

When an observable changes, it notifies its subscribers. If a subscriber is a computed value, it recursively notifies its own subscribers, and so on. If the subscriber is a reaction, it is scheduled for execution. When a transaction ends, scheduled reactions check if they need to run, and execute accordingly.

```typescript
export function notify(subscribers: Set<WeakRef<ISubscriber>>) {
  for (const ref of subscribers) {
    const subscriber = ref.deref();
    if (subscriber !== undefined) {
      subscriber._notify();
    }
  }
}

class Computed<T> {
  // ...
  _notify() {
    if (this._state === STATE.CLEAN) {
      this._state = STATE.DIRTY;
      notify(this._subscribers);
    }
  }
}

class Reaction {
  // ...
  _notify() {
    if (this._state === STATE.CLEAN) {
      this._state = STATE.DIRTY;
      scheduleReaction(this);
    }
  }
}
```

## 4. When to Run and Recompute

Before executing, reactions verify whether a run is actually necessary:

```typescript
class Reaction {
  // ...
  _maybeRun() {
    if (this._state === STATE.DIRTY && revisionsChanged(this._subscriptions)) {
      this.run();
    } else {
      this._state = STATE.CLEAN;
    }
  }
}
```

If a reaction is marked as dirty and the revisions of its subscriptions have changed, it runs. If no revisions changed, it safely cleans itself without executing. The revision check relies on a method called _recomputeAndGetLatestRevision that exists on both observables and computed values. Despite the long name, the logic is incredibly simple:

```typescript
function revisionsChanged(subscriptions: Map<ISubscription, number>): boolean {
  for (const [subscription, lastRevision] of subscriptions) {
    if (subscription._recomputeAndGetLatestRevision() !== lastRevision) {
      return true;
    }
  }
  return false;
}
```

It loops through the actual revisions of all subscriptions, and if a mismatch is found, it returns true immediately.

The Observable has a trivial implementation: it simply returns its current revision:

```typescript
class Observable<T> {
  // ...
  _recomputeAndGetLatestRevision(): number {
    return this._revision;
  }
}
```

The Computed class is slightly more complex, but its logic reads like poetry:

```typescript
class Computed<T> {
  // ...
  _recomputeAndGetLatestRevision(): number {
    if (this._state === STATE.CLEAN) {
      return this._revision;
    }
    
    if (this._state === STATE.NOT_INITIALIZED) {
      this._value = this._recompute();
      this._revision = getNextRevision();
    }
    
    if (this._state === STATE.DIRTY && revisionsChanged(this._subscriptions)) {
      const newValue = this._recompute();
      if (this._value !== newValue) {
        this._value = newValue;
        this._revision = getNextRevision();
      }
    }
    
    this._state = STATE.CLEAN;
    return this._revision;
  }
}
```

- If it is clean (no dependencies have notified it), it returns the current revision.
- If it is not initialized (the first run or recovering from an exception), it recomputes and assigns a new revision.
- If it is dirty and the revisions of its subscriptions have changed (checked recursively), it recomputes.
- After recomputing, it checks if the final derived result actually changed. If it has, it assigns a new revision.
- Finally, it marks itself as clean so it won't recalculate again without a new notification.

## 5. Transactions
The transaction implementation is simple: increment a global depth counter before execution, and decrement it afterward. When the counter reaches 0, the reaction runner flushes the queue:

```typescript
let txDepth = 0;

export function tx(fn: () => void) {
  txDepth++;
  try {
    fn();
  } finally {
    txDepth--;
    if (txDepth === 0) {
      runScheduledReactions();
    }
  }
}
```

## 6. Robustness

Let's add a few safeguards to make the system robust:

1. Recursion protection for computed values. A computed value should not be able to reference itself while it is still computing:

```typescript
class Computed<T> {
  // ...
  get(): T {
    if (this._state === STATE.COMPUTING) {
      throw new Error("Recursive computed call");
    }
    
    const revision = this._recomputeAndGetLatestRevision();
    trackSubscriber(this, revision);
    
    return this._value!;
  }
}
```

2. Mutation prevention. You should not be allowed to mutate an observable from inside a computed derivation:

```typescript
class Observable<T> {
  // ...
  set(newValue: T) {
    if (subscriberContext instanceof Computed) {
      throw new Error("Changing observable inside of computed");
    }
    // ... apply new value ...
  }
}
```

2. Infinite loop prevention. The reaction runner must stop infinite loops, which happen when a reaction continuously mutates its own dependencies. A simple solution is to swap queues for newly scheduled reactions while executing the previous batch, breaking the loop if too many iterations occur:

```typescript
let scheduledReactions: Reaction[] = [];

function runScheduledReactions() {
  try {
    let iterations = 0;
    while (scheduledReactions.length > 0) {
      if (iterations++ > 100) {
        throw new Error("Infinite reaction loop detected");
      }
      
      const queue = scheduledReactions;
      scheduledReactions = []; // Swap queue
      
      for (const reaction of queue) {
        try {
          reaction._maybeRun();
        } catch (error) {
          console.error("Reaction exception:", error);
        }
      }
    }
  } finally {
    // Clear queue on global failure to prevent getting stuck
    scheduledReactions = []; 
  }
}
```

3. Reaction destructors. For convenience, you should be able to return a cleanup function from a reaction's body to handle side effects:

```typescript
class Reaction {
  private _destructor?: () => void;
  // ...
  run() {
    this._unsubscribeAndCleanup();
    
    // Execute the reaction body inside an untracked transaction!
    this._destructor = utx(this._fn, this);
  }
  
  destroy() {
    this._unsubscribeAndCleanup();
    if (this._destructor) this._destructor();
  }
}
```

## The End

Congratulations! This architecture is all you need to pass almost every test in standard reactive framework test suites.

There are a few tests that won't pass out of the box, which I leave as homework for the reader:

1. **Revert of values**: If an observable reverts to its initial value by the end of a transaction, reactions should not run. Hint: add txInitialValue and txInitialRevision to Observable, compare the value in _recomputeAndGetLatestRevision, and revert to the initial revision if they are equal.

2. **Nested reactions**: Inner reactions should be destroyed when the parent reaction re-runs. Hint: add a _children array to Reaction, check if a reaction is running within another reaction's context, and add it to the parent's children list. Destroy all children before destroying the parent itself.

The remaining tests typically rely on side effects inside computed derivations, which this framework explicitly disallows.