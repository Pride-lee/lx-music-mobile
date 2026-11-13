const fs = require('node:fs')
const path = require('node:path')
const { patchSource } = require('./patch-car-lyrics.cjs')

const rootPath = 'android/src/main/java/com/guichaguri/trackplayer/service'
const patches = [
  {
    file: `${rootPath}/metadata/MetadataManager.java`,
    replacements: [
      [
        '        session.setFlags(MediaSessionCompat.FLAG_HANDLES_QUEUE_COMMANDS);',
        `        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
                | MediaSessionCompat.FLAG_HANDLES_QUEUE_COMMANDS);`,
      ],
      [
        '            for(int cap : capabilities) actions |= cap;',
        `            for(int cap : capabilities) actions |= cap;
            if ((actions & PlaybackStateCompat.ACTION_PLAY) != 0
                    && (actions & PlaybackStateCompat.ACTION_PAUSE) != 0) {
                actions |= PlaybackStateCompat.ACTION_PLAY_PAUSE;
            }`,
      ],
      [
        `        session.setRatingType(ratingType);

        updateNotification();`,
        `        session.setRatingType(ratingType);

        if (manager.getPlayback() != null) updatePlaybackState(manager.getPlayback());
        updateNotification();`,
      ],
    ],
  },
  {
    file: `${rootPath}/metadata/ButtonEvents.java`,
    replacements: [
      [
        'import android.os.Bundle;',
        `import android.os.Bundle;
import android.content.Intent;
import android.view.KeyEvent;
import android.util.Log;
import android.support.v4.media.session.PlaybackStateCompat;`,
      ],
      [
        `    @Override
    public void onPlay() {`,
        `    @Override
    public boolean onMediaButtonEvent(Intent intent) {
        if (intent == null || !Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) {
            return false;
        }
        KeyEvent event = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
        if (event == null) return false;
        long action;
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_NEXT: action = PlaybackStateCompat.ACTION_SKIP_TO_NEXT; break;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: action = PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY: action = PlaybackStateCompat.ACTION_PLAY; break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: action = PlaybackStateCompat.ACTION_PAUSE; break;
            case KeyEvent.KEYCODE_MEDIA_STOP: action = PlaybackStateCompat.ACTION_STOP; break;
            default: return super.onMediaButtonEvent(intent);
        }
        // Consume key-up/repeat without sending a second command to the JS playlist.
        if (event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() != 0) return true;
        PlaybackStateCompat state = manager.getMetadata().getSession().getController().getPlaybackState();
        if (state == null || (state.getActions() & action) == 0) return false;
        Log.d("LXMediaControls", "media key: " + event.getKeyCode());
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_NEXT: onSkipToNext(); break;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: onSkipToPrevious(); break;
            case KeyEvent.KEYCODE_MEDIA_PLAY: onPlay(); break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: onPause(); break;
            case KeyEvent.KEYCODE_MEDIA_STOP: onStop(); break;
            default: return false;
        }
        return true;
    }

    @Override
    public void onPlay() {`,
      ],
      [
        '        service.emit(MusicEvents.BUTTON_SKIP_PREVIOUS, null);',
        `        Log.d("LXMediaControls", "previous");
        service.emit(MusicEvents.BUTTON_SKIP_PREVIOUS, null);`,
      ],
      [
        '        service.emit(MusicEvents.BUTTON_SKIP_NEXT, null);',
        `        Log.d("LXMediaControls", "next");
        service.emit(MusicEvents.BUTTON_SKIP_NEXT, null);`,
      ],
    ],
  },
]

function patchMediaControls(root) {
  const files = patches.map(patch => {
    const file = path.join(root, patch.file)
    const source = fs.readFileSync(file, 'utf8')
    return { file, source, patched: patchSource(source, patch) }
  })
  for (const { file, source, patched } of files) {
    if (source !== patched) fs.writeFileSync(file, patched)
  }
}

module.exports = { patches, patchMediaControls }
