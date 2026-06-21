# Eleganto - The reactivity you finally understand

Modern software is very complex. React is so complex you can write a PhD thesis on it. Many libraries and concepts are represented with black boxes to hide the real complexity - sometimes this is right, but holding the full picture in your head gives you superpowers. Reactivity in modern UI frameworks is an example - the concept is quite simple, but if you see the implementation of, for example, MobX or preact-signals, you will immediately ge lost in dozens of micro-optimizations, quirky edge cases, and legacy. My goal for this article is to show you the implementation that is simple enough to fully keep in your head, but complex enough to pass almost all tests from the reactive framework tests suite. It turns out that taking the right decisions from the beginning can significantly simplify the mental model.

## Reactivity 101: The Core Primitives

The main goal of reactive frameworks is to do one thing: automatically update UI and run reactions/effects from changes of reactive state. This decomposes into the following primitives:

- **Observables/signals**: variables that hold the state. Usually they have some kind of getter and setter. Different frameworks have different conventions, but for simplicity we will use object-oriented approach with `Observable` class with methods

  - `.get()` to get the current value (with reactive tracking)
  - `.set(newValue)` to set the new value

- **Computed/derived values**: the derived state that can be expressed as read-only idempotent function of some observable variables. It has just `.get()` method

- **Reactions/effects**: The side effects (DOM updates, network requests). Different frameworks may have different conventions, but usually it has two methods:
  - `.run()` to run the reaction. In some framework this happens automatically after the reaction/effect creation
  - `.destroy()` destroys the reaction, stopping following observable changes, and (in some implementations) running destructor function

All the other flavours of reactivity like reactive stores (from MobX), signals with getter/setter .value property, can all be derived from the OOP representation:

```ts
export interface IObservable<T> {
  get(): T;
  set(newValue: T): void;
}

export interface IComputed<T> {
  get(): T;
  destroy(): void;
}

export interface IReaction {
  destroy(): void;
  run(): void;
}
```

## The Magic Trick: Auto-Tracking (The "How" Part 1)

What makes reactive frameworks feel magical is the autotracking - observable or computed values you use in your reactions or other computed values are being tracked automatically. How to do this? First, when the reaction or computed function is executed, it should set itself as a “context” for a `.get()` operation. When the `.get()` is called, it reads the global context variable and records it to its “subscribers” or “dependencies” - a set that holds all entities that used its value. In response, the observable should be recorded to the context's "subscriptions" or "dependencies":

```ts
// type.ts
export interface ISubscriber {
  readonly _subscriptions: Set<ISubscription>;
}

export interface ISubscription {
  readonly _subscribers: Set<ISubscriber>;
}
```

```ts
// subscriberContext.ts
export let subscriberContext: ISubscriber | null = null;

// helper to track subscriber inside subscribers/subscriptions
function trackSubscriber(subscription) {
  if (subscriberContext) {
    subscription._subscribers.add(subscriberContext);
    subscriberContext._subscriptions.add(subscription);
  }
}

// helper to run a function with given context
function runInContext(fn, context: ISubscriber) {
  const oldContext = subscriberContext;
  subscriberContext = context

  try {
    return fn();
  } finally {
    subscriberContext = oldContext;
  }
}
```

```ts
// observable.ts
class Observable implements ISubscription {
  _subscribers: Set<ISubscriber> = new Set();

  get() {
    trackSubscriber(this);
	return this._value;
  }
}
```

```ts
// computed.ts
class Computed implements ISubscription, ISubscriber {
  _subscriptions: Set<ISubscription> = new Set();
  _subscribers: Set<ISubscribers> = new Set();


  _recompute() {
    runInContext(this._fn, this);
  }

  get() {
    trackSubscriber(this);
  }
}
```

```ts
// reaction.ts
class Reaction implements ISubscriber {
  _subscriptions: Set<ISubscription> = new Set();

  run() {
    runInContext(this._fn, this);
  }
}
```

## Revisions

Let's introduce **revisions** - an object that will be unique for given observable/computed value. The logic is simple: **New value - new revision. Old value - old revision**. This will simplify 
