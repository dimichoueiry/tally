// Capture constants shared by main (policy) and the engine (requests).

// System audio = getDisplayMedia loopback (what the computer plays, never a
// microphone). No voice processing: AGC drove the spike's tone to clipping. Stereo.
// spike/sysaudio/README.md.
export const SYSTEM_AUDIO = Object.freeze({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 });

// Recorder bitrates. Also used for the disk-space estimates (minutes left).
export const VIDEO_BPS = { '1080p': 6_000_000, native: 12_000_000 };
export const AUDIO_BPS = 160_000;
export const bytesPerSecond = (quality, audio) => (VIDEO_BPS[quality === 'native' ? 'native' : '1080p'] + (audio ? AUDIO_BPS : 0)) / 8;
