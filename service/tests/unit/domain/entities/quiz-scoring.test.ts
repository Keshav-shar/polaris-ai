import { describe, expect, it } from "vitest";
import { publicQuiz, scoreAttempt } from "../../../../src/domain/entities/quiz-scoring";
import { PublicQuiz } from "../../../../src/domain/schemas/progress.schema";
import type { QuizQuestion } from "../../../../src/domain/schemas/quiz.schema";

const question = (answerIndex: number, n: number): QuizQuestion => ({
  question: `Question ${n}?`,
  options: ["a", "b", "c", "d"],
  answerIndex,
  explanation: `Because ${n}.`,
  evidenceUrl: `https://en.wikipedia.org/w/index.php?curid=${n}`,
});
const questions = [question(0, 1), question(2, 2), question(3, 3)];

describe("scoreAttempt (C106: scored on the server)", () => {
  it.each([
    { answers: [0, 2, 3], correct: 3, percent: 100, passed: true },
    { answers: [0, 2, 1], correct: 2, percent: 67, passed: false },
    { answers: [1, 1, 1], correct: 0, percent: 0, passed: false },
  ])("answers $answers -> $correct right", ({ answers, correct, percent, passed }) => {
    const scored = scoreAttempt(questions, answers);
    expect(scored).toMatchObject({ correct, total: 3, percent, passed });
    expect(scored.results.map((r) => r.correct)).toEqual(answers.map((a, i) => a === questions[i]?.answerIndex));
  });

  it("returns the key, the explanation and the source only in the result", () => {
    const [first] = scoreAttempt(questions, [1, 2, 3]).results;
    expect(first).toEqual({
      answerIndex: 0,
      chosenIndex: 1,
      correct: false,
      explanation: "Because 1.",
      evidenceUrl: "https://en.wikipedia.org/w/index.php?curid=1",
    });
  });

  it("refuses an attempt with the wrong number of answers", () => {
    expect(() => scoreAttempt(questions, [0, 2])).toThrow(RangeError);
  });
});

describe("publicQuiz", () => {
  it("strips the answer key and the explanations", () => {
    const nodeId = "22222222-2222-4222-8222-222222222222";
    const shown = publicQuiz({ nodeId, questions });
    expect(PublicQuiz.parse(shown)).toEqual(shown);
    const text = JSON.stringify(shown);
    expect(text).not.toContain("answerIndex");
    expect(text).not.toContain("Because");
    expect(shown.questions[0]).toEqual({ question: "Question 1?", options: ["a", "b", "c", "d"] });
  });
});
