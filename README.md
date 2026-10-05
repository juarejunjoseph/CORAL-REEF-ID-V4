# CORAL-REEF-ID-V4

V4 is a redesigned, mobile-first PWA for AI-assisted identification of coral and associated reef organisms.

## V4 improvements

- Modern React + Vite application
- Gallery upload and mobile camera capture
- Live camera scanner with throttled inference
- Stable live identification across multiple frames
- Top-3 results with confidence labels
- Low-confidence guidance
- On-device identification history
- Philippine reef/model reference catalog
- Teachable Machine model manager for local model replacement
- PWA manifest and service worker
- Netlify deployment configuration

## Model

The original model contains 24 visual classes and uses 224px image input.

The production V4 build first attempts the bundled model under `public/coralimagemodel/`. The real `weights.bin` is not duplicated here yet because the connected GitHub file tool cannot safely read that binary asset. Until the actual new weights are uploaded, V4 falls back to the existing V3.5 hosted model. No fake or empty weights are used.

To install a new model, use the Model tab and select a matching:
- `model.json`
- `weights.bin`
- `metadata.json`

## Philippine reference

LikasMap Anthozoa:
https://likasmap.com/species/class/Anthozoa

The catalog is used as a reference source for future taxonomy expansion. Model labels are visual classes and should not be treated as definitive species determinations.

## Netlify

Build command: `npm run build`
Publish directory: `dist`

Camera access requires HTTPS.

## Identification note

This is an AI-assisted visual classifier. Model probability is not equivalent to taxonomic certainty. Confirm important observations with accepted taxonomic references and expert review when appropriate.
