// Dev-only verification for the IndexedDB session store.
// Run from the browser console:  await import('/src/utils/sessiontest.ts').then(m => m.runSessionTest())

import { sessionStore } from './session';
import { Frame } from '../types';

function frameAt(timestamp: number): Frame {
  // A 1x1 PNG, enough to exercise Blob storage and object URL creation.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
  return {
    id: `t-${timestamp}`,
    url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
    timestamp,
  };
}

export async function runSessionTest(): Promise<{ ok: boolean; log: string[] }> {
  const log: string[] = [];
  const say = (m: string) => {
    log.push(m);
    console.log('[sessiontest]', m);
  };

  try {
    await sessionStore.clear();
    say('1. cleared store');

    const frames = [frameAt(0), frameAt(1), frameAt(2), frameAt(3)];
    const options = { fps: 1, format: 'jpg' as const };

    const saved = await sessionStore.save(frames, {
      fileName: 'clip.mp4',
      duration: 4,
      options: options as never,
    });
    say(`2. saved ${frames.length} frames -> ${saved}`);
    if (!saved) throw new Error('save returned false');

    const loaded = await sessionStore.loadCurrent();
    if (!loaded) throw new Error('loadCurrent returned null');

    say(`3. loaded fileName=${loaded.session.fileName} duration=${loaded.session.duration}`);
    say(`   frames restored: ${loaded.frames.length}`);

    if (loaded.frames.length !== frames.length) {
      throw new Error(`expected ${frames.length} frames, got ${loaded.frames.length}`);
    }

    const stamps = loaded.frames.map((f) => f.timestamp);
    say(`   timestamps: ${stamps.join(', ')}`);
    if (JSON.stringify(stamps) !== JSON.stringify([0, 1, 2, 3])) {
      throw new Error(`timestamps not preserved: ${stamps.join(',')}`);
    }

    // The restored URLs must be usable, or the grid renders broken images.
    const check = await fetch(loaded.frames[0].url);
    const blob = await check.blob();
    say(`4. restored frame readable: type=${blob.type} size=${blob.size}`);
    if (blob.size === 0) throw new Error('restored frame is empty');

    const bmp = await createImageBitmap(blob);
    say(`   decoded: ${bmp.width}x${bmp.height}`);

    loaded.frames.forEach((f) => URL.revokeObjectURL(f.url));
    frames.forEach((f) => URL.revokeObjectURL(f.url));

    await sessionStore.clear();
    const afterClear = await sessionStore.loadCurrent();
    say(`5. after clear, loadCurrent -> ${afterClear ? 'still had data' : 'null'}`);
    if (afterClear) throw new Error('clear did not remove the session');

    say('SESSION TESTS PASSED');
    return { ok: true, log };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`FAILED: ${message}`);
    return { ok: false, log };
  }
}