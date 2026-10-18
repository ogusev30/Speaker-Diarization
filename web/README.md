# Sıra Kimde? — web uygulaması (Aşama 6)

Konuş, seni tanıyayım. Her şey tarayıcıda çalışır: Silero VAD (`@ricky0123/vad-web`) konuşmayı bulur, kazanan model
(Model B: ECAPA + sınıflandırıcı, ONNX Runtime Web) her konuşmayı 2 sn'lik pencerelerle, 0,5 sn kaydırarak dinler ve
kimin konuştuğunu söyler. Sunucu ve API anahtarı yok.

## Çalıştırma

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

`npm run dev` ve `npm run build` önce `scripts/copy-assets.mjs`'i çalıştırır: ONNX Runtime'ın `.wasm`/`.mjs` dosyaları
`public/ort/`'a, VAD dosyaları `public/vad/`'a kopyalanır.

Sunucudaki önizleme (code-server proxy) için: `BASE_PATH=/lab/absproxy/3000 npm run build && BASE_PATH=/lab/absproxy/3000 npx next start -p 3000`,
sonra `https://student.exposureai.org/lab/absproxy/3000`.

## Model

`public/models/`: `model_b.int8.onnx` (ham ses `[B, 32000]` → `probs`, `embedding`) ve `labels.json` (kişi sırası,
seçilen dosya, DER). İkisini `scripts/onnx_export.py` yazar. Ön işleme eğitimle aynı (`lib/konusmaci.js`): her 2 sn'lik
pencere -20 dBFS RMS'e getirilip [-1, 1]'e kırpılır.

## Deploy (Vercel)

Vercel'de projeyi GitHub reposundan içe aktar, **Root Directory = `web`** seç. Framework otomatik Next.js olarak
algılanır; environment variable gerekmez. `next.config.mjs` COOP/COEP başlıklarını ekler, böylece ONNX Runtime Web
birden çok çekirdekle çalışır.
