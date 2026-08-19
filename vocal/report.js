'use strict';
/**
 * MixLens Vocal Analysis Engine — Complete Vocal Report Builder
 * Assembles every measured module into a human-readable engineering report.
 * No VST / plugin preset export — the deliverable is the analysis itself.
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalReport = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { fmtFreq, fmtDb } = DSP;

  function n(v, digits = 1) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toFixed(digits);
  }

  function yesNo(flag) {
    return flag ? 'Yes' : 'No';
  }

  function line(label, value) {
    return `${label}: ${value}`;
  }

  function section(title) {
    const bar = '='.repeat(72);
    return `\n${bar}\n${title}\n${bar}\n`;
  }

  function subsection(title) {
    return `\n--- ${title} ---\n`;
  }

  function fmtTime(sec) {
    if (!isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(2);
    return `${m}:${sec % 60 < 10 ? '0' : ''}${s}`;
  }

  function scoreBar(score) {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    const filled = Math.round(clamped / 5);
    return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${clamped}/100`;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function eventLine(ev) {
    const start = fmtTime(ev.start);
    const end = ev.end != null ? fmtTime(ev.end) : '';
    const span = end ? `${start}–${end}` : start;
    const extra = [];
    if (ev.durationMs != null) extra.push(`${ev.durationMs} ms`);
    if (ev.dominantFreq) extra.push(fmtFreq(ev.dominantFreq));
    if (ev.peakLevelDb != null && isFinite(ev.peakLevelDb)) extra.push(fmtDb(ev.peakLevelDb));
    const tail = extra.length ? ` (${extra.join(', ')})` : '';
    return `  • ${span}  ${ev.label || ev.subType || ev.type}${tail}`;
  }

  /**
   * Build a complete plain-text vocal analysis report.
   */
  function buildDetailedTextReport(reportJson) {
    const r = reportJson || {};
    const file = r.file || {};
    const health = r.recordingHealth || {};
    const clip = health.clipping || {};
    const noise = health.noiseFloor || {};
    const hum = health.hum || {};
    const dc = health.dcOffset || {};
    const dist = health.distortion || {};
    const spec = r.spectrum || {};
    const desc = spec.descriptors || {};
    const pitch = r.pitch || {};
    const vibrato = r.vibrato || {};
    const harmonics = r.harmonics || {};
    const formants = r.formants || {};
    const profile = r.tonalProfile || {};
    const scores = profile.scores || {};
    const zones = profile.zones || [];
    const resonances = r.resonances || [];
    const dynSpec = r.dynamicSpectral || {};
    const dynamics = r.dynamics || {};
    const loud = dynamics.loudness || {};
    const phrase = dynamics.phraseConsistency || {};
    const comp = dynamics.compressionProfile || {};
    const events = r.events || {};
    const sib = events.sibilance || {};
    const plo = events.plosives || {};
    const breaths = events.breaths || {};
    const clicks = events.clicks || {};
    const stereo = r.stereo || {};
    const proximity = r.proximity || {};
    const masking = r.mixMasking || {};
    const ref = r.referenceCompare || {};
    const recs = r.recommendations || [];
    const eqPlan = r.eqPlan || [];
    const chain = r.processingChain || [];

    let txt = '';
    txt += '========================================================================\n';
    txt += 'MIXLENS — COMPLETE VOCAL ANALYSIS REPORT\n';
    txt += '========================================================================\n';
    txt += `Generated: ${r.timestamp || new Date().toISOString()}\n`;
    txt += `Engine: ${r.generator || 'MixLens Vocal Analysis Engine'}  v${r.version || '1.0'}\n`;
    if (r.analysisDurationMs != null) {
      txt += `Analysis time: ${r.analysisDurationMs} ms\n`;
    }

    txt += section('1. FILE IDENTITY');
    txt += line('File name', file.name || 'Unknown') + '\n';
    txt += line('Duration', file.duration != null ? `${file.duration} s` : '—') + '\n';
    txt += line('Sample rate', file.sampleRate ? `${file.sampleRate} Hz` : '—') + '\n';
    txt += line('Channels', file.channels === 1 ? 'Mono' : (file.channels ? `${file.channels} (Stereo)` : '—')) + '\n';
    txt += line('Bit depth (declared)', file.bitDepth ? `${file.bitDepth}-bit` : '—') + '\n';
    if (file.size) txt += line('File size', `${file.size} bytes`) + '\n';
    txt += line('Sample peak', fmtDb(file.peakDb)) + '\n';
    txt += line('RMS', fmtDb(file.rmsDb)) + '\n';
    txt += line('Integrated loudness', file.integratedLufs != null ? `${n(file.integratedLufs)} LUFS` : '—') + '\n';

    txt += section('2. EXECUTIVE SUMMARY');
    txt += line('Mix-readiness estimate', `${r.mixReadinessScore != null ? r.mixReadinessScore : '—'}/100`) + '\n';
    txt += line('Vocal character', profile.classification || '—') + '\n\n';
    txt += (r.executiveSummary || 'No executive summary available.') + '\n';

    txt += section('3. RECORDING HEALTH');
    txt += line('Health score', `${health.score != null ? health.score : '—'}/100`) + '\n';
    txt += line('Verdict', health.healthVerdict || '—') + '\n';
    txt += subsection('Clipping / True Peak');
    txt += line('Severity', clip.severity || '—') + '\n';
    txt += line('Clipped samples', clip.samples != null ? `${clip.samples} (${n(clip.percent, 4)}%)` : '—') + '\n';
    txt += line('Longest clipped run', clip.longestRun != null ? `${clip.longestRun} samples` : '—') + '\n';
    txt += line('Sample peak', clip.peakSampleDb != null ? fmtDb(clip.peakSampleDb) : '—') + '\n';
    txt += line('True Peak (4× oversampled)', clip.truePeakDb != null ? fmtDb(clip.truePeakDb) : '—') + '\n';
    if (clip.note) txt += `Note: ${clip.note}\n`;
    txt += subsection('Noise Floor & SNR');
    txt += line('Noise floor', noise.floorDb != null ? `${n(noise.floorDb)} dBFS` : '—') + '\n';
    txt += line('SNR', noise.snrDb != null ? `${n(noise.snrDb)} dB` : '—') + '\n';
    txt += line('Floor variation', noise.variationDb != null ? `${n(noise.variationDb)} dB` : '—') + '\n';
    txt += line('Noise character', noise.character || '—') + '\n';
    if (noise.hint) txt += `Hint: ${noise.hint}\n`;
    txt += subsection('Mains Hum (50 / 60 Hz)');
    txt += line('Detected', yesNo(!!hum.detected)) + '\n';
    if (hum.detected) {
      txt += line('Fundamental', `${hum.freq} Hz at ${fmtDb(hum.levelDb)}`) + '\n';
      txt += line('Confidence', n((hum.confidence || 0) * 100, 0) + '%') + '\n';
      if (hum.harmonics && hum.harmonics.length) {
        txt += 'Harmonic series:\n';
        hum.harmonics.forEach(h => {
          txt += `  • H${h.harmonicNumber}  ${h.freq} Hz  ${fmtDb(h.levelDb)}  (+${n(h.ratioDb)} dB vs local floor)\n`;
        });
      }
    }
    txt += subsection('DC Offset');
    txt += line('Detected', yesNo(!!dc.detected)) + '\n';
    txt += line('Mean shift', dc.mean != null ? `${n(dc.mean * 100, 3)}% (${fmtDb(dc.db)})` : '—') + '\n';
    txt += subsection('Nonlinear Distortion');
    txt += line('Detected', yesNo(!!dist.detected)) + '\n';
    txt += line('Type', dist.type || 'clean') + '\n';

    txt += section('4. SPECTRAL DESCRIPTORS');
    txt += line('FFT size / bins', spec.numBins ? `${spec.numBins * 2}-pt  ·  ${spec.numBins} bins  ·  ${n(spec.binWidth, 2)} Hz/bin` : '—') + '\n';
    txt += line('Spectral tilt (100 Hz–10 kHz)', spec.spectralTilt != null ? `${n(spec.spectralTilt)} dB/decade` : '—') + '\n';
    txt += line('Spectral centroid', desc.meanCentroid ? `${n(desc.meanCentroid, 0)} Hz` : '—') + '\n';
    txt += line('Spectral flatness', desc.meanFlatness != null ? n(desc.meanFlatness, 4) : '—') + '\n';
    txt += line('Spectral flux', desc.meanFlux != null ? n(desc.meanFlux, 4) : '—') + '\n';
    txt += line('85% roll-off', desc.meanRollOff85 ? `${n(desc.meanRollOff85, 0)} Hz` : '—') + '\n';
    txt += line('95% roll-off', desc.meanRollOff95 ? `${n(desc.meanRollOff95, 0)} Hz` : '—') + '\n';

    txt += section('5. PITCH (F0), VIBRATO & HARMONICS');
    txt += line('Median F0', pitch.medianF0 ? `${n(pitch.medianF0)} Hz` : '—') + '\n';
    txt += line('Mean / min / max F0', pitch.medianF0 ? `${n(pitch.meanF0)} / ${n(pitch.minF0)} / ${n(pitch.maxF0)} Hz` : '—') + '\n';
    txt += line('Primary note', pitch.note ? `${pitch.note}${pitch.cents != null ? ` (${pitch.cents > 0 ? '+' : ''}${n(pitch.cents, 0)} cents)` : ''}` : '—') + '\n';
    txt += line('Voiced / unvoiced', pitch.voicedPercent != null ? `${n(pitch.voicedPercent)}% voiced  ·  ${n(pitch.unvoicedPercent)}% unvoiced` : '—') + '\n';
    txt += line('Pitch confidence', pitch.confidence != null ? n(pitch.confidence * 100, 0) + '%' : '—') + '\n';
    txt += line('Pitch stability', pitch.pitchStability != null ? n(pitch.pitchStability, 2) : '—') + '\n';
    txt += subsection('Vibrato');
    txt += line('Detected', yesNo(!!vibrato.detected)) + '\n';
    if (vibrato.detected) {
      txt += line('Rate', `${vibrato.rateHz} Hz`) + '\n';
      txt += line('Depth', `±${vibrato.depthCents} cents`) + '\n';
    }
    if (vibrato.note) txt += `${vibrato.note}\n`;
    txt += subsection('Harmonic Structure');
    txt += line('Mean HNR', harmonics.meanHnrDb != null ? `${n(harmonics.meanHnrDb)} dB` : '—') + '\n';
    txt += line('Harmonic roll-off', harmonics.harmonicRollOff != null ? `${n(harmonics.harmonicRollOff)} dB/oct` : '—') + '\n';
    txt += line('Odd/even ratio', harmonics.oddEvenRatio != null ? n(harmonics.oddEvenRatio, 2) : '—') + '\n';
    txt += line('Character', harmonics.character || '—') + '\n';
    if (harmonics.harmonics && harmonics.harmonics.length) {
      txt += 'Harmonic cascade (H1–H12):\n';
      harmonics.harmonics.forEach(h => {
        txt += `  H${String(h.harmonic).padStart(2, ' ')}  ${String(h.freq).padStart(6, ' ')} Hz   ${fmtDb(h.levelDb)}\n`;
      });
    }

    txt += section('6. FORMANTS (LPC)');
    const f1 = formants.f1 || {};
    const f2 = formants.f2 || {};
    const f3 = formants.f3 || {};
    const sf = formants.singersFormant || {};
    txt += line('F1', f1.freq ? `${f1.freq} Hz  (±${f1.stdDev || 0} Hz) — ${f1.label || ''}` : '—') + '\n';
    txt += line('F2', f2.freq ? `${f2.freq} Hz  (±${f2.stdDev || 0} Hz) — ${f2.label || ''}` : '—') + '\n';
    txt += line('F3', f3.freq ? `${f3.freq} Hz  (±${f3.stdDev || 0} Hz) — ${f3.label || ''}` : '—') + '\n';
    txt += line("Singer's formant (2.8–3.4 kHz)", yesNo(!!sf.detected) + (sf.note ? ` — ${sf.note}` : '')) + '\n';
    txt += line('Formant stability', formants.stability != null ? n(formants.stability, 2) : '—') + '\n';

    txt += section('7. 16-ZONE TONAL BALANCE');
    if (zones.length) {
      txt += 'Zone                  Range            Level      Dev       Energy   Status\n';
      zones.forEach(z => {
        const name = String(z.name || z.id || '').padEnd(20, ' ');
        const range = `${z.from}–${z.to} Hz`.padEnd(16, ' ');
        const level = fmtDb(z.levelDb).padEnd(10, ' ');
        const dev = (z.deviationDb > 0 ? '+' : '') + n(z.deviationDb);
        txt += `${name} ${range} ${level} ${dev.padEnd(9, ' ')} ${String(z.energyPercent).padEnd(7, ' ')}%  ${z.status}\n`;
        if (z.description) txt += `    ${z.description}\n`;
      });
    } else {
      txt += 'No tonal-zone data.\n';
    }

    txt += section('8. VOCAL CHARACTER PROFILE');
    Object.keys(scores).forEach(k => {
      txt += `${String(k.toUpperCase()).padEnd(12, ' ')} ${scoreBar(scores[k])}\n`;
    });
    txt += '\n' + line('Classification', profile.classification || '—') + '\n';
    txt += subsection('Proximity Effect');
    txt += line('Verdict', proximity.verdict || '—') + '\n';
    if (proximity.recommendation) txt += proximity.recommendation + '\n';

    txt += section('9. RESONANCE DISCRIMINATION');
    if (!resonances.length) {
      txt += 'No problematic stationary resonances. Spectral peaks track natural pitch harmonics.\n';
    } else {
      resonances.forEach((res, i) => {
        txt += `\n[${i + 1}] ${fmtFreq(res.centerFreq)}  ${res.note || ''}  Q=${res.q}\n`;
        txt += `    Excess: +${res.excessDb} dB   Persistence: ${res.persistencePct}%\n`;
        txt += `    Class: ${res.type}   Action: ${res.action}\n`;
        txt += `    ${res.reason || ''}\n`;
      });
    }

    txt += section('10. DYNAMIC SPECTRAL BEHAVIOR');
    const findings = dynSpec.findings || [];
    const dynIssues = dynSpec.dynamicIssues || [];
    if (findings.length) {
      findings.forEach(f => {
        txt += `• ${f.zone || f.zoneId || 'Zone'}: ${f.evidence || f.summary || JSON.stringify(f)}\n`;
      });
    } else {
      txt += 'No level-dependent spectral surges flagged.\n';
    }
    if (dynIssues.length) {
      txt += subsection('Level-dependent issues');
      dynIssues.forEach(d => {
        txt += `• ${d.zoneId || d.zone}: loud ${fmtDb(d.loudDb)} vs normal ${fmtDb(d.normalDb)}  (Δ ${n(d.excessDynamicDelta)} dB)\n`;
      });
    }

    txt += section('11. DYNAMICS & LOUDNESS (EBU R128)');
    txt += line('Integrated loudness', loud.integrated != null ? `${n(loud.integrated)} LUFS` : '—') + '\n';
    txt += line('Short-term max', loud.shortTermMax != null ? `${n(loud.shortTermMax)} LUFS` : '—') + '\n';
    txt += line('Momentary max', loud.momentaryMax != null ? `${n(loud.momentaryMax)} LUFS` : '—') + '\n';
    txt += line('Loudness range (LRA)', loud.lra != null ? `${n(loud.lra)} LU` : '—') + '\n';
    txt += line('Crest factor', dynamics.crestDb != null ? `${n(dynamics.crestDb)} dB` : '—') + '\n';
    txt += line('Dynamic range (P90–P10)', dynamics.dynamicRangeDb != null ? `${n(dynamics.dynamicRangeDb)} dB` : '—') + '\n';
    txt += line('Detected phrases', phrase.detectedPhrases != null ? phrase.detectedPhrases : '—') + '\n';
    txt += line('Phrase level std-dev', phrase.phraseStdDevDb != null ? `${n(phrase.phraseStdDevDb)} dB` : '—') + '\n';
    txt += line('Consistency verdict', phrase.verdict || '—') + '\n';
    txt += subsection('Compression plan');
    txt += line('Requirement', comp.requirement || '—') + '\n';
    txt += line('Style', comp.style || '—') + '\n';
    txt += line('Suggested ratio', comp.suggestedRatio || '—') + '\n';
    txt += line('Target gain reduction', comp.targetGR || '—') + '\n';
    txt += line('Attack / release', comp.attackReleaseHint || '—') + '\n';

    txt += section('12. VOCAL EVENTS');
    txt += line('Total events', events.allEventsCount != null ? events.allEventsCount : '—') + '\n';
    txt += subsection(`Sibilance (${sib.eventsCount || 0} events) — ${sib.severity || '—'}`);
    txt += line('Dominant frequency', sib.dominantFrequency ? fmtFreq(sib.dominantFrequency) : '—') + '\n';
    txt += line('Average level', sib.averageLevelDb != null && sib.averageLevelDb > -140 ? fmtDb(sib.averageLevelDb) : '—') + '\n';
    txt += line('Recommended action', sib.action || 'NONE') + '\n';
    if (sib.recommendation) txt += sib.recommendation + '\n';
    if (sib.settings) {
      txt += `De-esser: ${fmtFreq(sib.settings.frequency)}  Q=${sib.settings.q}  threshold ${fmtDb(sib.settings.thresholdDb)}  target ${sib.settings.targetReductionDb} dB  (${sib.settings.mode})\n`;
    }
    (sib.events || []).forEach(ev => { txt += eventLine(ev) + '\n'; });

    txt += subsection(`Plosives (${plo.eventsCount || 0} events) — ${plo.severity || '—'}`);
    if (plo.recommendation) txt += plo.recommendation + '\n';
    (plo.events || []).forEach(ev => { txt += eventLine(ev) + '\n'; });

    txt += subsection(`Breaths (${breaths.eventsCount || 0} events)`);
    if (breaths.recommendation) txt += breaths.recommendation + '\n';
    (breaths.events || []).forEach(ev => { txt += eventLine(ev) + '\n'; });

    txt += subsection(`Mouth clicks (${(clicks.eventsCount != null ? clicks.eventsCount : (clicks.events || []).length)} events)`);
    (clicks.events || []).forEach(ev => { txt += eventLine(ev) + '\n'; });
    if (!(clicks.events || []).length) txt += '  None detected.\n';

    txt += section('13. STEREO IMAGE & PHASE');
    txt += line('Layout', stereo.isStereo ? 'Stereo' : 'Mono') + '\n';
    txt += line('Classification', stereo.classification || '—') + '\n';
    txt += line('Inter-channel correlation', stereo.correlation != null ? n(stereo.correlation, 3) : '—') + '\n';
    txt += line('Stereo width', stereo.stereoWidthPct != null ? `${n(stereo.stereoWidthPct)}%` : '—') + '\n';
    txt += line('Mid / Side', `${fmtDb(stereo.midDb)} / ${fmtDb(stereo.sideDb)}`) + '\n';
    txt += line('L–R balance', stereo.balanceDb != null ? `${n(stereo.balanceDb)} dB` : '—') + '\n';
    txt += line('Mono compatibility', stereo.monoCompatibility || '—') + '\n';
    txt += line('Phase risk', stereo.phaseRisk || '—') + '\n';
    if (stereo.note) txt += stereo.note + '\n';

    txt += section('14. MIX MASKING (VOCAL vs INSTRUMENTAL)');
    if (!masking.enabled) {
      txt += (masking.summary || 'No instrumental / beat file was uploaded. Masking analysis was skipped.') + '\n';
    } else {
      txt += line('Overall masking index', masking.overallMaskingIndex != null ? masking.overallMaskingIndex : '—') + '\n';
      if (masking.summary) txt += masking.summary + '\n';
      (masking.collisions || []).forEach(c => {
        txt += `\n• ${c.name} (${c.from}–${c.to} Hz) — ${c.maskingProbability}% masking\n`;
        txt += `  Vocal ${c.vocalLevelDb} dB  |  Instrument ${c.instrumentLevelDb} dB  |  Δ ${c.deltaDb} dB\n`;
        txt += `  ${c.recommendation}\n`;
      });
    }

    txt += section('15. REFERENCE VOCAL COMPARISON');
    if (!ref.enabled) {
      txt += (ref.summary || 'No reference vocal was uploaded. Comparative analysis was skipped.') + '\n';
    } else {
      if (ref.summary) txt += ref.summary + '\n';
      (ref.deltas || []).forEach(d => {
        txt += `• ${d.name}: source ${d.sourceRelDb} dB vs reference ${d.refRelDb} dB  (Δ ${d.deltaDb > 0 ? '+' : ''}${d.deltaDb} dB)\n`;
      });
      (ref.findings || []).forEach(f => {
        txt += `  Finding: ${typeof f === 'string' ? f : (f.summary || f.title || JSON.stringify(f))}\n`;
      });
    }

    txt += section('16. PRIORITIZED ENGINEERING RECOMMENDATIONS');
    if (!recs.length) {
      txt += 'No corrective actions required.\n';
    } else {
      recs.forEach((rec, idx) => {
        txt += `\n${idx + 1}. [${rec.priority}] [${rec.action}] ${rec.title}\n`;
        txt += `   Category: ${rec.category || '—'}   Confidence: ${rec.confidence != null ? Math.round(rec.confidence * 100) + '%' : '—'}\n`;
        txt += `   Why: ${rec.reason || ''}\n`;
        txt += `   Evidence: ${rec.evidence || ''}\n`;
        txt += `   Action: ${rec.actionAdvice || ''}\n`;
      });
    }

    txt += section('17. SUGGESTED EQ / FILTER PLAN');
    txt += 'Plugin-agnostic parameter list. Apply in any parametric / dynamic EQ.\n';
    if (!eqPlan.length) {
      txt += 'No EQ bands proposed — measured spectrum is already well balanced.\n';
    } else {
      eqPlan.forEach((b, idx) => {
        const gain = b.type === 'hpf' ? 'HPF' : fmtDb(b.gain);
        txt += `\nBand ${idx + 1}: ${fmtFreq(b.frequency)}  |  ${String(b.type).toUpperCase()}  |  ${gain}  |  Q=${b.q}  |  ${String(b.mode || 'static').toUpperCase()}\n`;
        txt += `  Reason: ${b.reason || ''}\n`;
        if (b.evidence) txt += `  Evidence: ${b.evidence}\n`;
        if (b.dynamic) {
          txt += `  Dynamic range: ${b.dynamicRange} dB   Threshold: ${b.threshold != null ? fmtDb(b.threshold) : '—'}\n`;
        }
      });
    }

    txt += section('18. SUGGESTED 10-STAGE PROCESSING CHAIN');
    chain.forEach(st => {
      txt += `${st.stage}. ${st.name}  [${st.status}]\n`;
      txt += `   ${st.action}\n`;
      txt += `   Tool class: ${st.pluginType}\n`;
    });

    txt += '\n========================================================================\n';
    txt += 'END OF REPORT — All measurements computed locally in the browser.\n';
    txt += '========================================================================\n';
    return txt;
  }

  function kvHtml(label, value) {
    return `<div class="rpt-kv"><span class="rpt-k">${escapeHtml(label)}</span><span class="rpt-v">${value}</span></div>`;
  }

  function chipClass(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('severe') || s.includes('critical') || s.includes('bad') || s.includes('excess')) return 'bad';
    if (s.includes('clean') || s.includes('ok') || s.includes('balanced') || s.includes('none') || s.includes('excellent')) return 'ok';
    return 'warn';
  }

  /**
   * Build on-screen HTML for the Full Report tab.
   */
  function buildDetailedHtmlReport(reportJson) {
    const r = reportJson || {};
    const file = r.file || {};
    const health = r.recordingHealth || {};
    const clip = health.clipping || {};
    const noise = health.noiseFloor || {};
    const hum = health.hum || {};
    const dc = health.dcOffset || {};
    const dist = health.distortion || {};
    const spec = r.spectrum || {};
    const desc = spec.descriptors || {};
    const pitch = r.pitch || {};
    const vibrato = r.vibrato || {};
    const harmonics = r.harmonics || {};
    const formants = r.formants || {};
    const profile = r.tonalProfile || {};
    const scores = profile.scores || {};
    const zones = profile.zones || [];
    const resonances = r.resonances || [];
    const dynSpec = r.dynamicSpectral || {};
    const dynamics = r.dynamics || {};
    const loud = dynamics.loudness || {};
    const phrase = dynamics.phraseConsistency || {};
    const comp = dynamics.compressionProfile || {};
    const events = r.events || {};
    const sib = events.sibilance || {};
    const plo = events.plosives || {};
    const breaths = events.breaths || {};
    const clicks = events.clicks || {};
    const stereo = r.stereo || {};
    const proximity = r.proximity || {};
    const masking = r.mixMasking || {};
    const ref = r.referenceCompare || {};
    const recs = r.recommendations || [];
    const eqPlan = r.eqPlan || [];
    const chain = r.processingChain || [];

    const scoreCards = Object.entries(scores).map(([k, v]) => `
      <div class="char-card">
        <div class="char-head">
          <span class="char-name">${escapeHtml(k)}</span>
          <span class="char-val">${escapeHtml(v)}/100</span>
        </div>
        <div class="char-bar-track"><div class="char-bar-fill" style="width:${Number(v) || 0}%"></div></div>
      </div>`).join('');

    const zoneRows = zones.map(z => `
      <tr>
        <td><b>${escapeHtml(z.name)}</b></td>
        <td class="mono">${z.from}–${z.to} Hz</td>
        <td class="mono">${escapeHtml(fmtDb(z.levelDb))}</td>
        <td class="mono">${z.deviationDb > 0 ? '+' : ''}${n(z.deviationDb)} dB</td>
        <td class="mono">${z.energyPercent}%</td>
        <td><span class="status-chip ${chipClass(z.status)}">${escapeHtml(z.status)}</span></td>
        <td>${escapeHtml(z.description || '')}</td>
      </tr>`).join('');

    const recHtml = recs.map(rec => `
      <div class="rec-card ${String(rec.priority || '').toLowerCase()}">
        <div class="rec-header">
          <div class="rec-title-wrap">
            <span class="p-badge ${String(rec.priority || '').toLowerCase()}">${escapeHtml(rec.priority)}</span>
            <span class="action-pill ${String(rec.action || '').toLowerCase()}">${escapeHtml(rec.action)}</span>
            <span class="rec-title">${escapeHtml(rec.title)}</span>
          </div>
          <span class="status-chip ${rec.confidence >= 0.85 ? 'ok' : 'warn'}">Conf: ${Math.round((rec.confidence || 0) * 100)}%</span>
        </div>
        <div class="rec-body">${escapeHtml(rec.reason || '')}</div>
        <div class="rec-evidence"><b>Evidence:</b> ${escapeHtml(rec.evidence || '')}</div>
        <div class="rec-advice"><b>Action:</b> ${escapeHtml(rec.actionAdvice || '')}</div>
      </div>`).join('');

    const eqRows = eqPlan.map((b, idx) => `
      <tr>
        <td class="mono">Band ${idx + 1}</td>
        <td class="mono"><b>${escapeHtml(fmtFreq(b.frequency))}</b></td>
        <td class="mono">${b.type === 'hpf' ? 'HPF' : escapeHtml(fmtDb(b.gain))}</td>
        <td class="mono">Q=${b.q}</td>
        <td class="mono">${escapeHtml(b.type)}</td>
        <td><span class="status-chip ${b.mode === 'dynamic' ? 'warn' : 'ok'}">${escapeHtml(String(b.mode || 'static').toUpperCase())}</span></td>
        <td>${escapeHtml(b.reason || '')}</td>
      </tr>`).join('');

    const eventChips = (list, cls) => (list || []).map(ev =>
      `<div class="event-chip ${cls}" onclick="VocalUI.seekAudio(${ev.start})">▶ <b>${n(ev.start, 2)}s:</b> ${escapeHtml(ev.label || ev.type)}</div>`
    ).join('') || '<span class="rpt-empty">None detected.</span>';

    const harmRows = (harmonics.harmonics || []).map(h =>
      `<tr><td class="mono">H${h.harmonic}</td><td class="mono">${h.freq} Hz</td><td class="mono">${escapeHtml(fmtDb(h.levelDb))}</td></tr>`
    ).join('');

    const resRows = resonances.length
      ? resonances.map(res => `
        <tr>
          <td class="mono"><b>${escapeHtml(fmtFreq(res.centerFreq))}</b></td>
          <td class="mono">${escapeHtml(res.note || '')}</td>
          <td class="mono">Q=${res.q}</td>
          <td class="mono">+${res.excessDb} dB</td>
          <td class="mono">${res.persistencePct}%</td>
          <td><span class="status-chip ${chipClass(res.type)}">${escapeHtml(res.type)}</span></td>
          <td><span class="action-pill ${String(res.action || '').toLowerCase()}">${escapeHtml(res.action)}</span></td>
          <td>${escapeHtml(res.reason || '')}</td>
        </tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center;padding:16px;color:var(--v-green)">No problematic acoustic resonances detected.</td></tr>';

    const chainRows = chain.map(st => `
      <tr>
        <td class="mono">${st.stage}</td>
        <td><b>${escapeHtml(st.name)}</b></td>
        <td><span class="status-chip ${chipClass(st.status)}">${escapeHtml(st.status)}</span></td>
        <td>${escapeHtml(st.action)}</td>
        <td>${escapeHtml(st.pluginType)}</td>
      </tr>`).join('');

    const findingsHtml = (dynSpec.findings || []).length
      ? (dynSpec.findings || []).map(f => `<li>${escapeHtml(f.zone || f.zoneId || 'Zone')}: ${escapeHtml(f.evidence || f.summary || '')}</li>`).join('')
      : '<li>No level-dependent spectral surges flagged.</li>';

    let maskingHtml = `<p class="rpt-empty">${escapeHtml(masking.summary || 'No instrumental file uploaded — masking analysis skipped.')}</p>`;
    if (masking.enabled && (masking.collisions || []).length) {
      maskingHtml = (masking.collisions || []).map(c => `
        <div class="rec-card ${c.maskingProbability >= 65 ? 'p1' : 'p3'}">
          <div class="rec-header">
            <span class="rec-title">${escapeHtml(c.name)} (${c.from}–${c.to} Hz)</span>
            <span class="status-chip ${c.maskingProbability >= 65 ? 'bad' : 'ok'}">${c.maskingProbability}% masking</span>
          </div>
          <div class="rec-body">Vocal ${c.vocalLevelDb} dB · Instrument ${c.instrumentLevelDb} dB · Δ ${c.deltaDb} dB</div>
          <div class="rec-advice">${escapeHtml(c.recommendation || '')}</div>
        </div>`).join('');
    }

    let refHtml = `<p class="rpt-empty">${escapeHtml(ref.summary || 'No reference vocal uploaded — comparison skipped.')}</p>`;
    if (ref.enabled && (ref.deltas || []).length) {
      refHtml = (ref.deltas || []).map(d => `
        <div class="band-row">
          <span class="band-name">${escapeHtml(d.name)}</span>
          <span class="band-level mono">${d.sourceRelDb} vs ${d.refRelDb} dB</span>
          <span class="band-dev mono">${d.deltaDb > 0 ? '+' : ''}${d.deltaDb} dB</span>
        </div>`).join('');
    }

    return `
      <article class="full-report">
        <header class="rpt-cover">
          <div class="rpt-cover-kicker">Complete Vocal Analysis Report</div>
          <h3 class="rpt-cover-title">${escapeHtml(file.name || 'Vocal recording')}</h3>
          <p class="rpt-cover-meta">${file.duration != null ? file.duration + 's' : '—'} · ${file.sampleRate || '—'} Hz · ${file.channels === 1 ? 'Mono' : 'Stereo'} · Peak ${escapeHtml(fmtDb(file.peakDb))} · RMS ${escapeHtml(fmtDb(file.rmsDb))} · ${file.integratedLufs != null ? n(file.integratedLufs) + ' LUFS' : ''}</p>
          <div class="rpt-score-row">
            <div class="rpt-score-pill">
              <span>Mix-readiness</span>
              <strong id="rptMixScore">${r.mixReadinessScore != null ? r.mixReadinessScore : '—'}</strong>
              <em>/100</em>
            </div>
            <p class="rpt-exec">${escapeHtml(r.executiveSummary || '')}</p>
          </div>
        </header>

        <section class="rpt-section">
          <h4>1. Recording Health</h4>
          <p class="rpt-lede">${escapeHtml(health.healthVerdict || '')} Health score <b>${health.score != null ? health.score : '—'}/100</b>.</p>
          <div class="rpt-grid">
            ${kvHtml('Clipping', `${escapeHtml(clip.severity || '—')} · ${clip.samples || 0} samples · TP ${escapeHtml(fmtDb(clip.truePeakDb))}`)}
            ${kvHtml('Noise floor / SNR', `${n(noise.floorDb)} dBFS · SNR ${n(noise.snrDb)} dB · ${escapeHtml(noise.character || '')}`)}
            ${kvHtml('Mains hum', hum.detected ? `${hum.freq} Hz at ${escapeHtml(fmtDb(hum.levelDb))}` : 'None detected')}
            ${kvHtml('DC offset', dc.detected ? `${n((dc.mean || 0) * 100, 3)}% (${escapeHtml(fmtDb(dc.db))})` : 'None')}
            ${kvHtml('Distortion', dist.detected ? escapeHtml(dist.type) : 'Clean')}
            ${kvHtml('Noise hint', escapeHtml(noise.hint || '—'))}
          </div>
        </section>

        <section class="rpt-section">
          <h4>2. Vocal Character</h4>
          <p class="rpt-lede">${escapeHtml(profile.classification || '')}</p>
          <div class="character-grid">${scoreCards}</div>
          <p class="rpt-note"><b>Proximity:</b> ${escapeHtml(proximity.verdict || '—')}. ${escapeHtml(proximity.recommendation || '')}</p>
        </section>

        <section class="rpt-section">
          <h4>3. Pitch, Vibrato &amp; Harmonics</h4>
          <div class="rpt-grid">
            ${kvHtml('Median F0', pitch.medianF0 ? `${n(pitch.medianF0)} Hz (${escapeHtml(pitch.note || '—')})` : '—')}
            ${kvHtml('Range', pitch.medianF0 ? `${n(pitch.minF0)} – ${n(pitch.maxF0)} Hz` : '—')}
            ${kvHtml('Voiced ratio', pitch.voicedPercent != null ? `${n(pitch.voicedPercent)}%` : '—')}
            ${kvHtml('Pitch stability', pitch.pitchStability != null ? n(pitch.pitchStability, 2) : '—')}
            ${kvHtml('Vibrato', vibrato.detected ? `${vibrato.rateHz} Hz ±${vibrato.depthCents} cents` : (vibrato.note || 'Straight tone'))}
            ${kvHtml('HNR', harmonics.meanHnrDb != null ? `${n(harmonics.meanHnrDb)} dB` : '—')}
            ${kvHtml('Harmonic roll-off', harmonics.harmonicRollOff != null ? `${n(harmonics.harmonicRollOff)} dB/oct` : '—')}
            ${kvHtml('Odd/even', harmonics.oddEvenRatio != null ? n(harmonics.oddEvenRatio, 2) : '—')}
          </div>
          <p class="rpt-note">${escapeHtml(harmonics.character || '')}</p>
          ${harmRows ? `<div class="v-table-wrap"><table class="v-table"><thead><tr><th>Harmonic</th><th>Frequency</th><th>Level</th></tr></thead><tbody>${harmRows}</tbody></table></div>` : ''}
        </section>

        <section class="rpt-section">
          <h4>4. Formants (LPC)</h4>
          <div class="rpt-grid">
            ${kvHtml('F1 — vowel height', formants.f1 ? `${formants.f1.freq} Hz ±${formants.f1.stdDev || 0}` : '—')}
            ${kvHtml('F2 — vowel frontness', formants.f2 ? `${formants.f2.freq} Hz ±${formants.f2.stdDev || 0}` : '—')}
            ${kvHtml('F3 — acoustic ring', formants.f3 ? `${formants.f3.freq} Hz ±${formants.f3.stdDev || 0}` : '—')}
            ${kvHtml("Singer's formant", formants.singersFormant ? (formants.singersFormant.detected ? 'Present — ' + formants.singersFormant.note : formants.singersFormant.note) : '—')}
          </div>
        </section>

        <section class="rpt-section">
          <h4>5. Spectral Descriptors</h4>
          <div class="rpt-grid">
            ${kvHtml('Tilt (100 Hz–10 kHz)', spec.spectralTilt != null ? `${n(spec.spectralTilt)} dB/decade` : '—')}
            ${kvHtml('Centroid', desc.meanCentroid ? `${n(desc.meanCentroid, 0)} Hz` : '—')}
            ${kvHtml('Flatness', desc.meanFlatness != null ? n(desc.meanFlatness, 4) : '—')}
            ${kvHtml('Flux', desc.meanFlux != null ? n(desc.meanFlux, 4) : '—')}
            ${kvHtml('85% roll-off', desc.meanRollOff85 ? `${n(desc.meanRollOff85, 0)} Hz` : '—')}
            ${kvHtml('95% roll-off', desc.meanRollOff95 ? `${n(desc.meanRollOff95, 0)} Hz` : '—')}
          </div>
        </section>

        <section class="rpt-section">
          <h4>6. 16-Zone Tonal Balance</h4>
          <div class="v-table-wrap">
            <table class="v-table">
              <thead><tr><th>Zone</th><th>Frequency</th><th>Level</th><th>Deviation</th><th>Energy</th><th>Status</th><th>Description</th></tr></thead>
              <tbody>${zoneRows}</tbody>
            </table>
          </div>
        </section>

        <section class="rpt-section">
          <h4>7. Resonances</h4>
          <div class="v-table-wrap">
            <table class="v-table">
              <thead><tr><th>Frequency</th><th>Note</th><th>Q</th><th>Excess</th><th>Persistence</th><th>Class</th><th>Action</th><th>Evidence</th></tr></thead>
              <tbody>${resRows}</tbody>
            </table>
          </div>
        </section>

        <section class="rpt-section">
          <h4>8. Dynamic Spectral Behavior</h4>
          <ul class="rpt-bullets">${findingsHtml}</ul>
        </section>

        <section class="rpt-section">
          <h4>9. Dynamics &amp; Loudness</h4>
          <div class="rpt-grid">
            ${kvHtml('Integrated', loud.integrated != null ? `${n(loud.integrated)} LUFS` : '—')}
            ${kvHtml('Short-term max', loud.shortTermMax != null ? `${n(loud.shortTermMax)} LUFS` : '—')}
            ${kvHtml('Momentary max', loud.momentaryMax != null ? `${n(loud.momentaryMax)} LUFS` : '—')}
            ${kvHtml('LRA', loud.lra != null ? `${n(loud.lra)} LU` : '—')}
            ${kvHtml('Crest factor', dynamics.crestDb != null ? `${n(dynamics.crestDb)} dB` : '—')}
            ${kvHtml('Dynamic range', dynamics.dynamicRangeDb != null ? `${n(dynamics.dynamicRangeDb)} dB` : '—')}
            ${kvHtml('Phrases / consistency', `${phrase.detectedPhrases || 0} phrases · σ ${n(phrase.phraseStdDevDb)} dB · ${escapeHtml(phrase.verdict || '')}`)}
            ${kvHtml('Compression', escapeHtml(comp.requirement || '—'))}
          </div>
          <p class="rpt-note"><b>${escapeHtml(comp.style || '')}</b><br>Ratio ${escapeHtml(comp.suggestedRatio || '—')} · GR ${escapeHtml(comp.targetGR || '—')} · ${escapeHtml(comp.attackReleaseHint || '')}</p>
        </section>

        <section class="rpt-section">
          <h4>10. Vocal Events</h4>
          <div class="rpt-grid">
            ${kvHtml('Sibilance', `${sib.eventsCount || 0} events · ${escapeHtml(sib.severity || '—')} · ${sib.dominantFrequency ? fmtFreq(sib.dominantFrequency) : '—'}`)}
            ${kvHtml('Plosives', `${plo.eventsCount || 0} events · ${escapeHtml(plo.severity || '—')}`)}
            ${kvHtml('Breaths', `${breaths.eventsCount || 0} events`)}
            ${kvHtml('Clicks', `${clicks.eventsCount || (clicks.events || []).length || 0} events`)}
          </div>
          <p class="rpt-note">${escapeHtml(sib.recommendation || '')}</p>
          <p class="rpt-note">${escapeHtml(plo.recommendation || '')}</p>
          <p class="rpt-note">${escapeHtml(breaths.recommendation || '')}</p>
          <div class="event-chips-list">${eventChips(sib.events, 'sibilance')}${eventChips(plo.events, 'plosive')}${eventChips(breaths.events, 'breath')}${eventChips(clicks.events, 'click')}</div>
        </section>

        <section class="rpt-section">
          <h4>11. Stereo Image &amp; Phase</h4>
          <div class="rpt-grid">
            ${kvHtml('Layout', stereo.isStereo ? 'Stereo' : 'Mono')}
            ${kvHtml('Classification', escapeHtml(stereo.classification || '—'))}
            ${kvHtml('Correlation', stereo.correlation != null ? n(stereo.correlation, 3) : '—')}
            ${kvHtml('Width', stereo.stereoWidthPct != null ? n(stereo.stereoWidthPct) + '%' : '—')}
            ${kvHtml('Mono compatibility', escapeHtml(stereo.monoCompatibility || '—'))}
            ${kvHtml('Phase risk', escapeHtml(stereo.phaseRisk || '—'))}
          </div>
          <p class="rpt-note">${escapeHtml(stereo.note || '')}</p>
        </section>

        <section class="rpt-section">
          <h4>12. Mix Masking</h4>
          ${maskingHtml}
        </section>

        <section class="rpt-section">
          <h4>13. Reference Comparison</h4>
          ${refHtml}
        </section>

        <section class="rpt-section">
          <h4>14. Prioritized Recommendations</h4>
          <div class="rec-list">${recHtml || '<p class="rpt-empty">No corrective actions required.</p>'}</div>
        </section>

        <section class="rpt-section">
          <h4>15. Suggested EQ / Filter Plan</h4>
          <p class="rpt-lede">Plugin-agnostic. Use these measured frequencies, gains, and Q values in any parametric or dynamic EQ.</p>
          <div class="v-table-wrap">
            <table class="v-table">
              <thead><tr><th>Band</th><th>Frequency</th><th>Gain</th><th>Q</th><th>Shape</th><th>Mode</th><th>Reason</th></tr></thead>
              <tbody>${eqRows || '<tr><td colspan="7" style="text-align:center;padding:16px">No EQ bands proposed.</td></tr>'}</tbody>
            </table>
          </div>
        </section>

        <section class="rpt-section">
          <h4>16. Suggested Processing Chain</h4>
          <div class="v-table-wrap">
            <table class="v-table">
              <thead><tr><th>#</th><th>Stage</th><th>Status</th><th>Action</th><th>Tool class</th></tr></thead>
              <tbody>${chainRows}</tbody>
            </table>
          </div>
        </section>

        <footer class="rpt-foot">All measurements computed 100% locally in your browser. Audio never left this device.</footer>
      </article>
    `;
  }

  return {
    buildDetailedTextReport,
    buildDetailedHtmlReport
  };
}));
