# Síntesis por lotes con Piper TTS (lo llama scripts/assets/voces.mjs).
# Uso: python voces_piper.py trabajos.json
# trabajos.json = [{modelPath, espeak?, speaker?, lengthScale, noiseScale,
#                   noiseW, gap, text, out}]
# Escribe cada `out` como WAV mono de 16 bits e imprime una línea JSON por
# trabajo terminado. Carga cada modelo una sola vez.

import json
import os
import sys
import wave

import numpy as np
import onnxruntime

# Pocos hilos: la máquina se comparte (VOCES_THREADS, por defecto 2).
_SessionOptions = onnxruntime.SessionOptions


def _session_options():
    o = _SessionOptions()
    o.intra_op_num_threads = int(os.environ.get("VOCES_THREADS", "2"))
    o.inter_op_num_threads = 1
    return o


onnxruntime.SessionOptions = _session_options

from piper import PiperVoice, SynthesisConfig  # noqa: E402


def synth(v, text, cfg, gap):
    parts = []
    sr = v.config.sample_rate
    for chunk in v.synthesize(text, syn_config=cfg):
        sr = chunk.sample_rate
        if parts:  # pausa corta entre frases ("¡Tírese al piso! ¡Al piso!")
            parts.append(np.zeros(int(sr * gap), dtype=np.float32))
        parts.append(chunk.audio_float_array.astype(np.float32))
    return (np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32)), sr


def cut_tail(x, sr):
    """¿Termina con voz fuerte? (último 10 ms a menos de 12 dB del tramo más fuerte)."""
    w = int(sr * 0.01)
    n = len(x) // w
    if n < 4:
        return False
    r = np.sqrt(np.mean(x[: n * w].reshape(n, w) ** 2, axis=1))
    return r[-1] > r.max() * 0.25


def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    voices = {}
    for j in jobs:
        v = voices.get(j["modelPath"])
        if v is None:
            v = voices[j["modelPath"]] = PiperVoice.load(j["modelPath"])
            v.default_espeak = v.config.espeak_voice
        # 'es-419' en los modelos de España: seseo como en Medellín.
        v.config.espeak_voice = j.get("espeak") or v.default_espeak
        cfg = SynthesisConfig(
            speaker_id=j.get("speaker"),
            length_scale=j["lengthScale"],
            noise_scale=j["noiseScale"],
            noise_w_scale=j["noiseW"],
        )
        # A veces el modelo corta la última sílaba (termina con la voz a todo
        # volumen): se repite (la síntesis tiene ruido: cada intento cambia) y,
        # si insiste, se le agrega una pausa al final del texto.
        for attempt in range(6):
            text = j["text"] if attempt < 3 else j["text"] + " ..."
            audio, sr = synth(v, text, cfg, j.get("gap", 0.14))
            if not cut_tail(audio, sr):
                break
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
        os.makedirs(os.path.dirname(j["out"]), exist_ok=True)
        tmp = j["out"] + ".tmp"
        with wave.open(tmp, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(pcm.tobytes())
        os.replace(tmp, j["out"])
        print(json.dumps({"out": j["out"], "seconds": round(len(pcm) / sr, 3)}), flush=True)


if __name__ == "__main__":
    main()
