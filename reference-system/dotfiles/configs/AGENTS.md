# dotfiles/configs/

Individual tool configuration records as `CFG-NNNN.md`.

## Creating Configs

One config per tool per context. If `zsh` has separate configs for work and personal machines, those are separate records. The `tool` field is the tool name (`zsh`, `git`, `tmux`, `neovim`), not the config filename.

PURPOSE answers "what does this config do and why does it exist" — not "run `brew install` and then copy this file." If you're writing setup instructions, you're in the wrong section.

NOTES is where you put the things that will save someone an hour of debugging. The weird flag that has to be set on Apple Silicon. The env var that conflicts with another tool. The ordering dependency nobody documents.
