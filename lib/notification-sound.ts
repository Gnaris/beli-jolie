/**
 * Play a short pleasant "ding" notification sound using the Web Audio API.
 * No external audio file needed — works in any modern browser.
 * Fails silently if audio is unavailable (e.g. autoplay blocked).
 */
export function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    // Pleasant two-tone "ding"
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(830, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1050, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);

    oscillator.onended = () => ctx.close();
  } catch {
    // Audio not available — silent fallback
  }
}
