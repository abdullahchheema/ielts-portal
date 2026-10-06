import { describe, expect, it } from 'vitest';
import { elapsedSeconds, extensionFor, initialRecorderState, recorderReducer, type RecorderState } from './use-recorder';

const blob = new Blob(['x'], { type: 'audio/webm' });
const ready = { kind: 'ready', blob, url: 'blob:x', durationSec: 12 } as const;

describe('recorderReducer', () => {
  it('moves idle → requesting → recording → ready on the happy path', () => {
    let s: RecorderState = initialRecorderState;
    s = recorderReducer(s, { type: 'REQUEST' });
    expect(s.kind).toBe('requesting');
    s = recorderReducer(s, { type: 'STARTED', startedAt: 1000 });
    expect(s).toEqual({ kind: 'recording', startedAt: 1000 });
    s = recorderReducer(s, { type: 'STOPPED', blob, url: 'blob:x', durationSec: 12 });
    expect(s).toEqual(ready);
  });

  it('ignores a second start while already requesting or recording', () => {
    const rec: RecorderState = { kind: 'recording', startedAt: 5 };
    expect(recorderReducer(rec, { type: 'REQUEST' })).toBe(rec);
    expect(recorderReducer({ kind: 'requesting' }, { type: 'REQUEST' })).toEqual({ kind: 'requesting' });
  });

  it('does not treat a stray STARTED or STOPPED as a transition', () => {
    expect(recorderReducer({ kind: 'idle' }, { type: 'STARTED', startedAt: 1 })).toEqual({ kind: 'idle' });
    expect(recorderReducer({ kind: 'idle' }, { type: 'STOPPED', blob, url: 'u', durationSec: 1 })).toEqual({ kind: 'idle' });
  });

  it('a chosen file becomes the answer without recording', () => {
    expect(recorderReducer({ kind: 'idle' }, { type: 'FILE_CHOSEN', blob, url: 'blob:f' })).toEqual({ kind: 'ready', blob, url: 'blob:f', durationSec: 0 });
  });

  it('failure reports a message and reset returns to idle', () => {
    const err = recorderReducer({ kind: 'requesting' }, { type: 'FAILED', message: 'no mic' });
    expect(err).toEqual({ kind: 'error', message: 'no mic' });
    expect(recorderReducer(err, { type: 'RESET' })).toEqual({ kind: 'idle' });
  });
});

describe('recorder helpers', () => {
  it('counts whole elapsed seconds and never goes negative', () => {
    expect(elapsedSeconds(1000, 3500)).toBe(2);
    expect(elapsedSeconds(5000, 1000)).toBe(0);
  });
  it('maps MIME types to the extensions the grading endpoint accepts', () => {
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionFor('audio/mpeg')).toBe('mp3');
    expect(extensionFor('audio/wav')).toBe('wav');
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
  });
});
