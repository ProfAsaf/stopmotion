# Stop Motion

A stop-motion movie maker for iPad, built as a web app.

Open https://profasaf.github.io/stopmotion/ in Safari on the iPad, then Share → Add to Home Screen.
The Home Screen app gets far more storage for photos than a browser tab (Chrome on iPad can run out after a few dozen photos).

## Shooting

- **Ghost photos:** the last photo (or two) shows see-through over the live camera.
- **Tap, Timer, or Hands-free:** hands-free waits until the hands are out of the picture and everything is still, then snaps.
- **Bump alarm:** the motion sensors and the camera notice when the iPad moves, and a dot-in-the-ring guide helps put it back.
- **Frame:** zoom, move and straighten what gets filmed without moving the iPad (drag or pinch the picture).
- **Magic scene:** take one photo of the empty set, then the toys are cut out live onto a background (sky, space, under the sea, stage, …), with effects like snow, rain or confetti in front.

Photos are always saved whole, so framing and scenes can be changed later.

## The Studio (tap Play)

- **Frame:** shape (wide, square, tall), zoom, move and straighten.
- **Fix:** *Steady camera* lines every photo up with the first (slides and small twists); *Even out the light* removes flicker; the *magic eraser* rubs out feet, hands and other surprises (filled from the empty set or the first photo), and *Find surprises* spots them for you.
- **Scene:** magic backgrounds (or your own picture) and front effects.
- **Look:** color looks (old movie, night, comic, …) and lights (spotlight, lightning with thunder, disco, …).
- **Words:** speech and thought bubbles, shouts, captions, comic words and emoji stickers.
- **Sound:** record your voice over the movie, music tracks, and sound effects on any photo.
- **Titles:** opening title in six styles, theater curtains with clapping, and credits.
- **Speed:** 1 to 15 photos per second (turtle to rabbit), hold a photo longer, boomerang, and
  *Smooth moves*: in-between pictures that follow the motion between photos, so toys glide
  (Smooth aims for about 12 pictures a second, Extra smooth about 24). Playback skips in-betweens
  it can't draw in time; the saved video always has them all.

Tap anything on the picture (bubbles, words, stickers) to move it, resize it with the yellow corner,
change its words or delete it with ✕. **Undo / Redo** at the top covers every Studio change,
including deleted stickers, backgrounds, eraser marks and photos.

**Make video** saves an MP4 (H.264, with AAC sound when the iPad supports it) to Photos.
Nothing changes the photos; every choice is kept with the movie.

## Files

- `index.html`: the app shell, camera screen and storage.
- `studio.js`: the Studio screen, playback and video export.
- `fx.js`: lining photos up, light evening, eraser, cut-outs, framing, the timeline and the live camera scene.
- `art.js`: backgrounds, effects, looks, lights, titles, credits, curtains and stickers, all drawn in code.
- `audio.js`: sound effects, music, voice recording and the mix.
- `music/`: tracks by Kevin MacLeod (incompetech.com), CC BY 4.0. See `music/CREDITS.md`.

## Testing on a computer

Add `?fake` to the address for a simulated camera, with buttons to move the toy, bump the camera, take the toy out (for the empty-set photo) and poke a foot in.

```bash
python -m http.server 8765
```

Then open http://localhost:8765/?fake.

The icons are drawn by `tools/make_icons.py` (needs Pillow): `python tools/make_icons.py icons`.
