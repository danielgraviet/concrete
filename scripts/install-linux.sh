#!/usr/bin/env sh
# Install (or update) the latest Concrete AppImage for the current user.
# No sudo, Node.js, npm, or Git checkout is required.
set -eu

repo='danielgraviet/concrete'
arch=$(uname -m)

case "$arch" in
  x86_64|amd64) ;;
  *)
    printf '%s\n' "Concrete currently publishes Linux builds for x86_64 only (this machine is $arch)." >&2
    exit 1
    ;;
esac

case "${1:-}" in
  '') api_url="https://api.github.com/repos/$repo/releases/latest" ;;
  --version)
    tag=${2:-}
    if [ -z "$tag" ]; then
      printf '%s\n' 'Usage: install-linux.sh [--version vX.Y.Z]' >&2
      exit 2
    fi
    api_url="https://api.github.com/repos/$repo/releases/tags/$tag"
    ;;
  --help|-h)
    printf '%s\n' 'Usage: install-linux.sh [--version vX.Y.Z]'
    exit 0
    ;;
  *)
    printf '%s\n' 'Usage: install-linux.sh [--version vX.Y.Z]' >&2
    exit 2
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' 'Concrete installer needs curl. Install curl with your distribution package manager and try again.' >&2
  exit 1
fi

# Avoid depending on jq: GitHub's release API exposes a browser URL for each
# asset, and release asset names are controlled by electron-builder.
release_json=$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api_url") || {
  printf '%s\n' 'Could not retrieve a Concrete release from GitHub.' >&2
  exit 1
}
asset_url=$(printf '%s' "$release_json" | tr '\n' ' ' | sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*Concrete-[^"]*\.AppImage\)".*/\1/p')

if [ -z "$asset_url" ]; then
  printf '%s\n' 'The selected release has no Linux AppImage asset yet.' >&2
  exit 1
fi

data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
install_dir="$data_home/concrete"
bin_dir="$HOME/.local/bin"
applications_dir="$data_home/applications"
app_path="$install_dir/Concrete.AppImage"
wrapper_path="$bin_dir/concrete"
desktop_path="$applications_dir/concrete.desktop"

mkdir -p "$install_dir" "$bin_dir" "$applications_dir"
temporary_app=$(mktemp "$install_dir/.Concrete.AppImage.XXXXXX")
trap 'rm -f "$temporary_app"' EXIT HUP INT TERM

printf '%s\n' 'Downloading Concrete…'
curl -fL --progress-bar "$asset_url" -o "$temporary_app"
chmod 755 "$temporary_app"
mv -f "$temporary_app" "$app_path"

printf '%s\n' '#!/usr/bin/env sh' "exec \"$app_path\" \"\$@\"" >"$wrapper_path"
chmod 755 "$wrapper_path"

# A desktop entry lets users launch Concrete from their application menu even
# when ~/.local/bin is not inherited by the desktop session.
desktop_exec=$(printf '%s' "$wrapper_path" | sed 's/\\/\\\\/g; s/ /\\ /g')
printf '%s\n' \
  '[Desktop Entry]' \
  'Type=Application' \
  'Name=Concrete' \
  'Comment=A local Markdown workspace for learning' \
  "Exec=$desktop_exec %U" \
  'Terminal=false' \
  'Categories=Office;Education;' \
  'StartupWMClass=concrete' >"$desktop_path"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications_dir" >/dev/null 2>&1 || true
fi

trap - EXIT HUP INT TERM
printf '%s\n' "Concrete installed to $app_path"
printf '%s\n' 'Launch it from your application menu, or run: concrete'
if ! printf '%s' ":$PATH:" | grep -q ":$bin_dir:"; then
  printf '%s\n' "Tip: add $bin_dir to PATH to use the concrete command in new terminals."
fi
