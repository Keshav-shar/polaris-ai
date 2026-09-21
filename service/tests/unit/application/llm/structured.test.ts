import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createStructuredGenerator, extractJson } from "../../../../src/application/llm/structured";
import type { ChatMessage, ChatOptions, LlmPort } from "../../../../src/application/ports/llm.port";
import { LLM, TEMPERATURE_BY_LABEL } from "../../../../src/config/constants";
import { DomainError } from "../../../../src/domain/errors/domain-error";
import { StructuredOutputError } from "../../../../src/domain/errors/structured-output.error";

// Replies in order and records a copy of each call's messages.
function scriptedLlm(replies: string[]) {
  const calls: { messages: ChatMessage[]; options?: ChatOptions }[] = [];
  const llm: LlmPort = {
    chat: async (messages, options) => {
      calls.push({ messages: [...messages], options });
      const reply = replies.shift();
      if (reply === undefined) throw new Error("no scripted reply left");
      return reply;
    },
  };
  return { llm, calls };
}

const Schema = z.object({ ok: z.literal(true) });
const request = { schema: Schema, system: "sys", user: "usr", label: "test" };

describe("extractJson", () => {
  it("reads a fenced block", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("takes the outermost braces from surrounding prose", () => {
    expect(extractJson('Sure! Here it is: {"a": {"b": 2}} Hope that helps.')).toEqual({
      ok: true,
      value: { a: { b: 2 } },
    });
  });

  it("reports invalid or missing JSON without throwing", () => {
    expect(extractJson("{not json}").ok).toBe(false);
    expect(extractJson("no braces here").ok).toBe(false);
  });
});

describe("createStructuredGenerator", () => {
  it("returns parsed data from a valid first reply, asking for JSON mode", async () => {
    const { llm, calls } = scriptedLlm(['{"ok": true}']);
    await expect(createStructuredGenerator(llm)(request)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options).toEqual({ json: true });
    expect(calls[0]!.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });

  it("repairs once: sends the bad reply and the validation error back", async () => {
    const { llm, calls } = scriptedLlm(['{"ok": false}', '{"ok": true}']);
    await expect(createStructuredGenerator(llm)(request)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    const repair = calls[1]!.messages;
    expect(repair[2]).toEqual({ role: "assistant", content: '{"ok": false}' });
    expect(repair[3]!.role).toBe("user");
    expect(repair[3]!.content).toContain("Your reply was invalid");
    expect(repair[3]!.content).toContain("ok");
  });

  it("throws StructuredOutputError after MAX_REPAIR_ATTEMPTS repairs", async () => {
    const { llm, calls } = scriptedLlm(["nope", "nope", "nope", "nope"]);
    const error = await createStructuredGenerator(llm)(request).catch((e: unknown) => e);
    expect(calls).toHaveLength(1 + LLM.MAX_REPAIR_ATTEMPTS);
    expect(error).toBeInstanceOf(StructuredOutputError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "STRUCTURED_OUTPUT_INVALID", label: "test" });
  });

  it("uses the per-label temperature and passes temperature and seed on every attempt, repairs included", async () => {
    const { llm, calls } = scriptedLlm(['{"ok": false}', '{"ok": true}']);
    await createStructuredGenerator(llm)({ ...request, label: "parser", seed: 7 });
    expect(calls.map((c) => c.options)).toEqual([
      { json: true, temperature: TEMPERATURE_BY_LABEL.parser, seed: 7 },
      { json: true, temperature: TEMPERATURE_BY_LABEL.parser, seed: 7 },
    ]);
  });

  it("lets an explicit temperature win and leaves it unset for labels without a default", async () => {
    const explicit = scriptedLlm(['{"ok": true}']);
    await createStructuredGenerator(explicit.llm)({ ...request, label: "parser", temperature: 0.5 });
    expect(explicit.calls[0]!.options?.temperature).toBe(0.5);

    const unlabeled = scriptedLlm(['{"ok": true}']);
    await createStructuredGenerator(unlabeled.llm)({ ...request, label: "expand" });
    expect(unlabeled.calls[0]!.options?.temperature).toBeUndefined();
  });

  it("propagates transport errors without retrying", async () => {
    let count = 0;
    const llm: LlmPort = {
      chat: async () => {
        count++;
        throw new Error("network down");
      },
    };
    await expect(createStructuredGenerator(llm)(request)).rejects.toThrow("network down");
    expect(count).toBe(1);
  });
});
