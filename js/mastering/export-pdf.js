'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Minimal PDF writer (Helvetica + optional JPEG images).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAPdf = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function pdfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function wrap(text, width) {
    const words = String(text == null ? '' : text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (let i = 0; i < words.length; i++) {
      const trial = cur ? cur + ' ' + words[i] : words[i];
      if (trial.length > width) {
        if (cur) lines.push(cur);
        cur = words[i];
      } else cur = trial;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function buildPdf(json, images) {
    const pages = [];
    const imgs = images || {};
    const f = json.file || {};
    const ex = json.executive_summary || {};
    const qc = json.qc_score || {};
    const pa = json.platform_analysis || {};

    function addPage(lines, pageImages) {
      pages.push({ lines: lines, images: pageImages || [] });
    }

    let cover = [];
    cover.push({ text: 'MIXLENS', size: 22, y: 760 });
    cover.push({ text: 'FINAL MASTERING ANALYSIS 1.0', size: 14, y: 738 });
    cover.push({ text: 'Professional Mastering QC & Platform Delivery Analyzer', size: 11, y: 718 });
    cover.push({ text: 'Local DSP Mastering Analysis Engine', size: 10, y: 702 });
    cover.push({ text: 'File: ' + (f.name || 'Untitled'), size: 12, y: 670 });
    cover.push({ text: 'Date: ' + (json.analysis_timestamp || ''), size: 10, y: 652 });
    cover.push({ text: 'Engine ' + json.engine_version + '  schema ' + json.schema_version, size: 10, y: 636 });
    cover.push({ text: 'QC Score: ' + (qc.score != null ? qc.score + '/100' : 'n/a'), size: 12, y: 606 });
    cover.push({ text: 'Delivery: ' + (json.delivery_status || 'n/a'), size: 12, y: 588 });
    cover.push({ text: 'Platform: ' + (pa.platform_name || 'n/a'), size: 11, y: 570 });
    let y = 540;
    (ex.major_findings || []).forEach(function (x) {
      wrap(x, 88).forEach(function (ln) {
        cover.push({ text: ln, size: 10, y: y });
        y -= 14;
      });
    });
    addPage(cover, imgs.cover ? [imgs.cover] : []);

    function textPage(title, blocks) {
      const lines = [{ text: title, size: 14, y: 760 }];
      let yy = 736;
      blocks.forEach(function (b) {
        wrap(b, 92).forEach(function (ln) {
          if (yy < 60) return;
          lines.push({ text: ln, size: 10, y: yy });
          yy -= 13;
        });
        yy -= 4;
      });
      addPage(lines, []);
    }

    const tech = json.technical || {};
    const ld = json.loudness || {};
    const tp = json.true_peak || {};
    textPage('Technical / Loudness / True Peak', [
      'Peak ' + tech.sample_peak_dbfs + ' dBFS · Estimated True Peak ' + tech.true_peak_dbtp + ' dBTP · RMS ' + tech.rms_dbfs + ' dBFS',
      'Integrated ' + ld.integrated_lufs + ' LUFS · ST max ' + ld.short_term_max_lufs + ' · Mom max ' + ld.momentary_max_lufs + ' · LRA ' + ld.lra_lu + ' LU',
      'Crest ' + (json.dynamics && json.dynamics.crest_factor_db) + ' dB · PLR ' + (json.dynamics && json.dynamics.peak_to_loudness_ratio_db) + ' dB · ' + (json.dynamics && json.dynamics.dynamic_character),
      'Clipping: ' + (json.clipping && json.clipping.classification) + ' · events ' + (json.clipping && json.clipping.event_count),
      'True peak events: ' + tp.event_count + ' · ISP difference ' + tp.inter_sample_difference_db + ' dB'
    ]);

    const zoneLines = (json.spectrum && json.spectrum.regions || []).map(function (z) {
      return z.name + '  ' + z.energy_percent + '%  (pink share ' + z.expected_pink_percent + '%)  ' + z.status;
    });
    textPage('Tonal Balance', zoneLines.length ? zoneLines : ['Not available']);

    const st = json.stereo || {};
    const ph = json.phase || {};
    const mo = json.mono_compatibility || {};
    textPage('Stereo / Phase / Mono', [
      st.applicable ? ('L/R RMS ' + st.l_rms_dbfs + ' / ' + st.r_rms_dbfs + ' dBFS · balance ' + st.lr_balance_db + ' dB') : (st.note || 'Mono'),
      'Correlation ' + ph.correlation + ' · ' + ph.interpretation,
      'Width ' + st.stereo_width_label + ' (' + st.stereo_width_percent + '% side)',
      'Mono compatibility: ' + mo.rating + ' · energy ratio ' + mo.energy_ratio
    ]);

    const platLines = (json.platform_comparison || []).map(function (row) {
      return row.platform_name + '  LUFS ' + row.measured_lufs + ' vs ref ' + row.loudness_reference_lufs +
        '  d ' + row.loudness_difference_lu + '  TP ' + row.measured_true_peak_dbtp + '  ' + row.status;
    });
    textPage('Platform Comparison (reference profiles)', platLines.concat([
      ProfilesDisclaimer(json)
    ]));

    const obs = (json.engineering_observations || []).map(function (o) {
      return o.measurement + ' | ' + o.evidence + ' | ' + o.engineering_observation;
    });
    textPage('Engineering Observations', obs.length ? obs : ['None']);

    textPage('Disclaimer', [json.disclaimer || '']);

    if (imgs.spectrum) addPage([{ text: 'Frequency Spectrum (20 Hz – 20 kHz, log)', size: 12, y: 760 }], [imgs.spectrum]);
    if (imgs.loudness) addPage([{ text: 'Loudness Timeline (short-term LUFS)', size: 12, y: 760 }], [imgs.loudness]);
    if (imgs.waveform) addPage([{ text: 'Waveform', size: 12, y: 760 }], [imgs.waveform]);

    return assemble(pages);
  }

  function ProfilesDisclaimer(json) {
    return json.disclaimer || 'Platform values are reference profiles and may change.';
  }

  function assemble(pages) {
    const chunks = [];
    function emit(body) {
      const id = chunks.length + 1;
      chunks.push(id + ' 0 obj\n' + body + '\nendobj\n');
      return id;
    }

    /* Rebuild with mixed binary support */
    const parts = [];
    const font = { kind: 'str' };

    const imgSlots = [];
    pages.forEach(function (p) {
      p._imgs = [];
      (p.images || []).forEach(function (im) {
        if (!im || !im.data) return;
        p._imgs.push(im);
      });
    });

    const objects = [];
    function addObj(item) {
      objects.push(item);
      return objects.length;
    }

    const fontId = addObj({ type: 'str', body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });

    pages.forEach(function (p) {
      p._imgIds = [];
      p._imgs.forEach(function (im) {
        const id = addObj({
          type: 'img',
          im: im
        });
        p._imgIds.push(id);
      });
    });

    pages.forEach(function (p) {
      let stream = 'BT\n';
      p.lines.forEach(function (ln) {
        stream += '/F1 ' + (ln.size || 10) + ' Tf\n1 0 0 1 48 ' + ln.y + ' Tm\n(' + pdfEscape(ln.text) + ') Tj\n';
      });
      stream += 'ET\n';
      p._imgIds.forEach(function (id, idx) {
        const im = p._imgs[idx];
        const maxW = 500;
        const maxH = 320;
        const scale = Math.min(maxW / im.w, maxH / im.h);
        const w = im.w * scale;
        const h = im.h * scale;
        stream += 'q\n' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' 48 80 cm\n/Im' + id + ' Do\nQ\n';
      });
      p._content = addObj({ type: 'str', body: '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream' });
    });

    const pageIds = [];
    pages.forEach(function (p) {
      let xobj = '';
      if (p._imgIds.length) {
        xobj = ' /XObject <<';
        p._imgIds.forEach(function (id) { xobj += ' /Im' + id + ' ' + id + ' 0 R'; });
        xobj += ' >>';
      }
      const pid = addObj({
        type: 'str',
        body: '<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Contents ' + p._content + ' 0 R /Resources << /Font << /F1 ' + fontId + ' 0 R >>' + xobj + ' >> >>'
      });
      pageIds.push(pid);
    });

    const kids = pageIds.map(function (id) { return id + ' 0 R'; }).join(' ');
    const pagesId = addObj({ type: 'str', body: '<< /Type /Pages /Count ' + pageIds.length + ' /Kids [' + kids + '] >>' });
    objects.forEach(function (o) {
      if (o.type === 'str') o.body = o.body.replace('/Parent PAGES', '/Parent ' + pagesId + ' 0 R');
    });
    const catalog = addObj({ type: 'str', body: '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>' });

    const binParts = [];
    function addPart(x) { binParts.push(x); }
    addPart('%PDF-1.4\n%\x80\x81\x82\x83\n');
    const objOffsets = [0];
    let pos = utf8Len('%PDF-1.4\n%\x80\x81\x82\x83\n');

    for (let i = 0; i < objects.length; i++) {
      const id = i + 1;
      const o = objects[i];
      objOffsets.push(pos);
      if (o.type === 'img') {
        const im = o.im;
        const raw = im.data;
        const prefix = id + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + raw.length + ' >>\nstream\n';
        const suffix = '\nendstream\nendobj\n';
        addPart(prefix);
        pos += utf8Len(prefix);
        addPart(raw);
        pos += raw.length;
        addPart(suffix);
        pos += utf8Len(suffix);
      } else {
        const s = id + ' 0 obj\n' + o.body + '\nendobj\n';
        addPart(s);
        pos += utf8Len(s);
      }
    }

    const xrefPos = pos;
    let xrefStr = 'xref\n0 ' + objOffsets.length + '\n';
    xrefStr += '0000000000 65535 f \n';
    for (let i = 1; i < objOffsets.length; i++) {
      xrefStr += String(objOffsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xrefStr += 'trailer\n<< /Size ' + objOffsets.length + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
    addPart(xrefStr);
    return concatParts(binParts);
  }

  function utf8Len(s) {
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(s, 'utf8');
    return new TextEncoder().encode(s).length;
  }

  function concatParts(parts) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.concat(parts.map(function (p) {
        if (typeof p === 'string') return Buffer.from(p, 'utf8');
        if (p instanceof Uint8Array) return Buffer.from(p);
        return Buffer.from(p);
      }));
    }
    const enc = new TextEncoder();
    const bins = parts.map(function (p) {
      if (typeof p === 'string') return enc.encode(p);
      return p instanceof Uint8Array ? p : new Uint8Array(p);
    });
    let n = 0;
    bins.forEach(function (b) { n += b.length; });
    const out = new Uint8Array(n);
    let o = 0;
    bins.forEach(function (b) { out.set(b, o); o += b.length; });
    return out;
  }

  async function canvasToJpeg(canvas, quality) {
    return new Promise(function (resolve) {
      if (!canvas || !canvas.toBlob) return resolve(null);
      canvas.toBlob(function (blob) {
        if (!blob) return resolve(null);
        blob.arrayBuffer().then(function (ab) {
          resolve({ data: new Uint8Array(ab), w: canvas.width, h: canvas.height });
        });
      }, 'image/jpeg', quality || 0.82);
    });
  }

  return { buildPdf: buildPdf, canvasToJpeg: canvasToJpeg };
}));
