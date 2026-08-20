'use strict';
/**
 * MixLens Vocal Engine 3.0 — YIN F0 estimator (De Cheveigné & Kawahara 2002).
 * Natural pitch movement is not treated as an error.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEPitch = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  class YinPitchDetector {
    constructor(sampleRate, bufferSize, threshold) {
      this.sampleRate = sampleRate;
      this.bufferSize = bufferSize || 2048;
      this.threshold = threshold == null ? 0.15 : threshold;
      this.yinBuffer = new Float32Array(this.bufferSize >> 1);
    }

    detect(frame) {
      const half = this.bufferSize >> 1;
      const yin = this.yinBuffer;
      const len = Math.min(frame.length, this.bufferSize);

      for (let tau = 0; tau < half; tau++) {
        let s = 0;
        for (let i = 0; i < half; i++) {
          if (i + tau < len) {
            const d = frame[i] - frame[i + tau];
            s += d * d;
          }
        }
        yin[tau] = s;
      }
      yin[0] = 1;
      let run = 0;
      for (let tau = 1; tau < half; tau++) {
        run += yin[tau];
        yin[tau] = (yin[tau] * tau) / Math.max(U.EPSILON, run);
      }

      let tauEst = -1;
      for (let tau = 2; tau < half; tau++) {
        if (yin[tau] < this.threshold) {
          while (tau + 1 < half && yin[tau + 1] < yin[tau]) tau++;
          tauEst = tau;
          break;
        }
      }
      if (tauEst === -1) {
        let minV = 1e9;
        for (let tau = 2; tau < half; tau++) {
          if (yin[tau] < minV) { minV = yin[tau]; tauEst = tau; }
        }
      }

      let better = tauEst;
      if (tauEst > 0 && tauEst < half - 1) {
        const s0 = yin[tauEst - 1], s1 = yin[tauEst], s2 = yin[tauEst + 1];
        const den = 2 * (2 * s1 - s0 - s2);
        if (Math.abs(den) > 1e-6) better = tauEst + (s2 - s0) / den;
      }

      const diff = (tauEst >= 0 && tauEst < half) ? yin[tauEst] : 1;
      const confidence = U.clamp(1 - diff, 0, 1);
      const f0 = better > 0 ? this.sampleRate / better : 0;
      const valid = f0 >= 55 && f0 <= 1200;
      return { f0: valid ? f0 : 0, confidence: confidence, voiced: valid && confidence >= 0.65, tau: better };
    }
  }

  function analyzePitch(samples, sampleRate, options) {
    const opt = options || {};
    const frameSize = opt.frameSize || 2048;
    const hopSize = opt.hopSize || (samples.length / sampleRate > 180 ? 1024 : 512);
    const yin = new YinPitchDetector(sampleRate, frameSize, 0.15);
    const nF = Math.max(1, Math.floor((samples.length - frameSize) / hopSize));
    const track = [];
    const voicedF0 = [];
    const confs = [];
    const buf = new Float32Array(frameSize);
    let voiced = 0, unvoiced = 0;

    for (let f = 0; f < nF; f++) {
      const off = f * hopSize;
      if (off + frameSize > samples.length) break;
      for (let i = 0; i < frameSize; i++) buf[i] = samples[off + i];
      const r = U.rms(buf);
      const rmsDb = U.db20(r);
      const t = (off + frameSize / 2) / sampleRate;
      if (rmsDb < -55) {
        track.push({ time: t, f0: 0, confidence: 0, voiced: false, rmsDb: rmsDb });
        unvoiced++;
        continue;
      }
      const res = yin.detect(buf);
      const isVoiced = res.voiced && rmsDb >= -48 && res.confidence >= 0.65;
      track.push({ time: t, f0: isVoiced ? res.f0 : 0, confidence: res.confidence, voiced: isVoiced, rmsDb: rmsDb });
      if (isVoiced) { voiced++; voicedF0.push(res.f0); confs.push(res.confidence); }
      else unvoiced++;
    }

    const total = voiced + unvoiced;
    if (!voicedF0.length) {
      return {
        available: false,
        min_f0_hz: null, max_f0_hz: null, median_f0_hz: null, mean_f0_hz: null,
        f0_std_hz: null, voiced_ratio: total ? voiced / total : 0, unvoiced_ratio: total ? unvoiced / total : 1,
        pitch_range_hz: null, pitch_stability: null, primary_note: '—',
        contour: track, evidence: 'Pitch analysis could not be completed because insufficient reliable voiced material was detected.'
      };
    }

    const sorted = U.sortedCopy(voicedF0);
    const med = U.median(sorted);
    const mn = U.percentile(sorted, 0.05);
    const mx = U.percentile(sorted, 0.95);
    const mu = U.mean(voicedF0);
    const sd = U.stdDev(voicedF0, mu);
    const note = U.freqToNote(med);
    const stability = U.clamp(1 - (sd / Math.max(20, med)) * 2, 0, 1);

    const contour = [];
    const step = Math.max(1, Math.floor(track.length / 1200));
    for (let i = 0; i < track.length; i += step) {
      const p = track[i];
      const n = p.f0 ? U.freqToNote(p.f0) : { note: '—', cents: 0 };
      contour.push({
        time_s: U.round(p.time, 3),
        frequency_hz: p.voiced ? U.round(p.f0, 2) : null,
        note: n.note,
        cents: n.cents,
        voiced: p.voiced,
        confidence: U.round(p.confidence, 3)
      });
    }

    return {
      available: true,
      min_f0_hz: U.round(mn, 2),
      max_f0_hz: U.round(mx, 2),
      median_f0_hz: U.round(med, 2),
      mean_f0_hz: U.round(mu, 2),
      f0_std_hz: U.round(sd, 2),
      voiced_ratio: U.round(voiced / total, 3),
      unvoiced_ratio: U.round(unvoiced / total, 3),
      pitch_range_hz: [U.round(mn, 2), U.round(mx, 2)],
      pitch_stability: U.round(stability, 3),
      primary_note: note.note,
      primary_cents: note.cents,
      observed_profile: {
        median_f0_hz: U.round(med, 2),
        observed_range_hz: [U.round(mn, 1), U.round(mx, 1)],
        primary_pitch_center: note.note,
        note: 'Observed Pitch Profile — not a medical or biological voice-type claim.'
      },
      contour: contour,
      _track: track,
      evidence: 'YIN F0 on ' + voiced + ' voiced frames. Median ' + med.toFixed(1) + ' Hz (' + note.note + '), 5–95% range ' + mn.toFixed(0) + '–' + mx.toFixed(0) + ' Hz.'
    };
  }

  return { analyzePitch, YinPitchDetector };
}));
