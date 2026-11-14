"""Summarize content-free samples and compose private screenshots outside git."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

run = int(sys.argv[1])
if run not in (2, 3):
    raise ValueError('RUN_2_OR_3_REQUIRED')
folder = Path(__file__).resolve().parents[2] / 'runs' / 'wp16-shots'
samples = json.loads((folder / f'progress-metrics-{run}.json').read_text(encoding='utf-8'))
live = [sample for sample in samples if sample['live']]
longest = 0
last_signature = None
last_change = None
pause_ms = 0
for index, sample in enumerate(samples):
    if index and samples[index - 1]['paused']:
        pause_ms += sample['at'] - samples[index - 1]['at']
    if sample['paused']:
        last_signature = None
        last_change = None
        continue
    # Count visible work, including the phase response heartbeat. Exclude the
    # overall elapsed/remaining clocks. The device's bar is 344 CSS pixels wide.
    signature = (sample['headline'], sample['subtitle'], round((sample['percent'] or 0) * 344 / 100), sample['chars'], sample['photos'], sample['pills'], sample['done'])
    if last_change is not None:
        longest = max(longest, sample['at'] - last_change)
    if signature != last_signature:
        last_change = sample['at']
        last_signature = signature

summary = {
    'run': run, 'done': samples[-1]['done'], 'failed': samples[-1]['failed'],
    'samples': len(samples), 'wallMilliseconds': samples[-1]['at'],
    'choiceWaitMillisecondsApprox': pause_ms,
    'activeMillisecondsApprox': samples[-1]['at'] - pause_ms,
    'longestVisibleUnchangedMilliseconds': longest,
    'percentFinite': all(s['percentFinite'] for s in live),
    'percentMonotonic': all(b['percent'] >= a['percent'] for a, b in zip(live, live[1:])),
    'maxLivePercent': max(s['percent'] for s in live),
    'textRegressions': sum(b['chars'] < a['chars'] for a, b in zip(live, live[1:])),
    'photoRegressions': sum(b['photos'] < a['photos'] for a, b in zip(live, live[1:])),
    'pillRegressions': sum(b['pills'] < a['pills'] for a, b in zip(live, live[1:])),
    'maxPhotos': max(s['photos'] for s in live), 'maxPills': max(s['pills'] for s in live),
    'maxSampleIntervalMilliseconds': max(b['at'] - a['at'] for a, b in zip(samples, samples[1:])),
}
(folder / f'run{run}-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary, indent=2))
if not samples[-1]['done']:
    sys.exit('FINAL_RUN_NOT_DONE')

# Exclude the choice wait from the evenly spaced work frames. File timestamps
# align the real screencaps with nearby sampled states without reading content.
start = (folder / f'run{run}-attempted').stat().st_mtime
frames = []
for file in sorted(folder.glob(f'run{run}-[0-9][0-9].png')):
    at = (file.stat().st_mtime - start) * 1000
    sample = min(samples, key=lambda s: abs(s['at'] - at))
    if not sample['paused']:
        active_at = at - sum(b['at'] - a['at'] for a, b in zip(samples, samples[1:]) if a['paused'] and b['at'] <= at)
        frames.append((file, at, active_at))
done = folder / f'run{run}-done.png'
frames.append((done, samples[-1]['at'], summary['activeMillisecondsApprox']))
chosen = []
for index in range(8):
    target = frames[0][2] + (frames[-1][2] - frames[0][2]) * index / 7
    chosen.append(min(frames, key=lambda f: abs(f[2] - target)))
cell_width, padding, label_height = 570, 12, 30
with Image.open(chosen[0][0]) as first:
    height = round(first.height * cell_width / first.width)
sheet = Image.new('RGB', (4 * (cell_width + padding) + padding, 2 * (height + label_height + padding) + padding), '#eeeeee')
draw = ImageDraw.Draw(sheet)
for index, (file, wall, active) in enumerate(chosen):
    x, y = padding + (index % 4) * (cell_width + padding), padding + (index // 4) * (height + label_height + padding)
    draw.text((x + 6, y + 7), f'{file.name} | work {active / 1000:.1f}s', fill='#111111')
    with Image.open(file) as frame:
        sheet.paste(frame.convert('RGB').resize((cell_width, height), Image.Resampling.LANCZOS), (x, y + label_height))
assert sheet.width <= 2400
sheet.save(folder / 'run-contact.png')
print(json.dumps({'contactWidth': sheet.width, 'contactHeight': sheet.height, 'frames': [f[0].name for f in chosen]}))
