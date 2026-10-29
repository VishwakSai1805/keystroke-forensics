# Keystroke-dynamics biometrics: design, ethics and limits

This is a **research demonstration** of continuous authentication from typing rhythm. It isn't a security control and nothing in the app relies on it.

## What is measured

- **Dwell time**: keydown -> keyup of the same key (how long a key is held).
- **Flight time**: keyup of one key -> keydown of the next (the gap between keys; negative when keys overlap).

`core/dynamics.js` turns a run into a fixed 44-dimension feature vector:
- mean dwell for 20 frequent letters (`etaoinshrdlucmpgwyfb`)
- mean flight for 20 frequent digraphs (`th, he, in, er, an, ...`)
- global dwell mean and standard deviation, and flight mean and standard deviation

Features never observed in a run are `NaN` and ignored by the distance.

## Enrollment and scoring

1. With consent on, each finished run stores **one feature vector** (statistics only, no text, no raw log) in IndexedDB.
2. After **5 runs** a profile is enrolled: per-feature mean `mu` and a floored standard deviation `sd = max(sd, 10% of mu, 5 ms)`.
3. **Distance** (selectable):
   - scaled Manhattan: `mean_j |x_j - mu_j| / sd_j`
   - diagonal Mahalanobis: `sqrt(mean_j ((x_j - mu_j) / sd_j)^2)`
   Only dimensions present in both are used, and at least 5 are required.
4. **Threshold**: leave-one-out genuine distances (each enrollment run against a profile built from the others), threshold = mean + 2 sd.
5. **Live identity confidence**: the worker scores the last 80 keystrokes every second; confidence = `1 / (1 + exp((d - threshold) / (0.2 * threshold)))`, shown as a meter on the test screen.

## Evaluation

The Biometrics page computes, from genuine (leave-one-out) and impostor distances:
- **FAR** (false accept rate) and **FRR** (false reject rate) at every threshold, giving the **ROC** curve (FAR vs TPR) and its **AUC**
- **EER**: the point where FAR is approximately FRR

Impostor samples come from:
- **real impostor sessions**: tick "label my next run as an impostor session" and let someone else type (recommended)
- **synthetic impostors** (on by default, can be switched off): genuine vectors with per-feature rescaling (dwell x 0.65-1.45, flight x 0.55-1.55, jitter +/-15%). They are a crude baseline and **flatter the results**: real impostors share language and keyboard habits, so expect a worse EER with them.

## Privacy

- **Off by default**: explicit opt-in checkbox with a plain-language notice.
- **Local-first**: vectors and the profile stay in this browser's IndexedDB and are never uploaded. The server never sees biometric data. (Ranked runs upload that run's keystroke log for verification. That is a separate, documented flow, and the server does not derive biometric profiles.)
- **Minimal**: vectors are aggregates. The original text and per-keystroke sequence can't be reconstructed from them.
- **One-click delete**: "Delete all biometric data" clears vectors and profile and turns consent off. "Delete local history" in Settings removes keystroke logs.

## Ethics and limits

- Typing rhythm is **biometric data** (for example under GDPR Art. 9 when used to identify a person). Use it only with informed consent, for a stated purpose, and never covertly.
- **Not robust**: rhythm changes with fatigue, injury, keyboard, layout, posture, language and text. A one-off mismatch means nothing.
- **Small-sample statistics**: 5 runs of about 50 words give noisy means. Treat the EER as illustrative only.
- **Fairness**: people with motor impairments, tremor or assistive input methods may be systematically rejected. Never gate access on this signal.
- **Spoofable**: an attacker with a recorded trace of your timings can replay them (see THREAT_MODEL residual risks).
- **No inference beyond identity**: the demo doesn't try to infer emotion, health or demographics, and shouldn't.
