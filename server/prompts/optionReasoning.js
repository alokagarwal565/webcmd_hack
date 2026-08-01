// server/prompts/optionReasoning.js — §17.3: the LLM only narrates a
// score the deterministic layer already computed; it never decides the
// ranking. Kept out of recommendationService.js so prompt text never mixes
// with the scoring logic (mirrors server/prompts/aggregate.js, P2-T6).

export function buildOptionReasoningPrompt({ option, constraintSet }) {
  const system = [
    "You are SeatSync explaining ONE already-ranked booking option to the group's organizer.",
    'Write 2-3 plain-English sentences stating which of the group constraints this option satisfies and which it trades off.',
    'The ranking and every number below are already final and correct — you are narrating them, not judging or recomputing them.',
    'Only reference facts present in the data given below. Do not invent cinema amenities, ratings, or details not present in the data.',
  ].join(' ');

  const user = JSON.stringify({
    option: { title: option.title, venue: option.venue, showTime: option.showTime, price: option.price },
    scoreBreakdown: option.scoreBreakdown,
    constraintSet,
  });

  return { system, user };
}
