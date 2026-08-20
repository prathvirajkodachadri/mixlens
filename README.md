# MixLens — Vocal Engine 3.0 (+ Mix Analyzer & VoxLens)

A browser-based studio measurement suite. **100% local DSP. Your audio stays on your device.**

1. **🎙 MixLens Vocal Engine 3.0 (`index.html`)** — Professional vocal *analysis* and report generator. Measurement, detection, evidence, and engineering observation. Not an automatic mixer.
2. **📊 MixLens Audio Analyzer (`analyzer.html`)** — EBU R128 loudness and spectral analyzer for mixing / narration.
3. **🎛 VoxLens Vocal Chain (`vox.html`)** — Real-time vocal chain (separate processing app).

![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen) ![Runs anywhere](https://img.shields.io/badge/platform-any%20browser-blue) ![100% Offline](https://img.shields.io/badge/privacy-100%25%20local-success)

---

## Vocal Engine 3.0

**MIXLENS · Vocal Engine 3.0 · Professional Vocal Analysis & Report Generator**  
Subtitle: *Evidence-Based Local DSP Analysis* · Status: **LOCAL DSP ENGINE**

Workflow: upload → decode → preprocess → analyze → detect characteristics & technical problems → severity + confidence → professional report → export JSON / TXT / PDF.

This is **not** automatic EQ, compression, de-essing, mastering, or VST-preset generation. It does **not** require OpenAI, Gemini, Claude, or any AI API.

Every finding is structured as:

1. **Measurement** — what was objectively measured  
2. **Detection** — what the algorithm flags  
3. **Evidence** — the supporting numbers  
4. **Interpretation** — what it *might* indicate  
5. **Engineering observation** — what an engineer should investigate  

If a value cannot be measured: **Not available**, **Estimated**, **Low Confidence**, or **Insufficient Signal**. Numbers are never invented.

### Architecture

```
js/vocal-engine/
  utilities.js          db/linear, stats, windows, K-weighting, true peak
  fft.js                radix-2 FFT
  stft.js               Hann STFT + spectrogram
  audio-loader.js       local decode + WAV bit-depth metadata
  preprocessing.js      mono mix, silence, validation
  clipping.js           full-scale / flat-top clipping (not “near 0 dBFS”)
  loudness.js           EBU R128 momentary / short-term / integrated / LRA
  dynamics.js           RMS variation, quiet/loud sections
  spectrum.js           average / median / p10 / p90, descriptors
  tonal-balance.js      16-zone energy + baseline deviation
  resonance.js          prominence, Q, persistence vs harmonics
  sibilance.js          4–12 kHz consonant bursts
  plosive.js            short LF air blasts (not sustained bass)
  breath.js             unvoiced inhalation intervals
  noise.js              floor from quiet/unvoiced frames only
  hum.js                50/60 Hz families — measured, never assumed
  pitch.js              YIN F0 contour
  vibrato.js            rate / depth on sustained voiced material
  stereo.js             correlation, M/S, mono compatibility
  masking.js            optional instrumental + reference compare
  scoring.js            explainable health & mix-readiness
  interpretation.js     observation engine
  timeline.js           timestamped events
  report-generator.js   TXT + HTML
  json-export.js        schema 3.0 payload
  pdf-export.js         local PDF writer
  analyzer.js           pipeline coordinator
  worker.js             off-thread FFT / YIN / events
  ui.js                 laboratory UI
```

Heavy STFT / YIN work runs in a **Web Worker** when the browser allows it, with a main-thread fallback.

### Exports

- **JSON** — full measurements (`schema_version` 3.0, `engine_version` 3.0.0, `analysis_version` 2026.08)
- **TXT** — professional readable report
- **PDF** — title, file info, scores, tables, findings, observations
- **Copy report**

---

## Mix Analyzer & VoxLens

Unchanged standalone pages. See previous documentation in this repository for EBU R128 analyzer details and the VoxLens chain.

---

## Running MixLens

Open `index.html` in a modern browser, or:

```bash
python3 -m http.server 8080
# http://localhost:8080
```

A local server is recommended so the analysis Web Worker can load.

---

## Tests

```bash
node test-vocal.js      # Vocal Engine 3.0 DSP + 12 signal classes
node test.js            # Mix Analyzer engine
node test-vox.js        # VoxLens DSP
node test-ui-sim.js     # Vocal Engine 3.0 UI simulation
node test-boot-guard.js # Missing-module recovery banner
node verify_kweight.js  # K-weighting check
```

---

## License

MIT — see [LICENSE](LICENSE).
