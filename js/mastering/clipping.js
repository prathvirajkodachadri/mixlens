'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Clipping detector.
 * Requires actual full-scale / flat-top evidence. Near-0 dBFS peaks alone are not clipping.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAClipping = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  const HARD = 0.999;
  const FLAT_DELTA = 1.5e-4;

  function analyzeChannel(samples, sampleRate) {
    const N = samples.length;
    let pos = 0, neg = 0;
    let run = 0, maxRun = 0, runPolarity = 0;
    const events = [];
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

    return {
      clipped_positive_samples: pos,
      clipped_negative_samples: neg,
      clipped_samples: pos + neg,
      maximum_consecutive_samples: maxRun,
      events: events
    };
  }

  function analyzeClipping(left, right, sampleRate) {
    const chL = analyzeChannel(left, sampleRate);
    const chR = right ? analyzeChannel(right, sampleRate) : null;
    const totalClipped = chL.clipped_samples + (chR ? chR.clipped_samples : 0);
    const maxRun = Math.max(chL.maximum_consecutive_samples, chR ? chR.maximum_consecutive_samples : 0);
    const events = chL.events.concat(chR ? chR.events : []);
    events.sort(function (a, b) { return a.start - b.start; });
    const N = left.length + (right ? right.length : 0);
    const percent = N ? (totalClipped / N) * 100 : 0;

    let classification = 'NO CLIPPING';
    let status = 'PASS';
    let severity = 'GOOD';
    if (totalClipped > 0 && (maxRun >= 2 || percent > 0.0005)) {
      if (percent >= 0.15 || maxRun >= 12 || events.length >= 40) {
        classification = 'SIGNIFICANT CLIPPING';
        status = 'FAIL';
        severity = percent >= 0.8 || maxRun >= 24 ? 'CRITICAL' : 'HIGH';
      } else {
        classification = 'POSSIBLE CLIPPING';
        status = 'WARNING';
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
      detected: classification !== 'NO CLIPPING',
      classification: classification,
      status: status,
      severity: severity,
      clipped_positive_samples: chL.clipped_positive_samples + (chR ? chR.clipped_positive_samples : 0),
      clipped_negative_samples: chL.clipped_negative_samples + (chR ? chR.clipped_negative_samples : 0),
      clipped_samples: totalClipped,
      clipping_percent: U.round(percent, 5),
      event_count: events.length,
      maximum_consecutive_samples: maxRun,
      first_event_s: events.length ? U.round(events[0].start, 3) : null,
      timestamps: timestamps,
      events: timestamps,
      left: {
        clipped_samples: chL.clipped_samples,
        event_count: chL.events.length,
        maximum_consecutive_samples: chL.maximum_consecutive_samples
      },
      right: chR ? {
        clipped_samples: chR.clipped_samples,
        event_count: chR.events.length,
        maximum_consecutive_samples: chR.maximum_consecutive_samples
      } : null,
      evidence: classification === 'NO CLIPPING'
        ? 'No consecutive full-scale or flat-top samples were measured. Near-full-scale peaks alone are not treated as clipping.'
        : (totalClipped + ' samples met the clipping criterion (' + percent.toFixed(4) + '%), longest run ' + maxRun + ' samples, ' + events.length + ' events.')
    };
  }

  return { analyzeClipping: analyzeClipping };
}));
