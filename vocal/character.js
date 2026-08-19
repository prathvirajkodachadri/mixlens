'use strict';
/**
 * MixLens Vocal Analysis Engine — Modules 13 & 14: Proximity Effect & Vocal Character Profile
 * - Proximity effect detection (close-mic low-end variance across phrases)
 * - 11-dimension 0-100 radar character scoring:
 *   [BODY, WARMTH, CLARITY, PRESENCE, BRIGHTNESS, AIR, NASALITY, HARSHNESS, SIBILANCE, DYNAMICS, NOISE]
 * - Deterministic natural-language classification descriptor
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalCharacter = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { mean, stdDev, sortedCopy, percentile, median } = DSP;

  /**
   * Analyze Proximity Effect and compute 11-dimension vocal profile
   * @param {Object} tonalData - Output from tonal module
   * @param {Object} dynamicsData - Output from dynamics module
   * @param {Object} pitchData - Output from pitch module
   * @param {Object} eventsData - Output from events module
   * @param {Object} healthData - Output from health module
   * @param {Object} dynamicSpectralData - Output from dynamic spectral module
   */
  function analyzeVocalCharacter(tonalData, dynamicsData, pitchData, eventsData, healthData, dynamicSpectralData) {
    const zones = tonalData.zones || [];
    const getZoneDev = (id) => {
      const z = zones.find(item => item.id === id);
      return z ? z.deviationDb : 0;
    };

    // Helper: Map deviation (dB) to 0-100 score with 50 as neutral baseline
    const mapDevToScore = (devDb, scale = 10) => {
      const raw = 50 + (devDb / scale) * 40;
      return Math.max(0, Math.min(100, Math.round(raw)));
    };

    // 1. Proximity Effect Analysis
    const boomDev = getZoneDev('boom');
    const warmthDev = getZoneDev('warmth');
    const rumbleDev = getZoneDev('rumble');
    const phraseStd = dynamicsData.phraseConsistency ? dynamicsData.phraseConsistency.phraseStdDevDb : 1.5;

    let proximityVerdict = 'Consistent mic distance';
    let proximityRecommendation = 'Low frequencies are stable across phrases.';
    let proximitySeverity = 0;

    if (boomDev > 4.5 && phraseStd > 3.0) {
      proximityVerdict = 'Severe close-mic proximity boom';
      proximitySeverity = 0.85;
      proximityRecommendation = 'Pronounced proximity effect creates inconsistent bass as singer moves relative to mic. Recommend dynamic low-shelf cut (~100 Hz, -3 dB) or phrase gain automation.';
    } else if (boomDev > 2.5) {
      proximityVerdict = 'Moderate proximity warmth';
      proximitySeverity = 0.50;
      proximityRecommendation = 'Noticeable proximity bass buildup. A gentle low-shelf attenuation around 120 Hz will clean up the foundation.';
    }

    // 2. Compute 11-Dimension Character Scores (0–100)
    // 1. BODY (200-500 Hz foundation)
    const bodyScore = mapDevToScore(getZoneDev('body'), 8);

    // 2. WARMTH (140-250 Hz fullness & even harmonics)
    const oddEvenBonus = pitchData.harmonics ? (pitchData.harmonics.oddEvenRatio < 0.9 ? 10 : -5) : 0;
    const warmthScore = Math.max(0, Math.min(100, mapDevToScore(warmthDev, 8) + oddEvenBonus));

    // 3. CLARITY (2.0-3.5 kHz intelligibility)
    const clarityDev = getZoneDev('clarity');
    const clarityScore = mapDevToScore(clarityDev, 8);

    // 4. PRESENCE (3.5-5.5 kHz forward edge)
    const presenceDev = getZoneDev('presence');
    const presenceScore = mapDevToScore(presenceDev, 8);

    // 5. BRIGHTNESS (8-12 kHz top end)
    const brightDev = getZoneDev('brightness');
    const brightnessScore = mapDevToScore(brightDev, 10);

    // 6. AIR (12-20 kHz high sheen)
    const airDev = getZoneDev('air');
    const airScore = mapDevToScore(airDev, 12);

    // 7. NASALITY (800-1500 Hz pinch)
    const nasalDev = getZoneDev('nasal');
    const nasalityScore = Math.max(0, Math.min(100, Math.round(Math.max(0, (nasalDev + 3) * 12))));

    // 8. HARSHNESS (2.8-4.5 kHz dynamic spike)
    const harshDev = getZoneDev('harshness');
    const dynamicHarshIssue = dynamicSpectralData.dynamicIssues ? dynamicSpectralData.dynamicIssues.find(d => d.zoneId === 'harshness') : null;
    const dynamicHarshDelta = dynamicHarshIssue ? dynamicHarshIssue.excessDynamicDelta : 0;
    const harshnessScore = Math.max(0, Math.min(100, Math.round(Math.max(0, (harshDev + 2) * 8 + Math.max(0, dynamicHarshDelta) * 10))));

    // 9. SIBILANCE (5-9 kHz event energy)
    const sibCount = eventsData.sibilance ? eventsData.sibilance.eventsCount : 0;
    const sibAvg = eventsData.sibilance ? eventsData.sibilance.averageLevelDb : -144;
    const vocalRms = dynamicsData.rmsDb || -24;
    const sibDelta = sibAvg - vocalRms;
    const sibilanceScore = Math.max(0, Math.min(100, Math.round(40 + sibDelta * 6 + Math.min(30, sibCount * 4))));

    // 10. DYNAMICS (Crest factor & LRA)
    const lra = dynamicsData.loudness ? dynamicsData.loudness.lra : 6;
    const crest = dynamicsData.crestDb || 12;
    const dynamicsScore = Math.max(0, Math.min(100, Math.round((lra / 14) * 50 + (crest / 18) * 50)));

    // 11. NOISE (Noise floor & hum)
    const noiseFloor = healthData.noiseFloor ? healthData.noiseFloor.floorDb : -70;
    const noiseScore = Math.max(0, Math.min(100, Math.round(Math.max(0, (noiseFloor + 80) * 2.2))));

    const scores = {
      body: bodyScore,
      warmth: warmthScore,
      clarity: clarityScore,
      presence: presenceScore,
      brightness: brightnessScore,
      air: airScore,
      nasality: nasalityScore,
      harshness: harshnessScore,
      sibilance: sibilanceScore,
      dynamics: dynamicsScore,
      noise: noiseScore
    };

    // 3. Build Deterministic Tonal Classification Persona
    const descriptors = [];

    // Tone foundation
    if (warmthScore >= 68 && bodyScore >= 65) descriptors.push('Warm and full-bodied');
    else if (warmthScore <= 35 && bodyScore <= 35) descriptors.push('Thin and lightweight');
    else if (warmthScore >= 65) descriptors.push('Warm');
    else if (bodyScore >= 65) descriptors.push('Solid and grounded');

    // Upper-mid presentation
    if (clarityScore >= 70 && presenceScore >= 70) descriptors.push('forward and articulated');
    else if (clarityScore >= 65) descriptors.push('clear and intelligible');
    else if (presenceScore <= 35 && clarityScore <= 38) descriptors.push('dark and recessed');

    // Highs / Air
    if (brightnessScore >= 70 && airScore >= 65) descriptors.push('with airy modern sheen');
    else if (brightnessScore >= 65) descriptors.push('with bright top-end');
    else if (airScore <= 35) descriptors.push('with intimate, vintage roll-off');

    // Problems / Nuances
    const caveats = [];
    if (harshnessScore >= 65) caveats.push('intermittent upper-mid harshness on peaks');
    if (sibilanceScore >= 70) caveats.push('hot sibilance in the 6–8 kHz zone');
    if (nasalityScore >= 60) caveats.push('prominent 1 kHz nasal resonance');
    if (proximitySeverity > 0.6) caveats.push('variable close-mic proximity boom');

    let classification = descriptors.length ? descriptors.join(', ') : 'Neutral, balanced vocal';
    // Capitalize first letter
    classification = classification.charAt(0).toUpperCase() + classification.slice(1);
    if (caveats.length) {
      classification += ' (note: ' + caveats.join(' and ') + ')';
    }

    return {
      proximity: {
        verdict: proximityVerdict,
        severity: proximitySeverity,
        recommendation: proximityRecommendation
      },
      scores,
      classification
    };
  }

  return {
    analyzeVocalCharacter
  };
}));
