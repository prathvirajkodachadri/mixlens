/* ============================================================
   VoxLens — vox-worklet.js
   AudioWorkletProcessor wrapping the pure-JS VoxChain DSP.
   Load order matters: `addModule('vox-dsp.js')` first, then this file
   (both execute in the same AudioWorkletGlobalScope).
   ============================================================ */
/* global VoxDSP, AudioWorkletProcessor, registerProcessor, sampleRate */

class VoxLensProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return VoxDSP.PARAM_DEFS.map(d => ({
      name: d.key,
      defaultValue: d.def,
      minValue: d.min,
      maxValue: d.max,
      automationRate: 'k-rate',
    }));
  }

  constructor() {
    super();
    this.chain = new VoxDSP.VoxChain(sampleRate, 2);
    this.scratch = [new Float32Array(128), new Float32Array(128)];
    this._p = VoxDSP.defaultParams();
    this._blocks = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output.length) return true;
    const n = output[0].length;

    // collect k-rate params into a plain object
    const p = this._p;
    const defs = VoxDSP.PARAM_DEFS;
    for (let i = 0; i < defs.length; i++) {
      const a = params[defs[i].key];
      if (a && a.length) p[defs[i].key] = a[0];
    }

    const nIn = input ? input.length : 0;
    if (nIn === 0) {
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      return true;
    }

    // copy into scratch, duplicating mono → stereo so the chain always sees 2 channels
    if (this.scratch[0].length < n) this.scratch = [new Float32Array(n), new Float32Array(n)];
    this.scratch[0].set(input[0].subarray(0, n));
    this.scratch[1].set(input[nIn > 1 ? 1 : 0].subarray(0, n));

    this.chain.setParams(p);
    const meters = this.chain.processBlock(this.scratch, n);

    for (let c = 0; c < output.length; c++) {
      const s = this.scratch[Math.min(c, 1)];
      output[c].set(s.subarray(0, n));
    }

    // ~30 Hz meter updates
    if (++this._blocks % 4 === 0) {
      this.port.postMessage({
        type: 'meters',
        inPk: meters.inPk, outPk: meters.outPk,
        gate: meters.gateGrDb, dss: meters.dssGrDb, cmp: meters.cmpGrDb, lim: meters.limGrDb,
      });
    }
    return true;
  }
}

registerProcessor('voxlens-chain', VoxLensProcessor);
