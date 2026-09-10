# -*- coding: utf-8 -*-
"""Generates illustrative technical diagrams standing in for site photo evidence.
These are clearly-labeled schematic illustrations, not real photographs."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "imgs")
os.makedirs(OUT, exist_ok=True)

MAROON = (107, 30, 44)
GOLD = (169, 130, 28)
PAPER = (250, 247, 242)
INK = (58, 51, 44)
GREY = (170, 160, 148)
STEEL = (120, 130, 138)
GREEN = (58, 122, 84)

def font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()

def label_strip(draw, w, h, text, sub=""):
    draw.rectangle([0, h-46, w, h], fill=INK)
    draw.text((14, h-40), text, fill=(255,255,255), font=font(16, True))
    if sub:
        draw.text((14, h-20), sub, fill=(210,205,198), font=font(12))
    draw.rectangle([0,0,w-1,h-1], outline=GREY, width=2)

def watermark(draw, w, h):
    wm = "ILLUSTRATIVE DIAGRAM \u2014 NOT AN ACTUAL SITE PHOTO"
    draw.text((14, 10), wm, fill=(150,60,70), font=font(11, True))

def img1_switchroom():
    w, h = 900, 620
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    # floor
    d.rectangle([0, 480, w, 574], fill=(226, 219, 206))
    # switchgear cabinets row
    cab_w, gap, x0, y0, cab_h = 140, 18, 40, 140, 340
    for i in range(5):
        x = x0 + i*(cab_w+gap)
        d.rectangle([x, y0, x+cab_w, y0+cab_h], fill=(228,229,231), outline=STEEL, width=3)
        d.rectangle([x+10, y0+16, x+cab_w-10, y0+70], fill=(58,64,70))
        for j in range(6):
            yy = y0+90+j*38
            d.rectangle([x+16, yy, x+cab_w-16, yy+22], fill=(245,245,245), outline=STEEL, width=1)
        # nameplate
        d.rectangle([x+14, y0+cab_h-30, x+cab_w-14, y0+cab_h-8], fill=GOLD)
        d.text((x+20, y0+cab_h-27), f"LV-{i+1:02d}", fill=(30,25,10), font=font(13,True))
    # cable tray overhead
    d.rectangle([20, 96, w-20, 118], fill=(200,200,206), outline=STEEL, width=2)
    for x in range(40, w-20, 26):
        d.line([x, 96, x, 118], fill=STEEL, width=2)
    label_strip(d, w, h, "Photo 1 \u2014 Substation Bldg 2, LV Switchroom", "Panel & switchgear row prior to termination, Panel PNL-04 highlighted")
    watermark(d, w, h)
    im.save(os.path.join(OUT, "photo1_switchroom.png"))

def img2_termination():
    w, h = 900, 620
    im = Image.new("RGB", (w, h), (240,240,238))
    d = ImageDraw.Draw(im)
    d.rectangle([120, 120, 780, 460], fill=(232,233,235), outline=STEEL, width=3)
    # gland plate
    d.rectangle([300, 380, 620, 460], fill=(70,74,80))
    for i, x in enumerate(range(330, 620, 60)):
        d.ellipse([x-16, 396, x+16, 428], fill=(210,210,212), outline=(40,40,40), width=3)
        d.rectangle([x-6, 340, x+6, 400], fill=(20,20,20))  # cable
        d.text((x-14, 300+ (i%2)*20), f"C{i+1}", fill=INK, font=font(13,True))
    # torque wrench icon
    d.rectangle([640, 200, 760, 224], fill=(200,60,60))
    d.ellipse([740, 190, 790, 240], outline=(200,60,60), width=6)
    d.text((640, 170), "Torque check: 18 Nm", fill=MAROON, font=font(15,True))
    label_strip(d, w, h, "Photo 2 \u2014 Cable Gland Termination, Panel PNL-04", "Glands and lugs fitted, torque verified against manufacturer spec")
    watermark(d, w, h)
    im.save(os.path.join(OUT, "photo2_termination.png"))

def img3_irtest():
    w, h = 900, 620
    im = Image.new("RGB", (w, h), (238,240,236))
    d = ImageDraw.Draw(im)
    # meter body
    d.rounded_rectangle([300, 160, 620, 420], radius=18, fill=(235,120,40), outline=(90,50,10), width=4)
    d.rounded_rectangle([340, 200, 580, 300], radius=8, fill=(20,30,20))
    d.text((360, 215), "INSULATION RESISTANCE", fill=(120,220,140), font=font(13,True))
    d.text((360, 245), "1.42 G\u03a9", fill=(120,255,150), font=font(34,True))
    d.text((360, 285), "TEST V: 1000V DC", fill=(120,220,140), font=font(12))
    # dial buttons
    for i,x in enumerate(range(360, 560, 50)):
        d.ellipse([x, 330, x+34, 364], fill=(60,60,60))
    # probes
    d.line([300, 400, 200, 470], fill=(20,20,20), width=6)
    d.line([620, 400, 720, 470], fill=(200,30,30), width=6)
    label_strip(d, w, h, "Photo 3 \u2014 Insulation Resistance Test, Activity 3.1", "Measured 1.42 G\u03a9 against a 1 M\u03a9 minimum acceptance threshold \u2014 PASS")
    watermark(d, w, h)
    im.save(os.path.join(OUT, "photo3_irtest.png"))

def img4_nameplate():
    w, h = 900, 460
    im = Image.new("RGB", (w, h), (246,244,238))
    d = ImageDraw.Draw(im)
    d.rectangle([150, 90, 750, 330], fill=(52,58,64), outline=(20,22,24), width=4)
    d.rectangle([180, 120, 720, 300], fill=GOLD)
    lines = [
        ("GFL ENGINEERING & CONSTRUCTION", 20, True),
        ("Panel: PNL-04  \u00b7  LV Switchroom, Substation Bldg 2", 15, False),
        ("Rating: 415V / 630A / IP54", 15, False),
        ("Inspected: Jags Assurance \u00b7 Activity 2.4", 15, False),
    ]
    y = 145
    for text, size, bold in lines:
        d.text((205, y), text, fill=(35,28,10), font=font(size, bold))
        y += size + 16
    label_strip(d, w, h, "Photo 4 \u2014 Panel Nameplate & Rating Verification", "Panel PNL-04, confirmed against approved switchgear submittal")
    watermark(d, w, h)
    im.save(os.path.join(OUT, "photo4_nameplate.png"))

img1_switchroom()
img2_termination()
img3_irtest()
img4_nameplate()
print("done")
