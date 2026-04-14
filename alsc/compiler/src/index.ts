#!/usr/bin/env bun

import { runCli } from "./cli.ts";

process.exitCode = runCli(["validate", ...process.argv.slice(2)]);
