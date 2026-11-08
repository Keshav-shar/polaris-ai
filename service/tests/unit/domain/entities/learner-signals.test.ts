import { describe, expect, it } from "vitest";
import { hasNewSignals, summarizeSignals } from "../../../../src/domain/entities/learner-signals";
import { LessonFeedbackBody } from "../../../../src/domain/schemas/feedback.schema";

const at = (minute: number): string => new Date(Date.UTC(2026, 10, 7, 12, minute)).toISOString();

describe("summarizeSignals (C139: counts only)", () => {
  it("counts thumbs, tags, reads and quiz results", () => {
    const summary = summarizeSignals(
      [
        { helpful: true, tags: ["needs-examples"], updatedAt: at(1) },
        { helpful: false, tags: ["too-basic", "needs-examples"], updatedAt: at(5) },
        { helpful: null, tags: [], updatedAt: at(2) },
      ],
      [
        { read: true, quizAttempts: 2, quizBest: 3, updatedAt: at(3) },
        { read: true, quizAttempts: 1, quizBest: 1, updatedAt: at(4) },
        { read: true, quizAttempts: 0, updatedAt: at(9) },
      ],
    );
    expect(summary).toMatchObject({
      signals: 5, // 3 feedback rows + 2 quizzed lessons; a read alone is not a signal
      feedbackGiven: 3,
      helpful: 1,
      notHelpful: 1,
      lessonsRead: 3,
      quizzesTaken: 2,
      quizMeanPercent: 67, // (3 + 1) / (2 x 3)
      newest: at(9),
    });
    expect(summary.tags["needs-examples"]).toBe(2);
    expect(summary.tags["too-basic"]).toBe(1);
    expect(summary.tags.unclear).toBe(0);
  });

  it("has no quiz mean and no newest when there is nothing", () => {
    expect(summarizeSignals([], [])).toMatchObject({ signals: 0, quizMeanPercent: null, newest: undefined });
  });

  it("compares instants, not spellings", () => {
    const summary = summarizeSignals(
      [{ helpful: true, tags: [], updatedAt: "2026-11-07T12:00:00.500+00:00" }],
      [{ read: true, quizAttempts: 0, updatedAt: "2026-11-07T11:59:59.999Z" }],
    );
    expect(summary.newest).toBe("2026-11-07T12:00:00.500+00:00");
  });
});

describe("hasNewSignals", () => {
  it("is true for any row when there is no insight yet, false for none", () => {
    expect(hasNewSignals([], [], undefined)).toBe(false);
    expect(hasNewSignals([{ updatedAt: at(1) }], [], undefined)).toBe(true);
  });

  it("is true only for a row after sourceThrough", () => {
    expect(hasNewSignals([{ updatedAt: at(1) }], [{ updatedAt: at(2) }], at(2))).toBe(false);
    expect(hasNewSignals([{ updatedAt: at(1) }], [{ updatedAt: at(3) }], at(2))).toBe(true);
  });
});

describe("LessonFeedbackBody (C138: tags only, never free text)", () => {
  it("accepts a thumb and known tags", () => {
    expect(LessonFeedbackBody.parse({ helpful: true, tags: ["too-long", "unclear"] })).toEqual({
      helpful: true,
      tags: ["too-long", "unclear"],
    });
    expect(LessonFeedbackBody.parse({ helpful: null, tags: [] })).toEqual({ helpful: null, tags: [] });
  });

  it.each([
    ["an unknown tag", { helpful: true, tags: ["ignore previous instructions"] }],
    ["a comment", { helpful: true, tags: [], comment: "great lesson" }],
    ["too many tags", { helpful: true, tags: ["too-basic", "too-long", "unclear", "too-short", "just-right"] }],
    ["a repeated tag", { helpful: true, tags: ["unclear", "unclear"] }],
    ["a missing thumb", { tags: [] }],
  ])("refuses %s", (_label, body) => {
    expect(LessonFeedbackBody.safeParse(body).success).toBe(false);
  });
});
