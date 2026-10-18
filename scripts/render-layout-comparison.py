import json
import argparse
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent.parent/'output'/'3d'
parser=argparse.ArgumentParser(description='Render the current furniture layout comparison')
parser.add_argument('--font',default=os.environ.get('IDEALHOME_FONT'),help='Path to a Chinese TTF/TTC font')
args=parser.parse_args()
candidates=[args.font,'C:/Windows/Fonts/msyh.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/System/Library/Fonts/PingFang.ttc']
FONT=next((p for p in candidates if p and Path(p).is_file()),None)
if not FONT:
    parser.error('Provide a Chinese font using --font or IDEALHOME_FONT')
if not (ROOT/'layout-footprints-r10.json').is_file():
    parser.error('Run npm run check first to generate layout footprints')
data=json.loads((ROOT/'layout-footprints-r10.json').read_text(encoding='utf8'))
img=Image.new('RGB',(1800,990),'#f5f2ea')
d=ImageDraw.Draw(img)
def font(n): return ImageFont.truetype(FONT,n)
ink='#303c33'; muted='#737c70'; stroke='#54624f'
d.text((50,30),'家具布局对比',font=font(38),fill=ink)
d.text((52,90),'同一户型 · 固定柜 / 空调 / 电视墙 / 门窗 / 楼梯保留 · 三套床头均靠内墙',font=font(20),fill=muted)
d.text((52,125),'以下取自 R1.0 模型家具占地；统一配色，便于看清位置与组合差异。上北，右东。',font=font(17),fill=muted)
panels=[('wood','A  原木会客',['客厅：三人沙发＋单椅＋长茶几','卧室：保持床位，东侧单椅阅读角','书房：北墙书桌＋东侧矮书柜','取舍：座位、收纳多，家具也更多。']),('cream','B  奶油舒展',['客厅：双人模块＋贵妃位＋高低圆几','卧室：床向东约 43 cm，增床尾凳','书房：书桌转东墙，取消矮柜','取舍：适合躺坐，卧室东侧更开敞。']),('chinese','C  轻中式对坐',['客厅：木框坐榻＋单椅＋木茶桌','卧室：东南侧双椅相向，中间放边几','书房：书桌离北墙，矮柜靠东侧北段','取舍：可双人闲坐，占用东南侧空地。'])]
labels={'sofa':'沙发','cream-sofa':'沙发','cream-chaise':'贵妃','coffee-table':'几','nesting-tables':'圆几','chinese-settee':'坐榻','tea-table':'茶桌','bed':'床','study-desk':'桌','gaming-desk':'桌','fixed-cabinet':'原柜','bed-bench':'长凳','study-lowcase':'柜'}
for k,(key,title,notes) in enumerate(panels):
 left=40+k*586
 d.rounded_rectangle((left,177,left+548,918),radius=14,fill='#fffdf8',outline='#d8ddd1',width=2)
 d.text((left+24,197),title,font=font(28),fill=ink)
 scale=40.3; ox=left+69; oy=270
 def p(x,z):return (ox+x*scale,oy+z*scale)
 def line(a,b,width=3,fill=stroke):d.line([p(*a),p(*b)],fill=fill,width=width)
 # Room extents and openings are simplified; not a construction drawing.
 outline=[(-1.15,0),(11.05,0),(11.05,9),(1.55,9),(1.55,4.7),(-.25,4.7),(-.25,2.45),(-1.15,2.45),(-1.15,0)]
 d.polygon([p(*q) for q in outline],fill='#f2f1e8')
 d.line([p(*q) for q in outline],fill=stroke,width=4)
 for a,b in [((-.25,0),(-.25,1.55)),((-.25,2.35),(-.25,4.7)),((-.25,2.45),(1.83,2.45)),((2.62,2.45),(2.75,2.45)),((2.75,0),(2.75,2.6)),((2.75,4.4),(2.75,9)),((2.75,4.7),(3.2,4.7)),((4.02,4.7),(11.05,4.7)),((7.2,0),(7.2,3)),((7.2,3),(10.08,3)),((10.9,3),(11.05,3)),((1.55,4.7),(1.82,4.7)),((2.58,4.7),(2.75,4.7))]:line(a,b)
 for a,b in [((11.05,.55),(11.05,2.35)),((11.05,3.26),(11.05,4.42)),((11.05,5.75),(11.05,8.32)),((-.25,.2),(-.25,1.4))]:line(a,b,4,'#6a98a0')
 for z in [2.75,3,3.9,4.15]:line((-.05,z),(1.35,z),1,'#9ba18f')
 d.text(p(.18,3.25),'楼梯',font=font(13),fill=muted)
 d.text(p(1.8,6.9),'卫',font=font(14),fill=muted)
 # Dashed circulation line is clear of living furniture in all plans.
 for i in range(25):line((2.9+i*.29,3.65),(3.03+i*.29,3.65),2,'#baae93')
 d.text(p(5.1,3.9),'主过道',font=font(13),fill=muted)
 for f in data[key]:
  if f['room']=='bathroom':continue
  box=[p(f['x'],f['z']),p(f['x']+f['w'],f['z']+f['d'])]
  fixed=f['id']=='fixed-cabinet'
  d.rounded_rectangle(box,radius=2,fill='#8d9587' if fixed else '#c1ccb4',outline=stroke,width=1)
  label=labels.get(f['id'])
  if label:
   ft=font(12 if len(label)>1 else 15);bounds=d.textbbox((0,0),label,font=ft);tw=bounds[2]-bounds[0];th=bounds[3]-bounds[1]
   x,z=p(f['x']+f['w']/2,f['z']+f['d']/2)
   d.text((x-tw/2,z-th/2-3),label,font=ft,fill='#fffdf8' if fixed else ink)
 # TV and existing wall AC retain identical locations in the comparison.
 line((2.89,.92),(2.89,2.31),4,ink)
 line((9.03,4.86),(10.07,4.86),4,'#788e94')
 d.text(p(8.97,5.05),'原空调',font=font(11),fill=muted)
 d.text(p(6.5,8.45),'卧室',font=font(15),fill=muted)
 d.text((left+24,666),'摆放与使用',font=font(18),fill=ink)
 for j,note in enumerate(notes):d.text((left+24,710+j*43),note,font=font(17),fill=muted if j==3 else ink)
d.text((50,945),'固定建筑关系不变；家具尺寸与通道仍需按现场实测校正。示意中的圆几以外包占地表示。',font=font(17),fill=muted)
img.save(ROOT/'layout-comparison-r10.png')
