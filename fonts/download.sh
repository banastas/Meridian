#!/usr/bin/env bash
# Downloads the Google Fonts files Meridian bundles and converts them, without
# subsetting, to WOFF2. Requires fontTools with Brotli:
#   python3 -m pip install 'fonttools[woff]'
set -euo pipefail
cd "$(dirname "$0")"

UA='Mozilla/5.0'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() {
  curl -sSL -A "$UA" -o "$work/$1.ttf" "$2"
  python3 -m fontTools.ttLib.woff2 compress -o "$1.woff2" "$work/$1.ttf"
}

fetch inter-300 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf'
fetch inter-400 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf'
fetch inter-500 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf'
fetch inter-600 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf'

fetch jbm-200 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8SKxjPQ.ttf'
fetch jbm-300 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8lqxjPQ.ttf'
fetch jbm-400 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjPQ.ttf'

ls -la *.woff2
