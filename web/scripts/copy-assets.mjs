// ONNX Runtime Web ve VAD'ın çalışma dosyalarını public/ altına kopyalar (her dev/build'den önce).
// Böylece her şey aynı adresten gelir: CDN'e bağımlılık yok ve COOP/COEP ile çok çekirdekli WASM açılabilir.
import { cpSync, mkdirSync } from "node:fs";

const copy = (from, to, files) => {
  mkdirSync(to, { recursive: true });
  for (const f of files) cpSync(`${from}/${f}`, `${to}/${f}`);
};
copy("node_modules/onnxruntime-web/dist", "public/ort", ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]);
copy("node_modules/@ricky0123/vad-web/dist", "public/vad", ["vad.worklet.bundle.min.js", "silero_vad_v6.onnx"]);
console.log("ort + vad dosyaları public/ altına kopyalandı");
