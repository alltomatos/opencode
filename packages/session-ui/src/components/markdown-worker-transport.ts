export function createWorkerTransport<T extends { id: number; key: string }>(input: {
  post: (request: T) => void
  supersede: (request: T) => void
}) {
  const active = new Map<string, T>()
  const queued = new Map<string, T>()

  return {
    send(request: T) {
      if (!active.has(request.key)) {
        active.set(request.key, request)
        input.post(request)
        return
      }
      const previous = queued.get(request.key)
      if (previous) input.supersede(previous)
      queued.set(request.key, request)
    },
    complete(key: string, id: number) {
      if (active.get(key)?.id !== id) return
      active.delete(key)
      const next = queued.get(key)
      if (!next) return
      queued.delete(key)
      active.set(key, next)
      input.post(next)
    },
    dispose(key: string) {
      active.delete(key)
      const request = queued.get(key)
      if (request) {
        try {
          input.supersede(request)
        } catch {
          // See reset() — a consumer's rejection handler throwing must not propagate here.
        }
      }
      queued.delete(key)
    },
    reset() {
      queued.forEach((request) => {
        try {
          input.supersede(request)
        } catch {
          // A consumer's rejection handler threw synchronously — don't let one
          // bad callback abort teardown for the rest or crash the caller.
        }
      })
      queued.clear()
      active.clear()
    },
    queued: () => queued.size,
  }
}
