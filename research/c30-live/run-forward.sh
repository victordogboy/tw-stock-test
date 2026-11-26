#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$PWD"
workspace="$(mktemp -d "${RUNNER_TEMP:?}/c30-runtime.XXXXXX")"
linked=0
cleanup() {
  if [[ "$linked" == 1 ]]; then sudo unlink /mnt/data; fi
  rm -rf -- "$workspace"
}
trap cleanup EXIT
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
node research/c30-live/restore-runtime.mjs "$workspace/runtime.tar.gz"
mkdir "$workspace/engine"
bundle="$workspace/engine"
tar -xzf "$workspace/runtime.tar.gz" -C "$bundle" --no-same-owner --no-same-permissions
test ! -e /mnt/data && test ! -L /mnt/data
sudo ln -s "$bundle/lock/mnt_data" /mnt/data
linked=1
python research/c30-live/stage_inputs.py "$bundle" .c26-private/forward-eod.json.gz \
  public/r1494a/c26/data/forward-status.json .c26-private/contexts.json > "$workspace/stage.json"
report="$workspace/forward.json"
through="$(node -p "require(process.argv[1]).signal_date" "$workspace/stage.json")"
for pass in 1 2 3; do
  python research/c30-live/replay_original.py "$bundle" "$workspace/stage.json" "$report"
  if [[ "$(node -p "require(process.argv[1]).readiness" "$report")" == verified_replay ]]; then
    cp "$report" "$root/.c26-private/c30-verified-forward.json"
    exit 0
  fi
  if [[ "$pass" == 3 ]]; then
    break
  fi
  python research/c30-live/fetch_minutes.py "$report" .c26-private/forward-eod.json.gz \
    "$bundle/lock/workspace/replay/A39_new_minute" "$through"
done
echo 'C30 replay still has required input gaps; verified plan retained.'
exit 1
