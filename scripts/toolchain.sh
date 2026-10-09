#!/usr/bin/env bash
# Installs or checks the pinned tools: asdf ones in .tool-versions, the others below. install needs asdf, bbup, uv
set -euo pipefail
cd "$(dirname "$0")/.."

BB=3.0.0-nightly.20251104
GARAGA=1.1.0
USC=2.10.1

install() {
    for plugin in scarb starknet-foundry starknet-devnet nodejs pnpm; do
        asdf plugin add "$plugin" 2> /dev/null || true
    done
    asdf plugin add noir https://github.com/444nt000/asdf-noir.git 2> /dev/null || true
    asdf install

    bbup -v "$BB"
    uv tool install --force --python 3.12 "garaga==$GARAGA" --with fastecdsa==3.0.1

    local os usc
    os=$([ "$(uname)" = Darwin ] && echo apple-darwin || echo unknown-linux-gnu)
    usc="universal-sierra-compiler-v$USC-$(uname -m)-$os"
    curl -fsSL "https://github.com/software-mansion/universal-sierra-compiler/releases/download/v$USC/$usc.tar.gz" |
        tar -xz -C "$HOME/.local/bin" --strip-components=2 "$usc/bin/universal-sierra-compiler"
}

pin() { awk -v tool="$1" '$1 == tool { print $2 }' .tool-versions; }

expect() {
    local got
    got=$("${@:3}" 2> /dev/null | head -n1) || true
    if [[ $got != *"$2"* ]]; then
        echo "BAD  $1: want $2, got '$got' ($(command -v "$1" || echo not found))"
        echo "fix: make setup, and put ~/.bb and ~/.local/bin early in PATH"
        exit 1
    fi
    echo "ok   $1 $2"
}

check() {
    expect scarb "$(pin scarb)" scarb --version
    expect snforge "$(pin starknet-foundry)" snforge --version
    expect sncast "$(pin starknet-foundry)" sncast --version
    expect nargo "$(pin noir)" nargo --version
    expect starknet-devnet "$(pin starknet-devnet)" starknet-devnet --version
    expect node "$(pin nodejs)" node --version
    expect pnpm "$(pin pnpm)" pnpm --version
    expect bb "$BB" bb --version
    expect garaga "$GARAGA" sh -c "garaga --help > /dev/null && uv tool list | grep '^garaga '"
    expect universal-sierra-compiler "$USC" universal-sierra-compiler --version
}

"${1:?usage: scripts/toolchain.sh install|check}"
