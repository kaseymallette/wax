"""Render descriptive charts with Pillow; leave the supplied pooled PNG intact."""
import csv
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "charts"
OUT.mkdir(exist_ok=True)
PLAYLISTS = [("alt-rock", "Alt Rock"), ("electropop", "Electropop"),
             ("country-blues", "Country / Blues")]
COLORS = ["#538fe0", "#66ba73", "#ee8751"]
BG, FG, MUTED = "#111315", "#edf0f3", "#b9c2cb"

def font(size):
    for path in ["/System/Library/Fonts/Supplemental/Arial.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)

def text(d, xy, label, size=22, fill=FG, anchor="la"):
    d.text(xy, label, font=font(size), fill=fill, anchor=anchor)

def legend(d, y, names):
    for x, color, name in zip([350, 700, 1100], COLORS, names):
        d.rectangle((x, y, x+20, y+20), fill=color)
        text(d, (x+32, y-2), name)

orders, counts = [], []
for slug, label in PLAYLISTS:
    with (ROOT / "data" / f"{slug}-monday.csv").open() as f:
        rows = list(csv.DictReader(f))
    assert [int(r["#"]) for r in rows] == list(range(1, len(rows)+1))
    orders.append(rows)
    sections = [[0, 0, 0] for _ in range(3)]
    for i, (a, b) in enumerate(zip(rows, rows[1:])):
        distance = abs((int(b["Camelot"][:-1])-int(a["Camelot"][:-1])+6) % 12-6)
        sections[3*i//(len(rows)-1)][0 if distance <= 2 else 1 if distance <= 4 else 2] += 1
    counts.append(sections)
assert [[sum(c[s][k] for c in counts) for k in range(3)] for s in range(3)] == [
    [11, 7, 10], [22, 4, 1], [15, 9, 1]]

im = Image.new("RGB", (1800, 800), BG)
d = ImageDraw.Draw(im)
text(d, (70, 35), "Key-move mix within each playlist", 38)
text(d, (70, 90), "Share of transitions (%) · A/B ignored · Repeat-to-opener excluded", 23, MUTED)
for panel, ((_, label), sections) in enumerate(zip(PLAYLISTS, counts)):
    left = 100 + panel*570
    text(d, (left+220, 150), label, 28, anchor="ma")
    for tick in [0, 25, 50, 75, 100]:
        y = 600-tick*3.8
        d.line((left, y, left+440, y), fill="#41474e")
        text(d, (left-12, y), str(tick), 19, MUTED, "rm")
    for col, section in enumerate(sections):
        x, bottom = left+35+col*145, 600
        for count, color in zip(section, COLORS):
            percentage = 100*count/sum(section)
            top = bottom-percentage*3.8
            if count:
                d.rectangle((x, top, x+100, bottom), fill=color)
                text(d, (x+50, (top+bottom)/2), f"{percentage:.0f}%", 20, BG, "mm")
            bottom = top
        text(d, (x+50, 620), ["Beginning", "Middle", "End"][col], 21, anchor="ma")
        text(d, (x+50, 650), f"n={sum(section)}", 19, MUTED, "ma")
legend(d, 710, ["Close: 0–2", "Mood shifter: 3–4", "Jaws: 5–6"])
text(d, (900, 760), "Equal thirds of transitions within each playlist; percentages rounded.", 21, MUTED, "ma")
im.save(OUT / "move-categories-by-playlist.png")

im = Image.new("RGB", (1800, 1250), BG)
d = ImageDraw.Draw(im)
text(d, (70, 30), "Musical features through the chosen orders", 38)
text(d, (70, 85), "Raw feature values (0–100) · Individual song positions · No smoothing", 23, MUTED)
for panel, ((_, label), rows) in enumerate(zip(PLAYLISTS, orders)):
    top = 180+panel*330
    text(d, (100, top-45), f"{label} · {len(rows)} songs", 27)
    for tick in [0, 25, 50, 75, 100]:
        y = top+210-tick*2.1
        d.line((100, y, 1700, y), fill="#41474e")
        text(d, (85, y), str(tick), 19, MUTED, "rm")
    for feature, color in zip(["Energy", "Dance", "Valence"], COLORS):
        points = [(100+1600*i/(len(rows)-1), top+210-int(r[feature])*2.1)
                  for i, r in enumerate(rows)]
        d.line(points, fill=color, width=4)
        for x, y in points:
            d.ellipse((x-4, y-4, x+4, y+4), fill=color)
    for tick in sorted(set([1, *range(5, len(rows)+1, 5), len(rows)])):
        x = 100+1600*(tick-1)/(len(rows)-1)
        text(d, (x, top+225), str(tick), 20, MUTED, "ma")
    text(d, (900, top+258), "Song position", 21, MUTED, "ma")
legend(d, 1165, ["Energy", "Danceability", "Valence"])
text(d, (900, 1210), "Source: the three saved custom CSVs in this feature folder.", 21, MUTED, "ma")
im.save(OUT / "feature-trajectories.png")
print("Rendered two charts; verified category totals against the proposal.")
