import { describe, expect, it } from "vitest";
import { z } from "zod";
import { costUsd, extractJson, toStrictJsonSchema } from "@/lib/muse";

describe("toStrictJsonSchema", () => {
  it("marks every object property required and closes objects", () => {
    const schema = toStrictJsonSchema(
      z.object({ a: z.string(), nested: z.array(z.object({ b: z.number(), c: z.string() })) }),
    ) as { required: string[]; additionalProperties: boolean; properties: { nested: { items: { required: string[]; additionalProperties: boolean } } } };
    expect(schema.required).toEqual(["a", "nested"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.nested.items.required).toEqual(["b", "c"]);
    expect(schema.properties.nested.items.additionalProperties).toBe(false);
  });
});

describe("extractJson", () => {
  it("parses plain, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a":3} thanks')).toEqual({ a: 3 });
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("costUsd", () => {
  it("prices input, cached input and output tokens", () => {
    expect(costUsd({ prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(4);
    expect(costUsd({ prompt_tokens: 0, completion_tokens: 1_000_000 })).toBeCloseTo(20);
    expect(costUsd({ prompt_tokens: 1_000_000, cached: 1_000_000 })).toBeCloseTo(0.2);
  });
});
