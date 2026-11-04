# Update and Media Control Fixes

## Update Downloads

- Keep the installed package's release channel and ABI.
- Retry the official release URL, then use the official GitHub asset endpoint.
  No third-party download mirrors are used.
- Reject HTTP errors, empty or incomplete responses, HTML/JSON responses and
  mismatched release sizes. Verify SHA256 when GitHub supplies the asset digest.
- Prevent concurrent downloads from writing to the same APK.
- Preserve configured connection/read timeouts after native HTTP redirects.
- Separate download errors from installer errors. Installation permission errors
  retain the downloaded APK; invalid APKs permit a new download.
- On Android 8+, open the system unknown-app installation permission screen when
  needed. Returning to LX and retrying installation does not re-download the APK.
- The error view includes the actual error and a link to the matching release.

## Car Controls

- Advertise media-button and transport-control session flags, including the
  play/pause toggle action.
- Publish available playback actions immediately after options change.
- Use previous, play/pause and next as the compact notification controls.
- Route standard next/previous/play/pause/stop key events into the existing
  playlist callbacks. Consume key-up/repeat events to avoid duplicate commands.
- Keep Android's default headset/play-pause handling and existing car lyrics.
- Native next/previous callbacks log under `LXMediaControls` for device diagnosis.

This does not implement undocumented, vendor-specific commands or promise
compatibility with every CarWith/Jovi InCar device. Device verification is needed
to determine whether a car widget sends standard media commands to this session.

## Device Checks

1. Update each package edition and confirm it never switches to the other one.
2. Disable network during download; verify a useful error and a working retry.
3. Disable unknown-app installation permission; grant it when prompted, return
   to LX and retry installation without re-downloading.
4. Test previous/next/play/pause from the phone notification and car widget,
   both with LX visible and with the phone locked.
5. Test a short press and a held key: each press should change at most one song.
6. Confirm car lyrics still display, change with tracks, and clear when disabled.

Existing installed versions cannot receive updater fixes until replaced by a new
APK. A one-time manual download of the matching package may be necessary.
Build and publish APKs through the repository's GitHub Actions workflow only.
