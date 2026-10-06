import { describe, expect, it } from "vitest";
import { QuizOutput } from "../../../../src/domain/schemas/quiz.schema";
import { QUIZ_CONFIG } from "../../../../src/config/constants";

const question = {
  question: "What does chlorophyll absorb?",
  options: ["Light", "Water", "Soil", "Oxygen"],
  answerIndex: 0,
  explanation: "Chlorophyll absorbs light energy.",
  evidenceUrl: "https://example.org/chlorophyll",
};
const quiz = (n: number) => ({ questions: Array.from({ length: n }, () => question) });

describe("QuizOutput", () => {
  it("requires exactly QUESTIONS_PER_TOPIC questions", () => {
    // Driven from the constant, not a literal: the title always said QUESTIONS_PER_TOPIC while the body
    // hardcoded 5, so changing the sitewide count (C74: 5 -> 3) broke a test that should have followed it.
    const n = QUIZ_CONFIG.QUESTIONS_PER_TOPIC;
    expect(QuizOutput.safeParse(quiz(n)).success).toBe(true);
    expect(QuizOutput.safeParse(quiz(n - 1)).success).toBe(false);
    expect(QuizOutput.safeParse(quiz(n + 1)).success).toBe(false);
  });

  it("requires four options and an answer index inside them", () => {
    const bad = (q: Partial<typeof question>) => ({
      questions: Array.from({ length: QUIZ_CONFIG.QUESTIONS_PER_TOPIC }, () => ({ ...question, ...q })),
    });
    expect(QuizOutput.safeParse(bad({ answerIndex: 4 })).success).toBe(false);
    expect(QuizOutput.safeParse(bad({ options: ["a", "b", "c"] })).success).toBe(false);
  });

  it("requires every question to cite an evidence URL", () => {
    const bad = {
      questions: Array.from({ length: QUIZ_CONFIG.QUESTIONS_PER_TOPIC }, () => ({ ...question, evidenceUrl: "" })),
    };
    expect(QuizOutput.safeParse(bad).success).toBe(false);
  });
});
