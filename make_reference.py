#!/usr/bin/env python3
"""Generate reference test signals + compute ground-truth EBU R128 LUFS with pyloudnorm."""
import json, numpy as np, soundfile as sf, pyloudnorm as pyln

import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ref")
os.makedirs(OUT, exist_ok=True)

rng = np.random.default_rng(42)

def save(name, data, rate):
    path = f"{OUT}/{name}.wav"
    sf.write(path, data.astype(np.float32), rate, subtype="FLOAT")
    meter = pyln.Meter(rate)
    arr = data if data.ndim > 1 else data
    lufs = meter.integrated_loudness(arr)
    return {"path": os.path.join("ref", f"{name}.wav"), "rate": rate, "lufs": float(lufs),
            "channels": int(data.shape[1]) if data.ndim > 1 else 1,
            "samples": int(data.shape[0])}

results = {}

rate = 48000
t = np.arange(rate * 6) / rate

# 1. 1 kHz sine at -23 dBFS (EBU calibration tone; should read ~-23 LUFS)
amp = 10 ** (-23 / 20)
sine = amp * np.sin(2 * np.pi * 1000 * t)
results["sine_1k"] = save("sine_1k", sine, rate)

# 2. Pink noise, moderate level
white = rng.standard_normal(len(t))
# simple pink via cumulative filter (Paul Kellet approx)
b0=b1=b2=b3=b4=b5=b6=0.0
pink = np.empty(len(t))
for i, w in enumerate(white):
    b0 = 0.99886*b0 + w*0.0555179
    b1 = 0.99332*b1 + w*0.0750759
    b2 = 0.96900*b2 + w*0.1538520
    b3 = 0.86650*b3 + w*0.3104856
    b4 = 0.55000*b4 + w*0.5329522
    b5 = -0.7616*b5 - w*0.0168980
    pink[i] = b0+b1+b2+b3+b4+b5+b6 + w*0.5362
pink *= 0.11 * 0.15
results["pink"] = save("pink", pink, rate)

# 3. Speech-like: harmonic stack with AM + formant-ish emphasis, varied level
f0 = 110
sig = np.zeros(len(t))
for k in range(1, 15):
    sig += (1.0 / k**1.3) * np.sin(2*np.pi*f0*k*t + rng.random()*6.28)
sig *= (0.6 + 0.4*np.sin(2*np.pi*3.2*t))  # syllable AM
sig *= 0.10
results["speech"] = save("speech", sig, rate)

# 4. Dynamic: loud / soft alternating 6 dB, 5s segments (3s LRA windows resolve them)
seglen = 5
tn = np.arange(rate * seglen * 6) / rate
dyn = np.zeros(len(tn))
seg = rate * seglen
for i in range(6):
    lvl = 0.4 if i % 2 == 0 else 0.2
    dyn[i*seg:(i+1)*seg] = lvl * np.sin(2*np.pi*440*tn[i*seg:(i+1)*seg])
results["dynamic"] = save("dynamic", dyn, rate)

# 5. Stereo music-like (correlated stereo, multi-tone)
st = np.zeros((len(t), 2))
for f in [80, 160, 320, 640, 1250, 2500]:
    st[:,0] += np.sin(2*np.pi*f*t) * (1.0/f**0.5)
    st[:,1] += np.sin(2*np.pi*f*t + 0.3) * (1.0/f**0.5)
st *= 0.12
results["stereo"] = save("stereo", st, rate)

# 6. 44.1 kHz variant (sample-rate handling)
t44 = np.arange(44100 * 5) / 44100
s44 = 10**(-20/20) * np.sin(2*np.pi*997*t44)
results["sine441"] = save("sine_441", s44, 44100)

with open(f"{OUT}/reference.json", "w") as f:
    json.dump(results, f, indent=2)

for k, v in results.items():
    print(f"{k:9s} rate={v['rate']} ch={v['channels']} LUFS={v['lufs']:.2f}")
