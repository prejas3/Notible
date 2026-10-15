/**
 * Notification sounds (repair plan SND1). Made with Web Audio — no files, no licences. Off by
 * default. They play only for notices shown inside Notible, never on top of a Windows
 * notification, which has its own sound.
 */
export type NoticeSound = "none" | "chime" | "bell" | "pop";
export const NOTICE_SOUNDS: readonly NoticeSound[] = ["none", "chime", "bell", "pop"];
export const SOUND_KEY = "notible-notice-sound";

export function readNoticeSound(): NoticeSound {
  try {
    const value = localStorage.getItem(SOUND_KEY);
    return NOTICE_SOUNDS.includes(value as NoticeSound) ? value as NoticeSound : "none";
  } catch {
    return "none";
  }
}

/** The notes of each sound: frequency (Hz), start and length (s), peak loudness (0–1). */
const SHAPES: Record<Exclude<NoticeSound, "none">, Array<{ hz: number; at: number; length: number; peak: number; type: OscillatorType }>> = {
  chime: [{ hz: 880, at: 0, length: 0.5, peak: 0.18, type: "sine" }, { hz: 1318.5, at: 0.12, length: 0.6, peak: 0.12, type: "sine" }],
  bell: [{ hz: 659.3, at: 0, length: 0.9, peak: 0.2, type: "sine" }, { hz: 1318.5, at: 0, length: 0.5, peak: 0.06, type: "sine" }, { hz: 1977, at: 0, length: 0.3, peak: 0.03, type: "triangle" }],
  pop: [{ hz: 520, at: 0, length: 0.09, peak: 0.25, type: "triangle" }],
};

/**
 * Schedules the sound on any audio context (a live one to play it, an offline one to check it).
 * Returns how long it lasts in seconds; 0 for "none", which schedules nothing.
 */
export function scheduleNoticeSound(context: BaseAudioContext, sound: NoticeSound, start = context.currentTime): number {
  if (sound === "none") return 0;
  let end = 0;
  for (const note of SHAPES[sound]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = note.type;
    oscillator.frequency.value = note.hz;
    // A soft attack and an exponential fade: no click at either end.
    gain.gain.setValueAtTime(0.0001, start + note.at);
    gain.gain.exponentialRampToValueAtTime(note.peak, start + note.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + note.at);
    oscillator.stop(start + note.at + note.length + 0.02);
    end = Math.max(end, note.at + note.length + 0.02);
  }
  return end;
}

let live: AudioContext | null = null;
export function playNoticeSound(sound: NoticeSound = readNoticeSound()): void {
  if (sound === "none") return;
  try {
    live ??= new AudioContext();
    void live.resume().catch(() => {});
    scheduleNoticeSound(live, sound);
  } catch {
    // No audio device: a notice without a sound.
  }
}
