#!/bin/sh
AGI_DNS_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
. "$AGI_DNS_ROOT/scripts/node-runtime.sh"
agi_require_node_24 || exit 1
if [ "$#" -eq 0 ]; then
  printf '\n%s\n' 'Administrator DNS review — read-only inspection' 'This window does not change DNS, run sudo, or promote the compute account.' 'Automatic/DHCP DNS is not missing DNS. Review the active service and resolver policy first.' ''
  "$AGI_RUNTIME_NODE" "$AGI_DNS_ROOT/compute/admin-dns.mjs" inspect
  AGI_DNS_STATUS=$?
  printf '\n%s\n' 'For a repair, use a verified copy of this release owned by the separate Mac administrator.' 'In that administrator account, create a private directory (mode 700), then run:' 'node compute/admin-dns.mjs prepare --servers APPROVED_IP_1,APPROVED_IP_2 --directory PRIVATE_DIRECTORY' 'Read the saved plan. Only the administrator may then run apply with --plan FILE --confirm PLAN_ID --policy-reviewed using sudo and a trusted Node executable.' 'The receipt records the original automatic/manual settings; rollback requires --receipt FILE --confirm PLAN_ID.' 'No public resolver is selected for you. Managed, split-DNS, VPN, or ambiguous active services require the network policy owner.'
else
  "$AGI_RUNTIME_NODE" "$AGI_DNS_ROOT/compute/admin-dns.mjs" "$@"
  AGI_DNS_STATUS=$?
fi
if [ -t 0 ]; then printf '\n%s\n' 'DNS review finished. Press Return to close.'; read -r AGI_DNS_CLOSE; fi
exit "$AGI_DNS_STATUS"
