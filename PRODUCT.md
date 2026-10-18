# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (set by the project brief, Aşama 6). The model runs in the browser with onnxruntime-web 1.30.0 and @ricky0123/vad-web 0.0.31; no server, no API key. Deployed to Vercel. Until the winning model is exported, the UI is prototyped as a single static HTML page and ported to Next.js afterwards.

## Users

- A class / jury watching a live demo on a laptop or projector. They need to read who is speaking from across the room.
- The author's family and friends opening the Vercel link on their phones and talking into it.
- Both audiences are Turkish speakers. They know nothing about models; they only want to see whether it recognises them.

## Product Purpose

Listen through the microphone and show who is speaking, when, and how sure the model is. Each finished utterance is cut into 2 s windows (0.5 s hop), classified, and appended to a timeline where every speaker has their own colour, with name and % confidence on each segment. The last speaker is shown large. Success: a person from the dataset talks and their name appears; a stranger talks and the app says it did not recognise them.

## Positioning

It only knows four real people (Cem, Elif, Onur, Zehra) whose voices were recorded for this project, and it runs entirely on the visitor's device. It does not pretend to recognise anyone else.

## Operating Context

- Demo is done with a laptop microphone at arm's length (same setup as the test session).
- Microphone echo cancellation, noise suppression and auto gain must be off.
- First visit downloads the model (int8 about 22 MB, fp16 about 43 MB), so a visible loading state is required.
- One window takes about 0.15 s on a laptop and 0.6 s on a slow phone, so results appear after each utterance ends, not word by word.

## Capabilities and Constraints

- Start / Stop microphone (large control).
- Timeline that fills as utterances finish; per segment: name + % confidence.
- Confidence below 60 % shows "Tanıyamadım" instead of a name.
- States: model loading, mic permission denied / error, no speech found, listening, processing.
- Small info card: model name and its DER score.
- Speakers (labels.json order): cem, elif, onur, zehra.
- Open decision: which model ships (Model A CNN or Model B ECAPA) is decided in Aşama 5.
- Open decision: product name. Working name "Sıra Kimde?" (okey phrase for whose turn it is).

## Brand Commitments

User-mandated, binding:
- Never: purple gradients, vague hero text, fake counters, fake reviews, pill-shaped buttons, emoji icons, fake metrics, cursor animations, AI-generated images, "made with AI" tags, em dashes, AI-sounding copy.
- Always: a favicon; neo-brutalist design with sharp edges, varied geometric shapes and vivid colours.

## Evidence on Hand

From `modeller/sonuclar.json` and `DENEY_GUNLUGU.md` (20 synthetic conversations):
- Model A (CNN from scratch): DER 26.1 %, test accuracy 78.3 % (after retraining with Cem session 4).
- Model B (ECAPA + Linear): DER 4.0 %, test accuracy 100 %.
No user counts, reviews, or usage numbers exist; none may be shown.

## Product Principles

- Show only what the model actually said. Every number on screen comes from the model or from the measured results.
- Honest about uncertainty: low confidence is shown as not recognised, not forced into a name.
- Readable from across a room and usable with one thumb.
- Plain Turkish copy, short and concrete.

## Accessibility & Inclusion

Speakers must be distinguishable without colour (each has its own shape and name label). Text contrast must hold on vivid backgrounds.
