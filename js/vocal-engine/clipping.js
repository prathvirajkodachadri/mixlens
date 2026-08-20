'use strict';
/**
 * MixLens Vocal Engine 3.0 — Clipping detector.
 * Requires actual full-scale / flat-top evidence. Near-0 dBFS peaks alone are not clipping.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEClipping = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  const HARD = 0.999;
  const FLAT_DELTA = 1.5e-4;

  function analyzeClipping(samples, sampleRate) {
    const N = samples.length;
    let pos = 0, neg = 0;
    let run = 0, maxRun = 0, runPolarity = 0;
    let events = [];
    let eventStart = -1;
    let eventPeak = 0;

    for (let i = 0; i < N; i++) {
      const s = samples[i];
      const abs = Math.abs(s);
      const hard = abs >= HARD;
      const flat = i > 0 && abs >= 0.985 && Math.abs(abs - Math.abs(samples[i - 1])) < FLAT_DELTA;
      const clipped = hard || (flat && abs >= 0.995);

      if (clipped) {
        if (s >= 0) pos++; else neg++;
        const pol = s >= 0 ? 1 : -1;
        if (run === 0) {
          run = 1;
          runPolarity = pol;
          eventStart = i;
          eventPeak = abs;
        } else {
          run++;
          if (abs > eventPeak) eventPeak = abs;
        }
        if (run > maxRun) maxRun = run;
      } else if (run > 0) {
        if (run >= 2 || eventPeak >= HARD) {
          events.push({
            start: eventStart / sampleRate,
            end: i / sampleRate,
            samples: run,
            polarity: runPolarity > 0 ? 'positive' : 'negative',
            peak: eventPeak
          });
        }
        run = 0;
      }
    }
    if (run > 0 && (run >= 2 || eventPeak >= HARD)) {
      events.push({
        start: eventStart / sampleRate,
        end: N / sampleRate,
        samples: run,
        polarity: runPolarity > 0 ? 'positive' : 'negative',
        peak: eventPeak
      });
    }

    const totalClipped = pos + neg;
    const percent = N ? (totalClipped / N) * 100 : 0;

    let classification = 'NO CLIPPING';
    let severity = 'GOOD';
    if (totalClipped > 0 && (maxRun >= 2 || percent > 0.0005)) {
      if (percent >= 0.15 || maxRun >= 12 || events.length >= 40) {
        classification = 'SIGNIFICANT CLIPPING';
        severity = percent >= 0.8 || maxRun >= 24 ? 'CRITICAL' : 'HIGH';
      } else {
        classification = 'POSSIBLE CLIPPING';
        severity = events.length >= 8 || maxRun >= 4 ? 'MODERATE' : 'LOW';
      }
    }

    const timestamps = events.slice(0, 80).map(function (e) {
      return {
        start_s: U.round(e.start, 3),
        end_s: U.round(e.end, 3),
        consecutive_samples: e.samples,
        polarity: e.polarity
      };
    });

    return {
      clipped_positive_samples: pos,
      clipped_negative_samples: neg,
      clipped_samples: totalClipped,
      clipping_percent: U.round(percent, 5),
      clipping_events: events.length,
      maximum_consecutive_samples: maxRun,
      classification,
      severity,
      timestamps,
      evidence: classification === 'NO CLIPPING'
        ? 'No consecutive full-scale or flat-top samples were measured.'
        : (totalClipped + ' samples met the clipping criterion (' + percent.toFixed(4) + '%), longest run ' + maxRun + ' samples, ' + events.length + ' events.')
    };
  }

  return { analyzeClipping };
}));
