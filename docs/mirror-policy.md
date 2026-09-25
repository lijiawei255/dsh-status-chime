# Mirror policy: what is published, what is local, and what differs

This project has two roles at once. The repository is what other people install, and it is
also what runs on the author's machine. Those two must not drift, because drift is invisible:
a version string stays identical while the code behind it changes, and the local run then
tests something nobody can download.

This file states the rule, the exceptions, and how both are checked.

## The rule

**Code and audio are mirrored byte for byte. Wording is the only sanctioned difference, and
it is one-directional: the private master is authoritative, the published copy is the same
thing described in neutral terms.**

The corollary matters more than the rule: nothing is only-tested-locally. `--all` mirror
checks and the whole offline suite run against the same files that get pushed.

## What is identical, byte for byte

| Local | Published |
|---|---|
| `<profile>/<name>.js` (single-file install) | `lib/index.js` |
| `$DSH_HOME/voice-alerts/clips/**` | `assets/clips/**` (8 scenes × 2 languages × 2 formats = 32 files) |
| `$DSH_HOME/voice-alerts/play.ps1` | `assets/play.ps1` |

`node scripts/sync-profile.mjs --all --check` compares all three by size and SHA-256 and
prints `PARITY` or `DRIFT` per target; `--apply` copies, and only over the file it names in
its output. This is not a formality — the local copy behind this policy was found three
commits and one host-API migration behind the repository while both files claimed the same
version. A hash noticed; a version number could not.

## What is deliberately different

### `$DSH_HOME/voice-alerts/clips.json` (private master) vs `assets/clips.json` (published)

The 32 audio files were generated once, from the **private master**, and the repository ships
exactly those files — nothing was regenerated for publication. What differs is only the
manifest's prose and its audition bookkeeping:

| Difference | Why it is not a functional difference |
|---|---|
| Comments and notes (`_comment`, `_voiceNote`, `_candidateNote`, `_languagesNote`, `_consistencyNote`) | Prose. Nothing reads them. |
| `instruction` (the style prompt handed to TTS) | It describes the **same acoustic target** in neutral terms. The audio was already generated; this field affects a future regeneration only, and any regeneration would land in the same style range rather than byte-for-byte anyway (`_consistencyNote` says so). |
| `voiceCandidates` — ids, labels, instructions, and two extra pitch-variant entries | The audition shortlist. The shipped choice is named `flash-yuanfei-expressive` in the published manifest and by a more colloquial name privately; the same underlying voice (`longanyuanfei`) is locked in at the top level. |
| `chosenCandidate` | The name of that shortlist entry. |

**Everything that determines the audio is identical**, and that is asserted rather than
asserted-about: `sync-profile.mjs` classifies every differing field path and requires the
functional count to be **0** — model, voice, rate, pitch, volume, format, sampleRate,
`loudnorm`, and every spoken line including the English ones. The check is conservative by
design: a field nobody has classified is counted as functional, so a new key cannot slip
through as "probably just wording". If a functional path ever differs, the tool exits 3 and
says so, because no `--apply` can resolve it — that difference has to be decided by hand.

### The audio itself carries no prompt text

Worth checking rather than assuming, since TTS tooling sometimes writes the request into the
file: **all 32 shipped clips were scanned for the private wording and for prompt text at the
byte level.** The MP3 containers carry an ID3 tag whose only fields are `LAME3.100` and the
encoder name; no Chinese text appears anywhere in any clip. The one apparent hit — a single
CJK character that also appears in the forbidden-word list, in `needs-input.mp3` — sits at
byte offset 28804 of 34634, in the middle of compressed audio data with random neighbours,
i.e. a three-byte coincidence rather than a tag. (It is not quoted here: the local wording
scan flagged the first draft of this paragraph for containing it, at this exact line, which is
the gate doing its job.) Nothing was regenerated to achieve this; the audio was already clean.

### `$DSH_HOME/voice-alerts/voice-alerts.config.json`

This machine's settings. Never published, never mirrored, never overwritten.

### Wording, and how the private list stays private

The private master describes the voice in terms this project does not publish. The published
manifest carries the same acoustic target in neutral wording — "a mature, composed adult
female voice … not girlish, not exaggerated, and not flat or mechanical" — and **the published
wording is what ships and what runs locally**, since the mirrored plugin file is one file.

The list of words that must not appear in the repository lives in
`$DSH_HOME/voice-alerts.scan.json`, outside every clone, and is enforced by
`node scripts/scan-sensitive.mjs .`. That scanner prints **file, line and category only** and
never echoes what it matched, so its output is safe to paste into an issue, a CI log or a
chat — the check cannot become a second copy of the thing it checks for.

Two things follow, and both are limits worth stating rather than papering over:

- **CI cannot run this check.** A GitHub runner has no `$DSH_HOME`, so CI applies the
  built-in rules only — credentials, key shapes, personal paths. The wording rules protect the
  author's machine at commit time. This is a real gap, and the reason the paragraph below
  exists.
- **Positive control:** scanning the private directory
  (`node scripts/scan-sensitive.mjs "$DSH_HOME/voice-alerts"`) **must** report hits. If it
  comes back clean, the local rules stopped loading and the gate is silently open.

## One thing that is not a wording difference

`maturity` / 「成熟度」 stays. It is a scoring dimension of `scripts/qa.mjs`
(`ADVISORY_DIMENSIONS = ['naturalness', 'character', 'maturity']`) and a plain descriptor of
how old a voice sounds, not a description of its appeal — the same register as the shipped
"mature, composed adult female voice". Removing it would make the documentation contradict the
tool that produces the numbers.

## For contributors

Writing about the voice in this repository? Describe the **acoustic target and the ranking** —
which candidate won, and on what grounds — not the appeal. That keeps the documentation
reviewable by anyone, and keeps the published copy a faithful description of the same audio
rather than a different pitch for it.
