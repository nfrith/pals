#!/usr/bin/env bun

import { runCli } from "./cli.ts";

process.exit(runCli(["deploy", "claude", ...process.argv.slice(2)]));
