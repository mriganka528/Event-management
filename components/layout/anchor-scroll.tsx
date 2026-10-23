"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Makes `/#section` navigation land on the section.
 *
 * The public navigation links to `/#categories`, `/#packages` and `/#gallery`,
 * and the router's own handling of those is best-effort in a way that reads as
 * "the link sometimes does nothing":
 *
 *  - It scrolls once, after the route commits. If the target section has not
 *    rendered yet — a cold compile, a slow query, anything that delays the home
 *    page — there is nothing to scroll to, the attempt is dropped, and the
 *    visitor silently ends up at the top of a long page. It works when the page
 *    is cached and fails when it is slow, which is why it looked intermittent.
 *  - `html` sets `scroll-behavior: smooth`, so the scroll *animates*. Content
 *    above the target that settles mid-animation — fonts arriving through
 *    next/font's `swap`, a carousel settling — moves the target and leaves the
 *    animation parked at a stale offset. `/#gallery` is the worst affected
 *    because it sits below everything else on the page.
 *
 * So this re-checks until the target exists, then holds the position: it records
 * where the target came to rest and scrolls again only if it has actually
 * drifted. It never fights the visitor — any wheel, touch or key scroll hands
 * control straight back.
 */

/** How long to keep looking for a target that has not rendered yet. */
const LOOKING_MS = 120;
const MAX_LOOKING_ATTEMPTS = 20;

/**
 * ~2.4s of looking, which covers a cold compile and a slow query but not a page
 * that never resolves. Bounded because a hash that matches no element — a stale
 * bookmark, a `#` left on the URL — would otherwise poll for the rest of the
 * session.
 */
const MAX_LOOKING_MS = LOOKING_MS * MAX_LOOKING_ATTEMPTS;

/** Re-scrolling within this many pixels of the recorded position is pointless. */
const DRIFT_TOLERANCE_PX = 2;

function targetFromHash(hash: string): HTMLElement | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!id) return null;
  try {
    // A hash may be percent-encoded, and `getElementById` wants the decoded id.
    return document.getElementById(decodeURIComponent(id));
  } catch {
    return null;
  }
}

export function AnchorScroll() {
  const pathname = usePathname();

  useEffect(() => {
    // Any deliberate scroll means the visitor has taken over; from then on this
    // is their page, and a late correction would yank it away from them.
    let userMoved = false;
    const markMoved = () => {
      userMoved = true;
    };
    window.addEventListener("wheel", markMoved, { passive: true });
    window.addEventListener("touchmove", markMoved, { passive: true });
    window.addEventListener("keydown", markMoved);

    let interval = 0;
    let deadline = 0;
    /**
     * Where the target came to rest, so later checks can tell whether the page
     * moved under it. Left `null` until the first successful scroll — before
     * that there is nothing to compare against.
     */
    let restingAt: number | null = null;

    const stop = () => {
      window.clearInterval(interval);
      window.clearTimeout(deadline);
    };

    const settle = () => {
      if (userMoved) {
        stop();
        return;
      }

      const target = targetFromHash(window.location.hash);
      // No hash means this is an ordinary page load and there is nothing to do.
      // A target that is not in the document yet is not a failure — keep looking,
      // but only until the deadline.
      if (!target) {
        if (!window.location.hash) stop();
        return;
      }

      // Once the target is at rest and stays there, the job is done.
      const top = target.getBoundingClientRect().top;
      if (restingAt !== null && Math.abs(top - restingAt) <= DRIFT_TOLERANCE_PX) {
        stop();
        return;
      }

      // `instant` rather than `smooth`: the animation is the thing going wrong,
      // and the sections already carry `scroll-mt-28` to clear the sticky header.
      target.scrollIntoView({ block: "start", behavior: "instant" });
      restingAt = target.getBoundingClientRect().top;
    };

    // Re-check on a hash change too, because following a second anchor link from
    // the home page does not change the pathname and would otherwise never run.
    const restart = () => {
      stop();
      restingAt = null;
      interval = window.setInterval(settle, LOOKING_MS);
      // The backstop for a hash that matches nothing: without it the interval
      // keeps firing every 120ms for the life of the page.
      deadline = window.setTimeout(stop, MAX_LOOKING_MS);
      settle();
    };

    const onHashChange = () => restart();
    window.addEventListener("hashchange", onHashChange);
    restart();

    return () => {
      stop();
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("wheel", markMoved);
      window.removeEventListener("touchmove", markMoved);
      window.removeEventListener("keydown", markMoved);
    };
  }, [pathname]);

  return null;
}