# Stop Motion

A stop-motion movie maker for iPad, built as a single-page web app.

Open https://profasaf.github.io/stopmotion/ in Safari on the iPad, then Share → Add to Home Screen.

- **Ghost photos:** the last photo (or two) shows see-through over the live camera.
- **Tap, Timer, or Hands-free:** hands-free waits until the hands are out of the picture and everything is still, then snaps.
- **Bump alarm:** the motion sensors and the camera notice when the iPad moves, and a dot-in-the-ring guide helps put it back.
- **Play and Make video:** plays the movie at 5–15 photos per second and saves it to Photos as an MP4.

Photos are kept in the browser's storage on the iPad and are never uploaded. Save finished movies to Photos.

## Testing on a computer

Add `?fake` to the address for a simulated camera, with buttons to move the toy, bump the camera and nudge it back.

```bash
python -m http.server 8765
```

Then open http://localhost:8765/?fake.

The icons are drawn by `tools/make_icons.py` (needs Pillow): `python tools/make_icons.py icons`.
