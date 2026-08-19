# MixLens — Professional Vocal Analysis Engine (+ Mix Analyzer & VoxLens)

A browser-based, studio-grade audio engineering suite powered by 100% offline, zero-dependency digital signal processing.

1. **🎙 MixLens Vocal Analysis Engine (`index.html`)** — An AI-assisted vocal mixing and analysis engine that analyzes raw vocal recordings and produces a complete, evidence-based engineering report (health, pitch, formants, tonal balance, events, dynamics, and a plugin-agnostic EQ plan).
2. **📊 MixLens Audio Analyzer (`analyzer.html`)** — EBU R128 loudness and spectral analyzer tuned for cinematic narration (KGF style) and general mixing work.
3. **🎛 VoxLens Vocal Chain (`vox.html`)** — An XVox-style all-in-one real-time vocal chain plugin in the browser with live DSP preview and 24-bit WAV export.

![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen) ![Runs anywhere](https://img.shields.io/badge/platform-any%20browser-blue) ![100% Offline](https://img.shields.io/badge/privacy-100%25%20local-success)

---

## 🎙 MixLens Vocal Analysis Engine (`index.html`)

The Vocal Analysis Engine is built on the core engineering principle:

> **MEASURE → INTERPRET → CLASSIFY → DECIDE → RECOMMEND**

Every recommendation is backed by measurable DSP evidence rather than generic EQ recipes.

### 🔬 Analysis Modules (18 Engines)

| Module | Engine | What it analyzes |
|---|---|---|
| **Module 1** | **Recording Health** | Digital clipping count, longest clipped run, True-Peak (4x polyphase FIR), noise floor (dBFS), SNR, 50/60 Hz mains hum series, DC offset, nonlinear distortion. |
| **Module 2** | **Spectral Analysis** | Multi-frame STFT (4096-pt Hann window), active vocal frame selection, average / median / 90th percentile spectrum, spectral tilt, centroid, flux, flatness. |
| **Module 3** | **Fundamental Pitch (F0)** | YIN pitch estimation with sub-sample parabolic interpolation, voiced/unvoiced ratio, pitch stability, vibrato rate (Hz) and depth (cents). |
| **Module 4** | **Harmonic Structure** | Harmonic-to-Noise Ratio (HNR in dB), harmonic cascade (H1–H12), harmonic roll-off slope (dB/oct), odd/even harmonic balance. |
| **Module 5** | **Formant Analysis (LPC)** | Linear Predictive Coding (LPC) formant estimation for F1, F2, F3, formant trajectory and Singer's Formant ring (2.8–3.4 kHz). |
| **Module 6** | **16-Zone Tonal Balance** | Low (Rumble, Plosive Sub, Boom, Warmth, Body), Low-Mid (Mud, Boxiness, Hollow), Mid (Nasal, Honk, Mid Resonance), Upper-Mid (Clarity, Presence, Harshness, Shrillness), High (Sibilance, Tizziness, Brightness, Air) compared against normative vocal targets. |
| **Module 7** | **Dynamic Spectral Analysis** | Multi-tier energy evaluation (quiet vs normal vs loud frames) to distinguish static problems from level-dependent surges (e.g. dynamic harshness when belting). |
| **Module 8** | **Dynamics & Loudness** | Peak sample, True Peak, RMS, crest factor, dynamic range, EBU R128 integrated LUFS, short-term max, momentary max, LRA (LU), phrase-to-phrase consistency, compression styling. |
| **Module 9** | **Vocal Event Segmentation** | Time-localized event segmentation for fricatives ('S', 'SH', 'CH'), plosives ('P', 'B'), stops ('T', 'K'), inhalations, and mouth clicks. |
| **Module 10** | **Event-Based Sibilance** | Analyzes actual sibilant events in time and frequency to extract dominant sibilance peak frequency, average level, severity, and exact de-esser parameters. |
| **Module 11** | **Plosive Analysis** | Low-frequency transient blast detection (<120 Hz) with timestamps and clip-gain / dynamic HPF suggestions. |
| **Module 12** | **Breath Management** | Inhalation detection, breath loudness relative to vocal line, and 4–6 dB attenuation advice. |
| **Module 13** | **Proximity Effect** | Phrase-by-phrase low-end variance to identify close-mic boominess. |
| **Module 14** | **Vocal Character Profile** | 11-dimension 0–100 radar scores: `[BODY, WARMTH, CLARITY, PRESENCE, BRIGHTNESS, AIR, NASALITY, HARSHNESS, SIBILANCE, DYNAMICS, NOISE]` and natural language classification. |
| **Module 15** | **Mix Masking Analysis** | Dual audio upload comparing Vocal against Instrumental/Beat to detect frequency collisions, masking probability %, and instrument bus carving recommendations. |
| **Module 16** | **Stereo & Phase Analysis** | Inter-channel correlation (-1 to +1), Mid/Side distribution, stereo width %, mono compatibility, and anti-phase cancellation warnings. |
| **Module 17** | **Reference Vocal Compare** | Dual audio upload comparing source vocal against target reference track for delta spectrum curves and dynamic matching. |
| **Module 18** | **Engineering Decision Engine** | Prioritized decision matrix (`P0` Recording issues, `P1` Corrective, `P2` Tonal, `P3` Fine tuning, `P4` Enhancement) yielding 3–8 targeted EQ bands (`CUT`, `BOOST`, `DYNAMIC_CUT`, `DYNAMIC_BOOST`, `DE_ESS`, `COMPRESS`, `AUTOMATE`, `LEAVE_UNCHANGED`). |

### 📄 Complete Vocal Report

After you upload a vocal, MixLens opens a full engineering report covering all 18 analysis modules: recording health, spectrum, pitch/vibrato/harmonics, formants, 16-zone tonal balance, resonances, dynamic spectral behavior, EBU R128 loudness, sibilance/plosives/breaths, stereo/phase, recommendations, and a plugin-agnostic EQ / processing plan. Download it as a `.txt` file — no VST preset is generated.

---

## 📊 MixLens Audio Analyzer (`analyzer.html`)

- **EBU R128 loudness** — integrated LUFS, short-term max, Loudness Range (K-weighting matches ITU BS.1770-4 with 0.000 dB deviation).
- **8 Mixing Zones** measured against a pink-tilt reference.
- **Rumble & sibilance detection** with clickable timestamps.
- **Stereo image analysis**: correlation, width, and mono-compatibility.
- **WAV + markers export**: re-exports audio with embedded markers (`cue` + `adtl` chunks) for Cubase / DAWs.

---

## 🎛 VoxLens Vocal Chain (`vox.html`)

- **Gate** (Downward gate for room noise)
- **De-Ess** (Dynamic sibilance control)
- **Tone EQ** (HPF, Low weight, Tone tilt, Air shelf)
- **Compressor** (Soft-knee, stereo-linked dynamics with live GR meter)
- **Heat** (4x oversampled tanh saturation)
- **Output Limiter** (2 ms lookahead true limiter)
- **Real-time Web Audio Worklet** + **24-bit WAV offline rendering**.

---

## 🚀 Running MixLens

Open `index.html` in any modern web browser — or serve locally:

```bash
python3 -m http.server 8080
# Open http://localhost:8080 in your browser
```

---

## 🧪 Automated Test Suites

MixLens has comprehensive zero-dependency test suites runnable in Node.js (≥ 16):

```bash
node test-vocal.js      # Comprehensive test of all 18 Vocal Analysis Engine modules
node test.js            # Unit tests for MixLens Audio Analyzer engine
node test-vox.js        # 27 DSP tests for VoxLens Vocal Chain plugin
node test-ui-sim.js      # Headless DOM and UI interaction simulation
node test-boot-guard.js # Boot guard: stale-cache recovery & module-load failure handling
node verify_kweight.js  # K-weighting filter accuracy verification
```

---

## 🔧 Troubleshooting

- **"Analysis failed: Cannot read properties of undefined (reading …)"** — your browser
  is running a stale cached copy of the scripts from an older release. Hard-refresh the
  page (**Ctrl/Cmd + Shift + R**). Since v2.0.1 all assets are cache-busted (`?v=2.0.1`),
  and the UI auto-detects a missing engine module, reloads one fresh copy by itself, and
  shows a recovery banner instead of a cryptic error.

---

## 📁 Repository Structure

```
index.html                  MixLens Vocal Analysis Engine (NEW Homepage)
analyzer.html               MixLens Audio Analyzer (Preserved)
vox.html                    VoxLens Vocal Chain Plugin (Preserved)
style.css                   Base dark studio theme styles
vocal.css                   Vocal Analysis UI styles (meters, tabs, cards, plots)
vox.css                     VoxLens plugin faceplate styles
app.js                      Analyzer engine (powers analyzer.html)
vocal/                      Modular Vocal Analysis DSP & Decision Engine
├── dsp.js                  Core DSP: Radix-2 FFT, YIN, LPC, Biquads, True Peak, K-weighting
├── health.js               Module 1: Clipping, Noise Floor, SNR, 50/60 Hz Hum, DC Offset
├── spectrum.js             Module 2: Multi-frame STFT, Voiced selection, Spectral descriptors
├── pitch.js                Modules 3 & 4: YIN pitch (F0), Vibrato rate/depth, Harmonics, HNR
├── formants.js             Module 5: LPC Formants (F1, F2, F3, Singer's Formant)
├── tonal.js                Module 6: Complete 16-zone vocal acoustic spectrum evaluation
├── resonances.js           Resonance Engine: Harmonic vs Stationary peak discrimination
├── dynamic-spectral.js     Module 7: Multi-tier dynamic spectral analysis (Quiet vs Loud)
├── dynamics.js             Module 8: EBU R128 Loudness, LRA, Crest Factor, Compression style
├── events.js               Modules 9–12: Sibilance ('S'/'SH'), Plosives, Breaths, Clicks
├── character.js            Modules 13 & 14: Proximity effect & 11-dimension radar scoring
├── masking.js              Module 15: Vocal vs Instrumental mix masking collision analysis
├── stereo.js               Module 16: Inter-channel correlation, Mid/Side, Phase hazard
├── reference.js            Module 17: Source vs Target reference vocal comparative delta
├── decision.js             Module 18: Engineering Decision Engine & 10-Stage Signal Chain
├── report.js               Complete detailed vocal report (text + HTML)
├── engine.js               Master pipeline coordinator
└── ui.js                   UI controller, Canvas plots (Spectrum, Spectrogram, Timeline)
test-vocal.js               Automated test harness for Vocal Engine
test.js                     Automated test harness for Analyzer Engine
test-vox.js                 Automated test harness for VoxLens DSP
test-ui-sim.js              Headless UI interaction test
test-boot-guard.js          Boot guard & stale-cache recovery test
```

---

## 📄 License

MIT — see [LICENSE](LICENSE).
