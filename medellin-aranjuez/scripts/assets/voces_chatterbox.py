# Síntesis por lotes con Chatterbox Multilingual (Resemble AI, MIT) clonando
# voces colombianas de OpenSLR 72. Lo llama scripts/assets/voces.mjs.
#
#   python voces_chatterbox.py refs <refs.json>
#       refs.json = {"<voz>": {"clips": ["<wav>", ...], "out": "<wav>"}}
#       Arma la referencia de cada voz: recorta silencios, une los clips con
#       pausas cortas (máx. 10 s, lo que usa el modelo) y normaliza el nivel.
#
#   python voces_chatterbox.py synth <trabajos.json>
#       trabajos.json = [{ref, text, exaggeration, cfg, temperature, seed, out}]
#       Escribe cada `out` como WAV mono 16 bits a 24 kHz e imprime una línea
#       JSON por trabajo. Prepara el condicionamiento una vez por (ref, exag.).
#
# Hilos de CPU: VOCES_THREADS (por defecto, todos).

import json
import os
import sys
import wave

import numpy as np


def write_wav(path, x, sr):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    os.replace(tmp, path)


def build_refs(spec):
    import librosa

    sr = 24000
    for vid, r in spec.items():
        parts = []
        total = 0
        for clip in r["clips"]:
            y, _ = librosa.load(clip, sr=sr)
            y, _ = librosa.effects.trim(y, top_db=35)
            if parts:
                parts.append(np.zeros(int(sr * 0.3), dtype=np.float32))
            parts.append(y)
            total += len(y)
            if total > sr * 10:
                break
        y = np.concatenate(parts)[: sr * 10]
        y = y / (np.sqrt(np.mean(y**2)) + 1e-9) * 10 ** (-20 / 20)
        y = y * min(1, 0.95 / np.max(np.abs(y)))
        write_wav(r["out"], y, sr)
        print(json.dumps({"voice": vid, "seconds": round(len(y) / sr, 2)}), flush=True)


def tail_cut(x, sr):
    """¿Termina con voz fuerte? (último 10 ms a menos de 12 dB del tramo más fuerte)."""
    w = int(sr * 0.01)
    n = len(x) // w
    if n < 4:
        return False
    r = np.sqrt(np.mean(x[: n * w].reshape(n, w) ** 2, axis=1))
    return r[-1] > r.max() * 0.25


def synth(jobs):
    import torch

    torch.set_num_threads(int(os.environ.get("VOCES_THREADS", os.cpu_count() or 4)))
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    model = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
    sr = model.sr
    # Agrupar por referencia y exageración: el condicionamiento es lo caro.
    jobs = sorted(jobs, key=lambda j: (j["ref"], j["exaggeration"]))
    cond_key = None
    for j in jobs:
        key = (j["ref"], j["exaggeration"])
        if key != cond_key:
            model.prepare_conditionals(j["ref"], exaggeration=j["exaggeration"])
            cond_key = key
        # Duración esperada (≈ 13 caracteres por segundo) para detectar
        # alucinaciones (audio de más) o cortes; si pasa, otra semilla.
        expect = len(j["text"]) / 13 + 0.4
        best = None
        for attempt in range(3):
            torch.manual_seed(j["seed"] + 1000 * attempt)
            wav = model.generate(
                j["text"],
                language_id="es",
                exaggeration=j["exaggeration"],
                cfg_weight=j["cfg"],
                temperature=j["temperature"],
            )
            x = wav.squeeze(0).numpy().astype(np.float32)
            d = len(x) / sr
            ok = expect * 0.45 < d < expect * 2.2 + 0.8 and not tail_cut(x, sr)
            score = abs(np.log(max(d, 0.05) / expect))
            if best is None or score < best[0]:
                best = (score, x, attempt, ok)
            if ok:
                break
        _, x, attempt, ok = best
        write_wav(j["out"], x, sr)
        print(json.dumps({"out": j["out"], "seconds": round(len(x) / sr, 3), "attempt": attempt, "ok": ok}), flush=True)


def main():
    mode, file = sys.argv[1], sys.argv[2]
    data = json.load(open(file, encoding="utf-8"))
    if mode == "refs":
        build_refs(data)
    else:
        synth(data)


if __name__ == "__main__":
    main()
