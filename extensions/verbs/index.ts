import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const singleWordMessages = [
  "Overclocking...",
  "Transpiling...",
  "Rebasing...",
  "Bisecting...",
  "Sharding...",
  "Packetizing...",
  "Vectorizing...",
  "Quantizing...",
  "Entangling...",
  "Benchmarking...",
  "Pipelining...",
  "Tokenizing...",
  "Containerizing...",
  "Serializing...",
  "Multiplexing...",
  "Debouncing...",
  "Throttling...",
  "Prefetching...",
  "Rasterizing...",
  "Raytracing...",
  "Backpropagating...",
  "Sprinting...",
  "Jogging...",
  "Striding...",
  "Pacing...",
  "Pedaling...",
  "Freewheeling...",
  "Drafting...",
  "Cornering...",
  "Switchbacking...",
  "Summiting...",
  "Wayfinding...",
  "Scrambling...",
  "Ridgewalking...",
  "Bushwhacking...",
  "Trailblazing...",
  "Cruising...",
  "Downshifting...",
  "Apexing...",
  "Overlanding...",
  "Detouring...",
  "Slipstreaming...",
  "Redlining...",
  "Stargazing...",
  "Dopplering...",
  "Bazingaing...",
] as const;

export const shortPhraseMessages = [
  // Running
  "Chasing negative splits...",
  "Compiling at tempo...",
  "Running the hot path...",
  "Refactoring between intervals...",
  "Debugging at threshold pace...",
  "Shipping before cooldown...",
  "Profiling the final lap...",
  "Outrunning quadratic time...",
  "Finding runtime cadence...",
  "Pacing the event loop...",

  // Cycling
  "Drafting behind packets...",
  "Pedaling through deadlocks...",
  "Climbing the call graph...",
  "Shifting into big endian...",
  "Freewheeling past warnings...",
  "Trueing the dependency wheel...",
  "Spinning concurrent cranks...",
  "Routing around headwinds...",
  "Descending the happy path...",
  "Caching the feed zone...",

  // Programming
  "Compressing the thought graph...",
  "Inlining the clever bits...",
  "Untangling asynchronous shoelaces...",
  "Warming the instruction cache...",
  "Teaching types new tricks...",
  "Rebasing onto reality...",
  "Hunting nondeterministic gremlins...",
  "Vectorizing the brainwaves...",
  "Sharding the big idea...",
  "Benchmarking pure optimism...",
  "Escaping callback gravity...",
  "Pipelining probable answers...",
  "Indexing latent possibilities...",
  "Deploying tiny victories...",
  "Taking the scenic branch...",

  // Driving and road trips
  "Cruising the data highway...",
  "Downshifting for edge cases...",
  "Rerouting around technical debt...",
  "Mapping the next waypoint...",
  "Merging smoothly onto main...",
  "Testing every exit ramp...",
  "Fueling the event loop...",
  "Passing the slow lane...",
  "Cornering without undefined behavior...",
  "Parallel parking the threads...",
  "Reading the silicon horizon...",
  "Driving toward green builds...",
  "Plotting a cache detour...",
  "Redlining the profiler...",
  "Following compiler road signs...",

  // Hiking
  "Hiking the dependency ridge...",
  "Summiting the abstraction layer...",
  "Blazing a typed trail...",
  "Wayfinding through legacy code...",
  "Switchbacking around regressions...",
  "Scrambling over merge conflicts...",
  "Packing only useful context...",
  "Reading the runtime compass...",
  "Crossing the async valley...",
  "Following semantic breadcrumbs...",
  "Leaving no trace logs...",
  "Refactoring above tree line...",
  "Finding the base camp...",
  "Checking the weather branch...",
  "Traversing the silicon foothills...",

  // A little Pasadena physics
  "Calibrating the friendship algorithm...",
  "Knocking exactly three times...",
  "Optimizing apartment thermodynamics...",
  "Solving roommate edge cases...",
  "Calculating optimal couch coordinates...",
  "Ordering tensors for dinner...",
  "Testing the roommate protocol...",
  "Revising the relationship agreement...",
  "Debugging social subroutines...",
  "Simulating comic shop traffic...",
  "Modeling Pasadena entropy...",
  "Checking the Doppler effect...",
  "Making a quantum leap...",
  "Normalizing string theory...",
  "Entangling stubborn variables...",
  "Expanding the known universe...",
  "Applying nonlocal reasoning...",
  "Collapsing the bug function...",
  "Observing changes the output...",
  "Accelerating past light speed...",
  "Launching the moonshot branch...",
  "Orbiting the root cause...",
  "Reheating leftover equations...",
  "Aligning all the whiteboards...",
  "Computing probable punchlines...",
] as const;

export const messages = [...singleWordMessages, ...shortPhraseMessages] as const;

export function pickRandom(random = Math.random): string {
  return messages[Math.floor(random() * messages.length)]!;
}

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", (_event, ctx) => {
    ctx.ui.setWorkingMessage(pickRandom());
  });

  pi.on("turn_end", (_event, ctx) => {
    ctx.ui.setWorkingMessage();
  });
}
