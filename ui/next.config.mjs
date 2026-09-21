import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ui/ imports types from ../service (src/lib/contract.ts), so pin the workspace root at the repo root
  // instead of letting Next guess from the nearest lockfile.
  turbopack: { root: repoRoot },
};

export default nextConfig;
