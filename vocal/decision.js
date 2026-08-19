'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 18: Engineering Decision Engine
 * Principle: MEASURE → INTERPRET → CLASSIFY → DECIDE → RECOMMEND
 * - Rule-based decision layer with strict evidence & confidence gating
 * - Priority ranking: P0 (Recording), P1 (Major Corrective), P2 (Tonal), P3 (Fine Tuning), P4 (Enhancement)
 * - Synthesizes 3–8 targeted EQ filter bands with static vs dynamic discrimination
 * - Generates complete 10-stage processing chain recommendations
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp', './tonal'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'), require('./tonal'));
  } else {
    root.VocalDecision = factory(root.VocalDSP, root.VocalTonal);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP, Tonal) {

  const { fmtFreq, fmtDb } = DSP;

  /**
   * Run Engineering Decision Engine
   * @param {Object} modulesData - Full aggregated analysis data from all modules
   */
  function runDecisionEngine(modulesData) {
    const {
      health,
      spectrum,
      pitch,
      formants,
      tonal,
      resonances,
      dynamicSpectral,
      dynamics,
      events,
      character,
      stereo,
      mixMasking
    } = modulesData;

    const recommendations = [];
    const eqBands = [];

    // =========================================================================
    // 1. PRIORITY P0: RECORDING HEALTH & SOURCE DEFECTS
    // =========================================================================

    // A. Digital Clipping
    if (health.clipping && health.clipping.severity !== 'clean') {
      const clip = health.clipping;
      const isSevere = clip.severity === 'severe';
      recommendations.push({
        id: 'rec_clipping',
        priority: 'P0',
        action: 'CHECK_RECORDING',
        target: 'Source Audio',
        title: `${clip.severity === 'severe' ? 'Severe' : 'Noticeable'} Digital Clipping Detected`,
        reason: 'Digital waveform peaks have exceeded 0 dBFS, resulting in flat-topped clipping distortion.',
        evidence: `${clip.samples} clipped samples measured (${clip.percent.toFixed(3)}% of audio, longest run: ${clip.longestRun} samples, True Peak: ${fmtDb(clip.truePeakDb)}).`,
        actionAdvice: 'Do NOT use EQ to fix clipping. Apply dedicated de-clipping DSP restoration or re-record with 6 dB more analog preamp headroom.',
        severity: isSevere ? 0.95 : 0.65,
        confidence: clip.confidence,
        category: 'Recording Health'
      });
    }

    // B. Mains Hum (50 Hz / 60 Hz)
    if (health.hum && health.hum.detected && health.hum.severity > 0.3) {
      const hum = health.hum;
      const harmonicsCount = hum.harmonics ? hum.harmonics.length : 1;
      recommendations.push({
        id: 'rec_hum',
        priority: 'P0',
        action: 'CUT',
        target: `Electrical Hum @ ${hum.freq} Hz`,
        title: `Mains Electrical Hum (${hum.freq} Hz series)`,
        reason: 'Stationary power grid interference tone detected in quiet intervals.',
        evidence: `Mains fundamental at ${hum.freq} Hz measured at ${fmtDb(hum.levelDb)} with ${harmonicsCount} detected harmonic(s).`,
        actionAdvice: `Apply narrow notch filters (Q=16) at ${hum.freq} Hz${harmonicsCount > 1 ? ' and its harmonics' : ''} or use hum removal plugin.`,
        severity: hum.severity,
        confidence: hum.confidence,
        category: 'Recording Health'
      });

      // Add notch EQ candidate
      eqBands.push({
        id: 'eq_hum_notch',
        frequency: hum.freq,
        gain: -18.0,
        q: 18.0,
        type: 'notch',
        mode: 'static',
        dynamic: false,
        dynamicRange: 0,
        threshold: 0,
        severity: hum.severity,
        confidence: hum.confidence,
        reason: `Surgical notch for ${hum.freq} Hz electrical mains hum`,
        evidence: `Hum tone at ${hum.freq} Hz measured at ${fmtDb(hum.levelDb)}`,
        priority: 'P0'
      });
    }

    // C. Anti-Phase Stereo Cancellation
    if (stereo && stereo.isStereo && stereo.phaseRisk === 'Critical') {
      recommendations.push({
        id: 'rec_phase_cancellation',
        priority: 'P0',
        action: 'EDIT',
        target: 'Stereo Phase Polarity',
        title: 'Severe Anti-Phase Cancellation Hazard',
        reason: 'Left and Right channels are negatively correlated, causing catastrophic cancellation in mono.',
        evidence: `Inter-channel correlation measured at ${stereo.correlation.toFixed(3)} (< -0.20).`,
        actionAdvice: 'Invert polarity (180° phase flip) on one channel or collapse the vocal fundamental below 300 Hz to mono.',
        severity: 0.98,
        confidence: 0.98,
        category: 'Phase & Stereo'
      });
    }

    // D. DC Offset
    if (health.dcOffset && health.dcOffset.detected) {
      recommendations.push({
        id: 'rec_dc_offset',
        priority: 'P0',
        action: 'EDIT',
        target: 'DC Offset Removal',
        title: 'Measurable DC Offset Detected',
        reason: 'Waveform center line is shifted away from zero, reducing usable digital headroom and causing potential clicks on edits.',
        evidence: `Mean DC shift of ${(health.dcOffset.mean * 100).toFixed(2)}% (${fmtDb(health.dcOffset.db)}).`,
        actionAdvice: 'Enable high-pass filter (HPF) at 20 Hz or apply DC offset removal in your DAW.',
        severity: 0.50,
        confidence: 0.95,
        category: 'Recording Health'
      });
    }

    // =========================================================================
    // 2. PRIORITY P1: MAJOR CORRECTIVE ISSUES (HPF, RESONANCES, SIBILANCE, PLOSIVES)
    // =========================================================================

    // A. Sub-bass Rumble / High-Pass Filter (HPF)
    const rumbleZone = tonal.zones ? tonal.zones.find(z => z.id === 'rumble') : null;
    const lowestF0 = pitch.f0 ? pitch.f0.minF0 : 100;
    const safeHpfFreq = Math.max(35, Math.min(85, Math.round(lowestF0 * 0.65)));

    if (rumbleZone && (rumbleZone.energyPercent > 1.2 || rumbleZone.deviationDb > 4.0 || rumbleZone.levelDb > -50)) {
      recommendations.push({
        id: 'rec_hpf_rumble',
        priority: 'P1',
        action: 'CUT',
        target: `Sub Rumble HPF @ ${safeHpfFreq} Hz`,
        title: 'Sub-Frequency Rumble & Mechanical Noise',
        reason: 'Inaudible low-end energy eats mix headroom without contributing to vocal tone.',
        evidence: `Sub band (20–60 Hz) contains ${rumbleZone.energyPercent}% of total energy (${fmtDb(rumbleZone.levelDb)}).`,
        actionAdvice: `Apply 18–24 dB/oct high-pass filter at ${safeHpfFreq} Hz. Lowest vocal pitch fundamental is at ${Math.round(lowestF0)} Hz.`,
        severity: Math.min(0.9, Math.max(0.4, rumbleZone.severity)),
        confidence: 0.94,
        category: 'Corrective EQ'
      });

      eqBands.push({
        id: 'eq_hpf',
        frequency: safeHpfFreq,
        gain: 0,
        q: 0.707,
        type: 'hpf',
        mode: 'static',
        dynamic: false,
        dynamicRange: 0,
        threshold: 0,
        severity: 0.75,
        confidence: 0.95,
        reason: `High-pass filter at ${safeHpfFreq} Hz to eliminate sub rumble below vocal fundamentals (${Math.round(lowestF0)} Hz)`,
        evidence: `20–60 Hz sub energy measured at ${fmtDb(rumbleZone.levelDb)}`,
        priority: 'P1'
      });
    }

    // B. Problematic Stationary Resonances
    if (resonances && resonances.resonances) {
      const problemResonances = resonances.resonances.filter(r => r.action === 'CUT' || r.action === 'DYNAMIC_CUT');
      for (const res of problemResonances.slice(0, 3)) {
        const isDynamic = res.action === 'DYNAMIC_CUT';
        const gainCut = isDynamic ? -Math.min(4.5, Math.max(1.5, res.excessDb * 0.7)) : -Math.min(4.0, Math.max(1.2, res.excessDb * 0.6));

        recommendations.push({
          id: `rec_resonance_${res.centerFreq}`,
          priority: 'P1',
          action: res.action,
          target: `Resonance @ ${fmtFreq(res.centerFreq)}`,
          title: `${isDynamic ? 'Intermittent' : 'Persistent'} Acoustic Resonance @ ${fmtFreq(res.centerFreq)}`,
          reason: res.reason,
          evidence: `${fmtFreq(res.centerFreq)} shows +${res.excessDb} dB excess above baseline (Q=${res.q}, present in ${res.persistencePct}% of frames).`,
          actionAdvice: isDynamic
            ? `Apply dynamic EQ cut of ${gainCut.toFixed(1)} dB with Q=${res.q} engaging during loud notes.`
            : `Apply narrow parametric notch of ${gainCut.toFixed(1)} dB with Q=${res.q}.`,
          severity: res.severity,
          confidence: res.confidence,
          category: 'Resonance'
        });

        eqBands.push({
          id: `eq_res_${res.centerFreq}`,
          frequency: res.centerFreq,
          gain: Math.round(gainCut * 10) / 10,
          q: res.q,
          type: 'bell',
          mode: isDynamic ? 'dynamic' : 'static',
          dynamic: isDynamic,
          dynamicRange: isDynamic ? Math.abs(Math.round(gainCut * 10) / 10) : 0,
          threshold: -24.0,
          severity: res.severity,
          confidence: res.confidence,
          reason: res.reason,
          evidence: `+${res.excessDb} dB excess above baseline (Q=${res.q})`,
          priority: 'P1'
        });
      }
    }

    // C. De-Essing Sibilance
    if (events && events.sibilance && events.sibilance.action !== 'NONE') {
      const sib = events.sibilance;
      const isSevere = sib.severity.includes('Severe') || sib.severity.includes('High');
      const dominantFreq = sib.dominantFrequency || 7200;

      recommendations.push({
        id: 'rec_sibilance',
        priority: isSevere ? 'P1' : 'P2',
        action: sib.action,
        target: `Sibilance Control @ ${fmtFreq(dominantFreq)}`,
        title: `${sib.severity} Sibilance (${fmtFreq(dominantFreq)})`,
        reason: sib.recommendation,
        evidence: `${sib.eventsCount} sibilant events detected averaging ${fmtDb(sib.averageLevelDb)} with peak concentration at ${fmtFreq(dominantFreq)}.`,
        actionAdvice: `Configure de-esser centered at ${dominantFreq} Hz (Q=2.0) with ${isSevere ? '4–6 dB' : '2–4 dB'} target gain reduction. Avoid broad static high-shelf cuts.`,
        severity: isSevere ? 0.85 : 0.55,
        confidence: 0.92,
        category: 'De-Essing'
      });

      eqBands.push({
        id: 'eq_de_ess',
        frequency: dominantFreq,
        gain: isSevere ? -4.5 : -3.0,
        q: 2.2,
        type: 'bell',
        mode: 'dynamic',
        dynamic: true,
        dynamicRange: isSevere ? 5.0 : 3.5,
        threshold: sib.settings ? sib.settings.thresholdDb : -22.0,
        severity: isSevere ? 0.85 : 0.55,
        confidence: 0.92,
        reason: `Targeted dynamic sibilance control centered at measured peak (${fmtFreq(dominantFreq)})`,
        evidence: `${sib.eventsCount} sibilant bursts detected at ${fmtFreq(dominantFreq)} (${fmtDb(sib.averageLevelDb)})`,
        priority: isSevere ? 'P1' : 'P2'
      });
    }

    // D. Plosive Transients
    if (events && events.plosives && events.plosives.eventsCount > 0) {
      const plo = events.plosives;
      if (plo.severity !== 'Clean') {
        recommendations.push({
          id: 'rec_plosives',
          priority: 'P1',
          action: 'AUTOMATE',
          target: 'Low-Frequency Plosives (P/B)',
          title: `${plo.severity} Plosive Wind Bursts`,
          reason: plo.recommendation,
          evidence: `${plo.eventsCount} plosive burst(s) detected in the 30–100 Hz band.`,
          actionAdvice: 'Apply clip-gain reduction (-4 to -8 dB) on individual plosive timestamps or automate dynamic low-cut filter during consonant hits.',
          severity: plo.severity === 'Severe' ? 0.85 : 0.50,
          confidence: 0.90,
          category: 'Vocal Editing'
        });
      }
    }

    // =========================================================================
    // 3. PRIORITY P2: IMPORTANT TONAL ISSUES (MUD, BOXINESS, DYNAMIC HARSHNESS)
    // =========================================================================

    // A. Dynamic Harshness (2.8 kHz – 4.5 kHz)
    const harshZone = tonal.zones ? tonal.zones.find(z => z.id === 'harshness') : null;
    const dynamicHarshIssue = dynamicSpectral.dynamicIssues ? dynamicSpectral.dynamicIssues.find(d => d.zoneId === 'harshness') : null;

    if (dynamicHarshIssue && dynamicHarshIssue.excessDynamicDelta > 2.5) {
      const harshCut = -Math.min(3.8, Math.max(1.5, dynamicHarshIssue.excessDynamicDelta * 0.6));
      recommendations.push({
        id: 'rec_dynamic_harshness',
        priority: 'P2',
        action: 'DYNAMIC_CUT',
        target: 'Upper-Mid Harshness @ 3.4 kHz',
        title: 'Dynamic Upper-Mid Harshness on Vocal Peaks',
        reason: 'Upper-mid energy surges disproportionately during emphatic/belting phrases, causing ear fatigue.',
        evidence: `3.4 kHz energy increases by +${dynamicHarshIssue.excessDynamicDelta.toFixed(1)} dB above normal baseline during loud voiced frames (loud: ${fmtDb(dynamicHarshIssue.loudDb)} vs normal: ${fmtDb(dynamicHarshIssue.normalDb)}).`,
        actionAdvice: `Apply dynamic EQ cut of ${harshCut.toFixed(1)} dB at 3400 Hz (Q=2.2). The filter will remain transparent during soft singing and engage only when the singer pushes.`,
        severity: Math.min(0.9, dynamicHarshIssue.excessDynamicDelta / 5.0),
        confidence: 0.91,
        category: 'Dynamic EQ'
      });

      eqBands.push({
        id: 'eq_harsh_dynamic',
        frequency: 3400,
        gain: Math.round(harshCut * 10) / 10,
        q: 2.2,
        type: 'bell',
        mode: 'dynamic',
        dynamic: true,
        dynamicRange: Math.abs(Math.round(harshCut * 10) / 10),
        threshold: -20.0,
        severity: 0.78,
        confidence: 0.91,
        reason: 'Dynamic cut at 3.4 kHz to tame upper-mid stridence on loud notes while preserving quiet phrase warmth',
        evidence: `+${dynamicHarshIssue.excessDynamicDelta.toFixed(1)} dB surge in loud frames`,
        priority: 'P2'
      });
    } else if (harshZone && harshZone.deviationDb > 3.0) {
      // Static harshness
      recommendations.push({
        id: 'rec_static_harshness',
        priority: 'P2',
        action: 'CUT',
        target: 'Upper-Mid Presence @ 3.5 kHz',
        title: 'Persistent Upper-Mid Stridence',
        reason: 'Upper-mid frequencies are consistently elevated relative to vocal warmth.',
        evidence: `Harshness zone (2.8–4.5 kHz) deviates by +${harshZone.deviationDb.toFixed(1)} dB above normative baseline.`,
        actionAdvice: 'Apply broad musical cut of -1.5 to -2.5 dB around 3.5 kHz with Q=1.4.',
        severity: harshZone.severity,
        confidence: 0.85,
        category: 'Tonal EQ'
      });
    }

    // B. Low-Mid Mud & Boxiness (300 Hz – 550 Hz)
    const mudZone = tonal.zones ? tonal.zones.find(z => z.id === 'mud') : null;
    const boxZone = tonal.zones ? tonal.zones.find(z => z.id === 'boxiness') : null;

    if (mudZone && mudZone.deviationDb > 3.0) {
      const mudCut = -Math.min(3.5, Math.max(1.2, mudZone.deviationDb * 0.5));
      recommendations.push({
        id: 'rec_mud_cut',
        priority: 'P2',
        action: 'CUT',
        target: 'Low-Mid Mud @ 380 Hz',
        title: 'Excessive Low-Mid Mud / Clutter',
        reason: 'Buildup around 300–450 Hz creates an indistinct, congested tone that competes with snare and guitars.',
        evidence: `Mud zone deviates by +${mudZone.deviationDb.toFixed(1)} dB above baseline (${fmtDb(mudZone.levelDb)}).`,
        actionAdvice: `Apply gentle parametric cut of ${mudCut.toFixed(1)} dB at 380 Hz (Q=1.5).`,
        severity: mudZone.severity,
        confidence: 0.88,
        category: 'Tonal EQ'
      });

      eqBands.push({
        id: 'eq_mud_cut',
        frequency: 380,
        gain: Math.round(mudCut * 10) / 10,
        q: 1.5,
        type: 'bell',
        mode: 'static',
        dynamic: false,
        dynamicRange: 0,
        threshold: 0,
        severity: mudZone.severity,
        confidence: 0.88,
        reason: 'Gentle low-mid cut at 380 Hz to clear acoustic congestion without thinning vocal body',
        evidence: `+${mudZone.deviationDb.toFixed(1)} dB excess in 250–450 Hz zone`,
        priority: 'P2'
      });
    } else if (boxZone && boxZone.deviationDb > 3.5) {
      const boxCut = -Math.min(3.0, Math.max(1.0, boxZone.deviationDb * 0.45));
      recommendations.push({
        id: 'rec_boxiness_cut',
        priority: 'P2',
        action: 'CUT',
        target: 'Boxiness @ 550 Hz',
        title: 'Enclosed Room Boxiness @ 550 Hz',
        reason: 'Hollow, cardboard-like resonance characteristic of small untreated recording spaces.',
        evidence: `500–750 Hz band shows +${boxZone.deviationDb.toFixed(1)} dB deviation above baseline.`,
        actionAdvice: `Apply parametric cut of ${boxCut.toFixed(1)} dB around 550 Hz (Q=2.0).`,
        severity: boxZone.severity,
        confidence: 0.84,
        category: 'Tonal EQ'
      });

      eqBands.push({
        id: 'eq_box_cut',
        frequency: 550,
        gain: Math.round(boxCut * 10) / 10,
        q: 2.0,
        type: 'bell',
        mode: 'static',
        dynamic: false,
        dynamicRange: 0,
        threshold: 0,
        severity: boxZone.severity,
        confidence: 0.84,
        reason: 'Parametric cut at 550 Hz to clean up boxy room acoustic reflection',
        evidence: `+${boxZone.deviationDb.toFixed(1)} dB deviation in 500–750 Hz band`,
        priority: 'P2'
      });
    }

    // C. Dynamics & Compression Plan
    if (dynamics && dynamics.compressionProfile) {
      const comp = dynamics.compressionProfile;
      recommendations.push({
        id: 'rec_compression',
        priority: 'P2',
        action: 'COMPRESS',
        target: 'Dynamic Consistency',
        title: `${comp.requirement} Compression Recommended`,
        reason: `Dynamic range measured at ${dynamics.dynamicRangeDb} dB with LRA of ${dynamics.loudness.lra} LU (${dynamics.phraseConsistency.verdict} consistency).`,
        evidence: `Crest factor: ${dynamics.crestDb} dB, Phrase standard deviation: ${dynamics.phraseConsistency.phraseStdDevDb} dB.`,
        actionAdvice: `${comp.style}. Suggested settings: Ratio ${comp.suggestedRatio}, Target GR ${comp.targetGR}, ${comp.attackReleaseHint}.`,
        severity: dynamics.loudness.lra > 10 ? 0.80 : 0.50,
        confidence: comp.confidence,
        category: 'Dynamics'
      });
    }

    // =========================================================================
    // 4. PRIORITY P3: FINE TUNING & TONAL POLISH (PRESENCE, AIR, WARMTH)
    // =========================================================================

    // A. Vocal Presence / Intelligibility
    const clarityZone = tonal.zones ? tonal.zones.find(z => z.id === 'clarity') : null;
    const presenceZone = tonal.zones ? tonal.zones.find(z => z.id === 'presence') : null;

    if (clarityZone && clarityZone.deviationDb < -3.0 && (!harshZone || harshZone.deviationDb < 1.0)) {
      const presBoost = Math.min(2.8, Math.max(1.0, Math.abs(clarityZone.deviationDb) * 0.5));
      recommendations.push({
        id: 'rec_presence_boost',
        priority: 'P3',
        action: 'BOOST',
        target: 'Intelligibility & Clarity @ 2.8 kHz',
        title: 'Vocal Clarity & Formant Definition Lift',
        reason: 'Consonant intelligibility is slightly recessed relative to vocal body.',
        evidence: `Clarity zone (2.0–3.5 kHz) is ${Math.abs(clarityZone.deviationDb).toFixed(1)} dB below target normative curve.`,
        actionAdvice: `Apply gentle broad boost of +${presBoost.toFixed(1)} dB at 2800 Hz (Q=1.2) to bring the singer forward.`,
        severity: 0.45,
        confidence: 0.82,
        category: 'Tonal EQ'
      });

      eqBands.push({
        id: 'eq_clarity_boost',
        frequency: 2800,
        gain: Math.round(presBoost * 10) / 10,
        q: 1.2,
        type: 'bell',
        mode: 'static',
        dynamic: false,
        dynamicRange: 0,
        threshold: 0,
        severity: 0.45,
        confidence: 0.82,
        reason: 'Gentle broad bell boost at 2.8 kHz to enhance lyric articulation and forward placement',
        evidence: `${Math.abs(clarityZone.deviationDb).toFixed(1)} dB deficit in 2.0–3.5 kHz clarity zone`,
        priority: 'P3'
      });
    }

    // B. High-Frequency Air (12 kHz – 16 kHz)
    const airZone = tonal.zones ? tonal.zones.find(z => z.id === 'air') : null;
    const brightZone = tonal.zones ? tonal.zones.find(z => z.id === 'brightness') : null;

    if (airZone && airZone.deviationDb < -3.5 && (!brightZone || brightZone.deviationDb < 2.0)) {
      const airBoost = Math.min(2.8, Math.max(1.0, Math.abs(airZone.deviationDb) * 0.45));
      recommendations.push({
        id: 'rec_air_shelf',
        priority: 'P3',
        action: 'BOOST',
        target: 'Top-End Air High-Shelf @ 12 kHz',
        title: 'High-Frequency Air & Sheen Lift',
        reason: 'Top-end rolls off quickly, resulting in a dark or closed acoustic presentation.',
        evidence: `Air band (12–20 kHz) is ${Math.abs(airZone.deviationDb).toFixed(1)} dB below modern vocal target.`,
        actionAdvice: `Apply smooth high-shelf boost of +${airBoost.toFixed(1)} dB at 12,000 Hz.`,
        severity: 0.40,
        confidence: 0.80,
        category: 'Tonal EQ'
      });

      eqBands.push({
        id: 'eq_air_shelf',
        frequency: 12000,
        gain: Math.round(airBoost * 10) / 10,
        q: 0.707,
        type: 'highshelf',
        mode: 'static',
        dynamic: false,
        dynamicRange: 0,
        threshold: 0,
        severity: 0.40,
        confidence: 0.80,
        reason: 'Smooth high-shelf lift at 12 kHz to add modern acoustic openness and breathing room',
        evidence: `${Math.abs(airZone.deviationDb).toFixed(1)} dB deficit in 12–20 kHz air zone`,
        priority: 'P3'
      });
    }

    // C. Low-End Warmth / Proximity Tuning
    const warmthZone = tonal.zones ? tonal.zones.find(z => z.id === 'warmth') : null;
    if (warmthZone && warmthZone.deviationDb < -3.5) {
      const warmthBoost = Math.min(2.5, Math.max(1.0, Math.abs(warmthZone.deviationDb) * 0.45));
      recommendations.push({
        id: 'rec_warmth_boost',
        priority: 'P3',
        action: 'BOOST',
        target: 'Vocal Warmth @ 180 Hz',
        title: 'Vocal Warmth & Chest Weight Foundation',
        reason: 'Voice lacks fundamental body and sounds lightweight or thin.',
        evidence: `Warmth zone (140–250 Hz) is ${Math.abs(warmthZone.deviationDb).toFixed(1)} dB below target.`,
        actionAdvice: `Apply gentle low-shelf or broad bell boost of +${warmthBoost.toFixed(1)} dB at 180 Hz.`,
        severity: 0.42,
        confidence: 0.80,
        category: 'Tonal EQ'
      });

      eqBands.push({
        id: 'eq_warmth_boost',
        frequency: 180,
        gain: Math.round(warmthBoost * 10) / 10,
        q: 1.1,
        type: 'bell',
        mode: 'static',
        dynamic: false,
        dynamicRange: 0,
        threshold: 0,
        severity: 0.42,
        confidence: 0.80,
        reason: 'Broad musical lift at 180 Hz to restore chest foundation and intimate vocal warmth',
        evidence: `${Math.abs(warmthZone.deviationDb).toFixed(1)} dB deficit in warmth zone`,
        priority: 'P3'
      });
    }

    // =========================================================================
    // 5. PRIORITY P4: OPTIONAL ENHANCEMENT (SATURATION, STEREO WIDTH, MIX POCKET)
    // =========================================================================

    // A. Harmonic Saturation Suggestion
    const hnr = pitch.harmonics ? pitch.harmonics.meanHnrDb : 15;
    const rollOff = pitch.harmonics ? pitch.harmonics.harmonicRollOff : -6;

    if (hnr > 16 && rollOff < -8.0) {
      recommendations.push({
        id: 'rec_saturation',
        priority: 'P4',
        action: 'LEAVE_UNCHANGED',
        target: 'Harmonic Saturation',
        title: 'Tube / Tape Harmonic Density Enhancement',
        reason: 'Clean harmonic structure allows subtle analog saturation to add density and glue in dense mixes.',
        evidence: `HNR measured at ${hnr.toFixed(1)} dB with steep harmonic roll-off (${rollOff.toFixed(1)} dB/oct).`,
        actionAdvice: 'Apply 5–10% parallel tube or tape saturation (e.g. VoxLens Heat) to generate subtle 2nd/3rd harmonics.',
        severity: 0.25,
        confidence: 0.78,
        category: 'Creative Saturation'
      });
    }

    // B. Mix Masking Carving (if instrumental provided)
    if (mixMasking && mixMasking.enabled && mixMasking.collisions.length > 0) {
      const topCollision = mixMasking.collisions.find(c => c.maskingProbability >= 65);
      if (topCollision) {
        recommendations.push({
          id: 'rec_mix_masking',
          priority: 'P2',
          action: topCollision.action === 'INSTRUMENT_BUS_CARVE' ? 'EDIT' : 'DYNAMIC_BOOST',
          target: topCollision.name,
          title: `Mix Masking Collision: ${topCollision.name}`,
          reason: topCollision.recommendation,
          evidence: `Instrument energy exceeds vocal by ${fmtDb(topCollision.deltaDb)} at ${fmtFreq(topCollision.centerHz)} (${topCollision.maskingProbability}% masking probability).`,
          actionAdvice: topCollision.recommendation,
          severity: 0.75,
          confidence: 0.88,
          category: 'Mix Interaction'
        });
      }
    }

    // Sort recommendations by priority (P0 -> P1 -> P2 -> P3 -> P4) then severity descending
    const PRIORITY_WEIGHTS = { P0: 5, P1: 4, P2: 3, P3: 2, P4: 1 };
    recommendations.sort((a, b) => {
      const pDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
      if (pDiff !== 0) return pDiff;
      return b.severity - a.severity;
    });

    // Limit EQ bands to 3–8 meaningful, prioritized bands
    eqBands.sort((a, b) => {
      const pDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
      if (pDiff !== 0) return pDiff;
      return b.severity - a.severity;
    });
    const finalEqPlan = eqBands.slice(0, 8);
    // Sort final EQ bands by ascending frequency
    finalEqPlan.sort((a, b) => a.frequency - b.frequency);

    // =========================================================================
    // 6. SUGGESTED 10-STAGE VOCAL PROCESSING CHAIN
    // =========================================================================
    const processingChain = [
      {
        stage: 1,
        name: 'Vocal Editing & Timing',
        status: events.plosives && events.plosives.eventsCount > 0 ? 'Active' : 'Optional',
        action: events.plosives && events.plosives.eventsCount > 0 ? 'Trim plosive wind blasts with clip-gain' : 'Check breath transitions and head/tail trims',
        pluginType: 'DAW Clip Gain / Fades'
      },
      {
        stage: 2,
        name: 'Recording Health & Cleanup',
        status: (health.clipping.samples > 0 || health.hum.detected) ? 'Required' : 'Clean',
        action: health.hum.detected ? `Hum removal @ ${health.hum.freq} Hz` : (health.clipping.samples > 0 ? 'De-clipping restoration' : 'Pass-through (Clean recording)'),
        pluginType: 'Noise Gate / Spectral Repair'
      },
      {
        stage: 3,
        name: 'Corrective High-Pass & Resonance EQ',
        status: finalEqPlan.some(b => b.type === 'hpf' || (b.gain < 0 && b.mode === 'static')) ? 'Active' : 'Bypass',
        action: `HPF @ ${safeHpfFreq} Hz + corrective resonance notches`,
        pluginType: 'Parametric Linear/Min-Phase EQ'
      },
      {
        stage: 4,
        name: 'Dynamic EQ (Harshness / Proximity)',
        status: finalEqPlan.some(b => b.mode === 'dynamic') ? 'Active' : 'Bypass',
        action: finalEqPlan.some(b => b.mode === 'dynamic') ? 'Tame level-dependent harshness during loud belting notes' : 'Transparent (No dynamic excess)',
        pluginType: 'Dynamic EQ'
      },
      {
        stage: 5,
        name: 'De-Essing (Targeted Sibilance Control)',
        status: events.sibilance.action !== 'NONE' ? 'Active' : 'Optional',
        action: `Split-band de-essing centered @ ${fmtFreq(events.sibilance.dominantFrequency || 7200)}`,
        pluginType: 'De-Esser'
      },
      {
        stage: 6,
        name: 'Vocal Dynamics & Compression',
        status: 'Active',
        action: `${dynamics.compressionProfile.style} (${dynamics.compressionProfile.targetGR})`,
        pluginType: 'FET / Optical / VCA Compressor'
      },
      {
        stage: 7,
        name: 'Tonal Sweetening & Air EQ',
        status: finalEqPlan.some(b => b.gain > 0) ? 'Active' : 'Optional',
        action: 'Broad musical lift for presence and top-end air sheen',
        pluginType: 'Analog-Style Tone EQ (Pultec / Baxandall)'
      },
      {
        stage: 8,
        name: 'Harmonic Saturation / Heat',
        status: character.scores.body < 45 || character.scores.warmth < 45 ? 'Recommended' : 'Optional',
        action: 'Subtle tape/tube harmonic generation for density',
        pluginType: 'Tape / Tube Saturator (VoxLens Heat)'
      },
      {
        stage: 9,
        name: 'Fader & Breath Automation',
        status: 'Active',
        action: 'Ride phrase transitions and automate loud breaths down by 4–6 dB',
        pluginType: 'DAW Fader Automation / Vocal Rider'
      },
      {
        stage: 10,
        name: 'Spatial Reverb & Mix Placement',
        status: 'Active',
        action: stereo.stereoWidthPct < 15 ? 'Plate reverb + subtle stereo micro-shift' : 'Centered reverb with mono-compatible early reflections',
        pluginType: 'Stereo Reverb / Delay'
      }
    ];

    // Compute Overall Mix-Readiness Estimate (0–100)
    let mixReadiness = Math.round(
      health.score * 0.30 +
      Math.max(0, 100 - (tonal.zones.filter(z => z.status.includes('excess') || z.status.includes('deficient')).length * 7)) * 0.25 +
      (dynamics.loudness.lra > 12 ? 65 : 85) * 0.15 +
      (events.sibilance.action === 'NONE' ? 95 : (events.sibilance.severity.includes('Severe') ? 60 : 80)) * 0.15 +
      (health.noiseFloor.snrDb > 35 ? 95 : 70) * 0.15
    );
    mixReadiness = Math.max(10, Math.min(99, mixReadiness));

    // Executive Summary paragraph
    let summaryParts = [];
    summaryParts.push(character.classification + '.');

    const topIssues = recommendations.filter(r => r.priority === 'P0' || r.priority === 'P1');
    if (topIssues.length > 0) {
      summaryParts.push(`Main priority actions: ${topIssues.map(t => t.title).join(', ')}.`);
    } else {
      summaryParts.push('Recording is clean and well-balanced.');
    }

    if (finalEqPlan.length > 0) {
      summaryParts.push(`EQ plan proposes ${finalEqPlan.length} targeted filter band(s) with dynamic control on peak problem zones.`);
    }

    const executiveSummary = summaryParts.join(' ');

    return {
      mixReadinessScore: mixReadiness,
      executiveSummary,
      recommendations,
      topActions: recommendations.slice(0, 5),
      eqPlan: finalEqPlan,
      processingChain
    };
  }

  return {
    runDecisionEngine
  };
}));
