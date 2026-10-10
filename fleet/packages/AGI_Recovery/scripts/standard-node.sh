#!/bin/sh
# Fresh-Mac bootstrap. Official Node archives are pinned in runtime-artifacts.lock.json.
# No sudo/global install; never deletes or repairs an existing runtime directory.
agi_standard_node() {
  if agi_select_node_24; then return 0; fi
  [ "$(/usr/bin/uname -s)" = Darwin ] || { agi_require_node_24; return $?; }
  case "$(/usr/bin/uname -m)" in
    arm64) agi_node_arch=arm64; agi_node_sha=6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe ;;
    x86_64) agi_node_arch=x64; agi_node_sha=0ae5a24c24bb7d015cd816c5036b3f90f2945aa872fcf54e58da054753b3a299 ;;
    *) printf '%s\n' 'Unsupported Mac architecture.' >&2; return 1 ;;
  esac
  agi_node_parent="$HOME/.agi-genesis-runtime"
  if [ -e "$agi_node_parent" ] || [ -L "$agi_node_parent" ]; then
    [ -d "$agi_node_parent" ] && [ ! -L "$agi_node_parent" ] && [ "$(/usr/bin/stat -f %u "$agi_node_parent")" = "$(/usr/bin/id -u)" ] && [ "$(/usr/bin/stat -f %Lp "$agi_node_parent")" = 700 ] || { printf '%s\n' 'Private runtime ownership needs review. Nothing was replaced.' >&2; return 1; }
  else
    (umask 077; /bin/mkdir "$agi_node_parent") || return 1
  fi
  agi_node_target="$agi_node_parent/node-24.21.0"
  if [ -e "$agi_node_target" ] || [ -L "$agi_node_target" ]; then
    printf '%s\n' 'An existing private Node preparation needs Advanced review. Preserve it; nothing was overwritten.' >&2
    return 1
  fi
  agi_node_stage=$(/usr/bin/mktemp -d "$agi_node_parent/.node-preparing.XXXXXXXX") || return 1
  agi_node_archive="$agi_node_stage/node.tar.xz"
  printf '%s\n' 'Preparing the pinned Node 24.21.0 runtime in this account…'
  if ! /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 600 "https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-$agi_node_arch.tar.xz" --output "$agi_node_archive"; then
    printf '%s\n' 'Node download did not finish. Its private preparation was preserved.' >&2; return 1
  fi
  agi_node_actual=$(/usr/bin/shasum -a 256 "$agi_node_archive") || return 1
  [ "${agi_node_actual%% *}" = "$agi_node_sha" ] || { printf '%s\n' 'Node archive integrity failed. No downloaded code was executed.' >&2; return 1; }
  /usr/bin/tar -xJf "$agi_node_archive" -C "$agi_node_stage" || return 1
  agi_node_extracted="$agi_node_stage/node-v24.21.0-darwin-$agi_node_arch"
  [ -d "$agi_node_extracted" ] && [ ! -L "$agi_node_extracted" ] && [ -f "$agi_node_extracted/bin/node" ] && [ ! -L "$agi_node_extracted/bin/node" ] || return 1
  /bin/chmod -R go-w "$agi_node_extracted" || return 1
  /bin/chmod 700 "$agi_node_extracted" || return 1
  /usr/bin/env -i HOME="$HOME" PATH=/usr/bin:/bin "$agi_node_extracted/bin/node" -e 'if(process.versions.node!=="24.21.0")process.exit(1)' || return 1
  [ ! -e "$agi_node_target" ] && [ ! -L "$agi_node_target" ] || return 1
  /bin/mv "$agi_node_extracted" "$agi_node_target" || return 1
  AGI_RUNTIME_NODE="$agi_node_target/bin/node"
  printf '%s\n' 'Pinned Node runtime ready. Existing profiles and signing material were not accessed.'
}
