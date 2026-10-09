#!/usr/bin/env node
// ai-buffer v0.4.0 is consumed from git. The tag does not include dist/,
// and its prepare script needs the package's own TypeScript install.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "node_modules", "ai-buffer", "dist", "index.js");
if (fs.existsSync(dist)) process.exit(0);

const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const config = path.join(root, "node_modules", "ai-buffer", "tsconfig.json");
execFileSync(
  process.execPath,
  [tsc, "-p", config, "--typeRoots", path.join(root, "node_modules", "@types")],
  { cwd: root, stdio: "inherit" },
);
