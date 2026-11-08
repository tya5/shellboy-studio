"""Regenerate the six shipped character SVG variants from the committed logo.

Run: python3 tools/conversation-icons/build_proposal.py
Uses only the Python standard library; output names are deterministic.
"""
from pathlib import Path
import copy
import xml.etree.ElementTree as E
N='http://www.w3.org/2000/svg'; E.register_namespace('',N)
def q(s): return '{'+N+'}'+s
source = Path(__file__).resolve().parents[2] / 'web/app/public/brand/studio-teal-master.svg'
O = Path(__file__).resolve().parents[2] / 'web/app/public'
(O / 'characters').mkdir(exist_ok=True)
master = E.parse(source).getroot()
STATES=[('neutral','通常 / avatar'),('ask','質問 / ask-user'),('error','エラー / recovery'),('thinking','処理・作業・待機 / busy'),('complete-check','完了案 A / check'),('rest','一時停止・休息 / rest')]
def path(d,w=21,color='#38bdf8'):
    return E.Element(q('path'),{'d':d,'fill':'none','stroke':color,'stroke-width':str(w),'stroke-linecap':'round','stroke-linejoin':'round'})
def dot(x,y,r): return E.Element(q('circle'),{'cx':str(x),'cy':str(y),'r':str(r),'fill':'#38bdf8'})
def symbols(slug,v):
    # Fixed shell + fixed original ivory oval. Optical correction affects left symbol only.
    w={'master':21,'16':24,'24':22}[v]
    if slug in ['neutral','complete-caret','rest']:
        return [path({'master':'M134 161 L172 188 L134 216','16':'M126 155 L176 187 L126 220','24':'M132 158 L174 188 L132 218'}[v],w)]
    if slug=='ask':
        if v=='16': return [path('M125 163 C125 140 178 142 178 166 C178 182 151 179 151 188',w),dot(151,221,12)]
        if v=='24': return [path('M128 162 C128 141 176 143 176 165 C176 181 152 180 152 191',w),dot(152,220,10)]
        return [path('M130 163 C130 142 175 144 175 165 C175 181 153 180 153 193',w),dot(153,219,9)]
    if slug=='error':
        return [path('M153 155 V184' if v=='16' else 'M153 155 V190',w),dot(153,220,12 if v=='16' else 10)]
    if slug=='thinking':
        return [dot(x,188,{'master':8,'16':10,'24':9}[v]) for x in {'master':[125,153,181],'16':[118,153,188],'24':[121,153,185]}[v]]
    if slug=='complete-check': return [path({'master':'M126 189 L147 211 L180 159','16':'M120 187 L145 215 L184 155','24':'M124 188 L146 213 L182 157'}[v],w)]
for slug,label in STATES:
    for v in ['master','16','24']:
        r=copy.deepcopy(master); prefix=f'{slug}-{v}'
        r.set('width','390' if v=='master' else v); r.set('height',r.get('width')); r.set('aria-labelledby',prefix+'-title')
        for c in list(r):
            old=c.get('id','')
            if old: c.set('id',prefix+'-'+old.rsplit('-',1)[-1])
            if c.tag==q('title'): c.text='Shellboy '+label+' / '+v
            if c.tag==q('desc'): c.text='Proposal. Intentional symbol replacement at viewer LEFT wink. Pair with visible state text.'
            if old.endswith('-wink'): r.remove(c)
            if old.endswith('-eye') and slug in ['complete-caret','rest']:
                idx=list(r).index(c); r.remove(c)
                eye=path('M225 198 L246 174 L267 198' if slug=='complete-caret' else 'M225 190 Q246 204 267 190',21,'#FEF2D1'); eye.set('id',prefix+'-eye'); r.insert(idx,eye)
        for i,s in enumerate(symbols(slug,v)):
            s.set('id',prefix+f'-symbol-{i}'); r.append(s)
        E.ElementTree(r).write(O/'characters'/f'{slug}-{v}.svg',encoding='utf-8',xml_declaration=True)
