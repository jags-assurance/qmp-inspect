# -*- coding: utf-8 -*-
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
    PageBreak, HRFlowable, KeepTogether, ListFlowable, ListItem
)
from reportlab.pdfgen import canvas as canvas_mod

HERE = os.path.dirname(__file__)
IMGS = os.path.join(HERE, "imgs")
OUT = os.path.join(HERE, "QMP-Inspect_Real-World-Document-Package.pdf")

MAROON = colors.HexColor("#6B1E2C")
GOLD = colors.HexColor("#a9821c")
INK = colors.HexColor("#3a332c")
MUTED = colors.HexColor("#6b6259")
FAINT = colors.HexColor("#a49484")
PAPER = colors.HexColor("#faf7f2")
LINE = colors.HexColor("#e6ddd3")
GREEN = colors.HexColor("#2f6f4e")
BADGE_GOLD_BG = colors.HexColor("#f6e9c9")
BADGE_GREEN_BG = colors.HexColor("#dcefe1")
BADGE_GREY_BG = colors.HexColor("#eee9e2")

styles = getSampleStyleSheet()
def mk(name, **kw):
    styles.add(ParagraphStyle(name=name, **kw))

mk("DocTitle", fontName="Helvetica-Bold", fontSize=25, leading=30, textColor=INK, spaceAfter=6)
mk("DocSub", fontName="Helvetica", fontSize=12.5, leading=17, textColor=MUTED, spaceAfter=2)
mk("Kicker", fontName="Helvetica-Bold", fontSize=9.5, leading=12, textColor=GOLD, spaceAfter=4)
mk("H1", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=MAROON, spaceBefore=4, spaceAfter=10)
mk("H2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=MAROON, spaceBefore=12, spaceAfter=6)
mk("Body", fontName="Helvetica", fontSize=10, leading=14.5, textColor=INK, spaceAfter=6)
mk("BodyMuted", fontName="Helvetica", fontSize=9.3, leading=13.5, textColor=MUTED, spaceAfter=6)
mk("Small", fontName="Helvetica", fontSize=8.3, leading=11.5, textColor=FAINT)
mk("Mono", fontName="Courier", fontSize=8.6, leading=12.6, textColor=INK, backColor=colors.HexColor("#f4f0e8"))
mk("Caption", fontName="Helvetica-Oblique", fontSize=8.6, leading=11.5, textColor=MUTED, spaceBefore=3, spaceAfter=10)
mk("CoverTitle", fontName="Helvetica-Bold", fontSize=27, leading=33, textColor=colors.white)
mk("CoverSub", fontName="Helvetica", fontSize=13, leading=18, textColor=colors.HexColor("#f3d9dd"))
mk("TocEntry", fontName="Helvetica", fontSize=10.5, leading=20, textColor=INK)

def hr(color=LINE, thickness=1, space_before=4, space_after=10):
    return HRFlowable(width="100%", thickness=thickness, color=color, spaceBefore=space_before, spaceAfter=space_after)

def badge(text, bg, fg=INK):
    t = Table([[text]], colWidths=[None])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), bg),
        ("TEXTCOLOR", (0,0), (-1,-1), fg),
        ("FONTNAME", (0,0), (-1,-1), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 3),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ("LEFTPADDING", (0,0), (-1,-1), 8),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
    ]))
    return t

def simple_table(data, col_widths, header=True, font_size=8.8, align_first_left=True, bold_first_col=False):
    t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    style = [
        ("FONTSIZE", (0,0), (-1,-1), font_size),
        ("FONTNAME", (0,0), (-1,-1), "Helvetica"),
        ("TEXTCOLOR", (0,0), (-1,-1), INK),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("GRID", (0,0), (-1,-1), 0.6, LINE),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LEFTPADDING", (0,0), (-1,-1), 6),
        ("RIGHTPADDING", (0,0), (-1,-1), 6),
    ]
    if header:
        style += [
            ("BACKGROUND", (0,0), (-1,0), MAROON),
            ("TEXTCOLOR", (0,0), (-1,0), colors.white),
            ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ]
    if bold_first_col:
        style += [("FONTNAME", (0, 1 if header else 0), (0,-1), "Helvetica-Bold")]
    t.setStyle(TableStyle(style))
    return t

story = []

# ---------- Header/footer canvas ----------
class DocCanvas(canvas_mod.Canvas):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        super().showPage()

    def save(self):
        page_count = len(self._saved) + 1
        super().save()

def footer(cv, doc):
    cv.saveState()
    cv.setStrokeColor(LINE)
    cv.setLineWidth(0.6)
    cv.line(20*mm, 15*mm, 190*mm, 15*mm)
    cv.setFont("Helvetica", 7.6)
    cv.setFillColor(FAINT)
    cv.drawString(20*mm, 11*mm, "QMP Inspect · Jags Assurance · Illustrative Document Package — Coastal LNG Terminal Expansion, Package 4")
    cv.drawRightString(190*mm, 11*mm, f"Page {doc.page}")
    cv.restoreState()

# ================= COVER PAGE =================
def cover_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(MAROON)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#7d2836"))
    canvas.rect(0, h-70*mm, w, 70*mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, h-70*mm, w, 2.2*mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(20*mm, h-20*mm, "JAGS ASSURANCE")
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(colors.HexColor("#f3d9dd"))
    canvas.drawString(20*mm, h-26*mm, "Independent Quality Inspection · QMP Inspect Platform")
    canvas.restoreState()

story.append(Spacer(1, 82*mm))
story.append(Paragraph("How a Real ITP Is Generated, Executed &amp; Closed Out", styles["CoverTitle"]))
story.append(Spacer(1, 6))
story.append(Paragraph("An end-to-end, real-world document package for one live example project —", styles["CoverSub"]))
story.append(Paragraph("from the AI prompt that drafts the ITP, through field execution with photographic evidence,", styles["CoverSub"]))
story.append(Paragraph("to the signed Data Book and Handover Certificate.", styles["CoverSub"]))
story.append(Spacer(1, 14))
cover_meta = Table([
    ["Project", "Coastal LNG Terminal Expansion — Package 4"],
    ["Client", "Meridian Energy Holdings"],
    ["Contractor", "GFL Engineering & Construction"],
    ["Discipline (worked example)", "Electrical — LV Switchroom Fit-out"],
    ["Prepared by", "QMP Inspect · Jags Assurance"],
    ["Document date", "08 September 2026"],
], colWidths=[55*mm, 110*mm])
cover_meta.setStyle(TableStyle([
    ("FONTNAME", (0,0), (0,-1), "Helvetica-Bold"),
    ("FONTNAME", (1,0), (1,-1), "Helvetica"),
    ("FONTSIZE", (0,0), (-1,-1), 10.5),
    ("TEXTCOLOR", (0,0), (0,-1), colors.HexColor("#f3d9dd")),
    ("TEXTCOLOR", (1,0), (1,-1), colors.white),
    ("LINEBELOW", (0,0), (-1,-2), 0.5, colors.HexColor("#8a3644")),
    ("TOPPADDING", (0,0), (-1,-1), 6),
    ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ("LEFTPADDING", (0,0), (-1,-1), 0),
]))
story.append(cover_meta)
story.append(Spacer(1, 16))
story.append(Paragraph(
    "This package is a worked illustration prepared to show, concretely, what QMP Inspect's AI-drafted "
    "documents and field records look like in real use. Data, names and photographs in this package are "
    "illustrative and constructed for demonstration — the structure, prompts, cost figures and document "
    "formats reflect how the platform genuinely operates.",
    ParagraphStyle("CoverNote", parent=styles["CoverSub"], fontSize=9.6, leading=14, textColor=colors.HexColor("#e9c3c9"))
))
story.append(PageBreak())

# ================= TABLE OF CONTENTS =================
story.append(Paragraph("Contents", styles["H1"]))
story.append(hr())
toc_rows = [
    ("1", "How the AI Generation Pipeline Works", "3"),
    ("2", "The Exact Prompt Used to Draft This ITP", "4"),
    ("3", "AI Generation Cost & Performance", "6"),
    ("4", "Generated Document — Inspection & Test Plan (Controlled)", "7"),
    ("5", "Field Execution Evidence — Checklist & Photographs", "10"),
    ("6", "Inspection Report (Activity 3.1 — Insulation Resistance Test)", "12"),
    ("7", "Non-Conformance Report & Close-Out Certificate", "13"),
    ("8", "Data Book — Real-Time Completeness Index", "15"),
    ("9", "Certificate of Quality Handover", "16"),
    ("10", "Applying the Same Pipeline Across Disciplines", "17"),
]
toc_data = [[Paragraph(f"<b>{n}.</b>", styles["TocEntry"]), Paragraph(t, styles["TocEntry"]), Paragraph(p, styles["TocEntry"])] for n,t,p in toc_rows]
toc_table = Table(toc_data, colWidths=[10*mm, 140*mm, 15*mm])
toc_table.setStyle(TableStyle([
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("LINEBELOW", (0,0), (-1,-2), 0.4, LINE),
    ("TOPPADDING", (0,0), (-1,-1), 5),
    ("BOTTOMPADDING", (0,0), (-1,-1), 5),
]))
story.append(toc_table)
story.append(Spacer(1, 16))
story.append(Paragraph(
    "<b>The golden rule behind every AI-drafted document in this package:</b> the AI drafts, a qualified person "
    "reviews, edits and approves. The AI never finalises a quality decision — every hold point, pass/fail "
    "result and sign-off in this package is a human action, evidenced by name, date and signature status.",
    styles["Body"]
))
story.append(PageBreak())

# ================= SECTION 1: PIPELINE =================
story.append(Paragraph("1. How the AI Generation Pipeline Works", styles["H1"]))
story.append(Paragraph(
    "QMP Inspect uses Claude (Anthropic) to turn an uploaded specification and its referenced standards into a "
    "first-draft Inspection & Test Plan (ITP), checklists, and register entries. The AI never talks to the "
    "field directly — every output lands in a human review queue before it can be issued.",
    styles["Body"]
))
pipeline_rows = [
    ["Step", "What happens", "Who / what performs it"],
    ["1. Upload", "Contractor or Jags uploads the approved specification (PDF/DOCX) and linked drawings/standards to the Document Vault.", "Contractor / Jags Admin"],
    ["2. Extract", "AI reads the specification text, identifies inspection-relevant clauses, referenced codes (IEC, ISO, ASTM, etc.) and activity boundaries.", "Claude Sonnet 5, via the Spec-to-ITP prompt"],
    ["3. Draft", "AI proposes an activity schedule with Hold / Witness / Review / Surveillance points per party, acceptance criteria, and required records — returned as structured JSON, never as final text.", "Claude Sonnet 5"],
    ["4. Review & edit", "Jags Lead Inspector reviews every row, corrects point allocations, adds omissions, and edits wording. Nothing drafted by AI is issued unedited by default — review is mandatory.", "Jags Lead Inspector (human)"],
    ["5. Approve & issue", "Group Quality Director and Project Director approve; the ITP is issued as a controlled document with a document number and revision.", "Jags Assurance management (human)"],
    ["6. Execute & close", "Field teams execute against the issued ITP; checklists, photos, NCRs and test reports accumulate into the Data Book until 100% complete.", "Contractor, Subcontractor, TPI, Jags, Client"],
]
story.append(simple_table(
    [[Paragraph(f"<b>{r[0]}</b>", styles["Body"]) if i==0 else Paragraph(r[0], styles["Body"]) for i,r in enumerate([row]*1)][0:0] or [Paragraph(row[0], ParagraphStyle('c', parent=styles['Body'], fontSize=8.8)), Paragraph(row[1], ParagraphStyle('c', parent=styles['Body'], fontSize=8.8)), Paragraph(row[2], ParagraphStyle('c', parent=styles['Body'], fontSize=8.8))] for row in pipeline_rows[1:]],
    col_widths=[26*mm, 92*mm, 47*mm], header=False
))
# header row separately styled
hdr = Table([["Step", "What happens", "Who / what performs it"]], colWidths=[26*mm, 92*mm, 47*mm])
hdr.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), MAROON), ("TEXTCOLOR", (0,0), (-1,-1), colors.white),
    ("FONTNAME", (0,0), (-1,-1), "Helvetica-Bold"), ("FONTSIZE", (0,0), (-1,-1), 8.8),
    ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ("LEFTPADDING", (0,0), (-1,-1), 6),
]))
story.insert(len(story)-1, hdr)

story.append(Spacer(1, 10))
story.append(Paragraph(
    "<b>Why this matters for auditability:</b> because every AI-drafted row carries a distinct edit history and "
    "the final ITP is signed off by named individuals, the resulting document satisfies the same controlled-"
    "document requirements (ISO 9001 §7.5, ISO/IEC 17020 impartiality) as a fully manual ITP — the AI "
    "only removes the blank-page problem, not the accountability.",
    styles["BodyMuted"]
))
story.append(PageBreak())

# ================= SECTION 2: PROMPT =================
story.append(Paragraph("2. The Exact Prompt Used to Draft This ITP", styles["H1"]))
story.append(Paragraph(
    "This is the real system prompt QMP Inspect sends to Claude for Spec-to-ITP generation. The specification "
    "text and standards list are inserted at the marked points; the model is instructed to return structured "
    "JSON only — never prose — so it can be rendered directly into the ITP Builder screen for human review.",
    styles["Body"]
))
prompt_text = """You are drafting an Inspection & Test Plan (ITP) for a quality assurance platform used by an
independent inspection body. You will be given: (1) the full text of an approved
engineering specification, (2) a list of standards referenced by the project, and
(3) the project's party roster (Contractor, Subcontractor, TPI/Lab, Jags Assurance, Client).

Your task:
1. Identify each distinct inspectable activity described or implied by the specification,
   in construction/installation sequence order.
2. For each activity, propose acceptance criteria drawn directly from the specification
   text or the referenced standards — do not invent numeric tolerances that are not
   stated or clearly implied by the source documents.
3. Assign an intervention point per party using only these codes:
     H = Hold (work must stop until released)
     W = Witness (party invited, may proceed after notice period lapses)
     R = Review (records reviewed/accepted, no site presence required)
     S = Surveillance (routine monitoring, no hold)
   Leave a party's point blank if the specification gives no basis for involving them.
4. List the records/evidence required to close each activity (e.g. test certificate,
   photographic record, calibration certificate reference).
5. Cite the specification clause or standard clause supporting each activity.

Output ONLY valid JSON matching this shape — no commentary, no markdown fences:
{
  "rows": [
    { "n": "<activity number>", "activity": "<short title>",
      "criteria": "<acceptance criteria>", "c": "<H|W|R|S|''>", "s": "...", "t": "...",
      "j": "...", "cl": "...", "records": "<evidence required>",
      "sourceClause": "<spec or standard clause reference>" }
  ],
  "openQuestions": ["<anything the specification did not make clear enough to draft with confidence>"]
}

Golden rule: you are drafting for human review. If the specification is silent or
ambiguous on a point, say so in "openQuestions" rather than guessing. Never mark an
activity as inspected, passed, or signed — that is a human decision, made after
your draft is reviewed."""

for line in prompt_text.split("\n"):
    story.append(Paragraph(line.replace(" ", "&nbsp;") if line.strip()=="" else line.replace("<", "&lt;").replace(">", "&gt;"), styles["Mono"]))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "Inputs for this example: <b>Electrical Specification Rev B</b> (the Meridian Energy specification for "
    "Substation Building 2), cross-referenced against <b>IEC 60204-1, IEC 60364-5-52, IEC 60364-6, ISO 9001</b>.",
    styles["BodyMuted"]
))
story.append(Spacer(1, 6))
story.append(Paragraph("Excerpt of the raw model output before human review (row 3 of 11 shown):", styles["Body"]))
output_excerpt = """{
  "n": "2.3", "activity": "Cable termination",
  "criteria": "Correct glands/lugs, torque, phase ID, ferrules and enclosure sealing",
  "c": "H", "s": "W", "t": "", "j": "S", "cl": "S",
  "records": "Termination checklist, torque log",
  "sourceClause": "Electrical Specification Rev B §4.2; IEC 60364-5-52 §52.6"
}"""
for line in output_excerpt.split("\n"):
    story.append(Paragraph(line.replace(" ", "&nbsp;") if line.strip()=="" else line, styles["Mono"]))
story.append(Paragraph(
    "This raw row was accepted unchanged by the Lead Inspector during review — in this example, 9 of the "
    "11 AI-drafted rows required no edits, and 2 rows had party point allocations corrected before approval.",
    styles["Caption"]
))
story.append(PageBreak())

# ================= SECTION 3: COST =================
story.append(Paragraph("3. AI Generation Cost & Performance", styles["H1"]))
story.append(Paragraph(
    "Cost is calculated from Anthropic's published API pricing for the model used. Figures below are for "
    "generating this one ITP (11 activities) from a 22-page specification plus standards context.",
    styles["Body"]
))
cost_rows = [
    ["Metric", "Value"],
    ["Model", "Claude Sonnet 5 (claude-sonnet-5)"],
    ["Input tokens (spec + standards context + prompt)", "~ 21,400 tokens"],
    ["Output tokens (structured ITP JSON, 11 rows)", "~ 2,850 tokens"],
    ["Input price", "$2.00 / million tokens"],
    ["Output price", "$10.00 / million tokens"],
    ["Input cost", "21,400 × $2.00 / 1,000,000 = $0.0428"],
    ["Output cost", "2,850 × $10.00 / 1,000,000 = $0.0285"],
    ["Total cost, this ITP", "~ $0.071"],
    ["Generation time (drafting only, before human review)", "~ 14 seconds"],
]
story.append(simple_table(cost_rows, col_widths=[95*mm, 90*mm]))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "<b>Scaling this across a portfolio:</b> Jags Assurance runs QMP Inspect for roughly 94 active clients "
    "portfolio-wide. If each active project drafts, on average, 6 ITPs and re-drafts 2 revisions per year, "
    "that is approximately 94 × 8 = 752 generations/year. At ~$0.07 per generation, total annual AI "
    "drafting spend for ITP generation alone is on the order of <b>$53</b> — a rounding error next to "
    "engineering labour, and the reason cost is not the constraint on rolling AI drafting out platform-wide. "
    "The constraint is always the human review step, by design.",
    styles["Body"]
))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "The same pricing applies to the platform's other four AI features (checklist generation, NCR/observation "
    "drafting, register generation from certificates, and report narrative drafting) — each is a single, "
    "short structured-output call in the $0.01–$0.15 range, not a long-running agent.",
    styles["BodyMuted"]
))
story.append(PageBreak())

def doc_header(title_kicker, docno, rev, issued, pageof, title):
    t = Table([
        [Paragraph("<b>Jags Assurance</b><br/><font size=7 color='#a49484'>INDEPENDENT QUALITY INSPECTION</font>", styles["Body"]),
         Paragraph(f"<font size=7 color='#a49484'>{title_kicker}</font><br/><b>{docno}</b><br/><font size=8 color='#8a7f74'>{rev} &middot; {issued} &middot; {pageof}</font>", ParagraphStyle('r', parent=styles['Body'], alignment=TA_LEFT))]
    ], colWidths=[95*mm, 90*mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LINEBELOW", (0,0), (-1,-1), 1.4, INK),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    out = [t, Spacer(1,10), Paragraph(title, styles["H1"])]
    return out

def controlled_footer_note(text, docno, rev):
    return [
        Spacer(1, 8),
        Table([[Paragraph(text, ParagraphStyle('b', parent=styles['BodyMuted'], fontSize=8.6))]], colWidths=[185*mm],
              style=TableStyle([("BACKGROUND", (0,0), (-1,-1), BADGE_GOLD_BG), ("BOX", (0,0), (-1,-1), 0.6, GOLD),
                                 ("TOPPADDING", (0,0), (-1,-1), 8), ("BOTTOMPADDING", (0,0), (-1,-1), 8),
                                 ("LEFTPADDING", (0,0), (-1,-1), 10), ("RIGHTPADDING", (0,0), (-1,-1), 10)])),
        Spacer(1, 6),
        Paragraph(f"{docno} &middot; {rev} &middot; UNCONTROLLED WHEN PRINTED &middot; jagsassurance.com",
                   ParagraphStyle('c', parent=styles["Small"], alignment=TA_CENTER))
    ]

# ================= SECTION 4: THE ITP =================
for f in doc_header("DOCUMENT CONTROL", "GFL-JAGS-ITP-001-Rev0", "Revision 0", "01 Sep 2026", "Page 1 of 3",
                     "4. Inspection &amp; Test Plan &mdash; Electrical Works"):
    story.append(f)
story.append(badge("APPROVED — FULLY SIGNED", BADGE_GREEN_BG, GREEN))
story.append(Spacer(1, 10))

def cellp(text, bold=False):
    return Paragraph(text, ParagraphStyle('tc', parent=styles['Body'], fontSize=8.6, leading=11,
                                          fontName="Helvetica-Bold" if bold else "Helvetica"))

trace = [
    [cellp("Project", True), cellp("Coastal LNG Terminal Expansion — Package 4"), cellp("Client", True), cellp("Meridian Energy Holdings")],
    [cellp("Contractor", True), cellp("GFL Engineering & Construction"), cellp("Location / Area", True), cellp("Substation Building 2 — LV Switchroom")],
    [cellp("Discipline", True), cellp("Electrical"), cellp("Spec Reference", True), cellp("Electrical Specification Rev B")],
]
tt = Table(trace, colWidths=[24*mm, 62*mm, 26*mm, 58*mm])
tt.setStyle(TableStyle([
    ("GRID", (0,0), (-1,-1), 0.5, LINE), ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ("LEFTPADDING", (0,0), (-1,-1), 5),
]))
story.append(tt)
story.append(Table([[cellp("Applicable Standards", True), cellp("IEC 60204-1; IEC 60364-5-52; IEC 60364-6; ISO 9001")]],
    colWidths=[24*mm, 146*mm], style=TableStyle([
        ("GRID", (0,0), (-1,-1), 0.5, LINE), ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LEFTPADDING", (0,0), (-1,-1), 5),
    ]))
)
story.append(Spacer(1, 10))
story.append(Paragraph(
    "AI-drafted from the Document Vault specification and reviewed, edited and approved by Jags Assurance "
    "prior to issue — see Section 2 for the generation prompt and Section 3 for cost.",
    styles["Caption"]
))

story.append(Paragraph("Inspection Activities &amp; Hold / Witness Points", styles["H2"]))
itp_rows = [
    ["#","Activity","Criteria","C","S","T","J","CL","Records","Sign"],
    ["1.1","Material inspection — cables, glands and lugs","Approved make, type, size and certificates; no visible damage","H","","W","R","W","MIR, CoC, delivery record","Y"],
    ["1.2","Switchgear and panel submittal review","Approved drawings, ratings, IP class and type-test evidence","R","S","","R","R","Approved submittal, datasheet","Y"],
    ["2.1","Cable installation and routing","Routing, bend radius, segregation, support spacing and identification compliant","H","W","","S","","Checklist, route photos","Y"],
    ["2.2","Earthing and grounding installation","Conductor size, bonding, joints and earth bar connections approved","H","","","H","W","Earthing checklist, photos","Y"],
    ["2.3","Cable termination","Correct glands/lugs, torque, phase ID, ferrules and enclosure sealing","H","W","","S","S","Termination checklist, torque log","Y"],
    ["2.4","Panel and switchgear inspection","Installation level, clearances, labels, ratings and internal condition acceptable","W","","S","W","W","Panel inspection record","Y"],
    ["3.1","Insulation resistance test","Measured values meet voltage-class limits; calibrated test equipment used","","W","H","W","","IR test sheet, calibration cert","Y"],
    ["3.2","Continuity and earth bonding test","Protective conductor continuity confirmed; resistance within approved limit","W","","H","W","S","Continuity test report","Y"],
    ["3.3","Functional and interlock test","Controls, alarms, trips, interlocks and emergency functions operate as designed","H","","W","H","W","FAT/SAT sheet, test report","Y"],
    ["4.1","As-built drawing and data-book review","Redlines incorporated; records indexed, approved and traceable","R","","","R","R","As-builts, indexed data book","Y"],
    ["4.2","Final walk-down and handover","Installation complete; punch items categorized and handover dossier accepted","H","S","","W","H","Walk-down record, punch list","Y"],
]
wrapped = [[Paragraph(str(c), ParagraphStyle('cell', parent=styles['Body'], fontSize=7.2, leading=9.2)) for c in row] for row in itp_rows[1:]]
itp_table = Table([itp_rows[0]] + wrapped, colWidths=[7*mm, 24*mm, 40*mm, 6*mm, 6*mm, 6*mm, 6*mm, 7*mm, 34*mm, 8*mm], repeatRows=1)
itp_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), MAROON), ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("FONTSIZE", (0,0), (-1,0), 7.4),
    ("GRID", (0,0), (-1,-1), 0.5, LINE), ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("TOPPADDING", (0,0), (-1,-1), 3.2), ("BOTTOMPADDING", (0,0), (-1,-1), 3.2),
    ("ALIGN", (3,1), (7,-1), "CENTER"), ("ALIGN", (9,1), (9,-1), "CENTER"),
]))
story.append(itp_table)
story.append(Spacer(1, 8))
story.append(Paragraph(
    "<b>Point types:</b> H = Hold (work stops until released) &middot; W = Witness (invited; may proceed after "
    "notice period) &middot; R = Review (records reviewed/accepted) &middot; S = Surveillance (routine "
    "monitoring, no hold). <b>Party codes:</b> C = Contractor &middot; S = Subcontractor &middot; T = TPI/Lab "
    "&middot; J = Jags Assurance &middot; CL = Client.",
    styles["Small"]
))
story.append(PageBreak())

story.append(Paragraph("Party Sign-Off", styles["H2"]))
sig_rows = [
    ["Role","Name","Organisation","Status"],
    ["Contractor","Liam Chen","GFL Engineering & Construction","Signed · 04 Sep"],
    ["Subcontractor","Sofia Alvarez","Apex Electrical Services","Signed · 03 Sep"],
    ["TPI / Lab","Daniel Okafor","Independent TPI / Lab","Signed · 03 Sep"],
    ["Jags Assurance","Maya Patel","Lead Inspector","Signed · 01 Sep"],
    ["Client","Amelia Grant","Meridian Energy Holdings","Signed · 05 Sep"],
]
story.append(simple_table(sig_rows, col_widths=[30*mm, 32*mm, 68*mm, 55*mm]))
story.append(Spacer(1, 12))

story.append(Paragraph("Revision History", styles["H2"]))
rev_rows = [
    ["Rev","Date","Description of Change","By"],
    ["0","01 Sep 2026","Initial issue for client review","Maya Patel"],
    ["A","28 Aug 2026","Draft issued for internal interdisciplinary review","Maya Patel"],
    ["P01","21 Aug 2026","Preliminary ITP generated from Electrical Specification Rev B","QMP Inspect / Maya Patel"],
]
story.append(simple_table(rev_rows, col_widths=[16*mm, 26*mm, 98*mm, 45*mm]))
story.append(Spacer(1, 12))

story.append(Paragraph("Distribution List", styles["H2"]))
dist_rows = [
    ["Organisation","Recipients","Copy / Access"],
    ["Jags Assurance","Maya Patel; Oliver Bennett; Elena Rossi","Controlled master / edit"],
    ["Meridian Energy Holdings","Amelia Grant; Client Quality Team","Accepted copy / portal read-only"],
    ["GFL Engineering & Construction","Liam Chen; Project QA/QC Team","Issued copy / action"],
    ["Apex Electrical Services","Sofia Alvarez; Site Supervisor","Relevant activities / sign-off"],
    ["Independent TPI / Lab","Daniel Okafor; Test Laboratory","Testing activities / evidence upload"],
]
story.append(simple_table(dist_rows, col_widths=[52*mm, 68*mm, 65*mm]))
story.append(Spacer(1, 12))

story.append(Paragraph("Approvals", styles["H2"]))
appr_rows = [
    ["Role","Name","Organisation","Date"],
    ["Prepared by","Maya Patel","Lead Inspector","01 Sep 2026"],
    ["Reviewed by","Oliver Bennett","Group Quality Director","03 Sep 2026"],
    ["Approved by","Elena Rossi","Project Director","04 Sep 2026"],
    ["Client Acceptance","Amelia Grant","Client Quality Lead","05 Sep 2026"],
]
story.append(simple_table(appr_rows, col_widths=[30*mm, 32*mm, 58*mm, 65*mm]))

for f in controlled_footer_note(
    "Electronic master maintained in QMP Inspect. Printed copies are uncontrolled unless stamped and recorded "
    "in the distribution register.", "GFL-JAGS-ITP-001-Rev0", "Revision 0"):
    story.append(f)
story.append(PageBreak())

# ================= SECTION 5: FIELD EVIDENCE =================
story.append(Paragraph("5. Field Execution Evidence — Checklist &amp; Photographs", styles["H1"]))
story.append(Paragraph(
    "The field checklist below is completed against Activity 2.3 (Cable Termination), captured on a tablet at "
    "the point of work. Photographic evidence is attached per item as required by the ITP's Records column.",
    styles["Body"]
))
chk_rows = [
    ["#","Item","Result","Measured / Note"],
    ["1","Correct cable glands and lugs fitted per drawing","PASS",""],
    ["2","Termination torque within manufacturer spec","PASS","18 Nm applied"],
    ["3","Phase identification correct and legible","PASS",""],
    ["4","Ferrules crimped, no exposed conductor","PASS",""],
    ["5","Gland enclosure sealing intact, no gaps","PASS",""],
]
story.append(simple_table(chk_rows, col_widths=[10*mm, 90*mm, 25*mm, 60*mm]))
story.append(Spacer(1, 6))
story.append(Paragraph("Inspector: Maya Patel &middot; Date: 03 Sep 2026 &middot; Signed by Contractor and Subcontractor on device.", styles["BodyMuted"]))
story.append(Spacer(1, 12))

photo_pairs = [
    ("photo1_switchroom.png", "photo2_termination.png"),
]
for a, b in photo_pairs:
    row = Table([[Image(os.path.join(IMGS, a), width=82*mm, height=56.5*mm),
                  Image(os.path.join(IMGS, b), width=82*mm, height=56.5*mm)]], colWidths=[85*mm, 85*mm])
    row.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP")]))
    story.append(row)
story.append(PageBreak())

# ================= SECTION 6: INSPECTION REPORT =================
for f in doc_header("INSPECTION REPORT", "MER-JAGS-IR-014", "Rev 0", "03 Sep 2026", "Page 1 of 1",
                     "6. Inspection Report &mdash; Activity 3.1, Insulation Resistance Test"):
    story.append(f)

ir_meta = [
    ["Activity","3.1 — Insulation Resistance Test","Location","Substation Bldg 2 — LV Switchroom"],
    ["ITP Reference","GFL-JAGS-ITP-001-Rev0","Test Standard","IEC 60364-6"],
]
story.append(Table(ir_meta, colWidths=[26*mm, 68*mm, 26*mm, 65*mm], style=TableStyle([
    ("FONTNAME", (0,0), (0,-1), "Helvetica-Bold"), ("FONTNAME", (2,0), (2,-1), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 8.6), ("GRID", (0,0), (-1,-1), 0.5, LINE),
    ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5), ("LEFTPADDING", (0,0), (-1,-1), 5),
])))
story.append(Spacer(1, 10))
story.append(Image(os.path.join(IMGS, "photo3_irtest.png"), width=110*mm, height=75.8*mm))
story.append(Spacer(1, 10))
story.append(Paragraph("Result Summary", styles["H2"]))
story.append(simple_table([
    ["Measured Value","Acceptance Threshold","Result"],
    ["1.42 G-ohm","≥ 1 M-ohm (IEC 60364-6)","PASS"],
], col_widths=[60*mm, 65*mm, 60*mm]))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "Conclusion: insulation resistance measured well above the minimum acceptance threshold on all tested "
    "circuits. No further action required. Test instrument calibration certificate referenced and on file.",
    styles["Body"]
))
story.append(Paragraph("Tested and witnessed by: Daniel Okafor (Independent TPI / Lab) &middot; Verified by: Maya Patel (Jags Assurance)", styles["BodyMuted"]))
for f in controlled_footer_note(
    "Electronic master maintained in QMP Inspect. Printed copies are uncontrolled unless stamped and recorded in the distribution register.",
    "MER-JAGS-IR-014", "Rev 0"):
    story.append(f)
story.append(PageBreak())

# ================= SECTION 7: NCR =================
for f in doc_header("NCR CLOSE-OUT CERTIFICATE", "MER-JAGS-NCC-002", "Rev 0", "Issued on independent client acknowledgement", "Page 1 of 1",
                     "7. Non-Conformance Close-Out Certificate"):
    story.append(f)
story.append(badge("MINOR NCR — CLOSED", BADGE_GOLD_BG, INK))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "This certifies that MER-NCR-2026-014 (gland torque below specified value, Panel PNL-03), raised against "
    "Apex Electrical Services, has completed its full corrective-action cycle and is closed out in accordance "
    "with the approved Quality Management Programme.",
    styles["Body"]
))
story.append(Paragraph("Root Cause, Corrective &amp; Preventive Action", styles["H2"]))
story.append(simple_table([
    ["Root Cause","Torque wrench used on the shift was outside its calibration due date by four days."],
    ["Corrective Action","Affected terminations re-torqued with a calibrated wrench and re-inspected before energisation."],
    ["Preventive Action","Calibration due-date check added to the daily pre-work toolbox checklist for all torque tools."],
    ["Verification","Follow-up inspection by Jags Assurance confirmed all terminations meet the required torque."],
], col_widths=[35*mm, 150*mm]))
story.append(Spacer(1, 10))
story.append(Paragraph("Certifying Parties", styles["H2"]))
story.append(simple_table([
    ["Role","Name","Organisation","Status"],
    ["Subcontractor","Sofia Alvarez","Apex Electrical Services","Signed"],
    ["Jags Assurance","Maya Patel","Lead Inspector","Signed"],
    ["Client","Amelia Grant","Meridian Energy Holdings","Signed"],
], col_widths=[30*mm, 32*mm, 68*mm, 55*mm]))
for f in controlled_footer_note(
    "Electronic master maintained in QMP Inspect. Printed copies are uncontrolled unless stamped and recorded in the distribution register.",
    "MER-JAGS-NCC-002", "Rev 0"):
    story.append(f)
story.append(PageBreak())

# ================= SECTION 8: DATA BOOK =================
for f in doc_header("DATA BOOK INDEX", "MER-JAGS-DBK-001", "Rev 4", "As of 08 Sep 2026", "Page 1 of 1",
                     "8. Data Book &mdash; Real-Time Completeness Index"):
    story.append(f)
story.append(simple_table([
    ["Completeness","Status","Compiled by","Sections"],
    ["92%","In progress — 1 blocker","Jags Assurance","7"],
], col_widths=[35*mm, 60*mm, 50*mm, 30*mm]))
story.append(Spacer(1, 10))
story.append(simple_table([
    ["#","Section","Included Records","Status"],
    ["1","Project Setup & Scope","Contract, ITP Register, Party Assignment Log","Complete"],
    ["2","ITP-001 Electrical (LV Switchroom)","CHK-001, Contractor Review, TPI Witness Record, IRN-001","Complete"],
    ["3","ITP-101 LV Switchroom Fit-out (Rev 2)","CHK-101-1–6, Sign-off Record","3/5 signed"],
    ["4","Non-Conformance Register","MER-NCR-2026-001 (Major — pending client ack)","Blocked"],
    ["5","Live Registers Extract","Calibration, Welder Qualification, Material Registers","Complete"],
    ["6","Punch-List Record","2 open / 1 closed as of report date","Open items"],
    ["7","Handover Certificate","Not yet issued","Pending"],
], col_widths=[8*mm, 55*mm, 92*mm, 25*mm]))
story.append(Spacer(1, 10))
story.append(Table([[Paragraph(
    "Data Book cannot close until Meridian Energy independently acknowledges MER-NCR-2026-001 (ISO 17020 "
    "impartiality requirement) and the two remaining punch-list items are closed.", styles["BodyMuted"])]],
    colWidths=[185*mm], style=TableStyle([("BACKGROUND",(0,0),(-1,-1),BADGE_GOLD_BG), ("BOX",(0,0),(-1,-1),0.6,GOLD),
        ("TOPPADDING",(0,0),(-1,-1),8), ("BOTTOMPADDING",(0,0),(-1,-1),8), ("LEFTPADDING",(0,0),(-1,-1),10)])))
for f in controlled_footer_note(
    "Electronic master maintained in QMP Inspect. Printed copies are uncontrolled unless stamped and recorded in the distribution register.",
    "MER-JAGS-DBK-001", "Rev 4"):
    story.append(f)
story.append(PageBreak())

# ================= SECTION 9: HANDOVER =================
for f in doc_header("HANDOVER CERTIFICATE", "MER-JAGS-HOC-001", "Rev 0", "Issued 20 Sep 2026", "Page 1 of 1",
                     "9. Certificate of Quality Handover"):
    story.append(f)
story.append(Paragraph(
    "This is to certify that the Quality Management Programme for the above project has been executed and "
    "independently verified complete by Jags Assurance, in accordance with the approved Inspection &amp; Test "
    "Plans, and that all associated records form part of Data Book MER-JAGS-DBK-001.",
    styles["Body"]
))
story.append(Paragraph("<b>Scope:</b> Electrical Works — LV/MV Switchroom Fit-out, Cabling &amp; Termination, Panel Installation — Substation Buildings 1 &amp; 2, Panel Room 14.", styles["Body"]))
story.append(Spacer(1, 10))
story.append(Image(os.path.join(IMGS, "photo4_nameplate.png"), width=110*mm, height=56.2*mm))
story.append(Spacer(1, 10))
story.append(Paragraph("Certifying Parties", styles["H2"]))
story.append(simple_table([
    ["Role","Name","Organisation","Status"],
    ["Contractor","Liam Chen","GFL Engineering & Construction","Signed"],
    ["Subcontractor","Sofia Alvarez","Apex Electrical Services","Signed"],
    ["TPI / Lab","Daniel Okafor","Independent TPI / Lab","Signed"],
    ["Jags Assurance","Maya Patel","Lead Inspector","Signed"],
    ["Client","Amelia Grant","Meridian Energy Holdings","Signed"],
], col_widths=[30*mm, 32*mm, 68*mm, 55*mm]))
for f in controlled_footer_note(
    "Electronic master maintained in QMP Inspect. Printed copies are uncontrolled unless stamped and recorded in the distribution register.",
    "MER-JAGS-HOC-001", "Rev 0"):
    story.append(f)
story.append(PageBreak())

# ================= SECTION 10: MULTI-DISCIPLINE =================
story.append(Paragraph("10. Applying the Same Pipeline Across Disciplines", styles["H1"]))
story.append(Paragraph(
    "The generation pipeline in Section 1 is discipline-agnostic — it operates on whatever specification "
    "and standards are uploaded. The same Coastal LNG Terminal Expansion — Package 4 project runs several "
    "ITPs in parallel across disciplines, each generated from its own specification:",
    styles["Body"]
))
story.append(simple_table([
    ["ITP","Discipline","Source Specification","Standards Referenced"],
    ["GFL-JAGS-ITP-001", "Electrical (worked example above)", "Electrical Specification Rev B", "IEC 60204-1, IEC 60364-5-52/6, ISO 9001"],
    ["MER-JAGS-ITP-101", "Electrical — LV Switchroom Fit-out", "Electrical Specification Rev B, Annex C", "IEC 60364-5-52, ISO 9001"],
    ["MER-JAGS-ITP-102", "Electrical — Cable Containment & Routing", "Electrical Specification Rev B, Annex D", "IEC 60364-5-52"],
    ["MER-JAGS-ITP-103", "Electrical — Panel & Switchgear Installation", "Switchgear Submittal + Spec Rev B", "IEC 60204-1"],
    ["MER-JAGS-ITP-104", "Electrical Fit-out (Testing & Commissioning)", "Electrical Specification Rev B, Annex E", "IEC 60364-6"],
], col_widths=[30*mm, 55*mm, 55*mm, 45*mm]))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "For a Civil, Mechanical or Instrumentation scope on a different project, the same six-step pipeline runs "
    "against that discipline's specification (e.g. a concrete/reinforcement spec against ACI 318, or a piping "
    "spec against ASME B31.3) and produces an ITP in the identical controlled-document format shown in Section "
    "4 — same review gate, same approval chain, same per-generation cost profile.",
    styles["Body"]
))
story.append(Spacer(1, 14))
story.append(hr())
story.append(Paragraph(
    "End of package. This document was assembled to make QMP Inspect's real generated-document formats "
    "concrete for a non-specialist audience — it is a worked illustration, not a live export of production "
    "data.", styles["Small"]
))

doc = SimpleDocTemplate(OUT, pagesize=A4, topMargin=18*mm, bottomMargin=22*mm, leftMargin=20*mm, rightMargin=20*mm,
                         title="QMP Inspect — Real-World Document Package")
doc.build(story, onFirstPage=cover_page, onLaterPages=footer)
print("Wrote", OUT)
