"""Genera el título (y los números de paso) como trazados SVG con la letra, sin exponer la fuente entera."""
import json, random
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

f = TTFont('/home/claude/font/LetraApuntes.ttf')
gs, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f['hmtx']
pua = json.load(open('/home/claude/font/pua_map.json'))
rnd = random.Random(11)

def svg_text(text, cls, pick=None, space=330):
    x, parts, last = 0, [], {}
    for i, ch in enumerate(text):
        if ch == ' ':
            x += space; continue
        v = pua[ch]
        k = (pick[i] if pick else (last.get(ch, -1) + 1)) % len(v)
        last[ch] = k
        g = cmap[v[k]]
        pen = SVGPathPen(gs); gs[g].draw(pen)
        rot = rnd.uniform(-2.5, 2.5); dy = rnd.uniform(-10, 10)
        parts.append(f'<path class="{cls}" style="--i:{len(parts)}" transform="translate({x} {dy:.0f}) rotate({rot:.1f})" d="{pen.getCommands()}"/>')
        x += hmtx[g][0]
    return x, parts

w, title = svg_text("Apuntes en mi letra", "g")
pad = 40
svg = (f'<svg id="title-svg" viewBox="{-pad} -800 {w + 2*pad} 1150" role="img" aria-label="Apuntes en mi letra">'
       f'<g transform="scale(1,-1)">{"".join(title)}</g></svg>')
digits = {}
for d in "12":
    dw, p = svg_text(d, "d", pick={0: 0})
    digits[d] = f'<svg class="num" viewBox="-60 -700 {dw+120} 820" aria-hidden="true"><g transform="scale(1,-1)">{"".join(p)}</g></svg>'
json.dump({"title": svg, "digits": digits}, open('/home/claude/build/title_svg.json', 'w'), ensure_ascii=False)
print(len(svg), "bytes; ancho", w)
