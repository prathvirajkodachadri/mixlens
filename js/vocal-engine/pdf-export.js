'use strict';
/**
 * MixLens Vocal Engine 3.0 — Minimal PDF writer (Helvetica + optional JPEG images).
 * Browser-only for image embedding; Node can still produce a text-only PDF.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEPdf = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function pdfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function wrap(text, width) {
    const words = String(text).split(/\s+/);
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

  /**
   * @param {object} json
   * @param {object} [images] map name -> { data: Uint8Array, w, h } JPEG bytes
   */
  function buildPdf(json, images) {
    const pages = [];
    const imgs = images || {};
    const f = json.file || {};
    const ex = json.executive_summary || {};

    function addPage(lines, pageImages) {
      pages.push({ lines: lines, images: pageImages || [] });
    }

    let cover = [];
    cover.push({ text: 'MIXLENS', size: 22, y: 760 });
    cover.push({ text: 'VOCAL ENGINE 3.0', size: 16, y: 736 });
    cover.push({ text: 'Professional Vocal Analysis & Report Generator', size: 11, y: 716 });
    cover.push({ text: 'Evidence-Based Local DSP Analysis', size: 10, y: 700 });
    cover.push({ text: 'File: ' + (f.name || 'Untitled'), size: 12, y: 668 });
    cover.push({ text: 'Date: ' + (json.analysis_timestamp || ''), size: 10, y: 650 });
    cover.push({ text: 'Engine ' + json.engine_version + '  schema ' + json.schema_version + '  analysis ' + json.analysis_version, size: 10, y: 634 });
    cover.push({ text: 'Mix-Readiness: ' + (ex.mix_readiness != null ? ex.mix_readiness + '/100' : 'n/a'), size: 12, y: 604 });
    cover.push({ text: 'Recording Health: ' + (ex.recording_health != null ? ex.recording_health + '/100' : 'n/a'), size: 12, y: 584 });
    let y = 550;
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
    textPage('Technical / Loudness / Dynamics', [
      'Peak ' + tech.sample_peak_dbfs + ' dBFS · True Peak ' + tech.true_peak_dbtp + ' dBTP · RMS ' + tech.rms_dbfs + ' dBFS',
      'Integrated ' + (json.loudness && json.loudness.integrated_lufs) + ' LUFS · LRA ' + (json.loudness && json.loudness.lra_lu) + ' LU',
      'Crest ' + (json.dynamics && json.dynamics.crest_factor_db) + ' dB · Variation ' + (json.dynamics && json.dynamics.variation_db) + ' dB · ' + (json.dynamics && json.dynamics.classification),
      'Clipping: ' + (json.clipping && json.clipping.classification),
      json.dynamics && json.dynamics.evidence
    ].filter(Boolean));

    const zoneLines = (json.tonal_zones || []).map(function (z) {
      return z.name + ' ' + z.frequency_label + '  ' + z.energy_percent + '%  ' + (z.deviation_from_vocal_baseline_db == null ? 'n/a' : U.fmtDb(z.deviation_from_vocal_baseline_db)) + '  ' + z.status;
    });
    textPage('16-Zone Tonal Analysis', zoneLines);

    const resLines = (json.resonances || []).length
      ? json.resonances.map(function (r, i) {
        return '#' + (i + 1) + '  ' + r.frequency_hz + ' Hz  ' + U.fmtDb(r.peak_excess_db) + '  Q ' + r.q + '  persist ' + r.persistence + '%  conf ' + r.confidence + '%  ' + r.classification;
      })
      : ['No resonance candidates met the detection tests.'];
    textPage('Resonance / Sibilance / Events', resLines.concat([
      'Sibilance events: ' + (json.sibilance && json.sibilance.event_count) + '  dominant ' + (json.sibilance && json.sibilance.dominant_frequency_hz) + ' Hz  severity ' + (json.sibilance && json.sibilance.severity),
      'Plosives: ' + (json.plosives && json.plosives.event_count) + ' (strong ' + (json.plosives && json.plosives.strong_events) + ')',
      'Breaths: ' + (json.breaths && json.breaths.breath_count)
    ]));

    const obs = (json.engineering_observations || []).map(function (o) {
      return o.measurement + ' | ' + o.evidence + ' | ' + o.engineering_observation;
    });
    textPage('Engineering Observations', obs.length ? obs : ['None']);

    if (imgs.spectrum) addPage([{ text: 'Frequency Spectrum (20 Hz – 20 kHz, log)', size: 12, y: 760 }], [imgs.spectrum]);
    if (imgs.radar) addPage([{ text: 'Vocal Character Profile', size: 12, y: 760 }], [imgs.radar]);

    return assemble(pages);
  }

  function assemble(pages) {
    const objects = [];
    function add(str) { objects.push(str); return objects.length; }

    const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const imageIds = [];
    const pageIds = [];
    const contentIds = [];

    // We'll fill pages after images are numbered — first pass collect images.
    const imgObjs = [];
    pages.forEach(function (p) {
      p.images.forEach(function (im) {
        if (!im || !im.data) return;
        imgObjs.push(im);
      });
    });

    // Placeholder: we need sequential IDs. Build in two stages using offsets later.
    // Simpler approach: construct all objects in order: catalog, pages, page, contents, font, images.

    const chunks = [];
    const xref = [0];
    function pushObj(body) {
      const id = xref.length;
      const bytes = id + ' 0 obj\n' + body + '\nendobj\n';
      chunks.push(bytes);
      xref.push(0); // temp
      return id;
    }

    // reset
    chunks.length = 0;
    const offsets = [0];
    function emit(body) {
      const id = offsets.length;
      const s = id + ' 0 obj\n' + body + '\nendobj\n';
      offsets.push(-1);
      chunks.push(s);
      return id;
    }

    const font = emit('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    const imgIdsByKey = [];
    pages.forEach(function (p, pi) {
      p._imgIds = [];
      p.images.forEach(function (im) {
        if (!im || !im.data) return;
        const raw = im.data;
        const id = emit('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + raw.length + ' >>\nstream\n');
        // We'll splice binary after join — keep a marker.
        chunks[chunks.length - 1] = { kind: 'img', id: id, dictPrefix: id + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + raw.length + ' >>\nstream\n', data: raw, suffix: '\nendstream\nendobj\n' };
        p._imgIds.push(id);
      });
    });

    pages.forEach(function (p) {
      let stream = 'BT /F1 11 Tf 50 780 Td 0 -0 Td\n';
      // Use absolute Tm for each line.
      stream = 'BT\n';
      p.lines.forEach(function (ln) {
        stream += '/F1 ' + (ln.size || 10) + ' Tf\n1 0 0 1 48 ' + ln.y + ' Tm\n(' + pdfEscape(ln.text) + ') Tj\n';
      });
      stream += 'ET\n';
      p._imgIds.forEach(function (id, idx) {
        const im = p.images[idx];
        const maxW = 500;
        const maxH = 320;
        const scale = Math.min(maxW / im.w, maxH / im.h);
        const w = im.w * scale;
        const h = im.h * scale;
        const x = 48;
        const y = 80;
        stream += 'q\n' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x + ' ' + y + ' cm\n/Im' + id + ' Do\nQ\n';
      });
      const content = emit('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
      p._content = content;
    });

    const pageObjIds = [];
    pages.forEach(function (p) {
      let xobj = '';
      if (p._imgIds.length) {
        xobj = ' /XObject <<';
        p._imgIds.forEach(function (id) { xobj += ' /Im' + id + ' ' + id + ' 0 R'; });
        xobj += ' >>';
      }
      const pid = emit('<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Contents ' + p._content + ' 0 R /Resources << /Font << /F1 ' + font + ' 0 R >>' + xobj + ' >> >>');
      pageObjIds.push(pid);
    });

    const kids = pageObjIds.map(function (id) { return id + ' 0 R'; }).join(' ');
    const pagesId = emit('<< /Type /Pages /Count ' + pageObjIds.length + ' /Kids [' + kids + '] >>');

    // Patch parent reference
    for (let i = 0; i < chunks.length; i++) {
      if (typeof chunks[i] === 'string') chunks[i] = chunks[i].replace('/Parent PAGES', '/Parent ' + pagesId + ' 0 R');
    }

    const catalog = emit('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');

    // Build binary
    let out = '%PDF-1.4\n%\x80\x81\x82\x83\n';
    const off = [0];
    function append(s) {
      if (typeof s === 'string') {
        out += s;
      } else {
        // can't mix easily; we'll rebuild with byte array
      }
    }

    // Use byte-aware builder
    const parts = [];
    function pushStr(s) { parts.push(s); }

    // Recalculate offsets with a string+binary hybrid
    const binParts = [];
    function addPart(x) { binParts.push(x); }

    addPart('%PDF-1.4\n%\x80\x81\x82\x83\n');
    const objOffsets = [0];
    let pos = utf8Len('%PDF-1.4\n%\x80\x81\x82\x83\n');

    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      objOffsets.push(pos);
      if (typeof ch === 'string') {
        addPart(ch);
        pos += utf8Len(ch);
      } else {
        addPart(ch.dictPrefix);
        pos += utf8Len(ch.dictPrefix);
        addPart(ch.data);
        pos += ch.data.length;
        addPart(ch.suffix);
        pos += utf8Len(ch.suffix);
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

  return { buildPdf, canvasToJpeg };
}));
