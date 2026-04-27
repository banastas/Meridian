#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

UA='Mozilla/5.0'

curl -sSL -A "$UA" -o inter-300.ttf 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf'
curl -sSL -A "$UA" -o inter-400.ttf 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf'
curl -sSL -A "$UA" -o inter-500.ttf 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf'
curl -sSL -A "$UA" -o inter-600.ttf 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf'

curl -sSL -A "$UA" -o jbm-200.ttf 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8SKxjPQ.ttf'
curl -sSL -A "$UA" -o jbm-300.ttf 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8lqxjPQ.ttf'
curl -sSL -A "$UA" -o jbm-400.ttf 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjPQ.ttf'

ls -la *.ttf
