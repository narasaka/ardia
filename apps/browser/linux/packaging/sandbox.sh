ardia_read_number() { [[ -r "$1" ]] && tr -dc '0-9' < "$1" || echo "$2"; }

ardia_suid_ready() {
  local helper; helper="$(dirname "$1")/chrome-sandbox"
  [[ -f "$helper" ]] || return 1
  [[ "$(stat -c '%u' "$helper" 2>/dev/null)" == 0 ]] || return 1
  local mode; mode="$(stat -c '%a' "$helper" 2>/dev/null)"
  [[ ${#mode} -eq 4 && "${mode:0:1}" =~ [4567] ]] || return 1
  ! findmnt -n -o OPTIONS --target "$helper" 2>/dev/null | tr ',' '\n' | grep -qx nosuid
}

ardia_apparmor_allows_userns() {
  local binary; binary="$(readlink -f "$1")"
  local profile
  for profile in /etc/apparmor.d/*; do
    [[ -f "$profile" ]] || continue
    grep -qF "$binary" "$profile" 2>/dev/null && grep -qE '^\s*userns' "$profile" 2>/dev/null && return 0
  done
  return 1
}

ardia_userns_ready() {
  [[ "$(ardia_read_number /proc/sys/user/max_user_namespaces 1)" -gt 0 ]] || { ARDIA_SANDBOX_WHY="user namespaces are off (user.max_user_namespaces=0)"; return 1; }
  [[ "$(ardia_read_number /proc/sys/kernel/unprivileged_userns_clone 1)" != 0 ]] || { ARDIA_SANDBOX_WHY="unprivileged user namespaces are off (kernel.unprivileged_userns_clone=0)"; return 1; }
  if [[ "$(ardia_read_number /proc/sys/kernel/apparmor_restrict_unprivileged_userns 0)" == 1 ]] && ! ardia_apparmor_allows_userns "$1"; then
    ARDIA_SANDBOX_WHY="AppArmor restricts unprivileged user namespaces and no profile grants them to $(readlink -f "$1")"
    return 1
  fi
  return 0
}

ardia_sandbox_decide() {
  local binary="$1"
  ARDIA_SANDBOX_WHY=""
  ARDIA_SANDBOX_FLAGS=()
  if ardia_userns_ready "$binary"; then
    export ARDIA_SANDBOX_REASON="user namespaces"
  elif ardia_suid_ready "$binary"; then
    export ARDIA_SANDBOX_REASON="the setuid helper"
  else
    export ARDIA_SANDBOX_REASON="$ARDIA_SANDBOX_WHY, and chrome-sandbox isn't setuid root"
    ARDIA_SANDBOX_FLAGS=(--no-sandbox)
  fi
}
