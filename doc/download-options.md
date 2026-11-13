# Download Options

## Behavior

- Online lists and My List open the same single-choice download dialog.
- The seven visible tiers are 128k, 320k, FLAC, Hi-Res, Atmos, Atmos 2.0 and Master.
- Hi-Res keeps LX's existing `flac24bit` identifier. Providers declaring only
  `hires` receive that identifier instead. Unsupported tiers remain disabled.
- Existing song metadata supplies available size labels. Selecting a tier
  resolves its URL and checks its size with a five-second HEAD request.
  No audio is downloaded just to determine its size. Missing sizes remain unknown.
- Downloads do not fall back to another quality or source. The provider must
  actually support the selected quality; enabling a tier does not create access
  to it, nor can the app verify a provider's advertised audio fidelity.
- Settings and the chosen quality are captured when the download is confirmed.

## Filenames and Tags

The existing filename presets remain supported. Custom templates accept
`{name}`, `{singer}`, `{album}`, `{source}`, `{id}` and `{quality}`, along with
the original Chinese tokens. Templates must contain a song-name token and omit
the extension. The settings page shows a filename preview.

Filenames are sanitized and limited to 180 UTF-8 bytes before the extension.
Existing files and concurrent tasks get numbered suffixes instead of overwrites.

The additional options include title/artist/album tags, embedded artwork and
embedded lyrics, with translation, romanization and enhanced lyric options.
The existing native metadata library performs the writes. Tag-writing failures
keep the downloaded audio and appear in the completion message and task status.
Formats unsupported by the native metadata library may download successfully
without accepting tags.

## Verification

Run `npm run test:download` with Node 18 or newer.

Device acceptance checks:

1. Open downloads from both an online list and My List; cancel with Back, the
   background and Cancel. No task or audio file should be created.
2. Select each supported tier and confirm that only one option is active.
   Check unknown sizes and unavailable tiers with a limited provider.
3. Save a custom template, restart the app, and download a song. Verify the
   filename, extension, metadata, cover and selected lyric variants.
4. Start two same-name songs and remove an in-progress task. Verify numbered
   filenames, no overwritten audio and cleanup of partial downloads.
5. Check small phones and landscape screens: the options must scroll while the
   confirm/cancel buttons remain reachable.

## References

The quality tiers and settings organization were compared with:

- https://github.com/marsfans/ikun-music-mobile
- https://github.com/souvenp/lx-netease-music-mobile

Implementation uses this repository's existing downloader, UI controls and native
metadata library. Playback quality fallback, release identities and car lyrics
remain unchanged.
