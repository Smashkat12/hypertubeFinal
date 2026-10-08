#!/usr/bin/env bash
# One-time setup: wipe the USB Toshiba drive, format it ext4 and mount it at /mnt/hypertube
# (on every boot) for Hypertube's downloads. Run with: sudo bash setup-usb-storage.sh
set -euo pipefail

DISK_ID=/dev/disk/by-id/usb-TOSHIBA_MQ01ABD100_1608020200088848-0:0
MOUNT=/mnt/hypertube
OWNER=smash

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
[ -e "$DISK_ID" ] || { echo "Toshiba USB drive not found at $DISK_ID"; exit 1; }
DISK=$(readlink -f "$DISK_ID")

# refuse to touch the system disk or anything mounted
if [ "$DISK" = "$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" | sed 's#^#/dev/#')" ]; then
  echo "$DISK is the system disk, aborting"; exit 1
fi
if lsblk -no MOUNTPOINT "$DISK" | grep -q .; then
  echo "$DISK has mounted partitions, aborting"; exit 1
fi

echo "About to ERASE $DISK:"
lsblk -o NAME,SIZE,FSTYPE,LABEL,MODEL "$DISK"
read -r -p "Type WIPE to continue: " ok
[ "$ok" = "WIPE" ] || { echo "Cancelled"; exit 1; }

# drop the old ZFS pool if it got auto-imported, then clear all signatures
command -v zpool >/dev/null && zpool export shared-data 2>/dev/null || true
wipefs -a "$DISK"
parted -s "$DISK" mklabel gpt mkpart hypertube ext4 1MiB 100%
udevadm settle
PART="${DISK}1"
mkfs.ext4 -F -L hypertube -m 0 "$PART"

UUID=$(blkid -s UUID -o value "$PART")
mkdir -p "$MOUNT"
# nofail: the PC still boots if the drive is unplugged
sed -i "\#[[:space:]]$MOUNT[[:space:]]#d" /etc/fstab
echo "UUID=$UUID $MOUNT ext4 defaults,noatime,nofail,x-systemd.device-timeout=15 0 2" >> /etc/fstab
systemctl daemon-reload
mount "$MOUNT"
chown "$OWNER:$OWNER" "$MOUNT"

echo
echo "Done: $(df -h "$MOUNT" | tail -1)"
