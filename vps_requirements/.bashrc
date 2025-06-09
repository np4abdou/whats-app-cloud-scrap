
# Miniconda
# export PATH="/home/container/miniconda/bin:$PATH"  # commented out by conda initialize

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$('/home/container/miniconda/bin/conda' 'shell.bash' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/home/container/miniconda/etc/profile.d/conda.sh" ]; then
        . "/home/container/miniconda/etc/profile.d/conda.sh"
    else
        export PATH="/home/container/miniconda/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<

export PIP_CACHE_DIR=~/.cache/pip

# Node.js
export PATH="/home/container/node/bin:$PATH"
export npm_config_cache=~/.npm_cache
