'use strict';
/**
 * MixLens Vocal Analysis Engine — Master Pipeline Coordinator
 * Coordinates the full analysis pipeline:
 * Audio Decode -> Pre-validation -> STFT Spectrum -> YIN Pitch & Harmonics ->
 * LPC Formants -> 16-Band Tonal Balance -> Resonance Discrimination ->
 * Dynamic Spectral Tiers -> EBU R128 Dynamics -> Time Events (Sibilance/Plosives/Breaths) ->
 * Recording Health -> Vocal Character -> Stereo/Phase -> Decision Engine ->
 * Report -> JSON -> Complete Detailed Vocal Report
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([
      './dsp', './health', './spectrum', './pitch', './formants',
      './tonal', './resonances', './dynamic-spectral', './dynamics',
      './events', './character', './stereo', './masking', './reference',
      './decision', './report'
    ], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./dsp'),
      require('./health'),
      require('./spectrum'),
      require('./pitch'),
      require('./formants'),
      require('./tonal'),
      require('./resonances'),
      require('./dynamic-spectral'),
      require('./dynamics'),
      require('./events'),
      require('./character'),
      require('./stereo'),
      require('./masking'),
      require('./reference'),
      require('./decision'),
      require('./report')
    );
  } else {
    root.VocalEngine = factory(
      root.VocalDSP,
      root.VocalHealth,
      root.VocalSpectrum,
      root.VocalPitch,
      root.VocalFormants,
      root.VocalTonal,
      root.VocalResonances,
      root.VocalDynamicSpectral,
      root.VocalDynamics,
      root.VocalEvents,
      root.VocalCharacter,
      root.VocalStereo,
      root.VocalMasking,
      root.VocalReference,
      root.VocalDecision,
      root.VocalReport
    );
  }
}(typeof self !== 'undefined' ? self : this, function(
  DSP, Health, Spectrum, Pitch, Formants, Tonal, Resonances,
  DynamicSpectral, Dynamics, Events, Character, Stereo, Masking,
  Reference, Decision, Report
) {

  const tick = () => new Promise(r => setTimeout(r, 0));

  /**
   * Run complete vocal analysis on AudioBuffer / Audio Data
   * @param {AudioBuffer|Object} audioBuffer - Web Audio API AudioBuffer or custom buffer object
   * @param {Object} [fileMeta] - { name, size, type }
   * @param {Function} [onProgress] - Callback for progress updates: ({ stage, percent }) => void
   * @param {Object} [options] - Additional options (instrumental audio, reference audio)
   */
  async function analyzeVocal(audioBuffer, fileMeta = {}, onProgress = () => {}, options = {}) {
    const startTime = Date.now();

    // 1. Channel Extraction & Pre-Analysis Validation
    onProgress({ stage: 'Decoding & Validating Audio', percent: 10 });
    await tick();

    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;

    if (!length || length === 0) {
      throw new Error('Empty audio file: no samples to analyze.');
    }
    if (duration < 0.25) {
      throw new Error('Recording is too short (minimum 0.25s required for accurate spectral analysis).');
    }
    if (sampleRate < 16000) {
      throw new Error(`Sample rate too low (${sampleRate} Hz). Minimum 16 kHz required for full vocal analysis.`);
    }

    const left = audioBuffer.getChannelData(0);
    const right = numChannels > 1 ? audioBuffer.getChannelData(1) : null;

    // Create mono mix
    const mono = new Float32Array(length);
    if (right) {
      for (let i = 0; i < length; i++) {
        mono[i] = (left[i] + right[i]) * 0.5;
      }
    } else {
      mono.set(left);
    }

    // 2. Recording Health Analysis (Module 1)
    onProgress({ stage: 'Recording Health Analysis', percent: 20 });
    await tick();
    const healthResult = Health.analyzeRecordingHealth(mono, sampleRate, right ? [left, right] : [left]);

    // 3. High-Resolution Spectral Analysis (Module 2)
    onProgress({ stage: 'High-Res Spectral Analysis', percent: 40 });
    await tick();
    const spectrumResult = Spectrum.analyzeSpectrum(mono, sampleRate, { fftSize: 4096, hopSize: 1024 });

    // 4. Pitch & Harmonic Analysis (Modules 3 & 4)
    onProgress({ stage: 'Pitch (F0) & Harmonic Analysis', percent: 55 });
    await tick();
    const pitchResult = Pitch.analyzePitchAndHarmonics(mono, sampleRate, { frameSize: 2048, hopSize: 512 });

    // 5. Formant Analysis (Module 5)
    onProgress({ stage: 'Formant Analysis (LPC)', percent: 60 });
    await tick();
    const formantsResult = Formants.analyzeFormants(mono, sampleRate, pitchResult.pitchTrack);

    // 6. Complete Tonal Balance (Module 6)
    onProgress({ stage: 'Tonal Balance & Zones', percent: 65 });
    await tick();
    const tonalResult = Tonal.analyzeTonalBalance(spectrumResult);

    // 7. Resonance Analysis
    onProgress({ stage: 'Resonance Discrimination', percent: 70 });
    await tick();
    const resonancesResult = Resonances.analyzeResonances(spectrumResult, pitchResult, formantsResult);

    // 8. Dynamic Spectral Tiers (Module 7)
    onProgress({ stage: 'Dynamic Spectral Analysis', percent: 75 });
    await tick();
    const dynamicSpectralResult = DynamicSpectral.analyzeDynamicSpectrum(spectrumResult);

    // 9. Dynamics & EBU R128 Loudness (Module 8)
    onProgress({ stage: 'Dynamic Range & Loudness', percent: 80 });
    await tick();
    const dynamicsResult = Dynamics.analyzeDynamics(mono, sampleRate, left, right);

    // 10. Vocal Event Detection (Modules 9, 10, 11, 12)
    onProgress({ stage: 'Vocal Events (Sibilance / Plosives / Breaths)', percent: 85 });
    await tick();
    const eventsResult = Events.analyzeVocalEvents(mono, sampleRate, pitchResult);

    // 11. Proximity & Vocal Character Profile (Modules 13 & 14)
    onProgress({ stage: 'Vocal Character Profile', percent: 88 });
    await tick();
    const characterResult = Character.analyzeVocalCharacter(
      tonalResult,
      dynamicsResult,
      pitchResult,
      eventsResult,
      healthResult,
      dynamicSpectralResult
    );

    // 12. Stereo & Phase Analysis (Module 16)
    const stereoResult = Stereo.analyzeStereo(left, right);

    // 13. Optional Mix Masking Analysis (Module 15)
    let mixMaskingResult = { enabled: false, collisions: [], overallMaskingIndex: 0, summary: 'No instrumental track loaded.' };
    if (options.instrumentalBuffer) {
      const instLeft = options.instrumentalBuffer.getChannelData(0);
      const instRight = options.instrumentalBuffer.numberOfChannels > 1 ? options.instrumentalBuffer.getChannelData(1) : null;
      const instMono = new Float32Array(options.instrumentalBuffer.length);
      if (instRight) {
        for (let i = 0; i < options.instrumentalBuffer.length; i++) instMono[i] = (instLeft[i] + instRight[i]) * 0.5;
      } else {
        instMono.set(instLeft);
      }
      mixMaskingResult = Masking.analyzeMixMasking(spectrumResult, instMono, options.instrumentalBuffer.sampleRate);
    }

    // 14. Optional Reference Vocal Analysis (Module 17)
    let referenceResult = { enabled: false, deltas: [], findings: [], summary: 'No reference vocal loaded.' };
    if (options.referenceBuffer) {
      const refLeft = options.referenceBuffer.getChannelData(0);
      const refRight = options.referenceBuffer.numberOfChannels > 1 ? options.referenceBuffer.getChannelData(1) : null;
      const refMono = new Float32Array(options.referenceBuffer.length);
      if (refRight) {
        for (let i = 0; i < options.referenceBuffer.length; i++) refMono[i] = (refLeft[i] + refRight[i]) * 0.5;
      } else {
        refMono.set(refLeft);
      }
      referenceResult = Reference.analyzeReferenceComparison(spectrumResult, dynamicsResult, refMono, options.referenceBuffer.sampleRate);
    }

    // 15. Engineering Decision Engine (Module 18)
    onProgress({ stage: 'Engineering Decision Engine', percent: 92 });
    await tick();
    const decisionResult = Decision.runDecisionEngine({
      health: healthResult,
      spectrum: spectrumResult,
      pitch: pitchResult,
      formants: formantsResult,
      tonal: tonalResult,
      resonances: resonancesResult,
      dynamicSpectral: dynamicSpectralResult,
      dynamics: dynamicsResult,
      events: eventsResult,
      character: characterResult,
      stereo: stereoResult,
      mixMasking: mixMaskingResult
    });

    // 16. Assemble complete vocal report (no VST preset)
    onProgress({ stage: 'Building Complete Vocal Report', percent: 97 });
    await tick();

    // 17. Assemble Machine-Readable Export JSON
    const reportJson = {
      version: '1.0',
      generator: 'MixLens Vocal Analysis Engine',
      timestamp: new Date().toISOString(),
      analysisDurationMs: Date.now() - startTime,
      file: {
        name: fileMeta.name || 'vocal_recording.wav',
        size: fileMeta.size || (length * numChannels * 2),
        duration: Math.round(duration * 100) / 100,
        sampleRate,
        channels: numChannels,
        bitDepth: fileMeta.bitDepth || (numChannels === 1 ? 24 : 16),
        peakDb: dynamicsResult.peakDb,
        rmsDb: dynamicsResult.rmsDb,
        integratedLufs: dynamicsResult.loudness.integrated
      },
      mixReadinessScore: decisionResult.mixReadinessScore,
      executiveSummary: decisionResult.executiveSummary,
      recordingHealth: healthResult,
      spectrum: {
        numBins: spectrumResult.numBins,
        binWidth: spectrumResult.binWidth,
        spectralTilt: spectrumResult.spectralTilt,
        descriptors: spectrumResult.descriptors
      },
      pitch: pitchResult.f0,
      vibrato: pitchResult.vibrato,
      harmonics: pitchResult.harmonics,
      formants: formantsResult,
      tonalProfile: {
        scores: characterResult.scores,
        classification: characterResult.classification,
        zones: tonalResult.zones
      },
      proximity: characterResult.proximity,
      resonances: resonancesResult.resonances,
      dynamicSpectral: {
        findings: dynamicSpectralResult.findings,
        dynamicIssues: dynamicSpectralResult.dynamicIssues
      },
      dynamics: {
        crestDb: dynamicsResult.crestDb,
        dynamicRangeDb: dynamicsResult.dynamicRangeDb,
        loudness: dynamicsResult.loudness,
        phraseConsistency: dynamicsResult.phraseConsistency,
        compressionProfile: dynamicsResult.compressionProfile
      },
      events: {
        allEventsCount: eventsResult.allEvents.length,
        sibilance: eventsResult.sibilance,
        plosives: eventsResult.plosives,
        breaths: eventsResult.breaths,
        clicks: eventsResult.clicks
      },
      stereo: stereoResult,
      mixMasking: mixMaskingResult,
      referenceCompare: referenceResult,
      recommendations: decisionResult.recommendations,
      eqPlan: decisionResult.eqPlan,
      processingChain: decisionResult.processingChain
    };

    const detailedTextReport = Report.buildDetailedTextReport(reportJson);
    const detailedHtmlReport = Report.buildDetailedHtmlReport(reportJson);

    onProgress({ stage: 'Analysis Complete', percent: 100 });
    await tick();

    return {
      reportJson,
      detailedTextReport,
      detailedHtmlReport,
      // Raw DSP outputs for visualizations
      raw: {
        mono,
        left,
        right,
        sampleRate,
        duration,
        spectrum: spectrumResult,
        pitch: pitchResult,
        formants: formantsResult,
        tonal: tonalResult,
        resonances: resonancesResult,
        dynamicSpectral: dynamicSpectralResult,
        dynamics: dynamicsResult,
        events: eventsResult,
        character: characterResult,
        stereo: stereoResult,
        decision: decisionResult,
        health: healthResult
      }
    };
  }

  return {
    analyzeVocal
  };
}));
