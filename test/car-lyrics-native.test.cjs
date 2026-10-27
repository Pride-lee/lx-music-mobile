const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const { patches, patchSource } = require('../scripts/patch-car-lyrics.cjs')

test('patched Java writes, updates and clears actual metadata fields', () => {
  const root = path.join(__dirname, '..')
  const dependency = process.env.TRACK_PLAYER_SOURCE_DIR || path.join(root, 'node_modules/react-native-track-player')
  const sources = patches.map(patch => patchSource(fs.readFileSync(path.join(dependency, patch.file), 'utf8'), patch))
  const start = sources[1].indexOf('    public void updateTitles(Bundle data) {')
  const end = sources[1].indexOf('\n    /**', start)
  assert.ok(start >= 0 && end > start)
  const updateTitles = sources[1].slice(start, end)
  const files = {
    'com/guichaguri/trackplayer/service/models/TrackMetadata.java': sources[0],
    'android/content/Context.java': 'package android.content; public class Context {}',
    'android/net/Uri.java': 'package android.net; public class Uri {}',
    'android/os/Bundle.java': `package android.os;
      public class Bundle extends java.util.HashMap<String, Object> {
        public String getString(String key) { return (String) get(key); }
        public double getDouble(String key, double fallback) {
          return containsKey(key) ? ((Number) get(key)).doubleValue() : fallback;
        }
      }`,
    'android/support/v4/media/RatingCompat.java': 'package android.support.v4.media; public class RatingCompat {}',
    'android/support/v4/media/MediaMetadataCompat.java': `package android.support.v4.media;
      public class MediaMetadataCompat {
        public static final String METADATA_KEY_TITLE = "title", METADATA_KEY_ARTIST = "artist",
          METADATA_KEY_ALBUM = "album", METADATA_KEY_DATE = "date", METADATA_KEY_GENRE = "genre",
          METADATA_KEY_DURATION = "duration", METADATA_KEY_ART_URI = "artUri", METADATA_KEY_RATING = "rating";
        public final java.util.Map<String, Object> data;
        MediaMetadataCompat(java.util.Map<String, Object> values) { data = new java.util.HashMap<>(values); }
        public static class Builder {
          private final java.util.Map<String, Object> data = new java.util.HashMap<>();
          public Builder putString(String key, String value) { data.put(key, value); return this; }
          public Builder putLong(String key, long value) { data.put(key, value); return this; }
          public Builder putRating(String key, RatingCompat value) { data.put(key, value); return this; }
          public MediaMetadataCompat build() { return new MediaMetadataCompat(data); }
        }
      }`,
    'androidx/media3/common/util/UnstableApi.java': 'package androidx.media3.common.util; public @interface UnstableApi {}',
    'com/guichaguri/trackplayer/service/Utils.java': `package com.guichaguri.trackplayer.service;
      public class Utils {
        public static android.net.Uri getUri(android.content.Context context, android.os.Bundle data, String key) { return null; }
        public static long toMillis(double value) { return (long) (value * 1000); }
        public static android.support.v4.media.RatingCompat getRating(android.os.Bundle data, String key, int type) { return null; }
      }`,
    'NativeLyricTest.java': `import android.os.Bundle;
      import android.support.v4.media.MediaMetadataCompat;
      import static android.support.v4.media.MediaMetadataCompat.*;
      import com.guichaguri.trackplayer.service.models.TrackMetadata;

      public class NativeLyricTest {
        static class Track extends TrackMetadata {}
        static class Session {
          MediaMetadataCompat metadata;
          void setMetadata(MediaMetadataCompat value) { metadata = value; }
        }
        static class Manager { Object getPlayback() { return null; } }
        MediaMetadataCompat.Builder prevMetadata;
        Session session = new Session();
        Manager manager = new Manager();
        int playbackUpdates;
        void updatePlaybackState(Object playback) { playbackUpdates++; }
        ${updateTitles}

        static void equal(Object expected, Object actual) {
          if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(expected + " != " + actual);
        }
        public static void main(String[] args) {
          String wholeKey = "ucar.media.metadata.LYRICS_WHOLE";
          String lineKey = "ucar.media.metadata.LYRICS_LINE";
          String genericKey = "android.media.metadata.LYRICS";
          Bundle data = new Bundle();
          data.put("title", "Song");
          data.put("artist", "Singer");
          data.put("lyric", "[00:00]generic");
          data.put("ucarLyricWhole", "[00:00]First");
          data.put("ucarLyricLine", "First");
          Track track = new Track();
          track.setMetadata(null, data, 0);
          NativeLyricTest manager = new NativeLyricTest();
          manager.updateTitles(data);
          equal(null, manager.session.metadata);
          manager.prevMetadata = track.toMediaMetadata();
          manager.updateTitles(new Bundle());
          equal("[00:00]First", manager.session.metadata.data.get(wholeKey));
          equal("First", manager.session.metadata.data.get(lineKey));
          equal("[00:00]generic", manager.session.metadata.data.get(genericKey));

          Bundle line = new Bundle();
          line.put("ucarLyricLine", "Second");
          manager.updateTitles(line);
          equal("Second", manager.session.metadata.data.get(lineKey));
          equal("[00:00]First", manager.session.metadata.data.get(wholeKey));
          equal("Song", manager.session.metadata.data.get("title"));

          Bundle clear = new Bundle();
          clear.put("ucarLyricLine", "");
          clear.put("ucarLyricWhole", "");
          manager.updateTitles(clear);
          equal("", manager.session.metadata.data.get(lineKey));
          equal("", manager.session.metadata.data.get(wholeKey));
          equal("[00:00]generic", manager.session.metadata.data.get(genericKey));
          equal(3, manager.playbackUpdates);

          track.setMetadata(null, clear, 0);
          equal("", track.toMediaMetadata().build().data.get(wholeKey));
          equal("", track.toMediaMetadata().build().data.get(lineKey));
          equal("Song", track.toMediaMetadata().build().data.get("title"));
          System.out.println("Native lyric metadata checks passed");
        }
      }`,
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-car-lyrics-java-'))
  try {
    for (const [name, contents] of Object.entries(files)) {
      const file = path.join(temp, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, contents)
    }
    const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name
    execFileSync(bin('javac'), ['-encoding', 'UTF-8', '-d', temp, ...Object.keys(files)], { cwd: temp, timeout: 60000 })
    const result = execFileSync(bin('java'), ['-cp', temp, 'NativeLyricTest'], { encoding: 'utf8', timeout: 30000 })
    assert.match(result, /Native lyric metadata checks passed/)
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temp).startsWith('lx-car-lyrics-java-'))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
