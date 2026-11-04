const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const { patchSource } = require('../scripts/patch-car-lyrics.cjs')
const { patches } = require('../scripts/patch-media-controls.cjs')

const root = path.join(__dirname, '..')
const dependency = process.env.TRACK_PLAYER_SOURCE_DIR || path.join(root, 'node_modules/react-native-track-player')
const sources = patches.map(patch => patchSource(fs.readFileSync(path.join(dependency, patch.file), 'utf8'), patch))

for (const patch of patches) {
  const source = fs.readFileSync(path.join(dependency, patch.file), 'utf8').replace(/\r\n/g, '\n')
  let original = source
  for (const [before, after] of [...patch.replacements].reverse()) original = original.replace(after, before)
  test(`${path.basename(patch.file)}: media control patch is repeatable and checks upstream anchors`, () => {
    for (const newline of ['\n', '\r\n']) {
      const patched = patchSource(original.replace(/\n/g, newline), patch)
      assert.equal(patchSource(patched, patch), patched)
      for (const [, after] of patch.replacements) assert.ok(patched.replace(/\r\n/g, '\n').includes(after))
    }
    const [before] = patch.replacements[0]
    assert.throws(() => patchSource(original.replace(before, ''), patch), /does not match/)
    assert.throws(() => patchSource(`${original}\n${before}`, patch), /does not match/)
  })
}

test('session advertises transport controls, play/pause toggle and refreshed action state', () => {
  assert.match(sources[0], /FLAG_HANDLES_MEDIA_BUTTONS[\s\S]*?FLAG_HANDLES_TRANSPORT_CONTROLS/)
  assert.match(sources[0], /actions \|= PlaybackStateCompat\.ACTION_PLAY_PAUSE/)
  assert.match(sources[0], /session\.setRatingType\(ratingType\);\s+if \(manager\.getPlayback\(\) != null\) updatePlaybackState\(manager\.getPlayback\(\)\)/)
  const utils = fs.readFileSync(path.join(root, 'src/plugins/player/utils.ts'), 'utf8')
  const compact = utils.match(/compactCapabilities: \[([\s\S]*?)\]/)[1]
  for (const capability of ['SkipToPrevious', 'Play', 'Pause', 'SkipToNext']) {
    assert.ok(compact.includes(`Capability.${capability}`))
  }
  assert.ok(!compact.includes('Capability.Stop'))
  assert.match(fs.readFileSync(path.join(root, 'dependencies-patch.js'), 'utf8'), /patchMediaControls/)
})

test('native media keys and direct transport callbacks dispatch once to the existing JS events', () => {
  const source = sources[1]
  const start = source.indexOf('    @Override\n    public boolean onMediaButtonEvent')
  const end = source.indexOf('    @Override\n    public void onPlay()', start)
  assert.ok(start >= 0 && end > start)
  const callbacks = ['onPlay', 'onPause', 'onStop', 'onSkipToPrevious', 'onSkipToNext'].map(name => {
    const match = source.match(new RegExp(`    @Override\\s+public void ${name}\\(\\) \\{[^}]*\\}`))
    assert.ok(match, name)
    return match[0]
  }).join('\n')
  const java = `
    import java.util.*;
    public class MediaControlsTest {
      static class Intent {
        static final String ACTION_MEDIA_BUTTON = "media", EXTRA_KEY_EVENT = "key";
        String action = ACTION_MEDIA_BUTTON;
        KeyEvent event;
        Intent(KeyEvent event) { this.event = event; }
        String getAction() { return action; }
        KeyEvent getParcelableExtra(String key) { return event; }
      }
      static class KeyEvent {
        static final int ACTION_DOWN = 0, ACTION_UP = 1, KEYCODE_MEDIA_NEXT = 87,
          KEYCODE_MEDIA_PREVIOUS = 88, KEYCODE_MEDIA_PLAY = 126, KEYCODE_MEDIA_PAUSE = 127,
          KEYCODE_MEDIA_STOP = 86, KEYCODE_MEDIA_PLAY_PAUSE = 85;
        int key, action, repeat;
        KeyEvent(int key, int action, int repeat) { this.key = key; this.action = action; this.repeat = repeat; }
        int getKeyCode() { return key; } int getAction() { return action; } int getRepeatCount() { return repeat; }
      }
      static class PlaybackStateCompat {
        static final long ACTION_SKIP_TO_NEXT = 32, ACTION_SKIP_TO_PREVIOUS = 16,
          ACTION_PLAY = 4, ACTION_PAUSE = 2, ACTION_STOP = 1;
        long actions = 55;
        long getActions() { return actions; }
      }
      static class Log { static void d(String tag, String value) {} }
      static class MusicEvents {
        static final String BUTTON_PLAY = "play", BUTTON_PAUSE = "pause", BUTTON_STOP = "stop",
          BUTTON_SKIP_PREVIOUS = "previous", BUTTON_SKIP_NEXT = "next";
      }
      static class MusicService {
        List<String> events = new ArrayList<>();
        void emit(String event, Object data) { events.add(event); }
      }
      static class MusicManager {
        PlaybackStateCompat state = new PlaybackStateCompat();
        MusicManager getMetadata() { return this; }
        MusicManager getSession() { return this; }
        MusicManager getController() { return this; }
        PlaybackStateCompat getPlaybackState() { return state; }
      }
      static class Callback {
        int delegated;
        public boolean onMediaButtonEvent(Intent intent) { delegated++; return true; }
        public void onPlay() {} public void onPause() {} public void onStop() {}
        public void onSkipToPrevious() {} public void onSkipToNext() {}
      }
      static class Buttons extends Callback {
        MusicService service = new MusicService();
        MusicManager manager = new MusicManager();
        ${source.slice(start, end)}
        ${callbacks}
      }
      static void check(boolean result) { if (!result) throw new AssertionError(); }
      static Intent key(int code, int action, int repeat) { return new Intent(new KeyEvent(code, action, repeat)); }
      public static void main(String[] args) {
        Buttons b = new Buttons();
        int[] codes = {87, 88, 126, 127, 86};
        for (int code : codes) {
          check(b.onMediaButtonEvent(key(code, 0, 0)));
          check(b.onMediaButtonEvent(key(code, 1, 0)));
          check(b.onMediaButtonEvent(key(code, 0, 1)));
        }
        check(b.service.events.equals(Arrays.asList("next", "previous", "play", "pause", "stop")));
        check(!b.onMediaButtonEvent(null));
        check(!b.onMediaButtonEvent(new Intent(null)));
        Intent wrong = key(87, 0, 0); wrong.action = "other";
        check(!b.onMediaButtonEvent(wrong));
        b.manager.state.actions = 0;
        check(!b.onMediaButtonEvent(key(87, 0, 0)));
        b.manager.state = null;
        check(!b.onMediaButtonEvent(key(88, 0, 0)));
        check(b.service.events.size() == 5);
        check(b.onMediaButtonEvent(key(85, 0, 0)));
        check(b.onMediaButtonEvent(key(999, 0, 0)));
        check(b.delegated == 2);
        b.onSkipToNext(); b.onSkipToPrevious(); b.onPlay(); b.onPause(); b.onStop();
        check(b.service.events.equals(Arrays.asList("next", "previous", "play", "pause", "stop",
          "next", "previous", "play", "pause", "stop")));
        System.out.println("Media control callbacks passed");
      }
    }`
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-media-controls-'))
  try {
    fs.writeFileSync(path.join(temp, 'MediaControlsTest.java'), java)
    const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name
    execFileSync(bin('javac'), ['-encoding', 'UTF-8', 'MediaControlsTest.java'], { cwd: temp, timeout: 60000 })
    const result = execFileSync(bin('java'), ['-cp', temp, 'MediaControlsTest'], { encoding: 'utf8', timeout: 30000 })
    assert.match(result, /Media control callbacks passed/)
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temp).startsWith('lx-media-controls-'))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
