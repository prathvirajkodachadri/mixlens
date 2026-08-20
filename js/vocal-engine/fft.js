'use strict';
/**
 * MixLens Vocal Engine 3.0 — Radix-2 FFT.
 * Power-of-two sizes only. Magnitude scaling: coherent-gain compensated Hann-friendly 2/N (DC 1/N).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEFft = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  class FFT {
    constructor(n) {
      if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of 2: ' + n);
      this.n = n;
      this.rev = new Uint32Array(n);
      const bits = Math.round(Math.log2(n));
      for (let i = 0; i < n; i++) {
        let x = i, r = 0;
        for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
        this.rev[i] = r;
      }
      this.cos = new Float32Array(n / 2);
      this.sin = new Float32Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        this.cos[i] = Math.cos(2 * Math.PI * i / n);
        this.sin[i] = Math.sin(2 * Math.PI * i / n);
      }
    }

    transform(re, im) {
      const n = this.n, rev = this.rev;
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1, step = n / len;
        for (let i = 0; i < n; i += len) {
          for (let k = 0; k < half; k++) {
            const c = this.cos[k * step], s = this.sin[k * step];
            const j = i + k + half;
            const tre = re[j] * c + im[j] * s;
            const tim = im[j] * c - re[j] * s;
            re[j] = re[i + k] - tre;
            im[j] = im[i + k] - tim;
            re[i + k] += tre;
            im[i + k] += tim;
          }
        }
      }
    }

    inverse(re, im) {
      const n = this.n;
      for (let i = 0; i < n; i++) im[i] = -im[i];
      this.transform(re, im);
      const invN = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= invN;
        im[i] = -im[i] * invN;
      }
    }

    powerSpectrum(re, im, out) {
      const half = this.n / 2;
      const res = out || new Float32Array(half);
      const norm = 1 / (this.n * this.n);
      for (let i = 0; i < half; i++) {
        res[i] = (re[i] * re[i] + im[i] * im[i]) * (i === 0 ? norm : 2 * norm);
      }
      return res;
    }

    magnitude(re, im, out) {
      const half = this.n / 2;
      const res = out || new Float32Array(half);
      const norm = 2 / this.n;
      for (let i = 0; i < half; i++) {
        res[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * (i === 0 ? (1 / this.n) : norm);
      }
      return res;
    }

    magnitudeDb(re, im, out, minDb) {
      const mag = this.magnitude(re, im, out);
      for (let i = 0; i < mag.length; i++) mag[i] = U.db20(mag[i], minDb);
      return mag;
    }
  }

  return { FFT };
}));
