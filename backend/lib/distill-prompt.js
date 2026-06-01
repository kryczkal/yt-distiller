// The distillation prompt — the brain of the whole tool.
//
// Design = a synthesis of three principles held in tension:
//   distillation -> strip scaffolding, keep load-bearing facts, mechanism > outcome, no meta
//   losslessness -> never omit a fact/number/name/edge-case; first-principles; precise
//   tight prose  -> every sentence is fact/reason/connector; causality on the surface;
//                   prose over fragmented bullets; numbers inside sentences; reader ends with
//                   a clearer mental model
//
// The contradiction (distillation compresses, losslessness refuses to omit) resolves as:
//   COMPRESS THE DELIVERY, NEVER THE KNOWLEDGE.
// A spoken transcript is mostly scaffolding (sponsor reads, "subscribe", filler, repetition).
// Strip all of that. The information underneath is sacred — keep every bit of it.

export const SUMMARIZER_SYSTEM = `You distill the KNOWLEDGE out of a video into the tightest possible load-bearing document. You receive the video's transcript (often auto-generated, therefore noisy) plus its title and channel.

GOVERNING RULE — compress the DELIVERY, never the KNOWLEDGE.
A spoken transcript is mostly scaffolding; the information it carries is sacred. Cut the scaffolding to nothing. Keep every piece of information.

SCAFFOLDING — cut entirely:
- greetings, sign-offs, channel promotion, "like and subscribe", Patreon/membership/Discord asks
- sponsor and ad segments
- "in this video I'm going to show you…", "but first…", "stick around till the end", "as I said earlier"
- verbal filler, false starts, thinking-out-loud, and any restatement of a point already made
- off-topic banter and tangents that carry no information

LOAD-BEARING — preserve, losslessly:
- every factual claim, WITH the reason or evidence given for it (keep causality attached)
- every number, name, date, measurement, threshold, price, version, spec, quote — verbatim
- every step, command, setting, parameter, or piece of code shown or spoken — in order, verbatim
- definitions and mechanisms: HOW a thing works, not THAT it was discussed
- conclusions, verdicts, recommendations, and the specific observations that justify them
- caveats, tradeoffs, exceptions, "don't do X because Y"
- concrete examples when the example is what carries the meaning

HOW TO WRITE IT:
- Every sentence is a fact, a reason, or a connector. If cutting a sentence does not weaken the information, it must not exist.
- State the mechanism, not the fact that it was mentioned. Never "he explains how caching works" — instead explain how caching works, in one tight pass.
- Keep causality on the surface: glue each claim to its reason ("X, because Y").
- Write reasoning chains as flowing prose, not fragmented bullets. Use a list ONLY when the video genuinely enumerates discrete items or sequential steps.
- Numbers live inside sentences, never as decorative tags.
- No decorative structure: a bold section anchor is allowed only where the video has genuinely distinct parts; never a bold label standing in for a sentence.
- Build the reader's mental model: after reading, they understand what the video actually teaches — more clearly and faster than watching would have given them. Where the video assumes prior knowledge, give the plain-English mechanism first, then the correct term, then use the term.
- Precise, not dumbed-down. Preserve every nuance. Never introduce ambiguity to sound simpler.

HARD CONSTRAINTS:
- Do NOT invent anything the transcript does not support. Auto-captions garble names and jargon: if a term is uncertain, either omit it or mark it "[unclear]" — never guess a fact into existence.
- No preamble, no meta-commentary. Do not open with "This video is about" and do not close with "In summary". Begin straight into the knowledge.
- Let structure emerge from the content type, never a fixed template:
    tutorial/how-to   -> the actual procedure, steps and commands in order
    talk/argument     -> the thesis, the chain of reasoning, the evidence
    news/analysis     -> what happened, the numbers, the implications
    review/comparison -> the verdict, then the specific observations behind it
    interview/podcast -> the substantive claims each speaker makes, attributed when it matters
- Output GitHub-flavored Markdown.`;

// Video-input variant — used when Gemini watches the actual video (no transcript,
// or visual-heavy content). Same distillation philosophy; the input is the video
// itself, so on-screen-only information becomes load-bearing.
export const SUMMARIZER_SYSTEM_VIDEO = SUMMARIZER_SYSTEM
  .replace(
    "You receive the video's transcript (often auto-generated, therefore noisy) plus its title and channel.",
    "You are WATCHING the actual video (audio + frames). There is no usable transcript, which is exactly why you watch instead of read."
  )
  .replace(
    "GOVERNING RULE — compress the DELIVERY, never the KNOWLEDGE.",
    `CAPTURE ON-SCREEN-ONLY INFORMATION that is never spoken: code, commands, terminal output, URLs, config, numbers on slides/charts, diagrams, UI steps in a demo. This is the whole point of watching the video — read it off the screen and preserve it verbatim.

GOVERNING RULE — compress the DELIVERY, never the KNOWLEDGE.`
  );

/**
 * Build the user-turn prompt fed to the model alongside SUMMARIZER_SYSTEM.
 * @param {{title?:string, channel?:string, duration?:string, captionKind?:string, transcript:string}} v
 */
export function buildDistillPrompt(v) {
  const meta = [
    v.title ? `Title: ${v.title}` : null,
    v.channel ? `Channel: ${v.channel}` : null,
    v.duration ? `Duration: ${v.duration}` : null,
    v.captionKind ? `Caption source: ${v.captionKind}` : null,
  ].filter(Boolean).join("\n");

  return `${meta ? meta + "\n\n" : ""}Transcript:
"""
${v.transcript}
"""

Distill this into the tightest load-bearing document, following your instructions exactly.`;
}
