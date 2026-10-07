const { parseVideo, audienceText, categoryLabel } = require('../src/js/coach-videos.js');

describe('parseVideo', () => {
  test('Loom share and embed links play inline', () => {
    const id = '0123456789abcdef0123456789abcdef';
    for (const url of [`https://www.loom.com/share/${id}`, `https://loom.com/share/${id}?sid=abc`, `https://www.loom.com/embed/${id}`]) {
      const v = parseVideo(url);
      expect(v.provider).toBe('loom');
      expect(v.embedUrl).toBe(`https://www.loom.com/embed/${id}`);
    }
  });

  test('YouTube watch, short, shorts and live links', () => {
    const embed = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1';
    expect(parseVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ').embedUrl).toBe(embed);
    expect(parseVideo('https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share').embedUrl).toBe(embed);
    expect(parseVideo('https://youtu.be/dQw4w9WgXcQ').embedUrl).toBe(embed);
    expect(parseVideo('https://youtube.com/shorts/dQw4w9WgXcQ').embedUrl).toBe(embed);
    expect(parseVideo('https://www.youtube.com/live/dQw4w9WgXcQ').embedUrl).toBe(embed);
    expect(parseVideo('https://youtu.be/dQw4w9WgXcQ?t=42').embedUrl).toBe(`${embed}&start=42`);
  });

  test('Vimeo public and unlisted links', () => {
    expect(parseVideo('https://vimeo.com/76979871').embedUrl).toBe('https://player.vimeo.com/video/76979871?playsinline=1');
    expect(parseVideo('https://vimeo.com/76979871/a1b2c3d4e5').embedUrl).toBe('https://player.vimeo.com/video/76979871?playsinline=1&h=a1b2c3d4e5');
    expect(parseVideo('https://player.vimeo.com/video/76979871?h=ff00ff00').embedUrl).toBe('https://player.vimeo.com/video/76979871?playsinline=1&h=ff00ff00');
  });

  test('Google Drive file links use the preview player', () => {
    const embed = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview';
    expect(parseVideo('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing').embedUrl).toBe(embed);
    expect(parseVideo('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp').embedUrl).toBe(embed);
  });

  test('direct video files play in a <video> element', () => {
    const v = parseVideo('https://cdn.example.com/coach/welcome.MP4');
    expect(v.provider).toBe('file');
    expect(v.fileUrl).toBe('https://cdn.example.com/coach/welcome.MP4');
    expect(v.embedUrl).toBeNull();
  });

  test('anything else is a plain link; non-http is rejected', () => {
    expect(parseVideo('https://www.dropbox.com/s/abc/video').provider).toBe('link');
    expect(parseVideo('https://www.loom.com/looms/videos').provider).toBe('link');
    expect(parseVideo('https://www.youtube.com/watch?v=short').provider).toBe('link');
    expect(parseVideo('javascript:alert(1)')).toBeNull();
    expect(parseVideo('not a url')).toBeNull();
    expect(parseVideo('')).toBeNull();
  });
});

describe('audienceText', () => {
  const names = { u1: 'Ana', u2: 'Bob', u3: 'Cleo', u4: 'Dan' };
  test('all clients', () => expect(audienceText({ audience: 'all' }, names)).toBe('All clients'));
  test('one, two, many', () => {
    expect(audienceText({ audience: 'selected', clientUids: ['u1'] }, names)).toBe('Ana');
    expect(audienceText({ audience: 'selected', clientUids: ['u1', 'u2'] }, names)).toBe('Ana and Bob');
    expect(audienceText({ audience: 'selected', clientUids: ['u1', 'u2', 'u3', 'u4'] }, names)).toBe('Ana, Bob and 2 more');
  });
  test('clients no longer on the roster', () => {
    expect(audienceText({ audience: 'selected', clientUids: ['gone'] }, names)).toBe('a former client');
  });
});

test('categoryLabel falls back to General', () => {
  expect(categoryLabel('diet')).toBe('Diet');
  expect(categoryLabel('nope')).toBe('General');
});
