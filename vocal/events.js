'use strict';
/**
 * MixLens Vocal Analysis Engine — Modules 9, 10, 11, 12: Vocal Events, Sibilance, Plosives & Breaths
 * - Time-localized event segmentation: S, SH, CH, P, B, T, K, Breaths, Clicks, Voiced Vowels, Belts
 * - Event-based sibilance analysis with dominant peak frequency & de-esser parameters
 * - Transient plosive wind blast detector
 * - Breath inhalation detection & level management
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalEvents = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { db20, db10, mean, stdDev, sortedCopy, percentile, median, zeroCrossingRate, FFT, createHannWindow, applyWindow, designBiquad, applyBiquad, fmtFreq, fmtDb } = DSP;

  /**
   * Run comprehensive vocal event extraction across time
   * @param {Float32Array} mono - Audio samples
   * @param {number} sampleRate - Sample rate
   * @param {Object} pitchData - Output from pitch module
   * @param {Object} [options]
   */
  function analyzeVocalEvents(mono, sampleRate, pitchData, options = {}) {
    const N = mono.length;
    const duration = N / sampleRate;

    // Band-pass filters for event isolation
    // 1. High-frequency fricative band (5 kHz to 10 kHz)
    const sibBandFilter = designBiquad('bandpass', sampleRate, 7200, 0, 1.2);
    const sibFiltered = applyBiquad(mono, sibBandFilter);

    // 2. Ultra-low plosive band (20 Hz to 120 Hz)
    const plosiveLpFilter = designBiquad('lowpass', sampleRate, 110, 0, 0.707);
    const plosiveFiltered = applyBiquad(mono, plosiveLpFilter);

    // 3. Mid-frequency vocal body band (250 Hz to 3500 Hz)
    const bodyBpFilter = designBiquad('bandpass', sampleRate, 1200, 0, 0.707);
    const bodyFiltered = applyBiquad(mono, bodyBpFilter);

    // Sliding analysis frames (hop = 10ms, frame = 25ms)
    const frameSize = Math.floor(sampleRate * 0.025);
    const hopSize = Math.floor(sampleRate * 0.010);
    const numFrames = Math.max(1, Math.floor((N - frameSize) / hopSize));

    const events = [];
    const sibEvents = [];
    const plosiveEvents = [];
    const breathEvents = [];
    const clickEvents = [];

    // Frame metrics collection
    const frameTimes = new Float32Array(numFrames);
    const fullRmsDb = new Float32Array(numFrames);
    const sibRmsDb = new Float32Array(numFrames);
    const plosiveRmsDb = new Float32Array(numFrames);
    const bodyRmsDb = new Float32Array(numFrames);
    const zcrVals = new Float32Array(numFrames);

    const frameBuf = new Float32Array(frameSize);

    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;
      frameTimes[f] = (start + frameSize / 2) / sampleRate;

      let sumFull = 0, sumSib = 0, sumPlosive = 0, sumBody = 0;
      for (let i = 0; i < frameSize; i++) {
        const s = mono[start + i];
        frameBuf[i] = s;
        sumFull += s * s;
        const sibS = sibFiltered[start + i];
        sumSib += sibS * sibS;
        const ploS = plosiveFiltered[start + i];
        sumPlosive += ploS * ploS;
        const bodS = bodyFiltered[start + i];
        sumBody += bodS * bodS;
      }

      fullRmsDb[f] = db20(Math.sqrt(sumFull / frameSize));
      sibRmsDb[f] = db20(Math.sqrt(sumSib / frameSize));
      plosiveRmsDb[f] = db20(Math.sqrt(sumPlosive / frameSize));
      bodyRmsDb[f] = db20(Math.sqrt(sumBody / frameSize));
      zcrVals[f] = zeroCrossingRate(frameBuf);
    }

    // Baseline vocal RMS level (50th percentile of audible frames)
    const audibleRms = fullRmsDb.filter(v => v >= -50);
    const medianVocalRms = audibleRms.length ? median(sortedCopy(audibleRms)) : -24;

    // -------------------------------------------------------------
    // 1. SIBILANCE EVENT DETECTION ('S', 'SH', 'CH', 'Z')
    // -------------------------------------------------------------
    let inSib = false;
    let sibStart = 0;
    let sibPeakLevel = -144;
    let sibPeakTime = 0;
    let sibMaxZcr = 0;

    for (let f = 0; f < numFrames; f++) {
      const t = frameTimes[f];
      const isAudible = fullRmsDb[f] >= -45;
      const sibRatio = sibRmsDb[f] - bodyRmsDb[f];
      const isHighFreqFricative = (sibRmsDb[f] >= -36 && sibRatio > -8 && zcrVals[f] > 0.22);

      if (isAudible && isHighFreqFricative) {
        if (!inSib) {
          inSib = true;
          sibStart = t;
          sibPeakLevel = sibRmsDb[f];
          sibPeakTime = t;
          sibMaxZcr = zcrVals[f];
        } else {
          if (sibRmsDb[f] > sibPeakLevel) {
            sibPeakLevel = sibRmsDb[f];
            sibPeakTime = t;
          }
          if (zcrVals[f] > sibMaxZcr) sibMaxZcr = zcrVals[f];
        }
      } else {
        if (inSib) {
          const sibDur = t - sibStart;
          // Valid sibilant duration typically 40ms to 400ms
          if (sibDur >= 0.035 && sibDur <= 0.50) {
            // Measure exact dominant frequency of this specific sibilance hit
            const dominantFreq = measureCenterFrequency(mono, sampleRate, sibPeakTime, 5000, 10000);
            const severity = Math.min(1.0, Math.max(0.1, (sibPeakLevel - (medianVocalRms - 8)) / 14));
            const conf = Math.min(0.96, 0.70 + (sibMaxZcr > 0.35 ? 0.15 : 0.05));

            const sibObj = {
              type: 'sibilance',
              subType: dominantFreq > 7500 ? 'S' : 'SH/CH',
              start: Math.round(sibStart * 100) / 100,
              end: Math.round(t * 100) / 100,
              peakTime: Math.round(sibPeakTime * 100) / 100,
              durationMs: Math.round(sibDur * 1000),
              dominantFreq: Math.round(dominantFreq),
              peakLevelDb: Math.round(sibPeakLevel * 10) / 10,
              severity: Math.round(severity * 100) / 100,
              confidence: Math.round(conf * 100) / 100,
              label: `${dominantFreq > 7500 ? "'S'" : "'SH/CH'"} @ ${fmtFreq(dominantFreq)} (${fmtDb(sibPeakLevel)})`
            };
            sibEvents.push(sibObj);
            events.push(sibObj);
          }
          inSib = false;
        }
      }
    }

    // -------------------------------------------------------------
    // 2. PLOSIVE EVENT DETECTION ('P', 'B', 'T', 'K' bursts)
    // -------------------------------------------------------------
    let inPlosive = false;
    let ploStart = 0;
    let ploPeakLevel = -144;
    let ploPeakTime = 0;

    for (let f = 1; f < numFrames; f++) {
      const t = frameTimes[f];
      // Sudden low-frequency surge (> 8 dB step within 20ms)
      const lpDelta = plosiveRmsDb[f] - plosiveRmsDb[f - 1];
      const isPlosiveSurge = plosiveRmsDb[f] >= -30 && (plosiveRmsDb[f] - bodyRmsDb[f] > 2.0 || lpDelta > 6.0);

      if (isPlosiveSurge) {
        if (!inPlosive) {
          inPlosive = true;
          ploStart = t;
          ploPeakLevel = plosiveRmsDb[f];
          ploPeakTime = t;
        } else {
          if (plosiveRmsDb[f] > ploPeakLevel) {
            ploPeakLevel = plosiveRmsDb[f];
            ploPeakTime = t;
          }
        }
      } else {
        if (inPlosive) {
          const ploDur = t - ploStart;
          if (ploDur >= 0.025 && ploDur <= 0.22) {
            const centerFreq = measureCenterFrequency(mono, sampleRate, ploPeakTime, 25, 120);
            const severity = Math.min(1.0, Math.max(0.2, (ploPeakLevel - (medianVocalRms - 6)) / 12));
            const conf = Math.min(0.95, 0.72 + (ploPeakLevel > -20 ? 0.15 : 0.05));

            const ploObj = {
              type: 'plosive',
              subType: 'P/B Burst',
              start: Math.round(ploStart * 100) / 100,
              end: Math.round(t * 100) / 100,
              peakTime: Math.round(ploPeakTime * 100) / 100,
              durationMs: Math.round(ploDur * 1000),
              dominantFreq: Math.round(centerFreq),
              peakLevelDb: Math.round(ploPeakLevel * 10) / 10,
              severity: Math.round(severity * 100) / 100,
              confidence: Math.round(conf * 100) / 100,
              label: `Plosive pop @ ${fmtFreq(centerFreq)} (${fmtDb(ploPeakLevel)})`
            };
            plosiveEvents.push(ploObj);
            events.push(ploObj);
          }
          inPlosive = false;
        }
      }
    }

    // -------------------------------------------------------------
    // 3. BREATH INHALATION DETECTION
    // -------------------------------------------------------------
    let inBreath = false;
    let breathStart = 0;
    let breathPeakLevel = -144;
    let breathPeakTime = 0;

    for (let f = 0; f < numFrames; f++) {
      const t = frameTimes[f];
      const lvl = fullRmsDb[f];
      const zcr = zcrVals[f];

      // Breath characteristics: gentle turbulent friction between -48 dB and -22 dB, moderate ZCR (0.10 to 0.30), low pitch confidence
      const isBreathLike = (lvl >= -48 && lvl <= -22 && zcr >= 0.08 && zcr <= 0.32 && (bodyRmsDb[f] - plosiveRmsDb[f] > 6));

      if (isBreathLike) {
        if (!inBreath) {
          inBreath = true;
          breathStart = t;
          breathPeakLevel = lvl;
          breathPeakTime = t;
        } else {
          if (lvl > breathPeakLevel) {
            breathPeakLevel = lvl;
            breathPeakTime = t;
          }
        }
      } else {
        if (inBreath) {
          const breathDur = t - breathStart;
          // Breaths typically last 150ms to 750ms
          if (breathDur >= 0.14 && breathDur <= 0.85) {
            const severity = Math.min(1.0, Math.max(0.1, (breathPeakLevel - (medianVocalRms - 14)) / 14));
            const conf = Math.min(0.90, 0.65 + (breathDur > 0.25 ? 0.15 : 0.05));

            const breathObj = {
              type: 'breath',
              start: Math.round(breathStart * 100) / 100,
              end: Math.round(t * 100) / 100,
              peakTime: Math.round(breathPeakTime * 100) / 100,
              durationMs: Math.round(breathDur * 1000),
              dominantFreq: 1800,
              peakLevelDb: Math.round(breathPeakLevel * 10) / 10,
              severity: Math.round(severity * 100) / 100,
              confidence: Math.round(conf * 100) / 100,
              label: `Inhalation breath (${fmtDb(breathPeakLevel)})`
            };
            breathEvents.push(breathObj);
            events.push(breathObj);
          }
          inBreath = false;
        }
      }
    }

    // -------------------------------------------------------------
    // 4. MOUTH NOISE / CLICK DETECTION
    // -------------------------------------------------------------
    for (let f = 1; f < numFrames - 1; f++) {
      const stepUp = fullRmsDb[f] - fullRmsDb[f - 1];
      const stepDown = fullRmsDb[f] - fullRmsDb[f + 1];
      // Isolated ultra-short transient spike
      if (stepUp > 12 && stepDown > 10 && fullRmsDb[f] >= -36) {
        const clickObj = {
          type: 'click',
          start: Math.round(frameTimes[f] * 100) / 100,
          end: Math.round((frameTimes[f] + 0.02) * 100) / 100,
          peakTime: Math.round(frameTimes[f] * 100) / 100,
          durationMs: 15,
          dominantFreq: 3500,
          peakLevelDb: Math.round(fullRmsDb[f] * 10) / 10,
          severity: 0.65,
          confidence: 0.82,
          label: `Mouth click @ ${fmtDb(fullRmsDb[f])}`
        };
        clickEvents.push(clickObj);
        events.push(clickObj);
      }
    }

    // Sort all events chronologically
    events.sort((a, b) => a.start - b.start);

    // -------------------------------------------------------------
    // 5. AGGREGATE SIBILANCE REPORT & DE-ESSING PLAN
    // -------------------------------------------------------------
    let dominantSibFreq = 7200;
    let avgSibLevelDb = -144;
    let peakSibEvent = null;
    let sibSeverityVerdict = 'Low';
    let deEsserAction = 'NONE';
    let deEsserRecommendation = 'Sibilance is well-controlled and natural. No de-essing required.';
    let deEsserSettings = null;

    if (sibEvents.length > 0) {
      const freqList = sibEvents.map(e => e.dominantFreq);
      dominantSibFreq = Math.round(median(sortedCopy(freqList)));
      const sibLevels = sibEvents.map(e => e.peakLevelDb);
      avgSibLevelDb = Math.round(mean(sibLevels) * 10) / 10;
      peakSibEvent = sibEvents.reduce((prev, curr) => curr.peakLevelDb > prev.peakLevelDb ? curr : prev, sibEvents[0]);

      const sibCount = sibEvents.length;
      const totalSibDuration = sibEvents.reduce((acc, e) => acc + e.durationMs, 0) / 1000;
      const sibTrackPercent = duration > 0 ? (totalSibDuration / duration) * 100 : 0;

      const deltaToVocal = avgSibLevelDb - medianVocalRms;

      if (deltaToVocal > 2.0 || sibEvents.some(e => e.severity > 0.85)) {
        sibSeverityVerdict = 'Severe';
        deEsserAction = 'DYNAMIC_CUT';
        deEsserRecommendation = `Severe, piercing sibilance detected (+${deltaToVocal.toFixed(1)} dB above vocal core). Active dynamic de-essing at ${fmtFreq(dominantSibFreq)} required.`;
      } else if (deltaToVocal > -3.0 || sibCount >= 6) {
        sibSeverityVerdict = 'Moderate to High';
        deEsserAction = 'DE_ESS';
        deEsserRecommendation = `Noticeable sibilance concentrated around ${fmtFreq(dominantSibFreq)}. Targeted split-band de-essing recommended.`;
      } else if (deltaToVocal > -8.0) {
        sibSeverityVerdict = 'Mild';
        deEsserAction = 'DE_ESS';
        deEsserRecommendation = `Mild sibilance at ${fmtFreq(dominantSibFreq)}. Gentle de-essing (2–3 dB gain reduction) recommended for polishing.`;
      }

      if (deEsserAction !== 'NONE') {
        deEsserSettings = {
          frequency: dominantSibFreq,
          q: 2.0,
          thresholdDb: Math.round((avgSibLevelDb - 4) * 10) / 10,
          targetReductionDb: deEsserAction === 'DYNAMIC_CUT' ? -5.0 : -3.5,
          mode: 'Split-band dynamic shelf or targeted bell'
        };
      }
    }

    // -------------------------------------------------------------
    // 6. AGGREGATE PLOSIVE REPORT
    // -------------------------------------------------------------
    let plosiveSeverityVerdict = 'Clean';
    let plosiveRecommendation = 'No significant plosive bursts detected.';

    if (plosiveEvents.length >= 4 || plosiveEvents.some(p => p.severity > 0.8)) {
      plosiveSeverityVerdict = 'Severe';
      plosiveRecommendation = `${plosiveEvents.length} heavy plosive bursts detected. Use automated low-cut or clip-gain edits on specific timestamps rather than destructive high-pass across the entire track.`;
    } else if (plosiveEvents.length >= 1) {
      plosiveSeverityVerdict = 'Mild to Moderate';
      plosiveRecommendation = `${plosiveEvents.length} plosive pop(s) detected. Recommend clip-gain automation on affected timestamps.`;
    }

    // -------------------------------------------------------------
    // 7. AGGREGATE BREATH REPORT
    // -------------------------------------------------------------
    let breathRecommendation = 'Breaths are natural in volume and cadence. Leave untouched to preserve human feel.';
    if (breathEvents.length >= 3) {
      const avgBreathDb = mean(breathEvents.map(b => b.peakLevelDb));
      if (avgBreathDb > medianVocalRms - 10) {
        breathRecommendation = `Breaths are relatively loud (${fmtDb(avgBreathDb)} vs ${fmtDb(medianVocalRms)} vocal line). Recommend gentle 4–6 dB clip-gain reduction or fader automation.`;
      }
    }

    return {
      allEvents: events,
      sibilance: {
        eventsCount: sibEvents.length,
        dominantFrequency: dominantSibFreq,
        averageLevelDb: avgSibLevelDb,
        peakEvent: peakSibEvent,
        severity: sibSeverityVerdict,
        action: deEsserAction,
        recommendation: deEsserRecommendation,
        settings: deEsserSettings,
        events: sibEvents
      },
      plosives: {
        eventsCount: plosiveEvents.length,
        severity: plosiveSeverityVerdict,
        recommendation: plosiveRecommendation,
        events: plosiveEvents
      },
      breaths: {
        eventsCount: breathEvents.length,
        recommendation: breathRecommendation,
        events: breathEvents
      },
      clicks: {
        eventsCount: clickEvents.length,
        events: clickEvents
      }
    };
  }

  /**
   * Helper: Measure exact center frequency of an event via FFT snapshot
   */
  function measureCenterFrequency(samples, sampleRate, timeSec, minHz, maxHz) {
    const fftSize = 2048;
    const fft = new FFT(fftSize);
    const hann = createHannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const binWidth = sampleRate / fftSize;

    const centerIdx = Math.round(timeSec * sampleRate);
    const startIdx = Math.max(0, Math.min(samples.length - fftSize, centerIdx - fftSize / 2));

    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[startIdx + i];
      im[i] = 0;
    }
    applyWindow(re, hann, re);
    fft.transform(re, im);
    const power = fft.powerSpectrum(re, im);

    const minBin = Math.max(1, Math.round(minHz / binWidth));
    const maxBin = Math.min(fftSize / 2 - 1, Math.round(maxHz / binWidth));

    let sumWeightedFreq = 0;
    let sumPower = 0;
    for (let b = minBin; b <= maxBin; b++) {
      const p = power[b];
      sumPower += p;
      sumWeightedFreq += p * (b * binWidth);
    }

    if (sumPower > 1e-12) {
      return sumWeightedFreq / sumPower;
    }

    return (minHz + maxHz) / 2;
  }

  return {
    analyzeVocalEvents
  };
}));
