# Research: MicroVMs, Firecracker, and AI Sandbox Infrastructure

Date: 2026-03-30

## MicroVMs

MicroVMs are stripped-down virtual machines designed for speed and density. Unlike traditional VMs that emulate full hardware (USB, GPU, etc.), microVMs only include the bare minimum devices needed to run a workload. They boot in ~125ms, use <5 MiB memory overhead, and thousands can be packed on a single host. They still get full hardware-level isolation via KVM -- each workload runs its own kernel.

## Firecracker

Firecracker is AWS's open-source microVM monitor (VMM), written in Rust. It powers AWS Lambda and AWS Fargate (trillions of function executions/month).

- Uses Linux KVM for hardware virtualization
- Only emulates 5 devices (virtio-net, virtio-block, virtio-vsock, serial console, minimal keyboard controller)
- Boots user code in ~125ms, supports 150 microVM creations/second/host
- Exposes a REST API to configure and launch VMs
- Minimalist attack surface by design

### How it works

1. Firecracker VMM process starts and exposes a RESTful API endpoint
2. You configure the microVM via API calls -- vCPUs, memory, network interfaces, block devices
3. You provide a Linux kernel image and root filesystem
4. Firecracker boots the guest kernel and launches user-space code
5. Entire process completes in ~125ms

## gVisor

Google's user-space kernel approach. Instead of running a full guest kernel, an "application kernel" called Sentry runs in user-space and intercepts all system calls made by the sandboxed process. It fulfills these requests itself in Go, making only a limited and carefully vetted set of its own system calls to the real host kernel. Lighter than a full microVM but still provides strong isolation.

## What Anthropic Uses

| Context | Technology |
|---|---|
| Claude Code (local CLI/desktop) | OS-level primitives -- Linux `bubblewrap`, macOS `seatbelt`. No containers or VMs. |
| Claude Code Web (cloud) | gVisor -- confirmed via reverse-engineering (runsc hostname, custom init process, JWT-authenticated egress proxy). Firecracker may sit underneath as the outer isolation layer. |
| API code execution tool | Sandboxed Python execution environment (public beta). Cloud infrastructure appears to use gVisor with Firecracker microVMs. |

Anthropic also open-sourced `sandbox-runtime` (github.com/anthropic-experimental/sandbox-runtime), a lightweight sandboxing tool that enforces filesystem and network restrictions at the OS level without containers.

## What OpenAI Uses

| Context | Technology |
|---|---|
| Code Interpreter (API) | gVisor -- uses Google's user-space kernel (Sentry) that intercepts all syscalls and re-implements them in Go. |
| API containers | Exposed as a "container" abstraction. Configurable memory limits (default 1GB, up to 4GB). Underlying microVM layer not confirmed. |

## Key Tradeoffs

- **gVisor**: Lighter, faster, container-like performance. Both Anthropic and OpenAI chose this as their primary sandbox isolation.
- **Firecracker**: Stronger hardware-boundary isolation but more resource overhead. Used as an additional outer layer or by third-party platforms like E2B.
- **OS-level primitives** (bubblewrap, seatbelt): Lightest weight, no VM or container overhead, but weaker isolation boundary. Suitable for local developer tools.

## Sources

- https://firecracker-microvm.github.io/
- https://www.amazon.science/blog/how-awss-firecracker-virtual-machines-work
- https://github.com/firecracker-microvm/firecracker
- https://www.anthropic.com/engineering/claude-code-sandboxing
- https://michaellivs.com/blog/sandboxed-execution-environment/
- https://michaellivs.com/blog/sandboxing-ai-agents-2026/
- https://itnext.io/openais-code-execution-runtime-replicating-sandboxing-infrastructure-a2574e22dc3c
- https://developers.openai.com/api/docs/guides/tools-code-interpreter
- https://github.com/anthropic-experimental/sandbox-runtime
- https://manveerc.substack.com/p/ai-agent-sandboxing-guide
