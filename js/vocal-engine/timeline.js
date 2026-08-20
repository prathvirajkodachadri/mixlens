'use strict';
/**
 * MixLens Vocal Engine 3.0 — Unified timestamped event timeline.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VETimeline = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function pushAll(out, type, items, tKey) {
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      const t = e[tKey] != null ? e[tKey] : (e.start_s != null ? e.start_s : e.start);
      if (t == null) continue;
      out.push({
        type: type,
        time_s: U.round(t, 3),
        end_s: e.end_s != null ? e.end_s : null,
        label: type,
        detail: e,
        seek_s: U.round(Math.max(0, t - 0.04), 3)
      });
    }
  }

  function buildTimeline(ctx, waveform) {
    const events = [];
    pushAll(events, 'sibilance', ctx.sibilance.events, 'start_s');
    pushAll(events, 'plosive', ctx.plosives.events, 'start_s');
    pushAll(events, 'breath', ctx.breaths.events, 'start_s');
    pushAll(events, 'clipping', ctx.clipping.timestamps, 'start_s');
    if (ctx.resonances.candidates[0] && ctx.resonances.candidates[0].confidence >= 70) {
      events.push({
        type: 'resonance',
        time_s: 0,
        end_s: null,
        label: 'resonance',
        detail: { frequency_hz: ctx.resonances.candidates[0].frequency_hz },
        seek_s: 0,
        note: 'Resonance is a spectral feature, not a single time event.'
      });
    }
    pushAll(events, 'loud', ctx.dynamics.loud_sections, 'start_s');
    pushAll(events, 'quiet', ctx.dynamics.quiet_sections, 'start_s');
    events.sort(function (a, b) { return a.time_s - b.time_s; });
    return {
      events: events.slice(0, 600),
      waveform: waveform || []
    };
  }

  return { buildTimeline };
}));
