"""Draws the Stop Motion app icons: a film frame with an onion-skinned ball hopping across it.

Usage: python tools/make_icons.py icons
"""
import os
import sys

from PIL import Image, ImageDraw

S = 1024
TOP = (78, 52, 160, 255)
BOTTOM = (22, 17, 42, 255)


def background():
    """Diagonal purple gradient, full bleed (iOS rounds the corners itself)."""
    v = Image.linear_gradient('L').resize((S, S))
    h = v.rotate(90)
    t = Image.blend(h, v, 0.65)
    return Image.composite(Image.new('RGBA', (S, S), BOTTOM), Image.new('RGBA', (S, S), TOP), t)


def artwork(scale):
    """The film frame and hopping ball, scaled about the centre."""
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = S / 2

    def box(x0, y0, x1, y1):
        return [c + (x0 - c) * scale, c + (y0 - c) * scale, c + (x1 - c) * scale, c + (y1 - c) * scale]

    def r(v):
        return int(v * scale)

    d.rounded_rectangle(box(120, 236, 904, 788), radius=r(66), fill=(255, 247, 232, 255))
    for i in range(7):
        x0 = 168 + i * 102
        d.rounded_rectangle(box(x0, 264, x0 + 58, 316), radius=r(13), fill=(46, 33, 98, 255))
        d.rounded_rectangle(box(x0, 708, x0 + 58, 760), radius=r(13), fill=(46, 33, 98, 255))

    # Sky and grass, clipped to a rounded window inside the frame.
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box(168, 346, 856, 678), radius=r(30), fill=255)
    scene = Image.new('RGBA', (S, S), (92, 200, 255, 255))
    ImageDraw.Draw(scene).rectangle(box(0, 600, S, S), fill=(52, 196, 128, 255))
    layer.paste(scene, (0, 0), mask)

    d.ellipse(box(612, 598, 724, 622), fill=(20, 90, 60, 120))  # shadow under the landing ball
    rad = 66
    for x, y, a in [(318, 528, 70), (492, 432, 140), (668, 528, 255)]:
        ball = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        bd = ImageDraw.Draw(ball)
        bd.ellipse(box(x - rad, y - rad, x + rad, y + rad), fill=(255, 210, 63, a),
                   outline=(232, 150, 30, a), width=max(1, r(8)))
        layer.alpha_composite(ball)
    d.ellipse(box(640, 500, 658, 518), fill=(40, 26, 10, 255))
    d.ellipse(box(678, 500, 696, 518), fill=(40, 26, 10, 255))
    d.arc(box(642, 506, 694, 552), start=25, end=155, fill=(40, 26, 10, 255), width=max(1, r(7)))
    return layer


def icon(scale):
    img = background()
    img.alpha_composite(artwork(scale))
    return img.convert('RGB')


def main(out):
    os.makedirs(out, exist_ok=True)
    full, maskable = icon(1.0), icon(0.78)
    for size in (180, 192, 512):
        full.resize((size, size), Image.LANCZOS).save(os.path.join(out, f'icon-{size}.png'), optimize=True)
    maskable.resize((512, 512), Image.LANCZOS).save(os.path.join(out, 'icon-maskable-512.png'), optimize=True)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'icons')
