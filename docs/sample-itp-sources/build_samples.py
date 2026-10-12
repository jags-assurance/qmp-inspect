"""Builds the sample ITP source documents in this folder.

Run from the repo root:  python3 docs/sample-itp-sources/build_samples.py
Needs: python-docx, reportlab.  All content is original, written for the
THP-2026-001 test scenario in the QMP Real-World Test Playbook. The IEC / BS
numbers are cited by number only; no standard text is reproduced.
"""
from pathlib import Path

from docx import Document
from docx.shared import Pt
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent
NEG = OUT / "negative-tests"
NEG.mkdir(exist_ok=True)

HEADER = [
    "Client: Test Harbour Power   Project: THP-2026-001 Switchroom Electrical Fit-out",
    "Site: Harbour Site, Building 4   Discipline: Electrical",
]

# --------------------------------------------------------------------------------------------
# 1. Project specification (DOCX) -> Specifications folder
# --------------------------------------------------------------------------------------------
SPEC = [
    ("1", "SCOPE", [
        "This specification covers supply, installation, inspection, testing and commissioning of the new "
        "415 V LV main switchboard MSB-04, four outgoing feeders (F1 to F4) to distribution boards DB-4A, "
        "DB-4B, DB-4C and DB-4D, cable containment, earthing and bonding in the Building 4 switchroom.",
    ]),
    ("2", "REFERENCED DOCUMENTS", [
        "THP-ES-200 Rev 1  Client Electrical Installation Standard.",
        "THP-DWG-E-101 Rev A  Single line diagram and cable schedule.",
        "THP-MS-E-003 Rev A  Method statement, LV switchboard installation and testing.",
        "IEC 61439-1 and IEC 61439-2  LV switchgear assemblies (cited by number only).",
        "IEC 60364-6  Verification of LV installations (cited by number only).",
    ]),
    ("3", "MATERIALS AND SUBMITTALS", [
        "3.1 Before installation, the MSB-04 nameplate (rated current 1600 A, Icw 50 kA for 1 s, IP42 minimum) "
        "shall be checked against approved material submittal THP-MAT-E-002 item 1. Any deviation shall be "
        "raised as an NCR and installation shall not proceed. Evidence: receiving inspection record with photos.",
        "3.2 Cables shall be XLPE/SWA/PVC copper to the sizes on THP-DWG-E-101. Each drum shall be checked for "
        "manufacturer, size, voltage rating 0.6/1 kV and a mill certificate (CoC) matching the submittal.",
        "3.3 Materials without a CoC shall be quarantined and labelled until released by the JAGS inspector.",
    ]),
    ("4", "CONTAINMENT AND CABLE INSTALLATION", [
        "4.1 Cable tray shall be hot-dip galvanised, supported at not more than 1.5 m centres, with tray "
        "bonded to earth at both ends. Fill shall not exceed 40 % of tray cross-section.",
        "4.2 Minimum cable bending radius shall be 12 x overall cable diameter. Power and control cables "
        "shall be segregated with a minimum 300 mm separation or a metallic barrier.",
        "4.3 Every cable shall be identified at both ends with the cable number from the cable schedule.",
    ]),
    ("5", "SWITCHBOARD INSTALLATION AND TERMINATIONS", [
        "5.1 MSB-04 shall be installed level within 2 mm per metre on the prepared plinth and fixed with "
        "the anchors shown on THP-DWG-E-101.",
        "5.2 Busbar joints and cable lugs shall be torqued to the manufacturer's values; each joint shall "
        "be torque-marked. Torque wrench shall have a valid calibration certificate.",
        "5.3 Lugs shall be compression type, crimped with the matching die; gland earth tags shall be fitted.",
    ]),
    ("6", "EARTHING AND BONDING", [
        "6.1 The main earth bar shall be connected to the building earth electrode with 120 mm2 Cu cable.",
        "6.2 Earth electrode resistance shall not exceed 1 ohm, measured by the fall-of-potential method.",
        "6.3 Continuity of protective conductors and bonding shall be tested; resistance of each protective "
        "conductor shall not exceed 0.5 ohm.",
    ]),
    ("7", "TESTING AND COMMISSIONING", [
        "7.1 Insulation resistance shall be measured on each feeder F1 to F4 at 1000 V DC for 1 minute, "
        "phase-phase and phase-earth. Minimum acceptable value: 100 megohm. HOLD POINT: energisation shall not "
        "proceed until results are reviewed and released by the JAGS inspector and the main contractor.",
        "7.2 Polarity and phase rotation (L1-L2-L3 clockwise) shall be verified at MSB-04 and at each DB.",
        "7.3 Earth fault loop impedance (Zs) at each DB shall not exceed the value in THP-ES-200 Table 2.",
        "7.4 RCD trip time at rated residual current shall not exceed 300 ms; at 5 x rated current, 40 ms.",
        "7.5 Protection relay and MCCB settings shall be verified against coordination study THP-PCS-001 "
        "by secondary injection. WITNESS POINT: client and TPI to be notified 48 h in advance.",
        "7.6 Functional test: operation of all breakers, interlocks, indication lamps and emergency trip. "
        "WITNESS POINT for the client.",
        "7.7 Voltage at first energisation shall be 415 V +/- 6 % phase-phase with phase imbalance under 2 %.",
    ]),
    ("8", "LABELLING AND HANDOVER DOCUMENTATION", [
        "8.1 Circuit charts, arc-flash and danger labels shall be fixed before energisation.",
        "8.2 The handover dossier shall contain test certificates, calibration certificates of instruments "
        "used, as-built drawings and signed ITP records.",
    ]),
]


def build_spec() -> None:
    d = Document()
    d.styles["Normal"].font.size = Pt(10)
    d.add_heading("PROJECT SPECIFICATION - LV SWITCHROOM ELECTRICAL FIT-OUT", 0)
    d.add_paragraph("Document No: THP-SPEC-E-001   Revision: A   Date: 2026-10-01")
    for line in HEADER:
        d.add_paragraph(line)
    for num, title, paras in SPEC:
        d.add_heading(f"{num}. {title}", level=1)
        for p in paras:
            d.add_paragraph(p)
    d.save(OUT / "THP-SPEC-E-001_RevA_LV_Switchroom_Specification.docx")


# --------------------------------------------------------------------------------------------
# 2. Client standard (PDF) -> Standards & Codes folder
# --------------------------------------------------------------------------------------------
def build_standard() -> None:
    ss = getSampleStyleSheet()
    doc = SimpleDocTemplate(str(OUT / "THP-ES-200_Rev1_Client_Electrical_Standard.pdf"), pagesize=A4)
    s = [
        Paragraph("TEST HARBOUR POWER - CLIENT ELECTRICAL INSTALLATION STANDARD", ss["Title"]),
        Paragraph("Document No: THP-ES-200   Revision: 1   Date: 2026-06-15", ss["Normal"]),
        Spacer(1, 10),
        Paragraph("1. Purpose", ss["Heading2"]),
        Paragraph("Sets the minimum inspection and test requirements for LV installations on Test Harbour "
                  "Power sites. Where a project specification is stricter, the specification applies.", ss["Normal"]),
        Paragraph("2. Intervention points", ss["Heading2"]),
        Paragraph("2.1 Hold points (H): work shall not proceed past the point until released in writing. "
                  "Mandatory hold points: insulation resistance before energisation; earth electrode test "
                  "before backfill; first energisation.", ss["Normal"]),
        Paragraph("2.2 Witness points (W): the client shall be notified at least 48 hours ahead. Mandatory "
                  "witness points: protection settings verification; switchboard functional test.", ss["Normal"]),
        Paragraph("2.3 Review points (R): document review of material submittals and calibration "
                  "certificates before use.", ss["Normal"]),
        Paragraph("3. Test equipment", ss["Heading2"]),
        Paragraph("3.1 All test instruments shall hold a calibration certificate valid on the day of test. "
                  "The certificate number shall be recorded on every test record.", ss["Normal"]),
        Paragraph("4. Test limits", ss["Heading2"]),
        Paragraph("Table 1 - General test limits", ss["Heading4"]),
    ]
    t1 = [["Test", "Limit", "Clause"],
          ["Insulation resistance, 400/415 V circuits, 1000 V DC", ">= 100 Mohm", "4.1"],
          ["Protective conductor continuity", "<= 0.5 ohm", "4.2"],
          ["Earth electrode resistance", "<= 1 ohm", "4.3"],
          ["RCD trip time at I(delta)n", "<= 300 ms", "4.4"],
          ["RCD trip time at 5 x I(delta)n", "<= 40 ms", "4.4"],
          ["Busbar joint torque", "Manufacturer value +/- 5 %", "4.5"]]
    t2 = [["Protective device", "Max Zs (ohm)"],
          ["MCCB 250 A, DB-4A", "0.16"], ["MCCB 160 A, DB-4B", "0.25"],
          ["MCCB 125 A, DB-4C", "0.32"], ["MCCB 100 A, DB-4D", "0.40"]]
    style = TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey)])
    s += [Table(t1, style=style), Spacer(1, 8),
          Paragraph("Table 2 - Maximum earth fault loop impedance at each DB", ss["Heading4"]),
          Table(t2, style=style), Spacer(1, 8),
          Paragraph("5. Records", ss["Heading2"]),
          Paragraph("5.1 Every test shall be recorded with instrument serial, calibration certificate number, "
                    "tester name, date, measured value and pass/fail against the limit. Photos of instrument "
                    "readings shall be attached for hold points.", ss["Normal"])]
    doc.build(s)


# --------------------------------------------------------------------------------------------
# 3. Method statement (DOCX) -> Method Statements folder
# --------------------------------------------------------------------------------------------
MS_STEPS = [
    ("Receiving inspection", "Check MSB-04 and cable drums on delivery against THP-MAT-E-002. Record nameplate, "
     "photos, CoC numbers. Quarantine anything without CoC. Responsible: Voltway Electrical supervisor. "
     "Review by JAGS inspector (R)."),
    ("Plinth and positioning", "Verify plinth level and anchor positions to THP-DWG-E-101. Set MSB-04, level "
     "within 2 mm/m, fix anchors. Inspector surveillance (S)."),
    ("Containment", "Install tray at max 1.5 m support centres, bond both ends. Check fill <= 40 %. "
     "Main contractor surveillance (S)."),
    ("Cable pulling", "Pull cables with rollers, observe 12 x D bend radius, keep 300 mm power/control "
     "segregation. Tag both ends. Inspector surveillance (S)."),
    ("Terminations", "Crimp lugs with matched die, fit gland earth tags, torque to manufacturer values with a "
     "calibrated torque wrench and torque-mark. Inspector witness on first termination of each feeder (W)."),
    ("Earthing", "Connect main earth bar with 120 mm2 Cu. Test electrode (<= 1 ohm) before backfill: HOLD (H) "
     "for JAGS and the main contractor. Test protective conductor continuity (<= 0.5 ohm)."),
    ("Insulation resistance", "1000 V DC, 1 min, each feeder F1-F4, >= 100 Mohm. HOLD (H) for JAGS and the "
     "main contractor before energisation. TPI (Bureau Veritas) to witness (W)."),
    ("Protection settings", "Secondary injection against THP-PCS-001. WITNESS (W): client and TPI, 48 h notice."),
    ("Dead tests at DBs", "Polarity, Zs per THP-ES-200 Table 2, RCD trip times. Inspector review (R)."),
    ("First energisation", "HOLD (H) for client, JAGS and main contractor. Check phase rotation L1-L2-L3 and "
     "voltage 415 V +/- 6 %, imbalance < 2 %."),
    ("Functional test", "Breakers, interlocks, indication, emergency trip. WITNESS (W) for the client."),
    ("Labelling and dossier", "Fix circuit charts and arc-flash labels. Compile test records and calibration "
     "certificates for the data book. JAGS review (R)."),
]


def build_method_statement() -> None:
    d = Document()
    d.styles["Normal"].font.size = Pt(10)
    d.add_heading("METHOD STATEMENT - LV SWITCHBOARD INSTALLATION AND TESTING", 0)
    d.add_paragraph("Document No: THP-MS-E-003   Revision: A   Prepared by: Voltway Electrical Ltd")
    for line in HEADER:
        d.add_paragraph(line)
    d.add_heading("1. Competence and equipment", level=1)
    d.add_paragraph("Testing by a qualified electrician holding a valid LV test certification (recorded on the "
                    "Personnel Certifications register). Instruments: insulation tester, loop/RCD tester, "
                    "earth tester, torque wrench, secondary injection set - each with a valid calibration "
                    "certificate recorded on the Calibration register.")
    d.add_heading("2. Sequence of work and inspection", level=1)
    tbl = d.add_table(rows=1, cols=3)
    tbl.style = "Table Grid"
    hdr = tbl.rows[0].cells
    hdr[0].text, hdr[1].text, hdr[2].text = "Step", "Activity", "Method, acceptance and intervention"
    for i, (act, txt) in enumerate(MS_STEPS, 1):
        c = tbl.add_row().cells
        c[0].text, c[1].text, c[2].text = str(i), act, txt
    d.add_heading("3. Non-conformance", level=1)
    d.add_paragraph("Any failed test or deviation is raised as an NCR in QMP Inspect. Work on the affected "
                    "feeder stops until the NCR is closed or a concession is approved.")
    d.save(OUT / "THP-MS-E-003_RevA_Method_Statement.docx")


# --------------------------------------------------------------------------------------------
# 4. Drawing (PDF, text layer) -> Drawings folder
# --------------------------------------------------------------------------------------------
def build_drawing() -> None:
    path = OUT / "THP-DWG-E-101_RevA_SLD_and_Cable_Schedule.pdf"
    c = canvas.Canvas(str(path), pagesize=landscape(A4))
    w, h = landscape(A4)
    c.rect(20, 20, w - 40, h - 40)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, h - 50, "THP-DWG-E-101 Rev A - MSB-04 SINGLE LINE DIAGRAM AND CABLE SCHEDULE")
    c.setFont("Helvetica", 9)
    c.drawString(40, h - 66, HEADER[0] + "   " + HEADER[1])
    # simple SLD
    c.line(80, h - 120, w - 300, h - 120)
    c.drawString(80, h - 112, "MSB-04 415V 3PH+N 1600A BUSBAR  Icw 50kA/1s  IP42")
    c.drawString(80, h - 100, "INCOMER: ACB 1600A FROM TX-04 (by others)")
    xs = [140, 260, 380, 500]
    for i, x in enumerate(xs, 1):
        c.line(x, h - 120, x, h - 200)
        c.drawString(x - 30, h - 212, f"F{i}")
    sched = [["Cable no.", "From", "To", "Size", "Type", "Breaker", "Length"],
             ["C-F1", "MSB-04 F1", "DB-4A", "4C 185mm2 + 95 E", "XLPE/SWA/PVC", "MCCB 250A", "42 m"],
             ["C-F2", "MSB-04 F2", "DB-4B", "4C 95mm2 + 50 E", "XLPE/SWA/PVC", "MCCB 160A", "35 m"],
             ["C-F3", "MSB-04 F3", "DB-4C", "4C 70mm2 + 35 E", "XLPE/SWA/PVC", "MCCB 125A", "51 m"],
             ["C-F4", "MSB-04 F4", "DB-4D", "4C 50mm2 + 25 E", "XLPE/SWA/PVC", "MCCB 100A", "28 m"],
             ["C-E1", "Main earth bar", "Earth pit EP-1", "1C 120mm2 Cu", "PVC G/Y", "-", "15 m"]]
    t = Table(sched, style=TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                                       ("FONTSIZE", (0, 0), (-1, -1), 8)]))
    t.wrapOn(c, w, h)
    t.drawOn(c, 40, h - 360)
    notes = ["NOTES:",
             "1. Anchor MSB-04 with 4 x M12 chemical anchors per section. Level within 2 mm/m.",
             "2. Tray supports at max 1.5 m centres. Bond tray to earth at both ends.",
             "3. All feeders: IR test 1000 V DC, >= 100 Mohm, before energisation (HOLD).",
             "4. Earth electrode EP-1 <= 1 ohm; test before backfill (HOLD).",
             "5. Torque all busbar joints and lugs to manufacturer values; torque-mark every joint."]
    y = h - 390
    for n in notes:
        c.drawString(40, y, n)
        y -= 13
    c.drawString(w - 260, 40, "Drawn: Voltway   Checked: GFL   Approved: JAGS")
    c.save()


# --------------------------------------------------------------------------------------------
# 5. Material submittal schedule (plain text) -> Material Submittals folder
# --------------------------------------------------------------------------------------------
MAT = """MATERIAL SUBMITTAL SCHEDULE
Document No: THP-MAT-E-002   Revision: A   Date: 2026-09-20
Client: Test Harbour Power   Project: THP-2026-001 Switchroom Electrical Fit-out

Item 1  LV switchboard MSB-04, 1600 A, Icw 50 kA 1 s, IP42, form 4b. Type-tested to IEC 61439-2.
        Required: type test certificate, routine test report, GA drawing. Status: Approved.
Item 2  XLPE/SWA/PVC 0.6/1 kV copper cable, sizes per THP-DWG-E-101. Required: mill certificate (CoC)
        per drum, drum number, batch number. Status: Approved.
Item 3  Hot-dip galvanised cable tray 300 mm and 600 mm, with supports. Required: galvanising
        certificate. Status: Approved with comments (thickness >= 85 microns to be verified on site).
Item 4  Compression lugs and glands with earth tags. Required: manufacturer data sheet. Status: Approved.
Item 5  Earth electrode, copper-bonded rod 16 mm x 2.4 m, and 120 mm2 Cu cable. Status: Approved.

Receiving inspection: every item is checked on arrival against this schedule. Items without the
required certificate are recorded as Quarantined on the Material register until released.
"""


def build_materials() -> None:
    (OUT / "THP-MAT-E-002_RevA_Material_Submittal_Schedule.txt").write_text(MAT, encoding="utf-8")


# --------------------------------------------------------------------------------------------
# Negative test files
# --------------------------------------------------------------------------------------------
def build_negative() -> None:
    # B1: the vault must refuse scripts/executables. Harmless content.
    (NEG / "refuse-me.sh").write_text("#!/bin/sh\necho 'This file must be refused by the vault upload.'\n")
    # Image-only PDF: no text layer -> extraction_status 'empty', not eligible for AI drafting.
    c = canvas.Canvas(str(NEG / "scanned-no-text-layer.pdf"), pagesize=A4)
    for i in range(30):
        c.rect(40 + i * 15, 400, 10, 200 - i * 5, fill=1)
    c.save()
    # Unrelated document: AI should not invent electrical activities from it.
    (NEG / "unrelated-canteen-menu.txt").write_text(
        "Building 4 canteen menu, week 41. Monday: soup. Tuesday: rice. No technical content.\n")


if __name__ == "__main__":
    build_spec()
    build_standard()
    build_method_statement()
    build_drawing()
    build_materials()
    build_negative()
    print("Sample documents written to", OUT)
