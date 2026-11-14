"""Opaque geometry-only redaction of WP16 app screenshots. Never OCR or retain private text."""
from pathlib import Path
import json
import tempfile
from PIL import Image, ImageDraw

source = Path(tempfile.gettempdir()) / 'goltou-wp16-device'
destination = Path(__file__).resolve().parents[1] / 'docs/reports/wp16-ux-v2/device'
destination.mkdir(parents=True, exist_ok=True)
count = 0
for metadata in sorted(source.glob('*.json')):
    screenshot = metadata.with_suffix('.png')
    if not screenshot.exists():
        continue
    geometry = json.loads(metadata.read_text(encoding='utf-8'))
    with Image.open(screenshot) as original:
        image = original.convert('RGB')
        draw = ImageDraw.Draw(image)
        scale = image.width / geometry['width']
        # WebView's CSS origin is below the system inset. Mask the entire possible
        # inset range, so no account/product glyph can remain along an edge.
        accurate = 'topInset' in geometry and 'bottomInset' in geometry
        top_inset = geometry.get('topInset', 0)
        bottom_inset = geometry.get('bottomInset', 0)
        inset = 0 if accurate else max(0, image.height - geometry['height'] * scale)
        scale_y = (image.height - top_inset - bottom_inset) / geometry['height'] if accurate else scale
        draw.rectangle((0, 0, image.width, top_inset if accurate else max(100, inset)), fill='#ffffff')
        draw.rectangle((0, image.height - (bottom_inset if accurate else 100), image.width, image.height), fill='#ffffff')
        rectangles = [(r, True) for r in geometry['rects']] + [(r, False) for r in geometry.get('sheetRects', [])]
        for rect, clip_overlay in rectangles:
            left, top, right, bottom = rect
            if clip_overlay and geometry.get('overlays'):
                bottom = min(bottom, *[r[1] for r in geometry['overlays']])
            if bottom <= top or right < 0 or bottom < 0 or top * scale_y > image.height or left * scale > image.width:
                continue
            draw.rectangle((max(0, left * scale - 12), max(0, top_inset + top * scale_y - 12),
                            min(image.width, right * scale + 12), min(image.height, top_inset + bottom * scale_y + inset + 12)), fill='#dbe4de')
        image.save(destination / screenshot.name, optimize=True)
    count += 1
print(f'Redacted {count} device screenshots; no text extraction.')
