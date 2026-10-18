# Deney Günlüğü — Speaker Diarization

## Aşama 1 — Ses Toplama

4 kişi kaydedildi, herkes aynı ofiste. Laptop oturumları `kayit/` sayfasıyla, telefon oturumları telefonun ses kayıt uygulamasıyla alındı.

| Kişi  | Oturum 1 (tel) | Oturum 2 (lap) | Oturum 3 (lap) | Oturum 4 (tel) | Toplam |
|-------|----------------|----------------|----------------|----------------|--------|
| elif  | 1:50           | 2:23           | 2:07           | 2:00           | 8:19   |
| zehra | 2:14           | 2:25           | 2:01           | 2:01           | 8:42   |
| onur  | 1:28           | 2:31           | 2:04           | 2:33           | 8:35   |
| cem   | 1:32           | 2:20           | 2:20           | **yok**        | 6:12   |

Oda sesi: `ofis_laptop.wav` (0:41), `ofis_telefon.m4a` (0:31). İkisinde de VAD konuşma bulmadı.

**Plandan sapmalar**

- **Cem** okuma planına uymadı: telefonda Metin 4 + 5, laptop oturum 2'de Metin 2 + 3, laptop oturum 3'te Metin 1 ve serbest konuşma.
  Telefon kaydı oturum 1 (train) yapıldı ki model Cem'in telefon sesini de görsün; aksi halde "telefon = Cem değil" öğrenebilirdi.
  Laptop kayıtlarının adları Cem'in koyduğu gibi bırakıldı (oturum 2 uzak, oturum 3 orta mesafe varsayıldı).
- **Cem'in oturum 4'ü eksik**: validation setinde Cem yok ve toplamı 8 dakikanın altında. Gelirse Aşama 2 tekrar çalıştırılacak.
- Cem'in laptop kayıtlarının ilk saniyesinde yüksek bir tık sesi var; Onur'un kayıtları yüksek seviyede, birkaç yerde kısa clipping var. Seviye eşitleme ve VAD bunları büyük ölçüde temizliyor.

## Aşama 2 — Data Cleaning

Tek komut: `.venv/bin/python scripts/asama2.py`

1. **Tek format:** her şey WAV, 16 kHz, mono (`ffmpeg`).
2. **Sessizlik:** Silero VAD ile sadece konuşma bırakıldı (kayıtların ~%75–95'i konuşma).
3. **Seviye eşitleme:** her 2 saniyelik parça kendi RMS'ine göre **-20 dBFS**'e getirildi. Gradio ve web uygulaması da her pencereyi aynı şekilde eşitleyecek.
4. **Parçalar:** 2 saniyelik, üst üste binmeyen; sondaki 2 saniyeden kısa kısım atıldı.
5. **Bölme (oturuma göre):** oturum 1 + 2 → train, oturum 4 → validation, oturum 3 → test. Script, hiçbir kaydın iki bölüme düşmediğini kontrol ediyor.
6. **Augmentation:** her train parçasının yanına 3 kopya: oda sesi (SNR 5–20 dB), yapay yankı (RT60 0,2–0,7 sn), seviye değişimi (-12…+6 dB). Hız/perde değişikliği yok.
7. **Sahte sohbetler:** sadece test oturumlarından, 2–6 sn'lik sıralar, aralarda 0,3–1 sn laptop oda sesi; 20 × 1 dakika, doğru cevaplar RTTM'de.

| Kişi  | Train | Train + aug | Val | Test |
|-------|-------|-------------|-----|------|
| cem   | 87    | 348         | 0   | 51   |
| elif  | 98    | 392         | 48  | 47   |
| onur  | 106   | 424         | 69  | 55   |
| zehra | 119   | 476         | 58  | 45   |

Sahte sohbetlerde konuşma süresi dengeli: cem %27, zehra %27, elif %24, onur %23.

**Spektrogramlar** (`veri/kontrol/spektrogramlar.png`): Elif ve Zehra'da harmonik çizgiler (yatay parlak bantlar) daha seyrek, yani ses perdesi daha yüksek; Cem ve Onur'da çizgiler daha sık ve alt frekanslarda toplanmış, yani daha kalın sesler. Model en kolay bu iki grubu ayıracak; zorluk grup içinde (Elif–Zehra, Cem–Onur) olacak.
