#!/usr/bin/env python3
"""Builds assets/icons.json, the shapes GPS art's picker searches.

The shapes start as Lucide's icons (https://lucide.dev, ISC licence, kept
beside the file as assets/icons-LICENSE.txt) and are reworked for drawing
on streets, where only a bold outline survives:

  - each icon becomes plain lines (strokes of [x, y] points in Lucide's 24
    by 24 box, y down), which is what the server takes;
  - small rounded corners are squared off, so a heart gets its point and a
    house its corners (see sharpen);
  - specks such as eyes and dots are dropped;
  - icons that would draw badly are left out: ones in too many separate
    pieces or with too much line for their size (see measure), marks that
    only mean something on a screen (see SCREEN), versions of another icon
    with something added (see OWN), and the ones listed by hand in
    ops/icons-remove.txt. If ops/icons-chosen.txt exists (written by
    ops/icons-pick.py, a page for picking), only the icons named in it
    are kept of those. Shapes of our own in ops/icons-own.json are added,
    replacing any icon of the same name.

The file is a list of [name, "search words", strokes].

Run from the repo's folder:   python3 ops/build-icons.py
It fetches the icons from unpkg.com at the version below. With --from DIR
it reads icon-nodes.json, tags.json and LICENSE from DIR instead. With
--all it keeps every icon that can be drawn, for reviewing the rules
(ops/icons-review.html shows why each would be left out).
"""
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

VERSION = "1.72.0"
BASE = f"https://unpkg.com/lucide-static@{VERSION}/"
NAME = re.compile(r"^[a-z0-9-]+$")
WORD = re.compile(r"[^a-z0-9 -]+")
NUMBER = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")

STEP = 0.05  # how far apart the points of a line are while it is worked on


# ----- turning an icon's elements into lines -----

def arc(x0, y0, rx, ry, turn, large, sweep, x1, y1):
    """Points along an SVG arc from x0, y0 to x1, y1, after its start."""
    if rx == 0 or ry == 0 or (x0 == x1 and y0 == y1):
        return [(x1, y1)]
    rx, ry = abs(rx), abs(ry)
    phi = math.radians(turn)
    c, s = math.cos(phi), math.sin(phi)
    dx, dy = (x0 - x1) / 2, (y0 - y1) / 2
    xp, yp = c * dx + s * dy, -s * dx + c * dy
    scale = xp * xp / (rx * rx) + yp * yp / (ry * ry)
    if scale > 1:
        rx, ry = rx * math.sqrt(scale), ry * math.sqrt(scale)
    num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
    den = rx * rx * yp * yp + ry * ry * xp * xp
    k = math.sqrt(max(num / den, 0)) * (-1 if large == sweep else 1)
    cxp, cyp = k * rx * yp / ry, -k * ry * xp / rx
    cx, cy = c * cxp - s * cyp + (x0 + x1) / 2, s * cxp + c * cyp + (y0 + y1) / 2
    a0 = math.atan2((yp - cyp) / ry, (xp - cxp) / rx)
    a1 = math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx)
    da = a1 - a0
    if sweep and da < 0:
        da += 2 * math.pi
    if not sweep and da > 0:
        da -= 2 * math.pi
    n = max(int(abs(da) * max(rx, ry) / STEP), 2)
    out = []
    for i in range(1, n + 1):
        a = a0 + da * i / n
        ex, ey = rx * math.cos(a), ry * math.sin(a)
        out.append((cx + c * ex - s * ey, cy + s * ex + c * ey))
    out[-1] = (x1, y1)
    return out


def bezier(p0, p1, p2, p3):
    """Points along a cubic curve after its start."""
    rough = math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3)
    n = max(int(rough / STEP), 2)
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append(tuple(u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k] for k in (0, 1)))
    return out


def path_lines(d):
    """The lines of an SVG path: one per subpath."""
    pos = 0

    def skip():
        nonlocal pos
        while pos < len(d) and d[pos] in " ,\t\n":
            pos += 1

    def number():
        nonlocal pos
        skip()
        m = NUMBER.match(d, pos)
        if not m:
            raise ValueError(f"bad path at {pos}: {d!r}")
        pos = m.end()
        return float(m.group())

    def flag():
        nonlocal pos
        skip()
        if pos >= len(d) or d[pos] not in "01":
            raise ValueError(f"bad arc flag at {pos}: {d!r}")
        pos += 1
        return d[pos - 1] == "1"

    def more():
        skip()
        return pos < len(d) and not d[pos].isalpha()

    lines, line = [], []
    x = y = sx = sy = 0.0
    last, ctrl = "", None  # the last command and its far control point, for S and T
    while True:
        skip()
        if pos >= len(d):
            break
        cmd = d[pos]
        pos += 1
        rel = cmd.islower()
        op = cmd.upper()
        if op == "Z":
            if line:
                line.append((sx, sy))
                lines.append(line)
            line, x, y = [], sx, sy
            last = "Z"
            continue
        first = True
        while first or more():
            first = False
            ox, oy = (x, y) if rel else (0.0, 0.0)
            if op == "M":
                if line:
                    lines.append(line)
                x, y = ox + number(), oy + number()
                sx, sy = x, y
                line = [(x, y)]
                op = "L"  # further pairs after a move are lines
                last = "M"
                continue
            if not line:
                line = [(x, y)]
            if op == "L":
                x, y = ox + number(), oy + number()
                line.append((x, y))
            elif op == "H":
                x = ox + number()
                line.append((x, y))
            elif op == "V":
                y = oy + number()
                line.append((x, y))
            elif op in "CS":
                if op == "C":
                    c1 = (ox + number(), oy + number())
                else:
                    c1 = (2 * x - ctrl[0], 2 * y - ctrl[1]) if last in "CS" and ctrl else (x, y)
                c2 = (ox + number(), oy + number())
                end = (ox + number(), oy + number())
                line += bezier((x, y), c1, c2, end)
                ctrl, (x, y) = c2, end
            elif op in "QT":
                if op == "Q":
                    q = (ox + number(), oy + number())
                else:
                    q = (2 * x - ctrl[0], 2 * y - ctrl[1]) if last in "QT" and ctrl else (x, y)
                end = (ox + number(), oy + number())
                c1 = (x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y))
                c2 = (end[0] + 2 / 3 * (q[0] - end[0]), end[1] + 2 / 3 * (q[1] - end[1]))
                line += bezier((x, y), c1, c2, end)
                ctrl, (x, y) = q, end
            elif op == "A":
                rx, ry, turn = number(), number(), number()
                large, sweep = flag(), flag()
                ex, ey = ox + number(), oy + number()
                line += arc(x, y, rx, ry, turn, large, sweep, ex, ey)
                x, y = ex, ey
            else:
                raise ValueError(f"unknown path command {cmd}")
            last = op
    if line:
        lines.append(line)
    return lines


def element_lines(tag, a):
    """The lines of one drawing element."""
    f = lambda key: float(a.get(key, 0))
    if tag == "path":
        return path_lines(a["d"])
    if tag == "line":
        return [[(f("x1"), f("y1")), (f("x2"), f("y2"))]]
    if tag in ("polyline", "polygon"):
        nums = [float(n) for n in NUMBER.findall(a["points"])]
        pts = list(zip(nums[0::2], nums[1::2]))
        return [pts + pts[:1] if tag == "polygon" else pts]
    if tag in ("circle", "ellipse"):
        rx, ry = (f("r"), f("r")) if tag == "circle" else (f("rx"), f("ry"))
        n = max(int(2 * math.pi * max(rx, ry) / STEP), 8)
        pts = [(f("cx") + rx * math.cos(2 * math.pi * i / n), f("cy") + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]
        return [pts + pts[:1]]
    if tag == "rect":
        x, y, w, h = f("x"), f("y"), f("width"), f("height")
        rx = min(float(a.get("rx", a.get("ry", 0))), w / 2)
        ry = min(float(a.get("ry", a.get("rx", 0))), h / 2)
        if rx == 0 or ry == 0:
            return [[(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]]
        d = (f"M{x + rx} {y}H{x + w - rx}A{rx} {ry} 0 0 1 {x + w} {y + ry}V{y + h - ry}A{rx} {ry} 0 0 1 {x + w - rx} {y + h}"
             f"H{x + rx}A{rx} {ry} 0 0 1 {x} {y + h - ry}V{y + ry}A{rx} {ry} 0 0 1 {x + rx} {y}Z")
        return path_lines(d)
    raise ValueError(f"unknown element {tag}")


# ----- reworking the lines -----

def length(line):
    return sum(math.dist(line[i - 1], line[i]) for i in range(1, len(line)))


def is_closed(line):
    return len(line) > 3 and math.dist(line[0], line[-1]) < 1e-6


def resample(line, step=STEP):
    """The line as points step apart along it."""
    total = length(line)
    n = max(int(round(total / step)), 1)
    out, seg, gone = [], 0, 0.0
    for i in range(n + 1):
        want = total * i / n
        while seg + 2 < len(line) and gone + math.dist(line[seg], line[seg + 1]) < want:
            gone += math.dist(line[seg], line[seg + 1])
            seg += 1
        l = math.dist(line[seg], line[seg + 1])
        t = min((want - gone) / l, 1) if l > 0 else 0
        out.append((line[seg][0] + (line[seg + 1][0] - line[seg][0]) * t, line[seg][1] + (line[seg + 1][1] - line[seg][1]) * t))
    return out


# A corner counts as rounded, and is squared off, if the line turns between
# LEAST and MOST degrees there on a curve tighter than RADIUS. Lucide rounds
# its corners with a radius of 2 or less, and draws real curves bigger. A
# tight curve that turns further than MOST is a round end or a small
# circle, which is left alone.
RADIUS = 2.4
LEAST, MOST = 28, 152
WINDOW = 4  # points each side over which the turning is averaged


def sharpen(line):
    """The line with its small rounded corners made sharp.

    The line is walked in steps of STEP. Where it turns tightly over a
    short stretch, that stretch is replaced by the one point where the
    straighter parts before and after it would meet.
    """
    closed = is_closed(line)
    p = resample(line)
    if closed:
        p = p[:-1]
    n = len(p)
    if n < 4 * WINDOW:
        return line
    at = (lambda i: p[i % n]) if closed else (lambda i: p[max(0, min(n - 1, i))])

    def turn(i):
        a, b, c = at(i - 1), at(i), at(i + 1)
        ux, uy, vx, vy = b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]
        return math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)

    turns = [turn(i) if closed or 0 < i < n - 1 else 0.0 for i in range(n)]
    tget = (lambda i: turns[i % n]) if closed else (lambda i: turns[i] if 0 <= i < n else 0.0)
    tight = []
    for i in range(n):
        bend = abs(sum(tget(j) for j in range(i - WINDOW, i + WINDOW + 1)))
        tight.append(bend / ((2 * WINDOW + 1) * STEP) > 1 / RADIUS)
    if all(tight) or not any(tight):
        return line
    # the tight stretches, as first and last index (which may pass n on a
    # closed line)
    start = next(i for i in range(n) if not tight[i]) if closed else 0
    runs, i = [], start
    stop = start + n if closed else n
    while i < stop:
        if tight[i % n]:
            j = i
            while j + 1 < stop and tight[(j + 1) % n]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1

    cut = {}  # first index of a stretch to replace -> (last index, corner)
    for a, b in runs:
        a, b = a - WINDOW, b + WINDOW
        if not closed and (a < 1 or b > n - 2):
            continue
        total = abs(sum(tget(j) for j in range(a, b + 1)))
        if not math.radians(LEAST) <= total <= math.radians(MOST):
            continue
        # the headings just before and just after
        pa, pb = at(a), at(b)
        qa, qb = at(a - 2 * WINDOW), at(b + 2 * WINDOW)
        d1 = (pa[0] - qa[0], pa[1] - qa[1])
        d2 = (qb[0] - pb[0], qb[1] - pb[1])
        den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-9:
            continue
        t = ((pb[0] - pa[0]) * d2[1] - (pb[1] - pa[1]) * d2[0]) / den
        u = ((pb[0] - pa[0]) * d1[1] - (pb[1] - pa[1]) * d1[0]) / den
        corner = (pa[0] + d1[0] * t, pa[1] + d1[1] * t)
        # the corner must lie ahead of the first part and behind the second,
        # and not far off
        if t < 0 or u > 0 or math.dist(corner, pa) > 2 * RADIUS or math.dist(corner, pb) > 2 * RADIUS:
            continue
        cut[a] = (b, corner)

    if not cut:
        return line
    out, i = [], start if closed else 0
    stop = i + n if closed else n
    # on a closed line a stretch can begin before the starting point
    while i < stop:
        if i in cut:
            b, corner = cut[i]
            out.append(at(i))
            out.append(corner)
            i = b
        else:
            out.append(at(i))
            i += 1
    if closed:
        out.append(out[0])
    return out


def simplify(pts, tol):
    """Fewer points, none moved more than tol from the line (Douglas-Peucker)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    todo = [(0, len(pts) - 1)]
    while todo:
        a, b = todo.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        l = math.hypot(bx - ax, by - ay)
        worst, at = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = math.hypot(px - ax, py - ay) if l == 0 else abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / l
            if d > worst:
                worst, at = d, i
        if worst > tol:
            keep[at] = True
            todo += [(a, at), (at, b)]
    return [p for p, k in zip(pts, keep) if k]


def box(lines):
    xs = [p[0] for l in lines for p in l]
    ys = [p[1] for l in lines for p in l]
    return min(xs), min(ys), max(xs), max(ys)


def span(lines):
    x0, y0, x1, y1 = box(lines)
    return math.hypot(x1 - x0, y1 - y0)


SPECK = 0.07  # lines smaller than this share of the icon are dropped


def strokes_of(nodes):
    """An icon's elements as reworked strokes."""
    lines = []
    for tag, attrs in nodes:
        lines += [l for l in element_lines(tag, attrs) if len(l) > 1 and length(l) > 0]
    if not lines:
        return []
    whole = span(lines)
    lines = [l for l in lines if span([l]) >= SPECK * whole]
    out = []
    for l in lines:
        l = simplify(sharpen(l), 0.03)
        if is_closed(l) or math.dist(l[0], l[-1]) < 0.02:
            l[-1] = l[0]
        l = [[round(x, 2), round(y, 2)] for x, y in l]
        if length(l) > 0:
            out.append(l)
    return out if out and span(out) > 0 else []


# ----- which icons are worth keeping -----

def near(p, line):
    """How near point p is to a line."""
    best = math.inf
    for i in range(1, len(line)):
        (ax, ay), (bx, by) = line[i - 1], line[i]
        l2 = (bx - ax) ** 2 + (by - ay) ** 2
        t = max(0, min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / l2)) if l2 else 0
        best = min(best, math.hypot(p[0] - ax - (bx - ax) * t, p[1] - ay - (by - ay) * t))
    return best


def gap(a, b):
    """How far apart two strokes are at their nearest: 0 if they cross."""
    def crosses(p, q, r, s):
        d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0])
        if abs(d) < 1e-12:
            return False
        t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d
        u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d
        return 0 <= t <= 1 and 0 <= u <= 1
    for i in range(1, len(a)):
        for j in range(1, len(b)):
            if crosses(a[i - 1], a[i], b[j - 1], b[j]):
                return 0.0
    return min(min(near(p, b) for p in a), min(near(p, a) for p in b))


def measure(strokes):
    """What decides whether an icon draws well.

    pieces: how many separate parts it is in. Each one beyond the first
        costs a joining line that isn't part of the picture.
    joins: the length of those joining lines, as a share of the lines drawn.
    ink: the length of line drawn, in icon diagonals. A lot of line in a
        small space is detail the streets can't hold.
    """
    whole = span(strokes)
    touch = 0.012 * whole  # as near as the server's own joining of strokes
    n = len(strokes)
    gaps = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            gaps[i][j] = gaps[j][i] = gap(strokes[i], strokes[j])
    # join the nearest parts first (Prim), counting the joins that are gaps
    reached, pieces, joins = {0}, 1, 0.0
    while len(reached) < n:
        d, j = min((gaps[i][k], k) for i in reached for k in range(n) if k not in reached)
        reached.add(j)
        if d > touch:
            pieces += 1
            joins += d
    drawn = sum(length(s) for s in strokes)
    return {"pieces": pieces, "joins": round(joins / drawn, 3), "ink": round(drawn / whole, 2), "strokes": n}


# Marks that only mean something on a screen or on paper, plain geometry,
# and other icons with a badge stuck on: left out by name. Each is a whole
# word of the name (names are split at hyphens). Real things are not
# listed here, even ones that often carry badges (bell, cloud, lock): the
# measures below catch the badged versions.
SCREEN = set("""
arrow arrows chevron chevrons corner align text type heading list indent outdent wrap layout panel panels
columns rows grid table sheet dashed dotted dot plus minus x check off slash ban alert question info help
code braces brackets parentheses regex binary cursor pointer touchpad command option delete space tab enter
escape undo redo repeat refresh rotate flip move scale scaling expand shrink maximize minimize fullscreen
zoom scan focus crop frame group ungroup merge split combine separator divide equal percent sigma pi omega
variable function superscript subscript bold italic underline strikethrough baseline pilcrow quote ligature
spell case letter letters font a z word whole formatting remove replace diff
file files folder folders clipboard copy paste save download upload import export share send forward reply
link unlink external menu ellipsis more grip sliders settings cog toggle log sign user users contact inbox
message messages chat voicemail gallery cast airplay bluetooth wifi signal router server database hard cpu
gpu memory circuit usb ethernet network port sim git github gitlab chrome figma framer slack trello twitter
facebook instagram linkedin youtube twitch dribbble codepen codesandbox pocket rss podcast volume play pause
stop skip fast rewind shuffle eject vibrate unplug history badge bookmark locate navigation route waypoints
milestone languages currency filter sort search view captions caption accessibility contrast brightness
activity chart area bar line pie trending kanban gantt presentation proportions ratio layers component
blocks shapes workflow orbit iteration loader app window dock wallpaper timeline webhook graph
square squares circle rectangle triangle hexagon octagon pentagon diamond ellipse squircle astroid
vector spline tangent radius diameter angle opacity blend lens
ad hd creative copyleft section radical lambda phi hash asterisk exclamation ampersand ampersands
dram manat taka ruble dirham lari tenge peso riyal franc lira dollar euro pound yen rupee bitcoin
0 1 2 3 4 5 6 7 8 9 00 01 10 11 12 2x2 3x3
""".split())


# Versions of another icon with something added (book-heart, cloud-rain,
# calendar-clock) are left out: the plain one draws better. These are
# things of their own that only look like versions by their names.
OWN = set("""
candy-cane cake-slice egg-fried book-open tree-pine tree-palm tree-deciduous ice-cream-cone ice-cream-bowl
glass-water cup-soda bottle-wine fish-symbol chess-king chess-queen chess-rook chess-bishop chess-knight
chess-pawn hand-metal hand-fist heart-crack
""".split())

# Well-loved shapes kept although they are over the limits below.
KEEP = set("gift snowflake skull bike".split())

# Search words of our own, on top of Lucide's: occasions and groups people
# look for shapes by.
EXTRA = {
    "christmas xmas festive": "gift tree-pine snowflake bell candy-cane star",
    "halloween spooky": "ghost skull bone",
    "valentine love": "heart rose",
    "animal": "cat dog bird fish rabbit rat turtle squirrel shrimp worm",
    "easter": "egg rabbit",
    "birthday party": "cake gift balloon",
}

# The most an icon can have of each measure and still be kept (see measure).
MOST_PIECES, MOST_JOINS, MOST_INK, MOST_STROKES = 2, 0.10, 4.5, 6


def suitable(name, m, names):
    """Why an icon is left out, or "" if it is kept. names is every icon's name."""
    words = name.split("-")
    if set(words) & SCREEN:
        return "screen"
    if name not in OWN and any("-".join(words[:i]) in names for i in range(1, len(words))):
        return "version"
    if name in KEEP:
        return ""
    if m["pieces"] > MOST_PIECES:
        return "pieces"
    if m["joins"] > MOST_JOINS:
        return "joins"
    if m["ink"] > MOST_INK or m["strokes"] > MOST_STROKES:
        return "busy"
    return ""


def main():
    args = sys.argv[1:]
    src = Path(args[args.index("--from") + 1]) if "--from" in args else None
    keep_all = "--all" in args
    read = (lambda name: (src / name).read_bytes()) if src else (lambda name: urllib.request.urlopen(BASE + name).read())

    ops = Path(__file__).resolve().parent
    assets = ops.parent / "assets"
    removed = set()
    remove_file = ops / "icons-remove.txt"
    if remove_file.exists():
        removed = {w for line in remove_file.read_text().splitlines() for w in line.split("#")[0].split()}

    # the user's own pick of what the rules keep, made with ops/icons-pick.py
    chosen = None
    chosen_file = ops / "icons-chosen.txt"
    if chosen_file.exists():
        chosen = set(chosen_file.read_text().split())

    nodes = json.loads(read("icon-nodes.json"))
    tags = json.loads(read("tags.json"))
    icons, why = [], {}
    for name in sorted(nodes):
        if not NAME.match(name):
            continue
        try:
            strokes = strokes_of(nodes[name])
        except (ValueError, KeyError) as err:
            why[name] = f"unreadable: {err}"
            continue
        if not strokes:
            why[name] = "empty"
            continue
        m = measure(strokes)
        reason = "by hand" if name in removed else suitable(name, m, nodes.keys())
        if not reason and chosen is not None and name not in chosen:
            reason = "not chosen"
        if reason:
            why[name] = reason
            if not keep_all:
                continue
        words = " ".join(WORD.sub(" ", str(t).lower()).strip() for t in tags.get(name, []))
        words += "".join(" " + extra for extra, names in EXTRA.items() if name in names.split())
        icons.append([name, words, strokes] + ([reason, m] if keep_all else []))
    # our own shapes (ops/icons-own.json, the same list in any units) are
    # always kept, and take the place of an icon of the same name
    own_file = ops / "icons-own.json"
    if own_file.exists():
        own = json.loads(own_file.read_text())
        mine = {o[0] for o in own}
        icons = [i for i in icons if i[0] not in mine]
        for name, words, strokes in own:
            x0, y0, x1, y1 = box(strokes)
            k = 20 / max(x1 - x0, y1 - y0)  # fitted to the middle 20 of the 24 box, like Lucide's
            fit = [[[round(12 + (x - (x0 + x1) / 2) * k, 2), round(12 + (y - (y0 + y1) / 2) * k, 2)] for x, y in s] for s in strokes]
            icons.append([name, words, fit] + (["", measure(fit)] if keep_all else []))
        icons.sort(key=lambda i: i[0])
    out = assets / ("icons-all.json" if keep_all else "icons.json")
    out.write_text(json.dumps(icons, separators=(",", ":")))
    if not keep_all:
        (assets / "icons-LICENSE.txt").write_bytes(read("LICENSE"))
    counts = {}
    for r in why.values():
        counts[r.split(":")[0]] = counts.get(r.split(":")[0], 0) + 1
    print(f"{len(icons)} icons written to {out.name}; left out: {counts}", file=sys.stderr)


if __name__ == "__main__":
    main()
