#!/bin/bash
# Unified Miniconda + Node.js Installer for Container Environments
set -ex

# ===== Configuration =====
MINICONDA_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"
CONDA_DIR="$HOME/miniconda"
NODE_VERSION="24"            # Latest LTS
NODE_DIR="$HOME/node"

# Detect shell configuration file
SHELL_FILE="$HOME/.bashrc"
[ -f "$HOME/.bash_profile" ] && SHELL_FILE="$HOME/.bash_profile"
[ -f "$HOME/.zshrc" ] && SHELL_FILE="$HOME/.zshrc"
[ ! -f "$SHELL_FILE" ] && touch "$SHELL_FILE"

# ===== Miniconda Installation =====
echo "=== Installing Miniconda ==="
wget "$MINICONDA_URL" -O miniconda.sh || curl -L "$MINICONDA_URL" -o miniconda.sh
bash miniconda.sh -b -p "$CONDA_DIR"
rm miniconda.sh

# Add Conda to PATH
if ! grep -q "$CONDA_DIR/bin" "$SHELL_FILE"; then
    echo -e "\n# Miniconda" >> "$SHELL_FILE"
    echo "export PATH=\"$CONDA_DIR/bin:\$PATH\"" >> "$SHELL_FILE"
fi

# Initialize Conda
source "$SHELL_FILE"
conda init bash 2>/dev/null
conda config --set auto_activate_base false

# Create Python environment
conda create -n pyenv python=3.10 -y

# Configure pip cache
mkdir -p ~/.cache/pip
echo "export PIP_CACHE_DIR=~/.cache/pip" >> "$SHELL_FILE"

# ===== Node.js Installation =====
echo -e "\n=== Installing Node.js v$NODE_VERSION ==="
BASE_URL="https://nodejs.org/dist/latest-v$NODE_VERSION.x/"
FILE_NAME=$(curl -s $BASE_URL | grep -o 'node-v[0-9]*\.[0-9]*\.[0-9]*-linux-x64\.tar\.xz' | head -1)
DOWNLOAD_URL="${BASE_URL}${FILE_NAME}"

# Download and install
wget "$DOWNLOAD_URL" -O node.tar.xz || curl -L "$DOWNLOAD_URL" -o node.tar.xz
mkdir -p "$NODE_DIR"
tar -xJf node.tar.xz --strip-components=1 -C "$NODE_DIR"
rm node.tar.xz

# Add Node.js to PATH
if ! grep -q "$NODE_DIR/bin" "$SHELL_FILE"; then
    echo -e "\n# Node.js" >> "$SHELL_FILE"
    echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" >> "$SHELL_FILE"
fi

# Configure npm cache
mkdir -p ~/.npm_cache
echo "export npm_config_cache=~/.npm_cache" >> "$SHELL_FILE"

# ===== Finalization =====
source "$SHELL_FILE"

echo -e "\n=== Installation Complete ==="
echo "Miniconda installed to: $CONDA_DIR"
echo "Node.js installed to: $NODE_DIR"
echo -e "\nTo activate Python environment:"
echo "  conda activate pyenv"
echo -e "\nTo verify installations:"
echo "  python --version"
echo "  node --version"
echo "  npm --version"