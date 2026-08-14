# MixLens — Audio Analyzer for Mixing (+ VoxLens Vocal Chain)

A browser-based audio analyzer tuned for **deep cinematic narration (KGF style)** and general mixing work.
Drop in any audio file and get studio-grade measurements plus plain-language mixing suggestions.
**100% offline — audio never leaves your browser.**

**New: VoxLens** (`vox.html`) — an XVox-style **all-in-one vocal chain plugin in the browser**: drop in a vocal,
shape it live with knob-per-function modules, A/B against the dry signal, and export a rendered WAV.
Same zero-dependency, fully local approach.

![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen) ![Runs anywhere](https://img.shields.io/badge/platform-any%20browser-blue)

## 🎙 VoxLens — vocal chain (vox.html)

The processing chain, in order (each module toggleable, stereo-linked detection):

| Module | Controls | What it does |
|---|---|---|
| **Gate** | Threshold · Range · Release | Downward gate for room noise between phrases |
| **De-Ess** | Freq · Threshold · Amount | Dynamic high-shelf driven by an isolated sibilance band — tames "ess" without touching the body |
| **Tone EQ** | HPF · Low · Tone · Air | Rumble filter, low-shelf weight, dark↔bright tilt, 10 kHz air shelf |
| **Compressor** | Threshold · Ratio · Attack · Release · Makeup | Soft-knee, stereo-linked dynamics with live GR meter |
| **Heat** | Drive · Mix | 4×-oversampled tanh saturation (parallel blend) for harmonic density |
| **Output** | Level · Ceiling | Pre-limiter "push" gain + 2 ms lookahead limiter that never overshoots |

- **Chain presets**: Default · Deep Narration (KGF) · Vocal/Song · Podcast Voice · Gentle Polish
- **Live preview** in an AudioWorklet running pure-JS DSP — every knob processes in real time
- **A/B bypass** button for instant before/after
- **Export WAV**: the *same* DSP renders offline (bit-identical to preview) → 24-bit WAV at the original sample rate
- Knobs: vertical drag · Shift = fine · wheel · double-click reset · arrow keys
- Settings persist locally; meters show IN/OUT level + per-module gain reduction

DSP core is `vox-dsp.js` (pure JS, no Web Audio dependency) — tested headlessly in Node.

## 🧪 VoxLens DSP tests

```bash
node test-vox.js   # 27 checks: biquad accuracy, gate/de-ess/comp curves, saturation
                   # harmonics, limiter ceiling (sine + noise), mono/stereo, 44.1/48 kHz
```

Highlights: passthrough is bit-transparent, 0 dBFS noise renders to exactly −1.00 dBFS at the
ceiling with no overshoot, compressor curve matches theory within ±0.6 dB.

## ✨ Features

- **EBU R128 loudness** — integrated LUFS, short-term max, Loudness Range (K-weighting matches the ITU BS.1770-4 reference coefficients with 0.000 dB deviation; validated ±0.04 LU against `pyloudnorm`)
- **True peak** (oversampled estimate), sample peaks, crest factor, clipping detection
- **Spectrum analysis** with 8 mixing zones: Sub · Chest · Warmth · Mud · Body · Presence · Sibilance · Air — measured against a pink-tilt reference
- **Time-located rumble detection** (20–80 Hz): timestamps, duration, dominant frequency, high-pass recommendation
- **Sibilance detection** with clickable timestamps
- **Noise floor** estimation
- **Stereo image**: correlation, width, mono-compatibility verdict
- **Reference compare**: overlay a reference track and get band-by-band findings
- **Fix Preview**: A/B the suggested fixes live (HPF, mud cut, presence, de-ess, leveling + loudness)
- **WAV + markers export**: re-exports your audio with sibilance/rumble/clip markers embedded (`cue` + `adtl` chunks) — Cubase shows them as WAV markers
- **Content presets**: Deep Narration (KGF) · Vocal/Song · Full Mix
- **Loudness targets**: −16 (under music) / −14 (YouTube) / −9 (loud promo)
- **Export report** (.txt)

## 🚀 Use it

Just open `index.html` in any modern browser — or serve the folder:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## 🧪 Tests

No dependencies for the app itself. The test harness runs on Node ≥ 16:

```bash
node test.js              # unit tests (levels, LUFS, zones, suggestions)
node cross_validate.js    # cross-validation vs pyloudnorm + edge cases
```

Regenerating the reference signals (optional; requires Python + `numpy`, `soundfile`, `pyloudnorm`):

```bash
python3 make_reference.py
```

Validated results:

| Check | Result |
|---|---|
| K-weighting vs ITU BS.1770-4 coefficients | 0.000 dB max deviation |
| Integrated LUFS vs pyloudnorm (6 signal types, 44.1/48 kHz, mono/stereo) | ±0.04 LU |
| LRA (6 dB level swing) | 6.02 LU |
| Rumble/sibilance detection | correct timestamps, no false positives |
| WAV marker round-trip | cue positions + labels byte-perfect |
| 3-minute file analysis | ~1.5 s |

## 📁 Structure

```
index.html            MixLens UI (analyzer)
style.css             dark studio theme
app.js                analysis engine + rendering (FFT, K-weighting, detection, export)
vox.html              VoxLens UI (vocal chain plugin)
vox.css               plugin faceplate styles (knobs, module cards, meters)
vox.js                VoxLens controller: knobs, transport, presets, WAV export
vox-dsp.js            vocal chain DSP core — pure JS, runs in worklet/browser/Node
vox-worklet.js        AudioWorkletProcessor wrapper for real-time preview
test.js               unit tests (Node)
test-vox.js           VoxLens DSP tests (Node)
cross_validate.js     cross-validation harness (Node)
make_reference.py     reference-signal generator (Python, optional)
verify_kweight.js     K-weighting filter verification (Node)
ref/                  generated reference WAVs (gitignored)
```

## 📄 License

MIT — see [LICENSE](LICENSE).
