HUGO_VERSION=0.27.1

set -x
set -e

# Install Hugo if not already cached or upgrade an old version.
if [ ! -e $HOME/bin/hugo ] || ! [[ `hugo version` =~ v${HUGO_VERSION} ]]; then
  wget https://github.com/spf13/hugo/releases/download/v${HUGO_VERSION}/hugo_${HUGO_VERSION}_Linux-64bit.tar.gz
  tar xvzf hugo_${HUGO_VERSION}_Linux-64bit.tar.gz
  cp hugo $HOME/bin/hugo
fi
