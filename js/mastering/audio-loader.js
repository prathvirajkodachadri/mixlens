'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Local decode + WAV/AIFF metadata.
 * Never uploads audio. Uses Web Audio decodeAudioData only.
 * Bit depth is reported only when the container header provides it. Never invented.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAAudioLoader = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function formatFromName(name, mime) {
    const ext = extOf(name);
    const map = {
      wav: 'WAV', wave: 'WAV', mp3: 'MP3', flac: 'FLAC', m4a: 'M4A', aac: 'AAC',
      ogg: 'OGG', oga: 'OGG', aiff: 'AIFF', aif: 'AIFF'
    };
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

  function readU16LE(u8, o) { return u8[o] | (u8[o + 1] << 8); }
  function readU16BE(u8, o) { return (u8[o] << 8) | u8[o + 1]; }
  function readU32LE(u8, o) { return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0; }
  function readU32BE(u8, o) { return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0; }

  function ascii(u8, o, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8[o + i]);
    return s;
  }

  function parseWavHeader(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8.length < 44) return { bitDepth: null, wavSampleRate: null, wavChannels: null };
    if (ascii(u8, 0, 4) !== 'RIFF' || ascii(u8, 8, 4) !== 'WAVE') {
      return { bitDepth: null, wavSampleRate: null, wavChannels: null };
    }
    let off = 12;
    let bitDepth = null, wavSampleRate = null, wavChannels = null;
    while (off + 8 <= u8.length) {
      const id = ascii(u8, off, 4);
      const size = readU32LE(u8, off + 4);
      if (id === 'fmt ') {
        wavChannels = readU16LE(u8, off + 10);
        wavSampleRate = readU32LE(u8, off + 12);
        bitDepth = readU16LE(u8, off + 22);
      }
      off += 8 + size + (size % 2);
      if (id === 'fmt ') break;
    }
    return { bitDepth: bitDepth, wavSampleRate: wavSampleRate, wavChannels: wavChannels };
  }

  function parseAiffHeader(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8.length < 54) return { bitDepth: null };
    const form = ascii(u8, 0, 4);
    const kind = ascii(u8, 8, 4);
    if (form !== 'FORM' || (kind !== 'AIFF' && kind !== 'AIFC')) return { bitDepth: null };
    let off = 12;
    let bitDepth = null;
    while (off + 8 <= u8.length) {
      const id = ascii(u8, off, 4);
      const size = readU32BE(u8, off + 4);
      if (id === 'COMM') {
        bitDepth = readU16BE(u8, off + 16);
      }
      off += 8 + size + (size % 2);
      if (id === 'COMM') break;
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
    } else if (format === 'AIFF') {
      const aiff = parseAiffHeader(buf);
      bitDepth = aiff.bitDepth;
    }
    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(buf.slice(0));
    } catch (err) {
      throw new Error('Unable to decode this file in the current browser (' + (format || 'unknown format') + ').');
    }
    if (!audioBuffer || !audioBuffer.length) throw new Error('Empty or corrupt file: no samples after decode.');
    const channels = audioBuffer.numberOfChannels;
    if (channels > 2) {
      /* Multichannel is analyzed as the first two channels. Remaining channels are not mixed. */
    }
    const left = audioBuffer.getChannelData(0);
    const right = channels > 1 ? audioBuffer.getChannelData(1) : null;
    return {
      audioBuffer: audioBuffer,
      left: left,
      right: right,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
      channels: channels,
      fileName: file.name,
      fileSize: file.size,
      format: format,
      codec: codecFrom(format, file.type || ''),
      bitDepth: bitDepth,
      mime: file.type || 'Not available',
      multichannel_note: channels > 2
        ? 'Browser decoded ' + channels + ' channels. Analysis uses channels 1–2 only.'
        : null
    };
  }

  return { decodeFile: decodeFile, parseWavHeader: parseWavHeader, parseAiffHeader: parseAiffHeader, formatFromName: formatFromName };
}));
