import { describe, expect, it } from "vitest";
import { QuizOutput } from "../../../../src/domain/schemas/quiz.schema";

const question = {
  question: "What does chlorophyll absorb?",
  options: ["Light", "Water", "Soil", "Oxygen"],
  answerIndex: 0,
  explanation: "Chlorophyll absorbs light energy.",
  evidenceUrl: "https://example.org/chlorophyll",
};
const quiz = (n: number) => ({ questions: Array.from({ length: n }, () => question) });

describe("QuizOutput", () => {
  it("requires exactly QUESTIONS_PER_TOPIC (5) questions", () => {
    expect(QuizOutput.safeParse(quiz(5)).success).toBe(true);
    expect(QuizOutput.safeParse(quiz(4)).success).toBe(false);
    expect(QuizOutput.safeParse(quiz(6)).success).toBe(false);
  });

  it("requires four options and an answer index inside them", () => {
    const bad = (q: Partial<typeof question>) => ({ questions: Array.from({ length: 5 }, () => ({ ...question, ...q })) });
    expect(QuizOutput.safeParse(bad({ answerIndex: 4 })).success).toBe(false);
    expect(QuizOutput.safeParse(bad({ options: ["a", "b", "c"] })).success).toBe(false);
  });

  it("requires every question to cite an evidence URL", () => {
    const bad = { questions: Array.from({ length: 5 }, () => ({ ...question, evidenceUrl: "" })) };
    expect(QuizOutput.safeParse(bad).success).toBe(false);
  });
});
