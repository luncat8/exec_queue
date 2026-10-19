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

- Hole sift-up must compare the event being sifted, not `h[i]`: after
  `h[i] = h[p]` the slot holds the parent, and comparing it stops the sift early
  and breaks heap order without any error. A benchmark that asserts drain order
  catches this immediately; a demo just looks slightly wrong.

- Per-event DOM is the hidden cost in a canvas demo. One `div` + `innerHTML`
  per event reached 158,000 rows in two minutes at ×100; throttling the log to
  one row per 90 ms (or a preallocated row pool fed from a ring in the sim)
  removes it. Same for `document.querySelector` inside the frame loop.

- Give the backing store the device pixels and draw in CSS pixels
  (`canvas.width = css * dpr`, `ctx.setTransform(dpr, …)`). Copying CSS size
  into `canvas.width` halves the resolution on retina; passing explicit width to
  `drawImage` on a cached backdrop shears it once `dpr > 1`.

- A capped drain must hold the clock at the last event it processed, not advance
  to the frame target — otherwise unprocessed events sit in the past.

- Production without a sink piles every bin at the cap and the bars stop moving
  (82.9% average fill, 0.5% of samples with an empty bin). A consumption tick
  per port as a real event brings it to ~53% fill with visible scarcity, and it
  gives the queue a third kind to demonstrate.

- Headless audit of a foreign demo: stub `document`, `performance.now`, a rAF
  queue and a canvas Proxy, then evaluate the inline script with `vm` in one
  context — top-level `let`/`const` stay reachable from later scripts in the
  same context, so you can inspect its internal state directly.

- Rendering a canvas app under node: `@napi-rs/canvas` plus a stub DOM works, but
  the stub must keep one context object for the whole run (resizing must not
  hand the page a new context), and the offscreen backdrop must be allocated
  larger than the page canvas or `drawImage` leaves unpainted bands.
