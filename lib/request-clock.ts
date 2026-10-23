import { cache } from "react";

/**
 * The moment the current request started serving, memoised for the whole render.
 *
 * React's `cache` is scoped to a single server request, so every component in
 * one render sees the same number. Reading the clock inline would return a
 * slightly later value on each render, and on hydration the client would arrive
 * at a third one — three different answers to "when did this page appear", which
 * is both a hydration mismatch and a worse answer to the question the fill timer
 * is actually asking.
 */
export const requestStartedAt = cache(() => Date.now());