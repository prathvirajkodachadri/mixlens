# MixLens — Audio Analyzer for Mixing

A browser-based audio analyzer tuned for **deep cinematic narration (KGF style)** and general mixing work.
Drop in any audio file and get studio-grade measurements plus plain-language mixing suggestions.
**100% offline — audio never leaves your browser.**

![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen) ![Runs anywhere](https://img.shields.io/badge/platform-any%20browser-blue)

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
index.html            UI
style.css             dark studio theme
app.js                analysis engine + rendering (FFT, K-weighting, detection, export)
test.js               unit tests (Node)
cross_validate.js     cross-validation harness (Node)
make_reference.py     reference-signal generator (Python, optional)
verify_kweight.js     K-weighting filter verification (Node)
ref/                  generated reference WAVs (gitignored)
```

## 📄 License

MIT — see [LICENSE](LICENSE).
