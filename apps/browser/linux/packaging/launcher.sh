here="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
binary="$here/ardia.bin"
export ARDIA_LAUNCHER="${APPIMAGE:-$(readlink -f "${BASH_SOURCE[0]}")}"
for argument in "$@"; do
  [[ "$argument" == --no-sandbox ]] && { export ARDIA_SANDBOX_REASON="--no-sandbox was passed"; exec -a ardia "$binary" "$@"; }
done
ardia_sandbox_decide "$binary"
exec -a ardia "$binary" "${ARDIA_SANDBOX_FLAGS[@]}" "$@"
