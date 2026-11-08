import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { zip } from "../../../scripts/zip-writer";

// Reads the archive back by its own directory, the way an unzip tool does: end record -> central directory -> local
// header -> deflated bytes. (The build itself is also checked with an independent unzip, Windows bsdtar.)
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const crc = archive.readUInt32LE(at + 16);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const localAt = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    expect(archive.readUInt32LE(localAt)).toBe(0x04034b50);
    const dataAt = localAt + 30 + archive.readUInt16LE(localAt + 26) + archive.readUInt16LE(localAt + 28);
    const data = inflateRawSync(archive.subarray(dataAt, dataAt + size));
    expect(crc32(data) >>> 0).toBe(crc);
    files.set(name, data);
    at += 46 + nameLength;
  }
  return files;
}

describe("zip writer (Lambda bundles)", () => {
  it("round-trips several files byte for byte, CRCs included", () => {
    const big = Buffer.from("export const handler = () => 1;\n".repeat(5_000));
    const files = unzip(zip([{ name: "index.mjs", data: big }, { name: "nested/äö.txt", data: Buffer.from("ü") }]));
    expect(files.get("index.mjs")?.equals(big)).toBe(true);
    expect(files.get("nested/äö.txt")?.toString()).toBe("ü");
  });

  it("is deterministic: the same input gives the same bytes", () => {
    const entries = [{ name: "index.mjs", data: Buffer.from("x") }];
    expect(zip(entries).equals(zip(entries))).toBe(true);
  });
});
