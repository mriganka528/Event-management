/**
 * A short chime for an incoming notification.
 *
 * Synthesised with the Web Audio API rather than shipped as an audio file, so
 * there is no asset to download, no cache to bust, and nothing for the browser
 * to fetch before it can play the sound. Two notes, a fifth apart, with a soft
 * envelope so it reads as a chime rather than a beep.
 *
 * Browsers refuse to start audio until the user has interacted with the page,
 * so the context is created lazily on the first gesture and resumed if it was
 * suspended. A notification that arrives before that is simply silent; there
 * is no way around it, and pretending otherwise would throw.
 *
 * The mute preference is remembered per browser so a person who turned the
 * sound off is not asked again on every page load.
 */

const STORAGE_KEY = "staff-notification-sound";

let context: AudioContext | null = null;

/** Whether the sound is switched on. Defaults to on for somebody new. */
export function isNotificationSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // A browser that refuses local storage still gets the sound.
    return true;
  }
}

export function setNotificationSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Nothing to do; the preference simply does not persist.
  }
}

/**
 * The audio context, created on demand.
 *
 * It is kept between calls so the second notification does not pay for
 * creating another one, and so a suspended context can be resumed.
 */
function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  return context;
}

/**
 * Plays the chime.
 *
 * Returns whether a sound was actually produced, so the caller can tell the
 * difference between "played" and "the browser would not allow it yet".
 */
export function playNotificationSound(): boolean {
  if (!isNotificationSoundEnabled()) return false;
  const ctx = audioContext();
  if (!ctx) return false;

  // A context created before any interaction starts suspended, and one that
  // was suspended by the browser needs resuming. Both are asynchronous, so the
  // notes are scheduled from the resumed context rather than from here.
  const play = () => {
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // A soft attack and a longer decay: the note should fade in and out
    // rather than click on and off.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    for (const [index, frequency] of [880, 1318.5].entries()) {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now + index * 0.11);
      oscillator.stop(now + 0.6);
    }
  };

  if (ctx.state === "suspended") {
    ctx
      .resume()
      .then(() => {
        if (ctx.state === "running") play();
      })
      .catch(() => undefined);
    return false;
  }

  try {
    play();
    return true;
  } catch {
    return false;
  }
}

/**
 * Unlocks the audio context on the first user interaction.
 *
 * Browsers only allow audio after a gesture, and the notification that
 * prompts the sound may well arrive before the person has clicked anything.
 * Listening for the first gesture and resuming the context there means the
 * sound is ready for every notification after it.
 */
export function unlockNotificationSound() {
  if (typeof window === "undefined") return () => undefined;
  const unlock = () => {
    const ctx = audioContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => undefined);
  };
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  for (const event of events) {
    window.addEventListener(event, unlock, { once: true, passive: true });
  }
  return () => {
    for (const event of events) window.removeEventListener(event, unlock);
  };
}
