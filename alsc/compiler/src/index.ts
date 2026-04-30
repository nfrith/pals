#!/usr/bin/env bun

import { runCli } from "./cli.ts";

process.exitCode = runCli(process.argv.slice(2));
