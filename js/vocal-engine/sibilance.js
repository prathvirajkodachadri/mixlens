'use strict';
/**
 * MixLens Vocal Engine 3.0 — Sibilance / high-frequency consonant detector (≈4–12 kHz).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'), require('./fft'));
  } else {
    root.VESibilance = factory(root.VEUtilities, root.VEFft);
  }
}(typeof self !== 'undefined' ? self : this, function (U, FftMod) {

  function centerFreq(samples, sampleRate, timeSec, lo, hi) {
    const fftSize = 2048;
    if (samples.length < fftSize) return (lo + hi) / 2;
    const fft = new FftMod.FFT(fftSize);
    const hann = U.hannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const mid = Math.round(timeSec * sampleRate);
    const start = Math.max(0, Math.min(samples.length - fftSize, mid - (fftSize >> 1)));
    for (let i = 0; i < fftSize; i++) { re[i] = samples[start + i]; im[i] = 0; }
    U.applyWindow(re, hann, re);
    fft.transform(re, im);
    const power = fft.powerSpectrum(re, im);
    const bw = sampleRate / fftSize;
    const a = Math.max(1, Math.round(lo / bw));
    const b = Math.min(power.length - 1, Math.round(hi / bw));
    let num = 0, den = 0;
    for (let k = a; k <= b; k++) {
      den += power[k];
      num += power[k] * k * bw;
    }
    return den > 0 ? num / den : (lo + hi) / 2;
  }

  function analyzeSibilance(mono, sampleRate) {
    const sib = U.applyBiquad(mono, U.designBiquad('bandpass', sampleRate, 7200, 0, 1.05));
    const body = U.applyBiquad(mono, U.designBiquad('bandpass', sampleRate, 1200, 0, 0.7));
    const frame = Math.max(32, Math.round(sampleRate * 0.02));
    const hop = Math.max(16, Math.round(sampleRate * 0.01));
    const nF = Math.max(1, Math.floor((mono.length - frame) / hop));
    const sibDb = new Float32Array(nF);
    const bodyDb = new Float32Array(nF);
    const fullDb = new Float32Array(nF);
    const zcr = new Float32Array(nF);
    const buf = new Float32Array(frame);

    for (let f = 0; f < nF; f++) {
      const s = f * hop;
      let eS = 0, eB = 0, eF = 0;
      for (let i = 0; i < frame; i++) {
        const x = mono[s + i];
        buf[i] = x;
        eF += x * x;
        eS += sib[s + i] * sib[s + i];
        eB += body[s + i] * body[s + i];
      }
      fullDb[f] = U.db20(Math.sqrt(eF / frame));
      sibDb[f] = U.db20(Math.sqrt(eS / frame));
      bodyDb[f] = U.db20(Math.sqrt(eB / frame));
      zcr[f] = U.zeroCrossingRate(buf);
    }

    const audible = [];
    for (let i = 0; i < nF; i++) if (fullDb[i] > -50) audible.push(fullDb[i]);
    const medVocal = audible.length ? U.median(U.sortedCopy(audible)) : -24;

    const events = [];
    let on = false, startF = 0, peak = -144, peakF = 0, maxZ = 0, peakExcess = 0;

    for (let f = 0; f < nF; f++) {
      const excess = sibDb[f] - bodyDb[f];
      const hit = fullDb[f] >= -45 && sibDb[f] >= -38 && excess > -6 && zcr[f] > 0.20;
      if (hit) {
        if (!on) { on = true; startF = f; peak = sibDb[f]; peakF = f; maxZ = zcr[f]; peakExcess = excess; }
        else {
          if (sibDb[f] > peak) { peak = sibDb[f]; peakF = f; }
          if (zcr[f] > maxZ) maxZ = zcr[f];
          if (excess > peakExcess) peakExcess = excess;
        }
      } else if (on) {
        const dur = (f - startF) * hop / sampleRate;
        if (dur >= 0.03 && dur <= 0.45) {
          const t0 = startF * hop / sampleRate;
          const t1 = f * hop / sampleRate;
          const pt = (peakF * hop + frame / 2) / sampleRate;
          const dom = centerFreq(mono, sampleRate, pt, 4000, 12000);
          const sevNum = U.clamp((peak - (medVocal - 8)) / 14, 0.05, 1);
          let sev = 'LOW';
          if (sevNum >= 0.85) sev = 'HIGH';
          else if (sevNum >= 0.55) sev = 'MODERATE';
          events.push({
            start_s: U.round(t0, 3),
            end_s: U.round(t1, 3),
            peak_s: U.round(pt, 3),
            duration_ms: Math.round(dur * 1000),
            dominant_frequency_hz: Math.round(dom),
            energy_db: U.round(peak, 2),
            excess_db: U.round(peakExcess, 2),
            severity: sev,
            confidence: U.round(U.clamp(0.62 + (maxZ > 0.32 ? 0.18 : 0.06) + (dur > 0.05 ? 0.08 : 0), 0, 0.96) * 100, 1),
            type: dom >= 7500 ? 'S/Z-like' : 'SH/CH-like'
          });
        }
        on = false;
      }
    }

    let dominant = null, avgExcess = 0, maxExcess = 0, severity = 'GOOD';
    if (events.length) {
      const freqs = events.map(function (e) { return e.dominant_frequency_hz; });
      dominant = Math.round(U.median(U.sortedCopy(freqs)));
      avgExcess = U.mean(events.map(function (e) { return e.excess_db; }));
      maxExcess = Math.max.apply(null, events.map(function (e) { return e.excess_db; }));
      const high = events.filter(function (e) { return e.severity === 'HIGH'; }).length;
      if (high >= 8 || maxExcess >= 9 || events.length >= 80) severity = 'HIGH';
      else if (high >= 2 || maxExcess >= 5 || events.length >= 20) severity = 'MODERATE';
      else severity = 'LOW';
    }

    return {
      event_count: events.length,
      dominant_frequency_hz: dominant,
      average_excess_db: events.length ? U.round(avgExcess, 2) : null,
      maximum_excess_db: events.length ? U.round(maxExcess, 2) : null,
      severity: severity,
      events: events.slice(0, 400),
      evidence: events.length
        ? (events.length + ' high-frequency consonant bursts measured; dominant ' + U.fmtFreq(dominant) + '; max excess ' + maxExcess.toFixed(1) + ' dB vs vocal body band.')
        : 'No 4–12 kHz consonant bursts met the duration, ZCR, and excess criteria.'
    };
  }

  return { analyzeSibilance };
}));
