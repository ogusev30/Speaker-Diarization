"use client";
// Model, mikrofon ve ONNX Runtime sadece tarayıcıda çalışır: sayfa sunucuda hiç render edilmez.
import dynamic from "next/dynamic";

const Uygulama = dynamic(() => import("./Uygulama"), { ssr: false });

export default function Sayfa() {
  return <Uygulama />;
}
