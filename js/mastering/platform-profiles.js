'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Platform reference profiles.
 *
 * IMPORTANT
 * ---------
 * Platform values are REFERENCE PROFILES and may change.
 * Verify current platform documentation before final commercial delivery.
 *
 * These numbers are NOT mandatory mastering requirements.
 * Loudness normalization policies differ by playback mode, codec, content type,
 * device, region, and service configuration.
 *
 * This module is the single source of truth. Do not hard-code LUFS / true-peak
 * targets elsewhere in the application.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MAPlatformProfiles = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const DISCLAIMER =
    'Platform normalization is playback-dependent. This analysis compares your master against the selected reference profile; it does not guarantee platform playback loudness.';

  /**
   * loudness_reference_lufs  — typical loudness-normalization aim / published reference (LUFS).
   * true_peak_reference_dbtp — commonly cited delivery ceiling (dBTP).
   * normalizes             — whether the service is generally known to apply loudness normalization.
   * All fields are editable here.
   */
  const PROFILES = {
    spotify: {
      id: 'spotify',
      name: 'Spotify',
      loudness_reference_lufs: -14,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 16,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'Reference target; platform playback normalization may vary by loudness mode and catalog encoding.'
    },
    apple_music: {
      id: 'apple_music',
      name: 'Apple Music',
      loudness_reference_lufs: -16,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 24,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'Sound Check reference. Spatial / lossless playback is not modelled here.'
    },
    youtube: {
      id: 'youtube',
      name: 'YouTube',
      loudness_reference_lufs: -14,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 48000,
      recommended_bit_depth: 24,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'Reference target for typical YouTube loudness normalization. Codec and player behaviour vary.'
    },
    youtube_music: {
      id: 'youtube_music',
      name: 'YouTube Music',
      loudness_reference_lufs: -14,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 16,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'Treated similarly to YouTube’s published loudness reference. Not a separate official mastering mandate.'
    },
    amazon_music: {
      id: 'amazon_music',
      name: 'Amazon Music',
      loudness_reference_lufs: -14,
      true_peak_reference_dbtp: -2,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 24,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'Reference profile. Amazon has cited different ceilings by quality tier; confirm current delivery docs.'
    },
    tidal: {
      id: 'tidal',
      name: 'TIDAL',
      loudness_reference_lufs: -14,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 24,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'Reference target. HiFi / Master / Atmos paths are not modelled separately.'
    },
    deezer: {
      id: 'deezer',
      name: 'Deezer',
      loudness_reference_lufs: -15,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 16,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'Reference profile based on commonly cited Deezer loudness normalization.'
    },
    soundcloud: {
      id: 'soundcloud',
      name: 'SoundCloud',
      loudness_reference_lufs: -14,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 16,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'SoundCloud normalization has changed over time. Treat this as a configurable reference only.'
    },
    bandcamp: {
      id: 'bandcamp',
      name: 'Bandcamp',
      loudness_reference_lufs: null,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 24,
      channels: 'stereo_or_mono',
      normalizes: false,
      notes: 'Bandcamp typically does not apply loudness normalization. Loudness reference is omitted; true-peak ceiling is a technical suggestion only.'
    },
    podcast: {
      id: 'podcast',
      name: 'Podcast / General Digital',
      loudness_reference_lufs: -16,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 44100,
      recommended_bit_depth: 16,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'General digital / podcast reference (often −16 LUFS). Programme loudness targets vary by network.'
    },
    broadcast: {
      id: 'broadcast',
      name: 'Broadcast / Custom',
      loudness_reference_lufs: -23,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 48000,
      recommended_bit_depth: 24,
      channels: 'stereo_or_mono',
      normalizes: true,
      notes: 'EBU R128 broadcast reference (−23 LUFS). ATSC A/85 uses −24 LKFS. Confirm the delivery specification.'
    },
    custom: {
      id: 'custom',
      name: 'Custom Target',
      loudness_reference_lufs: -14,
      true_peak_reference_dbtp: -1,
      recommended_sample_rate_hz: 48000,
      recommended_bit_depth: 24,
      channels: 'stereo_or_mono',
      normalizes: false,
      notes: 'User-configurable delivery target. Values are set in the Custom Target panel.'
    }
  };

  const ORDER = [
    'spotify', 'apple_music', 'youtube', 'youtube_music', 'amazon_music',
    'tidal', 'deezer', 'soundcloud', 'bandcamp', 'podcast', 'broadcast', 'custom'
  ];

  function list() {
    return ORDER.map(function (id) { return PROFILES[id]; }).filter(Boolean);
  }

  function get(id) {
    return PROFILES[id] || PROFILES.spotify;
  }

  function clone(id) {
    const p = get(id);
    const out = {};
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    return out;
  }

  return {
    PROFILES: PROFILES,
    ORDER: ORDER,
    DISCLAIMER: DISCLAIMER,
    list: list,
    get: get,
    clone: clone
  };
}));
