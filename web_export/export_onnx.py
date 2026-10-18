# export_onnx.py — Proje 2: export the speaker model to ONNX for the browser (onnxruntime-web).
#
# Copy this whole file into one notebook cell (or `from export_onnx import *`).
# Extra deps on top of the course env (verified: does NOT change torch 2.6.0 / numpy 1.26.4):
#     pip install onnx==1.23.2 onnxruntime==1.31.0
#
# Model B (frozen ECAPA + your small classifier):
#     files = export_model_b(ecapa, head, names, out_dir="web_model", check_windows=X_test[:200])
#       -> web_model/model_b.onnx        fp32, ~84 MB  waveform[B,32000] -> probs[B,N], embedding[B,192]
#       -> web_model/model_b.fp16.onnx   fp16-stored weights, ~43 MB, same accuracy (cos >= 0.99999) <- recommended
#       -> web_model/model_b.int8.onnx   int8 weights, ~22 MB, embedding cos ~0.98-0.99 vs fp32
#       -> web_model/labels.json
# Model A (log-mel CNN from scratch):
#     export_model_a(mel, cnn, names, out_dir="web_model_a", log_fn=lambda m: torch.log(m + 1e-6))
#
# Why not just torch.onnx.export(ecapa...)? SpeechBrain's Fbank and torchaudio's MelSpectrogram call
# torch.stft(return_complex=True); the default (TorchScript) exporter fails with
# "STFT does not currently support complex types", and dynamo=True fails on SpeechBrain's
# InputNormalization / ECAPA BatchNorm (torch 2.6). We rebuild the exact same feature step with a
# Conv1d whose kernels are the windowed DFT basis, so the whole pipeline
# (raw samples -> features -> network -> softmax) is ONE graph and the browser only feeds samples.
import json, math, os
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SR = 16000
WIN_SAMPLES = 2 * SR  # the model always sees exactly 2 s = 32000 samples


def _dft_kernel(n_fft, window):
    """Conv1d weights [2*(n_fft//2+1), 1, n_fft]: rows 0..F-1 = real part, F..2F-1 = imag part."""
    win = window.detach().double().cpu()
    if len(win) < n_fft:  # torch.stft centres a shorter window inside n_fft
        left = (n_fft - len(win)) // 2
        win = F.pad(win, (left, n_fft - len(win) - left))
    k = torch.arange(n_fft // 2 + 1, dtype=torch.float64)[:, None]
    n = torch.arange(n_fft, dtype=torch.float64)[None, :]
    ang = 2 * math.pi * k * n / n_fft
    real, imag = torch.cos(ang) * win, -torch.sin(ang) * win
    return torch.cat([real, imag], 0).float().unsqueeze(1)


class _PowerSpec(nn.Module):
    """|STFT|^2 as [B, n_freq, T] using Conv1d (export friendly, no complex numbers)."""

    def __init__(self, n_fft, hop, window, center, pad_mode):
        super().__init__()
        self.n_fft, self.hop, self.center, self.pad_mode = n_fft, hop, center, pad_mode
        self.register_buffer("kernel", _dft_kernel(n_fft, window))
        self.nf = n_fft // 2 + 1

    def forward(self, wav):  # [B, L]
        x = wav.unsqueeze(1)
        if self.center:
            p = self.n_fft // 2
            x = F.pad(x, (p, p), mode=self.pad_mode)  # "constant" (SpeechBrain) or "reflect" (torchaudio)
        y = F.conv1d(x, self.kernel, stride=self.hop)  # [B, 2F, T]
        re, im = y[:, : self.nf], y[:, self.nf:]
        return re * re + im * im


class SpeechBrainFbankONNX(nn.Module):
    """Same output as speechbrain.lobes.features.Fbank (+ InputNormalization 'sentence') for full-length input."""

    def __init__(self, fbank, mean_var_norm=None):
        super().__init__()
        st, fb = fbank.compute_STFT, fbank.compute_fbanks
        assert not fbank.deltas and not fbank.context, "deltas/context not supported"
        assert not st.normalized_stft and st.onesided
        self.spec = _PowerSpec(st.n_fft, st.hop_length, st.window, st.center, st.pad_mode)
        # Read the exact (frozen) mel matrix out of SpeechBrain's Filterbank by feeding it an identity.
        with torch.no_grad():
            was = fb.log_mel
            fb.log_mel = False
            try:
                M = fb(torch.eye(self.spec.nf).unsqueeze(0))[0]  # [n_freq, n_mels]
            finally:
                fb.log_mel = was
        self.register_buffer("mel", M.float().contiguous())
        self.log_mel = fb.log_mel
        self.amin, self.top_db = float(fb.amin), float(fb.top_db)
        self.mult, self.db_mult = float(fb.multiplier), float(fb.db_multiplier)
        self.mean_norm = mean_var_norm is not None and mean_var_norm.mean_norm
        self.std_norm = mean_var_norm is not None and mean_var_norm.std_norm
        self.eps = float(mean_var_norm.eps) if mean_var_norm is not None else 1e-10
        if mean_var_norm is not None:
            assert mean_var_norm.norm_type == "sentence"

    def forward(self, wav):  # [B, 32000] -> [B, T, n_mels]
        p = self.spec(wav).transpose(1, 2)  # [B, T, n_freq]   (spectral_magnitude, power=1 -> |X|^2)
        x = torch.matmul(p, self.mel)  # [B, T, n_mels]
        if self.log_mel:
            x = self.mult * torch.log10(torch.clamp(x, min=self.amin)) - self.mult * self.db_mult
            x = torch.maximum(x, x.amax(dim=(1, 2), keepdim=True) - self.top_db)
        if self.mean_norm:
            x = x - x.mean(dim=1, keepdim=True)
        if self.std_norm:
            x = x / torch.clamp(x.std(dim=1, keepdim=True), min=self.eps)
        return x


class ModelB(nn.Module):
    """waveform [B, 32000] -> (probs [B, N], embedding [B, 192])"""

    def __init__(self, ecapa, head, l2_normalize_embedding=False):
        super().__init__()
        self.features = SpeechBrainFbankONNX(ecapa.mods.compute_features, ecapa.mods.mean_var_norm)
        self.encoder = ecapa.mods.embedding_model
        self.head = head
        self.l2 = l2_normalize_embedding

    def forward(self, waveform):
        emb = self.encoder(self.features(waveform)).squeeze(1)  # [B, 192]
        z = F.normalize(emb, dim=-1) if self.l2 else emb
        return torch.softmax(self.head(z), dim=-1), emb


class TorchaudioLogMelONNX(nn.Module):
    """Same as torchaudio.transforms.MelSpectrogram(...) followed by log_fn, without torch.stft."""

    def __init__(self, mel, log_fn):
        super().__init__()
        s = mel.spectrogram
        assert s.pad == 0 and not s.normalized and s.onesided in (None, True) and s.power == 2.0
        self.spec = _PowerSpec(s.n_fft, s.hop_length, s.window, s.center, s.pad_mode)
        self.register_buffer("fb", mel.mel_scale.fb.detach().float().contiguous())  # [n_freq, n_mels]
        self.log_fn = log_fn

    def forward(self, wav):  # -> [B, 1, n_mels, T]  (what the CNN was trained on)
        m = torch.matmul(self.spec(wav).transpose(1, 2), self.fb).transpose(1, 2)
        return self.log_fn(m).unsqueeze(1)


class ModelA(nn.Module):
    def __init__(self, mel, cnn, log_fn):
        super().__init__()
        self.features = TorchaudioLogMelONNX(mel, log_fn)
        self.cnn = cnn

    def forward(self, waveform):
        return torch.softmax(self.cnn(self.features(waveform)), dim=-1)


def linear_from_sklearn(clf, scaler=None):
    """sklearn LogisticRegression (multinomial, >=3 classes) [+ StandardScaler] -> nn.Linear(192, N)."""
    W = torch.tensor(clf.coef_, dtype=torch.float32)
    b = torch.tensor(clf.intercept_, dtype=torch.float32)
    if scaler is not None:  # fold (x - mean) / scale into the weights
        mu = torch.tensor(scaler.mean_, dtype=torch.float32)
        sd = torch.tensor(scaler.scale_, dtype=torch.float32)
        W, b = W / sd, b - (W / sd) @ mu
    lin = nn.Linear(W.shape[1], W.shape[0])
    lin.weight.data, lin.bias.data = W, b
    return lin


def _export(model, path, outputs):
    model.eval()
    dummy = torch.randn(1, WIN_SAMPLES) * 0.1
    dyn = {"waveform": {0: "batch"}, **{o: {0: "batch"} for o in outputs}}
    with torch.no_grad():
        torch.onnx.export(model, (dummy,), path, input_names=["waveform"], output_names=outputs,
                          dynamic_axes=dyn, opset_version=17, do_constant_folding=True, dynamo=False)
    import onnx
    onnx.checker.check_model(path)
    return path


def quantize_int8(src, dst, keep_float_prefix=("/features/",)):
    """Dynamic int8 quantisation of the network weights. The feature step (DFT conv + mel matmul)
    stays float32: quantising the DFT basis wrecks the spectrogram."""
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic
    names = [n.name for n in onnx.load(src).graph.node]
    keep = [n for n in names if n.startswith(keep_float_prefix)]
    # QUInt8 weights: same accuracy as QInt8 here but ~4x faster in onnxruntime 1.31 CPU (59 vs 232 ms/window).
    quantize_dynamic(src, dst, weight_type=QuantType.QUInt8, nodes_to_exclude=keep)
    return dst


def fp16_weights(src, dst, min_elems=1024):
    """Store large float32 weights as float16 (+ a Cast back to float32). Halves the file; the maths
    still runs in float32 because onnxruntime constant-folds the Casts when the session is created."""
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    m = onnx.load(src); g = m.graph; new, casts = [], []
    for init in list(g.initializer):
        a = numpy_helper.to_array(init)
        if a.dtype == np.float32 and a.size >= min_elems and not init.name.startswith("features."):
            new.append(numpy_helper.from_array(a.astype(np.float16), init.name + "_fp16"))
            g.initializer.remove(init)
            casts.append(helper.make_node("Cast", [init.name + "_fp16"], [init.name], to=TensorProto.FLOAT, name="cast_" + init.name))
    g.initializer.extend(new)
    for c in reversed(casts):
        g.node.insert(0, c)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    return dst


def _write_labels(out_dir, names, outputs, extra=None):
    meta = {"labels": list(names), "sample_rate": SR, "window_samples": WIN_SAMPLES, "hop_samples": SR // 2,
            "input": "waveform", "outputs": outputs,
            "preprocess": "mono 16 kHz float32 in [-1,1]; each 2 s window RMS-normalised to -20 dBFS then clipped"}
    meta.update(extra or {})
    with open(os.path.join(out_dir, "labels.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


def check_parity(onnx_path, torch_fn, windows, emb=True):
    """windows: np.float32 [K, 32000]. torch_fn(x) -> (probs, emb) or probs from the ORIGINAL pipeline."""
    import onnxruntime as ort
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    cos, agree, maxdiff = [], 0, 0.0
    for i in range(0, len(windows), 32):
        x = windows[i:i + 32].astype(np.float32)
        outs = sess.run(None, {"waveform": x})
        with torch.no_grad():
            ref = torch_fn(torch.from_numpy(x))
        rp = (ref[0] if isinstance(ref, tuple) else ref).numpy()
        agree += int((outs[0].argmax(1) == rp.argmax(1)).sum())
        maxdiff = max(maxdiff, float(np.abs(outs[0] - rp).max()))
        if emb and isinstance(ref, tuple):
            a, b = outs[1], ref[1].numpy()
            cos += list((a * b).sum(1) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1)))
    r = {"n": len(windows), "argmax_agree": agree / len(windows), "max_abs_prob_diff": maxdiff}
    if cos:
        r.update(min_cos=float(np.min(cos)), mean_cos=float(np.mean(cos)))
    return r


def export_model_b(ecapa, head, names, out_dir="web_model", l2_normalize_embedding=False, fp16=True, int8=True, check_windows=None):
    """ecapa: speechbrain EncoderClassifier (spkrec-ecapa-voxceleb); head: nn.Module 192 -> N logits."""
    os.makedirs(out_dir, exist_ok=True)
    ecapa.eval(); head.eval()
    model = ModelB(ecapa, head, l2_normalize_embedding).eval()
    path = _export(model, os.path.join(out_dir, "model_b.onnx"), ["probs", "embedding"])
    files = {"fp32": path}
    if fp16:
        files["fp16"] = fp16_weights(path, os.path.join(out_dir, "model_b.fp16.onnx"))
    if int8:
        files["int8"] = quantize_int8(path, os.path.join(out_dir, "model_b.int8.onnx"))
    _write_labels(out_dir, names, ["probs", "embedding"], {"files": {k: os.path.basename(v) for k, v in files.items()}})
    if check_windows is not None:  # compare against SpeechBrain's own encode_batch, not against our re-implementation
        def ref(x):
            e = ecapa.encode_batch(x).squeeze(1)
            z = F.normalize(e, dim=-1) if l2_normalize_embedding else e
            return torch.softmax(head(z), -1), e
        for k, p in files.items():
            print(k, f"{os.path.getsize(p)/1e6:.1f} MB", check_parity(p, ref, check_windows))
    return files


def export_model_a(mel, cnn, names, out_dir="web_model", log_fn=lambda m: torch.log(m + 1e-6), int8=False, check_windows=None):
    """mel: torchaudio.transforms.MelSpectrogram used in training; cnn: nn.Module [B,1,n_mels,T] -> N logits."""
    os.makedirs(out_dir, exist_ok=True)
    cnn.eval()
    model = ModelA(mel, cnn, log_fn).eval()
    path = _export(model, os.path.join(out_dir, "model_a.onnx"), ["probs"])
    files = {"fp32": path}
    if int8:
        files["int8"] = quantize_int8(path, os.path.join(out_dir, "model_a.int8.onnx"))
    _write_labels(out_dir, names, ["probs"], {"files": {k: os.path.basename(v) for k, v in files.items()}})
    if check_windows is not None:
        ref = lambda x: torch.softmax(cnn(log_fn(mel(x)).unsqueeze(1)), -1)
        for k, p in files.items():
            print(k, f"{os.path.getsize(p)/1e6:.2f} MB", check_parity(p, ref, check_windows, emb=False))
    return files
