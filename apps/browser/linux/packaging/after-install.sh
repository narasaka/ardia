#!/bin/bash
set -e
folder='/opt/${sanitizedProductName}'
if type update-alternatives >/dev/null 2>&1; then
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' "$folder/${executable}" 100 || ln -sf "$folder/${executable}" '/usr/bin/${executable}'
else
    ln -sf "$folder/${executable}" '/usr/bin/${executable}'
fi
chown root:root "$folder/chrome-sandbox" || true
chmod 4755 "$folder/chrome-sandbox" || true
if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
if hash gtk-update-icon-cache 2>/dev/null; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
if apparmor_status --enabled > /dev/null 2>&1; then
  source="$folder/resources/apparmor-profile"
  target='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$source" > /dev/null 2>&1; then
    cp -f "$source" "$target"
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --replace --write-cache --skip-read-cache "$target" || true
    fi
  fi
fi
exit 0
