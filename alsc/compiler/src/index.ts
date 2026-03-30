#!/usr/bin/env bun

import { runCli } from "./cli.ts";

process.exit(runCli(["validate", ...process.argv.slice(2)]));
