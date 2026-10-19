# findings, pitfalls, skills

- Time-ordered queue: a binary min-heap over parallel typed arrays (`time`,
  `kind`, `ref`) allocates nothing once capacity is reached. Keep the handler
  call outside the sift loop and re-read the arrays from `this` inside
  `drainUntil`, because a handler may grow them.
  Measured 50k push+drain: heap 12.6 ms vs sorted-array memmove 167.9 ms.

- Event handlers must schedule follow-up work from the event time, not from the
  frame clock. The cheap way to prove it: run the same seed with 1-minute and
  with 37-minute steps and compare every ship and stock field after a few
  thousand minutes. Any use of a frame clock, or state advanced before the
  drain, breaks equality immediately.

- Recurring state (production, decay) belongs inside the drain:
  `produce(time - t)` before handling each event, then once more to the target.
  Bulk-applying it before the drain makes every event in a jump see the future.

- Cycles of "retire → schedule replacement" need the request to survive a full
  fleet; dropping it at the cap silently shrinks the population. Retrying every
  10–50 minutes keeps the queue bounded and the fleet stable.

- Canvas GUI can be exercised under node with a stub document and a Proxy canvas
  context (`createLinearGradient`/`createRadialGradient` return an object with
  `addColorStop`). It catches wrong element ids, listener wiring and per-frame
  exceptions without a browser.

- Canvas backdrops cached in an offscreen canvas: draw it with `drawImage(bg, 0, 0)`
  after `setTransform(1, 0, 0, 1, 0, 0)`. Passing explicit width/height to
  `drawImage` mixes device pixels with CSS pixels and shears the image once
  `devicePixelRatio > 1`.

- Render offscreen under node with `@napi-rs/canvas` (installed outside the repo)
  to check layout, colors and DPR handling without a browser; feed it a stub DOM
  and an rAF queue.
