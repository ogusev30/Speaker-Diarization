# Deney Günlüğü — Speaker Diarization

## Aşama 1 — Ses Toplama

4 kişi kaydedildi, herkes aynı ofiste. Laptop oturumları `kayit/` sayfasıyla, telefon oturumları telefonun ses kayıt uygulamasıyla alındı.

| Kişi  | Oturum 1 (tel) | Oturum 2 (lap) | Oturum 3 (lap) | Oturum 4 (tel) | Toplam |
|-------|----------------|----------------|----------------|----------------|--------|
| elif  | 1:50           | 2:23           | 2:07           | 2:00           | 8:19   |
| zehra | 2:14           | 2:25           | 2:01           | 2:01           | 8:42   |
| onur  | 1:28           | 2:31           | 2:04           | 2:33           | 8:35   |
| cem   | 3:14 (2 kayıt)  | 2:20           | 2:20           | 2:01           | 9:54   |

Oda sesi: `ofis_laptop.wav` (0:41), `ofis_telefon.m4a` (0:31). İkisinde de VAD konuşma bulmadı.

**Plandan sapmalar**

- **Cem** okuma planına uymadı: telefonda Metin 4 + 5, laptop oturum 2'de Metin 2 + 3, laptop oturum 3'te Metin 1 ve serbest konuşma.
  Telefon kaydı oturum 1 (train) yapıldı ki model Cem'in telefon sesini de görsün; aksi halde "telefon = Cem değil" öğrenebilirdi.
  Laptop kayıtlarının adları Cem'in koyduğu gibi bırakıldı (oturum 2 uzak, oturum 3 orta mesafe varsayıldı).
- **Cem'in oturum 4'ü sonradan geldi** (WhatsApp üzerinden iki telefon kaydı). ECAPA iki kaydın her 2 sn'lik parçasını da Cem olarak tanıdı. Daha sürekli/enerjik olan (2:01) oturum 4 (validation) yapıldı, diğeri (1:41) train'e ek telefon kaydı olarak eklendi (`oturum1_telefon_2`).
- Cem'in laptop kayıtlarının ilk saniyesinde yüksek bir tık sesi var; Onur'un kayıtları yüksek seviyede, birkaç yerde kısa clipping var. Seviye eşitleme ve VAD bunları büyük ölçüde temizliyor.

## Aşama 2 — Data Cleaning

Tek komut: `.venv/bin/python scripts/asama2.py`

1. **Tek format:** her şey WAV, 16 kHz, mono (`ffmpeg`).
2. **Sessizlik:** Silero VAD ile sadece konuşma bırakıldı (kayıtların ~%75–95'i konuşma).
3. **Seviye eşitleme:** her 2 saniyelik parça kendi RMS'ine göre **-20 dBFS**'e getirildi, sonra [-1, 1]'e kırpıldı. Bu, `web_export/export_onnx.py`'nin `labels.json`'a yazdığı ön işlemeyle birebir aynı; Gradio ve web uygulaması da her pencereyi böyle eşitleyecek.
4. **Parçalar:** 2 saniyelik, üst üste binmeyen; sondaki 2 saniyeden kısa kısım atıldı.
5. **Bölme (oturuma göre):** oturum 1 + 2 → train, oturum 4 → validation, oturum 3 → test. Script, hiçbir kaydın iki bölüme düşmediğini kontrol ediyor.
6. **Augmentation:** her train parçasının yanına 3 kopya: oda sesi (SNR 5–20 dB), yapay yankı (RT60 0,2–0,7 sn), seviye değişimi (-12…+6 dB). Hız/perde değişikliği yok.
7. **Sahte sohbetler:** sadece test oturumlarından, 2–6 sn'lik sıralar, aralarda 0,3–1 sn laptop oda sesi; 20 × 1 dakika, doğru cevaplar RTTM'de.

| Kişi  | Train | Train + aug | Val | Test |
|-------|-------|-------------|-----|------|
| cem   | 117   | 468         | 48  | 51   |
| elif  | 98    | 392         | 48  | 47   |
| onur  | 106   | 424         | 69  | 55   |
| zehra | 119   | 476         | 58  | 45   |

Sahte sohbetlerde konuşma süresi dengeli: cem %27, zehra %27, elif %24, onur %23.

**Spektrogramlar** (`veri/kontrol/spektrogramlar.png`): Elif ve Zehra'da harmonik çizgiler (yatay parlak bantlar) daha seyrek, yani ses perdesi daha yüksek; Cem ve Onur'da çizgiler daha sık ve alt frekanslarda toplanmış, yani daha kalın sesler. Model en kolay bu iki grubu ayıracak; zorluk grup içinde (Elif–Zehra, Cem–Onur) olacak.

## Aşama 3 — Model Seçimi

> Durum: **onaylandı**, bu mimariyle eğitildi (Aşama 4).

### Model A — sıfırdan CNN

**Girdi:** 2 sn'lik parçanın log-mel spektrogramı, boyutu `[1, 80, 201]` (80 mel bandı × 201 zaman adımı).
`torchaudio.transforms.MelSpectrogram(sample_rate=16000, n_fft=400, hop_length=160, n_mels=80)` → `log(m + 1e-6)`.
(25 ms pencere, 10 ms kaydırma. `web_export/export_onnx.py`'nin `export_model_a`'sı tam olarak bu adımı tarayıcıya taşıyor.)

**Mimari** (`nn.Sequential`, canlı panel ilk 5 bloğu çizer):

| # | Katman | Çıkış boyutu |
|---|--------|--------------|
| 1 | Conv 3×3 (1→16) → BatchNorm → ReLU → MaxPool 2×2 | 16 × 40 × 100 |
| 2 | Conv 3×3 (16→32) → BatchNorm → ReLU → MaxPool 2×2 | 32 × 20 × 50 |
| 3 | Conv 3×3 (32→64) → BatchNorm → ReLU → MaxPool 2×2 | 64 × 10 × 25 |
| 4 | Conv 3×3 (64→128) → BatchNorm → ReLU → MaxPool 2×2 | 128 × 5 × 12 |
| 5 | Conv 3×3 (128→128) → BatchNorm → ReLU → MaxPool 2×2 | 128 × 2 × 6 |
|   | Global average pooling → Flatten → Dropout(0.3) → Linear(128 → 4) | 4 |

Toplam **~246 bin parametre**.

**Neden bu boyut:** train'de 410 temiz parça var (aug ile 1640). Panel örneğindeki gibi 32-64-128-128-256 kanal ve büyük bir Linear katmanı bu kadar az data için çok büyük olurdu, model kayıtları ezberlerdi. Kanalları yarıya indirip sonda tek bir küçük Linear bıraktık. Global average pooling sayesinde model sesin parçanın *neresinde* olduğunu değil, *nasıl* bir ses olduğunu öğrenir.

**Eğitim:** AdamW (lr 1e-3, weight decay 1e-4), batch 64, en çok 40 epoch, cosine learning rate. Validation loss'u en iyi olan epoch'un ağırlıkları saklanır. `torch.set_num_threads(48)`. Ölçülen hız: **~4 sn/epoch** → tüm eğitim **~3 dakika**.

### Model B — pretrained ECAPA + küçük sınıflandırıcı

- `speechbrain/spkrec-ecapa-voxceleb` (20,8 M parametre, VoxCeleb'de 7.000+ kişiyle eğitilmiş). **Donuk**: hiç eğitilmez.
- Her parçanın 192 sayılık embedding'i bir kez hesaplanıp diske kaydedilir (tüm parçalar için ölçülen süre **~75 sn**).
- **Sınıflandırıcı:** embedding L2 ile normalize edilir → `Linear(192 → 4)` (yani lojistik regresyon). AdamW, tüm data tek batch, birkaç yüz adım: **birkaç saniye**.
- **Neden sadece bir Linear:** ECAPA'nın embedding'leri zaten kişileri ayırmak için eğitilmiş; 4 kişiyi ayırmak için düz bir çizgi yetmeli. Daha büyük bir sınıflandırıcı sadece ezber riskini artırır. Export, `export_model_b(..., l2_normalize_embedding=True)` ile aynı adımı tarayıcıya taşır.

### Adil karşılaştırma

İki model de **aynı** `manifest.csv`'yi kullanır: aynı train parçaları (temiz + 3 aug kopyası), aynı validation ve test, aynı -20 dBFS seviye eşitleme. Tek fark: Model A her şeyi bizim 1640 parçamızdan öğrenir, Model B'nin "kulağı" binlerce kişiden önceden öğrenilmiş.

**DER ölçümü (ikisi için aynı):** sahte sohbette Silero VAD konuşmayı bulur → 2 sn'lik pencere 0,5 sn kaydırılır → her 0,5 sn'lik dilimin kişisi, üstüne düşen pencerelerin olasılık ortalamasından seçilir → art arda aynı kişi birleşir → `pyannote.metrics.IdentificationErrorRate`.

### Bilinen sınırlamalar

- Model sadece bu 4 kişiyi tanır; yabancı bir sesi de bu 4 kişiden birine benzetir (web uygulamasında "Tanıyamadım" eşiği bunun için).

### Tahminim

> *(buraya senin tahminin gelecek: hangi model kazanır, DER'leri yaklaşık ne olur, pretraining ne kadar fark yaratır, en çok kimler karışır?)*

## Aşama 4 — Training ve DER Karşılaştırma

`training.ipynb` iki kez baştan sona çalıştırıldı: önce Cem'in oturum 4'ü olmadan, sonra Cem'in yeni kayıtlarıyla. Sahte sohbetler (test oturumları) iki çalıştırmada da aynı, yani DER'ler doğrudan karşılaştırılabilir.

| | Model A, 1. çalıştırma | **Model A, 2. çalıştırma** | Model B, 1. çalıştırma | **Model B, 2. çalıştırma** |
|---|---|---|---|---|
| Train parçası (aug dahil) | 1640 | 1760 | 1640 | 1760 |
| Eğitim süresi | 3,1 dk | 3,7 dk | 0,4 sn + 60 sn embedding | 0,4 sn + embedding |
| Validation accuracy (seçilen epoch) | %87,4 (Cem yok) | %95,1 | %99,4 (Cem yok) | %100 |
| Test accuracy (2 sn parça) | %91,4 | **%78,3** | %100 | **%100** |
| **DER (20 sahte sohbet)** | %13,5 | **%26,1** | %4,1 | **%4,0** |
| ├ yanlış kişi | %10,2 | %22,7 | %0,7 | %0,7 |
| ├ kaçırılan konuşma | %1,5 | %1,5 | %1,5 | %1,5 |
| └ yanlış alarm | %1,8 | %1,8 | %1,8 | %1,8 |
| Ortalama confidence | %84 | %87 | %91 | %91 |

Eğitilen parametre: Model A 245.988, Model B 772 (+20,8 M donuk ECAPA).

**Önde olan: Model B**, iki çalıştırmada da. DER'in neredeyse tamamı VAD'dan (kaçırılan konuşma + yanlış alarm iki modelde aynı); Model B'nin "yanlış kişi" hatası sadece %0,7. Test parçalarında hiç hata yapmadı.

**Model A nerede zorlandı:**
- **Elif ↔ Zehra:** iki çalıştırmada da tek büyük hata bu. Testte (oturum 3, laptop orta mesafe) Elif'in parçalarını 1. çalıştırmada %36, 2. çalıştırmada **%91** oranında Zehra sandı. Cem, Onur ve Zehra iki çalıştırmada da %100 doğru.
  Validation'da (oturum 4, telefon) Elif'i doğru biliyor; yani sorun Elif'in *laptop* sesi. Train'deki tek Elif laptop kaydı uzak mesafeden (oturum 2, sesi en düşük ve en gürültülü kayıt); model Elif'i laptoptan orta mesafede hiç duymadı ve o koşulda Zehra'ya benzetiyor.
- **Kararsızlık:** iki çalıştırma arasında sadece Cem'in datası değişti, ama Elif'in test doğruluğu %64'ten %9'a düştü. Model A'nın bu karışıklıktaki kararı rastlantıya çok bağlı: 4 kişinin ~7'şer dakikalık sesi, bir sesi "kimin sesi" yapan şeyi sağlam öğrenmeye yetmiyor.
- **Overfitting:** train accuracy 2. epoch'ta ~%100'e çıkıyor, validation loss 2. epoch'tan sonra iyileşmiyor; seçilen ağırlıklar iki seferde de 2. epoch'tan.

**Pretraining'in farkı:** Model B'nin öğrenen kısmı Model A'nın 300'de biri kadar ve 0,4 saniyede eğitiliyor, ama iki çalıştırmada da aynı sonucu veriyor ve Elif'le Zehra'yı hiç karıştırmıyor. ECAPA binlerce kişiden ve binlerce farklı mikrofon/odadan "sesi kişiye ait yapan şeyi" önceden öğrenmiş; Model A bunu bizim 4 kişimizden öğrenmeye çalışıyor ve mikrofon/mesafe farkını kişi farkı sanabiliyor.

**Tahminim doğru çıktı mı?** *(Aşama 3'teki tahminle karşılaştır)*

**Kaydedilen modeller (2. çalıştırma):** `modeller/model_a.pt`, `modeller/model_b_kafa.pt` (ECAPA `pretrained_models/` içinde), `modeller/sonuclar.json`.

## Aşama 5 — Dene ve Karar Ver

`app.py` (Gradio, "Sıra Kimde? Model Arena"): mikrofon veya dosya → 16 kHz mono → Silero VAD → 2 sn pencere / 0,5 sn kaydırma → iki model aynı anda → yan yana zaman çizelgeleri (isim + % confidence), "şu an konuşan" ve canlı skor.

**İlk deneme** (Elif'in test oturumundan 12 sn, "şu an konuşan: elif" seçili): **Model A 0/6**, **Model B 6/6**. Model A Elif'i %82–97 eminlikle Zehra sandı; yani hem yanıldı hem yanıldığından çok emindi. Model B %90–99 eminlikle Elif dedi.

**Karar: web'e Model B gidiyor.** DER (%4,0'a karşı %26,1) ve canlı test aynı şeyi söyledi. Kaybeden Model A'nın zorlandığı yer: Elif'in laptop sesi (Zehra'ya benzetiyor) ve iki eğitim arasında sonucun çok değişmesi.

*(Ailemle/arkadaşlarımla farklı mesafe ve odalarda yaptığım canlı testin notları buraya.)*

## Aşama 6 — Productize ve Deploy

- **ONNX:** `scripts/onnx_export.py` (kursun `web_export/export_onnx.py`'sini kullanır). Ses → spektrogram → ECAPA → sınıflandırıcı tek dosyada.
  | Sürüm | Boyut | Test parçalarında `.pt` ile aynı kişi | Embedding benzerliği (min) |
  |---|---|---|---|
  | fp32 | 84,1 MB | %100 (198/198) | 1,0000 |
  | fp16 | 42,6 MB | %100 | 1,0000 |
  | **int8** | **22,2 MB** | **%100** | 0,9863 |

  int8 uyumu %99 eşiğinin üstünde → web uygulaması **int8** kullanıyor.
- **Web uygulaması:** `web/` (Next.js 15.5.28, onnxruntime-web 1.30.0, @ricky0123/vad-web 0.0.31, sürümler sabit). Tasarım `tasarim/onizleme.html`'den. Model Gradio'yu kullanmıyor, sadece Model B var.
  - Mikrofonda yankı engelleme, gürültü azaltma ve otomatik seviye kapalı (vad-web'in varsayılanında üçü de açık; `getStream`/`resumeStream` ile kapatıldı).
  - Her konuşma bitince 2 sn pencere / 0,5 sn kaydırma, kısa konuşma sessizlikle doldurulur, her pencere -20 dBFS'e eşitlenip kırpılır; %60 altı "Tanıyamadım".
  - JS ön işleme + int8 model Node'da Python'la karşılaştırıldı: 12/12 pencerede aynı kişi, olasılık farkı en çok 0,03.
  - vad-web ve bizim kod `onnxruntime-web/wasm`'ı tek dosyaya bağlıyor (`next.config.mjs`): tarayıcıda tek ONNX Runtime.
- **Canlı link:** *(Vercel linki)*
- **Telefonda bir pencere:** *(uygulamadaki "Bu cihazda bir pencere: … ms" yazısından)*
- **Datasette olmayan biri konuşunca:** *(ne oldu?)*
