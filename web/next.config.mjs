import { fileURLToPath } from "node:url";

// vad-web onnxruntime-web/wasm'ı require ile, biz import ile alıyoruz. İkisini aynı dosyaya bağla:
// tarayıcıda tek bir ONNX Runtime olur (ayarlar ortak, wasm bir kez iner). Çalışma dosyaları public/ort/'tan gelir.
const ortWasm = fileURLToPath(new URL("./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs", import.meta.url));

const basePath = process.env.BASE_PATH || ""; // sadece sunucudaki önizleme için

const nextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  webpack(config) {
    config.resolve.alias["onnxruntime-web/wasm$"] = ortWasm;
    return config;
  },
  // COOP + COEP: sayfa "cross-origin isolated" olur -> ONNX Runtime Web birden çok çekirdekle (WASM thread) çalışır.
  // Model, ORT, VAD ve font aynı adresten geldiği için bu başlıklar hiçbir şeyi engellemez.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      ],
    }];
  },
};
export default nextConfig;
