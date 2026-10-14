import { describe, expect, it } from 'vitest';
import { parseDriveUrl, parseZoomUrl } from '../src/live/meeting-links';

describe('parseZoomUrl', () => {
  it('accepts a standard zoom.us join link', () => {
    expect(parseZoomUrl('https://zoom.us/j/1234567890?pwd=abc')).toEqual({ valid: true });
  });

  it('accepts a regional subdomain', () => {
    expect(parseZoomUrl('https://us02web.zoom.us/j/1234567890')).toEqual({ valid: true });
  });

  it('rejects a non-https link', () => {
    expect(parseZoomUrl('http://zoom.us/j/1234567890')).toMatchObject({ valid: false });
  });

  it('rejects a non-Zoom host, however plausible the path', () => {
    expect(parseZoomUrl('https://zoom.us.evil.example/j/1234567890')).toMatchObject({ valid: false });
    expect(parseZoomUrl('https://meet.google.com/abc-defg-hij')).toMatchObject({ valid: false });
  });

  it('rejects garbage input without throwing', () => {
    expect(parseZoomUrl('not a url')).toMatchObject({ valid: false });
    expect(parseZoomUrl('')).toMatchObject({ valid: false });
  });
});

describe('parseDriveUrl', () => {
  it('extracts the file id from a /file/d/ share link', () => {
    expect(parseDriveUrl('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?usp=sharing')).toEqual({ valid: true, fileId: '1A2B3C4D5E6F7G8H9I0J' });
  });

  it('extracts the file id from an ?id= query link', () => {
    expect(parseDriveUrl('https://drive.google.com/open?id=1A2B3C4D5E6F7G8H9I0J')).toEqual({ valid: true, fileId: '1A2B3C4D5E6F7G8H9I0J' });
    expect(parseDriveUrl('https://drive.google.com/uc?id=1A2B3C4D5E6F7G8H9I0J&export=download')).toEqual({ valid: true, fileId: '1A2B3C4D5E6F7G8H9I0J' });
  });

  it('accepts a recognisable Drive file link even if the id cannot be extracted', () => {
    expect(parseDriveUrl('https://drive.google.com/file/d/')).toEqual({ valid: true, fileId: null });
  });

  it('rejects a whole-folder link', () => {
    expect(parseDriveUrl('https://drive.google.com/drive/folders/1A2B3C4D5E6F7G8H9I0J')).toMatchObject({ valid: false });
  });

  it('rejects a non-Drive host', () => {
    expect(parseDriveUrl('https://dropbox.com/s/abc123/recording.mp4')).toMatchObject({ valid: false });
    expect(parseDriveUrl('https://docs.google.com/document/d/1A2B3C4D5E6F7G8H9I0J/edit')).toMatchObject({ valid: false });
  });

  it('rejects garbage input without throwing', () => {
    expect(parseDriveUrl('not a url')).toMatchObject({ valid: false });
  });
});
