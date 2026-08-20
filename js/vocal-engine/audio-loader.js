'use strict';
/**
 * MixLens Vocal Engine 3.0 — Main-thread audio decode + WAV metadata.
 * Never uploads audio. Uses Web Audio decodeAudioData only.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEAudioLoader = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function formatFromName(name, mime) {
    const ext = extOf(name);
    const map = { wav: 'WAV', wave: 'WAV', mp3: 'MP3', flac: 'FLAC', m4a: 'M4A', aac: 'AAC', ogg: 'OGG', oga: 'OGG', aiff: 'AIFF', aif: 'AIFF' };
    if (map[ext]) return map[ext];
    if (mime && /wav/i.test(mime)) return 'WAV';
    if (mime && /mpeg|mp3/i.test(mime)) return 'MP3';
    if (mime && /flac/i.test(mime)) return 'FLAC';
    if (mime && /mp4|m4a|aac/i.test(mime)) return 'M4A/AAC';
    if (mime && /ogg/i.test(mime)) return 'OGG';
    if (mime && /aiff/i.test(mime)) return 'AIFF';
    return 'Not available';
  }

  function codecFrom(format, mime) {
    if (format === 'WAV') return 'PCM (container)';
    if (format === 'MP3') return 'MPEG-1/2 Layer III';
    if (format === 'FLAC') return 'FLAC';
    if (format === 'OGG') return 'Vorbis / Opus (container)';
    if (format === 'M4A' || format === 'AAC' || format === 'M4A/AAC') return 'AAC (if decoded by browser)';
    if (format === 'AIFF') return 'PCM (AIFF)';
    if (mime) return mime;
    return 'Not available';
  }

  function parseWavHeader(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8.length < 44) return { bitDepth: null };
    const ascii = function (o, n) {
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(u8[o + i]);
      return s;
    };
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return { bitDepth: null };
    let off = 12;
    let bitDepth = null;
    while (off + 8 <= u8.length) {
      const id = ascii(off, 4);
      const size = u8[off + 4] | (u8[off + 5] << 8) | (u8[off + 6] << 16) | (u8[off + 7] << 24);
      if (id === 'fmt ') {
        bitDepth = u8[off + 22] | (u8[off + 23] << 8);
      }
      off += 8 + size + (size % 2);
      if (id === 'fmt ') break;
    }
    return { bitDepth: bitDepth };
  }

  async function decodeFile(file, audioCtx) {
    if (!file) throw new Error('No file selected.');
    if (!file.size) throw new Error('Empty file.');
    const buf = await file.arrayBuffer();
    const format = formatFromName(file.name, file.type);
    let bitDepth = null;
    if (format === 'WAV') {
      const wav = parseWavHeader(buf);
      bitDepth = wav.bitDepth;
    }
    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(buf.slice(0));
    } catch (err) {
      throw new Error('Decoder failure. This browser could not decode the file (' + (format || 'unknown format') + ').');
    }
    if (!audioBuffer || !audioBuffer.length) throw new Error('Empty or corrupt file: no samples after decode.');
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
    return {
      audioBuffer: audioBuffer,
      left: left,
      right: right,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
      channels: audioBuffer.numberOfChannels,
      fileName: file.name,
      fileSize: file.size,
      format: format,
      codec: codecFrom(format, file.type || ''),
      bitDepth: bitDepth,
      mime: file.type || 'Not available'
    };
  }

  function cloneChannel(ch) {
    const copy = new Float32Array(ch.length);
    copy.set(ch);
    return copy;
  }

  function toTransferable(decoded) {
    const left = cloneChannel(decoded.left);
    const right = decoded.right ? cloneChannel(decoded.right) : null;
    return {
      payload: {
        left: left,
        right: right,
        sampleRate: decoded.sampleRate,
        fileName: decoded.fileName,
        fileSize: decoded.fileSize,
        format: decoded.format,
        codec: decoded.codec,
        bitDepth: decoded.bitDepth
      },
      transfer: right ? [left.buffer, right.buffer] : [left.buffer]
    };
  }

  return { decodeFile, parseWavHeader, formatFromName, toTransferable };
}));
