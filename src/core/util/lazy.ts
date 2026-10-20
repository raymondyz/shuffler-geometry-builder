/** A function that computes its value on first call and returns the cached value afterwards. */
export function lazy<T>(compute: () => T): () => T {
  let done = false
  let value: T
  return () => {
    if (!done) {
      value = compute()
      done = true
    }
    return value
  }
}

/** Memoise a function on the identity of its arguments (only the most recent call is kept). */
export function memoizeLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null
  let lastResult: R
  return (...args: A) => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((a, i) => a === args[i])) return lastResult
    lastResult = fn(...args)
    lastArgs = args
    return lastResult
  }
}
