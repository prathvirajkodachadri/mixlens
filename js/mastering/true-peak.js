'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Estimated true peak (inter-sample).
 *
 * 4× polyphase FIR interpolation in the style of ITU-R BS.1770 Annex 2.
 * Results are labelled ESTIMATED TRUE PEAK. This is not a hardware meter.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MATruePeak = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  const TP_COEFFS_4X = [
    [0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [-0.0031, 0.0135, -0.0381, 0.0934, -0.2312, 0.8997, 0.3541, -0.1194, 0.0522, -0.0219, 0.0084, -0.0027],
    [-0.0062, 0.0252, -0.0684, 0.1611, -0.3789, 0.6385, 0.6385, -0.3789, 0.1611, -0.0684, 0.0252, -0.0062],
    [-0.0027, 0.0084, -0.0219, 0.0522, -0.1194, 0.3541, 0.8997, -0.2312, 0.0934, -0.0381, 0.0135, -0.0031]
  ];

  function measureChannel(samples, sampleRate, options) {
    const opt = options || {};
    const eventThrLin = opt.eventThresholdLin == null ? U.dbToLinear(-1.0) : opt.eventThresholdLin;
    const maxEvents = opt.maxEvents || 80;
    const N = samples.length;
    const TAPS = 12;
    const HALF = 6;
    let maxPeak = 0;
    let maxIndex = 0;
    let samplePeak = 0;
    let samplePeakIndex = 0;
    let eventCount = 0;
    const events = [];
    let inEvent = false;
    let eventStart = 0;
    let eventMax = 0;

    for (let i = 0; i < N; i++) {
      const a = Math.abs(samples[i]);
      if (a > samplePeak) { samplePeak = a; samplePeakIndex = i; }
      if (a > maxPeak) { maxPeak = a; maxIndex = i; }
    }

    for (let i = HALF; i < N - HALF; i++) {
      if (Math.abs(samples[i]) < 0.20) {
        if (inEvent) {
          if (events.length < maxEvents) {
            events.push({
              start_s: U.round(eventStart / sampleRate, 4),
              end_s: U.round(i / sampleRate, 4),
              peak_dbtp: U.round(U.db20(eventMax), 2)
            });
          }
          inEvent = false;
        }
        continue;
      }
      let localMax = Math.abs(samples[i]);
      for (let p = 1; p < 4; p++) {
        const c = TP_COEFFS_4X[p];
        let acc = 0;
        for (let k = 0; k < TAPS; k++) acc += samples[i - HALF + k] * c[k];
        const a = Math.abs(acc);
        if (a > localMax) localMax = a;
      }
      if (localMax > maxPeak) { maxPeak = localMax; maxIndex = i; }
      if (localMax >= eventThrLin) {
        eventCount++;
        if (!inEvent) {
          inEvent = true;
          eventStart = i;
          eventMax = localMax;
        } else if (localMax > eventMax) {
          eventMax = localMax;
        }
      } else if (inEvent) {
        if (events.length < maxEvents) {
          events.push({
            start_s: U.round(eventStart / sampleRate, 4),
            end_s: U.round(i / sampleRate, 4),
            peak_dbtp: U.round(U.db20(eventMax), 2)
          });
        }
        inEvent = false;
      }
    }
    if (inEvent && events.length < maxEvents) {
      events.push({
        start_s: U.round(eventStart / sampleRate, 4),
        end_s: U.round((N - HALF) / sampleRate, 4),
        peak_dbtp: U.round(U.db20(eventMax), 2)
      });
    }

    return {
      true_peak_lin: maxPeak,
      true_peak_dbtp: U.round(U.db20(maxPeak), 2),
      true_peak_time_s: U.round(maxIndex / sampleRate, 4),
      sample_peak_lin: samplePeak,
      sample_peak_dbfs: U.round(U.db20(samplePeak), 2),
      sample_peak_time_s: U.round(samplePeakIndex / sampleRate, 4),
      event_count: eventCount,
      events: events
    };
  }

  function buildTimeline(left, right, sampleRate, hopSec) {
    const hop = Math.max(64, Math.round(sampleRate * (hopSec || 0.05)));
    const N = left.length;
    const timeline = [];
    const maxPts = 1600;
    const total = Math.max(1, Math.floor(N / hop));
    const step = total > maxPts ? Math.ceil(total / maxPts) : 1;
    for (let b = 0; b < total; b += step) {
      const start = b * hop;
      const end = Math.min(N, start + hop * step);
      let p = 0;
      for (let i = start; i < end; i++) {
        const aL = Math.abs(left[i]);
        if (aL > p) p = aL;
        if (right) {
          const aR = Math.abs(right[i]);
          if (aR > p) p = aR;
        }
      }
      timeline.push({
        time_s: U.round(start / sampleRate, 3),
        sample_peak_dbfs: U.round(U.db20(p), 2)
      });
    }
    return timeline;
  }

  function analyzeTruePeak(left, right, sampleRate) {
    if (!left || !left.length) {
      return {
        available: false,
        estimated: true,
        note: 'True-peak estimation unavailable for this source.',
        value_dbtp: null
      };
    }
    const chL = measureChannel(left, sampleRate);
    const chR = right ? measureChannel(right, sampleRate) : null;
    const maxLin = chR ? Math.max(chL.true_peak_lin, chR.true_peak_lin) : chL.true_peak_lin;
    const sampleMax = chR ? Math.max(chL.sample_peak_lin, chR.sample_peak_lin) : chL.sample_peak_lin;
    const tpDb = U.db20(maxLin);
    const spDb = U.db20(sampleMax);
    const diff = tpDb - spDb;
    let ispStatus = 'PASS';
    let ispNote = 'Estimated true peak is close to the sample peak.';
    if (diff >= 1.5) {
      ispStatus = 'WARNING';
      ispNote = 'Possible inter-sample peak risk. Estimated true peak is substantially above the sample peak.';
    } else if (diff >= 0.5) {
      ispStatus = 'WARNING';
      ispNote = 'Possible inter-sample peak risk.';
    }

    const events = (chL.events || []).concat(chR ? chR.events : []);
    events.sort(function (a, b) { return a.start_s - b.start_s; });

    const winner = (!chR || chL.true_peak_lin >= chR.true_peak_lin) ? chL : chR;

    return {
      available: true,
      estimated: true,
      label: 'Estimated True Peak',
      method: '4× polyphase FIR interpolation (ITU-R BS.1770-style). Approximation.',
      value_dbtp: U.round(tpDb, 2),
      value_lin: maxLin,
      timestamp_s: winner.true_peak_time_s,
      event_count: (chL.event_count || 0) + (chR ? chR.event_count : 0),
      events: events.slice(0, 80),
      left: {
        true_peak_dbtp: chL.true_peak_dbtp,
        sample_peak_dbfs: chL.sample_peak_dbfs,
        timestamp_s: chL.true_peak_time_s
      },
      right: chR ? {
        true_peak_dbtp: chR.true_peak_dbtp,
        sample_peak_dbfs: chR.sample_peak_dbfs,
        timestamp_s: chR.true_peak_time_s
      } : null,
      sample_peak_dbfs: U.round(spDb, 2),
      inter_sample_difference_db: U.round(diff, 2),
      inter_sample_peak_risk: {
        status: ispStatus,
        difference_db: U.round(diff, 2),
        note: ispNote
      },
      timeline: buildTimeline(left, right, sampleRate, 0.05)
    };
  }

  return { analyzeTruePeak: analyzeTruePeak, measureChannel: measureChannel };
}));
