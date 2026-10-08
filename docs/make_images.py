"""Draws the README images as terminal cell grids, the way Claude Code paints unstuck.

python docs/make_images.py <out dir>   ->  <name>.html, one per image (render with a headless browser)
"""
import sys
from html import escape
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

# Claude Code dark theme
STYLE = {
    'text': 'color:#e8e8e8',
    'bold': 'color:#ffffff;font-weight:700',
    'dim': 'color:#8c8c8c',
    'faint': 'color:#4d4d4d',
    'error': 'color:#ff6b80',
    'error_b': 'color:#ff6b80;font-weight:700',
    'warning': 'color:#ffc107',
    'success': 'color:#4eba65',
    'claude': 'color:#d77757',
    'claude_b': 'color:#d77757;font-weight:700',
    'blue': 'color:#b1b9f9',
    'blue_b': 'color:#b1b9f9;font-weight:700',
    'border': 'color:#5a5a5a',
}
WIDE = set('⏪🧹🔎🔬🌐💡🔴🟡🟢✅🙈🧠↩⚙')


class Grid:
    def __init__(self, cols, rows):
        self.cols, self.rows = cols, rows
        self.cells = [[(' ', 'text') for _ in range(cols)] for _ in range(rows)]

    def put(self, x, y, s, style='text'):
        for ch in s:
            if ch == '️':
                continue
            if x >= self.cols:
                return x
            self.cells[y][x] = (ch, style)
            if ch in WIDE:
                if x + 1 < self.cols:
                    self.cells[y][x + 1] = (None, style)
                x += 2
            else:
                x += 1
        return x

    def runs(self, x, y, parts):
        for s, style in parts:
            x = self.put(x, y, s, style)
        return x

    def box(self, x, y, w, h, style='border'):
        self.put(x, y, '╭' + '─' * (w - 2) + '╮', style)
        for i in range(1, h - 1):
            self.put(x, y + i, '│', style)
            self.put(x + w - 1, y + i, '│', style)
        self.put(x, y + h - 1, '╰' + '─' * (w - 2) + '╯', style)

    def clear(self, x, y, w, h):
        for j in range(max(0, y), min(self.rows, y + h)):
            for i in range(max(0, x), min(self.cols, x + w)):
                self.cells[j][i] = (' ', 'text')

    def button(self, x, y, label, primary=False, dim=False):
        style = 'claude_b' if primary else 'dim' if dim else 'text'
        return self.put(x, y, f'[ {label} ]', style) + 1

    def html(self):
        rows = []
        last = max(i for i, row in enumerate(self.cells) if any(ch not in (' ', None) for ch, _ in row))
        for row in self.cells[: last + 1]:
            out, cur, buf = [], None, ''
            for ch, style in row:
                if ch is None:
                    continue
                if ch in WIDE:
                    piece = f'<span class="c2"><i>{escape(ch)}</i></span>'
                elif ord(ch) > 127 and not 0x2500 <= ord(ch) <= 0x257F:
                    piece = f'<span class="c1">{escape(ch)}</span>'  # fallback glyphs keep the grid
                else:
                    piece = escape(ch)
                if style != cur:
                    if buf:
                        out.append(f'<span style="{STYLE[cur]}">{buf}</span>')
                    cur, buf = style, ''
                buf += piece
            if buf:
                out.append(f'<span style="{STYLE[cur]}">{buf}</span>')
            rows.append(''.join(out))
        return '\n'.join(rows)


def page(grid, name):
    OUT.joinpath(f'{name}.html').write_text(
        f'''<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:transparent}}
.t{{display:inline-block;margin:0;padding:22px 26px;background:#141414;border:1px solid #2c2c2c;border-radius:10px;
font:15px/1.45 'Cascadia Mono',Consolas,monospace;font-variant-ligatures:none;white-space:pre}}
.c1{{display:inline-block;width:1ch;text-align:center;overflow:visible}}
.c2{{display:inline-block;width:2ch;text-align:left}}
.c2 i{{font-style:normal;font-family:'Segoe UI Emoji','Apple Color Emoji',sans-serif;font-size:13px}}
</style><pre class="t">{grid.html()}</pre>''',
        encoding='utf-8',
    )


FAIL = '✗ a 10% discount is rounded to the cent · actual 53.973, expected 53.97'


def transcript(g, x, y, faint=False):
    t, b, d, e = ('faint',) * 4 if faint else ('text', 'bold', 'dim', 'error')
    g.runs(x, y, [('> ', d), ('add a 10% discount code to the cart total', d)])
    y += 2
    steps = [
        ('Bash', 'npm test', FAIL),
        ('say', "Rounding each line item should fix it.", None),
        ('Update', 'cart.js', 'Updated cart.js with 1 addition and 1 removal'),
        ('Bash', 'npm test', FAIL),
        ('say', "That didn't help, reverting to the previous version.", None),
        ('Update', 'cart.js', 'Updated cart.js with 1 addition and 1 removal'),
        ('Bash', 'npm test', FAIL),
    ]
    for kind, arg, res in steps:
        if kind == 'say':
            g.runs(x, y, [('⏺ ', t), (arg, t)])
            y += 2
            continue
        ok = res and not res.startswith('✗')
        g.runs(x, y, [('⏺ ', ('faint' if faint else 'success') if ok else e), (kind, b), (f'({arg})', t)])
        g.runs(x, y + 1, [('  ⎿  ', d), (res, d if ok else e)])
        y += 3
    return y


def band(g, x, y, w):
    g.box(x, y, w, 5, 'error')
    end = g.put(x + 2, y + 1, '🔴 Claude is stuck · same error 3× · 1 undone edit · 4 min · ≈$0.38 burned', 'error_b')
    g.put(x + w - 6, y + 1, 'hide', 'dim')
    g.put(x + 2, y + 2, "AssertionError [ERR_ASSERTION]: actual 53.973, expected 53.97", 'dim')
    bx = g.button(x + 2, y + 3, '⏪ Revert to last green', primary=True)
    bx = g.button(bx, y + 3, '🧹 Clean restart')
    bx = g.button(bx, y + 3, '🔎 2nd opinion')
    g.button(bx, y + 3, 'Not stuck', dim=True)
    return y + 5


def prompt(g, x, y, w, hint=''):
    g.box(x, y, w, 3, 'border')
    g.runs(x + 2, y + 1, [('> ', 'text'), (hint, 'faint')])
    return y + 3


def toast(g, x, y, w, title, lines, style):
    g.clear(x - 1, y, w + 2, len(lines) + 3)
    g.box(x, y, w, len(lines) + 3, style)
    g.put(x + 2, y + 1, title, 'bold')
    for i, line in enumerate(lines):
        g.put(x + 2, y + 2 + i, line, 'dim')
    return y + len(lines) + 3


# 1. Hero: the loop, the band, the prompt, the status line, the toast.
HW = 120
g = Grid(HW, 30)
y = transcript(g, 0, 0)
y = band(g, 0, y, HW)
y = prompt(g, 0, y, HW)
g.put(2, y, '🔴 Claude is stuck · same error 3× · /unstuck', 'error')
g.put(HW - 16, y, '? for shortcuts', 'faint')
toast(g, HW - 38, 0, 38, '🔴 Claude is stuck', ['same error 3×, 1 undone edit', 'Ways out: above the prompt'], 'error')
page(g, 'hero')

# 2. The /unstuck pane docked beside the transcript.
L, R = 50, 58
g = Grid(L + 3 + R, 31)
transcript(g, 0, 0, faint=True)
g.clear(L, 0, 3 + R, 31)  # the pane covers what the transcript drew beneath it
for row in range(31):
    g.put(L + 1, row, '│', 'border')
prompt(g, 0, 28, L, 'Ask Claude anything…')
x, y = L + 4, 0
g.put(x, y, 'unstuck', 'dim')
g.put(x, y + 2, '🔴 Claude is stuck', 'error_b')
g.put(x, y + 3, 'same error 3× · 1 undone edit · 1 silenced error', 'text')
g.put(x, y + 4, '≈$0.38 burned', 'text')
g.put(x, y + 5, 'AssertionError: actual 53.973, expected 53.97', 'dim')
g.put(x, y + 7, '⏪ Last green state: 39ecddb', 'dim')
g.put(x, y + 9, '💡 Second opinion', 'blue_b')
g.runs(x, y + 10, [('Root cause: ', 'bold'), ('cart.js:5 rounds the sum first,', 'text')])
g.put(x, y + 11, 'then applies the discount, so 53.973 is never', 'text')
g.put(x, y + 12, 'rounded. Both attempts kept that order.', 'text')
g.runs(x, y + 14, [('Fix: ', 'bold'), ('round(sum * (1 - discount))', 'blue')])
bx = g.button(x, y + 16, '💡 Use 2nd opinion', primary=True)
g.button(bx, y + 16, '⏪ Revert to last green')
bx = g.button(x, y + 17, '🧹 Clean restart')
g.button(bx, y + 17, '🔎 2nd opinion')
bx = g.button(x, y + 18, '🔬 Diagnose first')
g.button(bx, y + 18, '🌐 Search the error')
g.button(x, y + 19, 'Not stuck', dim=True)
g.put(x, y + 21, '⚙ Settings', 'dim')
page(g, 'menu')

# 3. Settings.
g = Grid(60, 23)
y = 0
for title, rows in [
    ('Detect', [
        (1, 'The same error coming back'),
        (1, 'The same command failing (even with new errors)'),
        (1, 'Claude saying "fixed" when it is not'),
        (1, 'Claude undoing its own edits'),
        (1, 'Claude silencing errors (.skip(), as any, ...)'),
    ]),
    ('Act', [
        (1, 'On red, tell Claude to stop and list hypotheses'),
        (0, 'Block edits that silence errors'),
        (1, 'Remember dead ends for this project'),
    ]),
    ('Notify', [(1, 'Pop-up notifications'), (1, 'Red band above the prompt'), (1, 'Status line while looping')]),
]:
    g.put(0, y, title, 'bold')
    y += 1
    for on, label in rows:
        g.runs(0, y, [('◉ ' if on else '○ ', 'success' if on else 'faint'), (label, 'text' if on else 'dim')])
        y += 1
    y += 1
g.put(0, y, 'Sensitivity', 'bold')
for i, (n, label) in enumerate([('2', 'signals before 🟡'), ('3', 'signals before 🔴')]):
    bx = g.button(0, y + 1 + i, '-')
    bx = g.put(bx, y + 1 + i, n, 'bold') + 1
    bx = g.button(bx, y + 1 + i, '+')
    g.put(bx, y + 1 + i, label, 'text')
page(g, 'settings')

# 4. The toasts.
g = Grid(52, 24)
y = 0
for title, lines, style in [
    ('🟡 Claude may be going in circles', ['same error 2×'], 'warning'),
    ('↩ Claude undid its own earlier edit', ['in cart.js'], 'warning'),
    ('🙈 Claude silenced an error', ['cart.test.js: .skip()'], 'error'),
    ('🧠 Context is 84% full', ['a clean restart will help more than another try'], 'blue'),
    ('✅ Loop broken, back on track.', [], 'success'),
]:
    y = toast(g, 0, y, 52, title, lines, style) + 1
page(g, 'toasts')
print('ok')
