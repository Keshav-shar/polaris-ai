import { describe, expect, it } from "vitest";
import { canReadRun, isRunOwner } from "../../../../src/domain/entities/run-access";

const owner = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const other = { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };

describe("canReadRun (C105)", () => {
  it("lets only the owner read a private run", () => {
    const run = { ownerId: owner.userId, visibility: "private" as const };
    expect(canReadRun(run, owner)).toBe(true);
    expect(canReadRun(run, other)).toBe(false);
    expect(canReadRun(run, undefined)).toBe(false);
  });

  it("treats a missing visibility on an owned run as private, never as open", () => {
    expect(canReadRun({ ownerId: owner.userId }, undefined)).toBe(false);
  });

  it("lets anyone read an unlisted or public run", () => {
    for (const visibility of ["unlisted", "public"] as const) {
      expect(canReadRun({ ownerId: owner.userId, visibility }, undefined)).toBe(true);
      expect(canReadRun({ ownerId: owner.userId, visibility }, other)).toBe(true);
    }
  });

  it("lets anyone read an ownerless run (auth off, C137)", () => {
    expect(canReadRun({}, undefined)).toBe(true);
  });
});

describe("isRunOwner", () => {
  it("is true for the owner only, and never for an ownerless run", () => {
    expect(isRunOwner({ ownerId: owner.userId }, owner)).toBe(true);
    expect(isRunOwner({ ownerId: owner.userId }, other)).toBe(false);
    expect(isRunOwner({ ownerId: owner.userId }, undefined)).toBe(false);
    expect(isRunOwner({}, owner)).toBe(false);
  });
});
