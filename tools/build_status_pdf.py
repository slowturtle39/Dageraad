#!/usr/bin/env python3
"""
Build the shareable project-status PDF.

Regenerate with:  python3 tools/build_status_pdf.py
Screenshots come from /tmp/pdf-*.png (see the playwright snippet in the README
of this folder) — if they are missing the document still builds, minus figures.
"""
import os
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

OUT = os.environ.get("OUT", "Dageraad-status.pdf")

INK = colors.HexColor("#1d2029")
DIM = colors.HexColor("#5f6472")
GOLD = colors.HexColor("#8a6d10")
RULE = colors.HexColor("#d8d4cb")
PANEL = colors.HexColor("#f5f2ec")
BLOOD = colors.HexColor("#8c3b3b")

ss = getSampleStyleSheet()


def style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.6, leading=14.2,
                textColor=INK, alignment=TA_LEFT, spaceAfter=6)
    base.update(kw)
    return ParagraphStyle(name, **base)


BODY = style("body")
LEAD = style("lead", fontSize=11.2, leading=16.5, textColor=DIM, spaceAfter=10)
H1 = style("h1", fontName="Times-Bold", fontSize=19, leading=23,
           spaceBefore=16, spaceAfter=7)
H2 = style("h2", fontName="Helvetica-Bold", fontSize=10.4, leading=14,
           spaceBefore=11, spaceAfter=4)
SMALL = style("small", fontSize=8.4, leading=12, textColor=DIM)
CAP = style("cap", fontSize=8, leading=11, textColor=DIM, spaceBefore=3)
MONO = style("mono", fontName="Courier", fontSize=8, leading=11.4)
QUOTE = style("quote", fontSize=9.6, leading=14.4, leftIndent=9,
              textColor=INK, borderPadding=0)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Times-Bold", 8.5)
    canvas.setFillColor(DIM)
    canvas.drawString(20 * mm, A4[1] - 12 * mm, "DAGERAAD")
    canvas.setFont("Helvetica", 8.5)
    canvas.drawRightString(A4[0] - 20 * mm, A4[1] - 12 * mm,
                           "Projectstatus · 26 augustus 2026")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, A4[1] - 15 * mm, A4[0] - 20 * mm, A4[1] - 15 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(A4[0] / 2, 12 * mm, str(doc.page))
    canvas.restoreState()


CELL = style("cell", fontSize=8.6, leading=12.2, spaceAfter=0)
CELL_KEY = style("cellkey", fontSize=8.6, leading=12.2, spaceAfter=0,
                 fontName="Helvetica-Bold")
CELL_HEAD = style("cellhead", fontSize=8.6, leading=12.2, spaceAfter=0,
                  fontName="Helvetica-Bold", textColor=DIM)


def panel(rows, widths, header=False):
    """
    A table whose cells actually wrap and honour <b>/<i>.

    Plain strings in a ReportLab Table do neither: long text runs straight off
    the page edge and markup renders literally. Every cell becomes a Paragraph.
    """
    wrapped = []
    for r, row in enumerate(rows):
        out = []
        for c, cell in enumerate(row):
            if not isinstance(cell, str):
                out.append(cell)
                continue
            if header and r == 0:
                st = CELL_HEAD
            elif c == 0 and len(row) > 1:
                st = CELL_KEY
            else:
                st = CELL
            out.append(Paragraph(cell, st))
        wrapped.append(out)

    t = Table(wrapped, colWidths=widths, hAlign="LEFT")
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]
    if header:
        cmds += [("LINEBELOW", (0, 0), (-1, 0), 0.8, INK)]
    t.setStyle(TableStyle(cmds))
    return t


CROPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_figures")


def figure(path, width_mm, caption, crop=None):
    """
    Place a screenshot, optionally cropping first.

    Phone captures are 390x844 — nearly 2.2:1 — so at any width wide enough to
    read they are tall enough to own a whole page and shove the text off it.
    `crop` is (top, bottom) as fractions of height, trimming the dead space a
    portrait screenshot always has.
    """
    if not os.path.exists(path):
        return Spacer(1, 0)
    from PIL import Image as PILImage

    src = PILImage.open(path)
    if crop:
        os.makedirs(CROPS, exist_ok=True)
        top, bottom = crop
        w0, h0 = src.size
        src = src.crop((0, int(h0 * top), w0, int(h0 * bottom)))
        path = os.path.join(CROPS, os.path.basename(path))
        src.save(path)

    w, h = src.size
    width = width_mm * mm
    img = Image(path, width=width, height=width * h / w)
    return KeepTogether([img, Paragraph(caption, CAP)])


story = []

# ---------------------------------------------------------------- cover
story.append(Spacer(1, 26 * mm))
story.append(Paragraph("Dageraad", style("title", fontName="Times-Bold",
                                         fontSize=40, leading=44, spaceAfter=2)))
story.append(Paragraph(
    "Companion-app voor <i>1 Nacht Weerwolven &amp; Waaghalzen</i>, "
    "met onze eigen huisregels",
    style("sub", fontSize=12.5, leading=18, textColor=DIM, spaceAfter=16)))

story.append(Paragraph(
    "Dit document beschrijft waar het project staat, welke ontwerpkeuzes eronder "
    "liggen en wat er nog moet gebeuren voordat er aan tafel mee gespeeld kan "
    "worden.", LEAD))

# ------------------------------------------------- status, up front
#
# Deliberately the first thing a reader sees, and deliberately blunt about the
# gap: the Firebase side is genuinely finished, which makes it very easy to
# read this as "so it works now". It does not. `npm run dev` still starts the
# demo harness.
story.append(Paragraph("Stand van zaken — vóór het playtesten", H1))

story.append(Paragraph("Wat klaar is", H2))
story.append(panel([
    ["Firebase", "Project <b>dageraad-fdb2d</b>. Firestore draait in productiemodus in <b>europe-west4</b>, anonieme login staat aan, en de publieke webconfig staat in de repo."],
    ["Beveiliging", "De Firestore-regels zijn <b>gepubliceerd</b> (26 aug, ±08:56). De regelsuite draait 38/38 groen in de emulator — geschreven als aanvallen, niet als gelukkige paden."],
    ["Code", "Nachtmotor, tijdlijn, dagfase, orkestratie en alle schermen: <b>151 tests groen</b>, typecheck schoon."],
], [26 * mm, 130 * mm]))

story.append(Paragraph("Wat er nog moet gebeuren — dit is het echte werk", H2))
story.append(Paragraph(
    "<b>De live app-schil bestaat nog niet.</b> <font face='Courier' size='8'>"
    "npm run dev</font> start vandaag een <i>demo</i> met verzonnen spelers: er "
    "wordt geen kamer aangemaakt, geen kaarten gedeeld en niets gesynchroniseerd "
    "tussen telefoons. <font face='Courier' size='8'>src/firebase/config.ts</font> "
    "staat klaar, maar wordt nog nergens geïmporteerd.", BODY))
story.append(panel([
    ["1", "Schil bouwen", "Kamer maken en joinen, stoelvolgorde vastleggen, kaarten delen naar Firestore, de scheidsrechter op de tablet laten draaien, en elk telefoonscherm aan zijn eigen echte onthullingen hangen."],
    ["2", "Lokaal doorspelen", "Eén nacht van begin tot eind, met meerdere browservensters als losse spelers."],
    ["3", "Uitrollen", "<font face='Courier' size='8'>npm run build</font> en daarna <font face='Courier' size='8'>firebase deploy --only hosting</font> — dat geeft de deelbare link die iedereen op zijn eigen telefoon opent."],
], [8 * mm, 30 * mm, 116 * mm]))

story.append(Paragraph("Commando’s die nu al werken", H2))
story.append(panel([
    ["npm install", "Eenmalig."],
    ["npm test", "151 tests — motor, timing, dagfase, UI-regels."],
    ["npm run test:rules", "38 beveiligingstests in de emulator. Vereist Java 11+; op Milans machine moet de Java-bin tijdelijk aan PATH worden toegevoegd."],
    ["npm run dev", "De demo. Nadrukkelijk <b>geen</b> echt spel — geen kamers, geen synchronisatie."],
], [34 * mm, 122 * mm]))

story.append(Paragraph(
    "<b>Over de plaatjes:</b> de app gebruikt nu eigen, zelfgetekende symbolen. "
    "Die kunnen later vervangen worden door echte spelillustraties als we goede "
    "foto’s van de kaarten hebben — <i>optioneel, en het houdt het playtesten "
    "niet tegen.</i>", SMALL))

story.append(PageBreak())

story.append(figure("/tmp/pdf-table.png", 74,
                    "De tafel op een telefoon. Dezelfde weergave in dag én nacht. "
                    "De gestreepte kaarten zijn eigen vermoedens, geen feiten.",
                    crop=(0.02, 0.80)))

# ---------------------------------------------------------------- what
story.append(Paragraph("Wat het is", H1))
story.append(Paragraph(
    "Een webapp die het nachtgedeelte van het spel afhandelt zonder verteller. "
    "Iedereen speelt op de eigen telefoon; een tablet in het midden van de tafel "
    "toont een neutraal, spoilervrij overzicht. Eén link delen is genoeg — er is "
    "geen app-store, geen installatie en geen lokaal netwerk nodig.", BODY))
story.append(Paragraph(
    "De volledige rollenbibliotheek zit erin, met onze huisregels waar we die "
    "hebben afgesproken en de gedrukte regels waar we dat niet deden.", BODY))

story.append(Paragraph("De twee regels waar de rest aan hangt", H2))
story.append(Paragraph(
    "<b>Je startrol handelt, je eindkaart wint.</b> Waar je in de nachtvolgorde "
    "staat en welke actie je doet, komt van de rol die je aan het begin kreeg — "
    "ook als je kaart later van tafel verwisseld is. Met welk team je wint, komt "
    "van de kaart die bij zonsopgang voor je ligt. Kaarten bewegen de hele nacht; "
    "beurten niet.", BODY))
story.append(Paragraph(
    "<b>Kaarten zijn exemplaren, geen rolnamen.</b> Er zijn dubbele Dorpelingen "
    "en meerdere Weerwolven, en een kaart die publiek open gaat moet die kaart "
    "blijven volgen als hij daarna nog verwisseld wordt.", BODY))

# ---------------------------------------------------------------- night
story.append(Paragraph("Hoe de nacht verloopt", H1))
story.append(Paragraph(
    "Niemand hoeft te wachten om te <i>kiezen</i>. Iedereen tikt meteen. Wat "
    "gespreid wordt is het <i>zien van het resultaat</i>: de Mystieke Wolf kiest "
    "haar doelwit op seconde nul, maar krijgt de kaart pas te zien als de "
    "Alfawolf klaar is — die kan hem immers verwisseld hebben.", BODY))

story.append(panel([
    ["", "Modus 1 — dependency", "Modus 2 — twee rondes"],
    ["Duur", "40 seconden", "22 seconden"],
    ["Vensters", "Iedereen · Dubbelganger · Heks · Medium", "Iedereen · Dubbelganger"],
    ["Heks", "Kiest live: kijkt, dan beslist ze", "Legt vooraf een regel vast"],
    ["Medium", "Kiest live", "Legt vooraf ja/nee vast"],
], [22 * mm, 66 * mm, 66 * mm], header=True))

story.append(Spacer(1, 4))
story.append(Paragraph(
    "Dat verschil is precies de vraag om uit te spelen: <b>is de vooraf "
    "vastgelegde Heks die achttien seconden waard?</b>", BODY))

story.append(Paragraph("De tijdlijn van modus 1", H2))
story.append(panel([
    ["0 s", "Kaarten gedeeld. Iedereen leest zijn rol en tikt. Droomwolf ziet meteen de andere wolven."],
    ["8 s", "Venster van de Alfawolf sluit — één tik, want de kaart ligt vast."],
    ["9 s", "Mystieke Wolf ziet haar kaart en is klaar. Dubbelganger ziet wat hij gekopieerd heeft."],
    ["9–21 s", "Tweede beslissing van de Dubbelganger."],
    ["21–31 s", "Heks ziet haar middenkaart en kiest haar doelwit."],
    ["32 s", "Dorpsgek schuift. Medium ziet zijn kaart."],
    ["32–38 s", "Ruil van het Medium met de Looier, als die zich voordeed."],
], [18 * mm, 136 * mm]))
story.append(Paragraph(
    "De meeste spelers zijn binnen tien seconden klaar. Alleen de Dubbelganger, "
    "de Heks en het Medium zijn daarna nog bezig — precies de keten die hun "
    "eigen venster verdient.", SMALL))

story.append(PageBreak())

# ---------------------------------------------------------------- design
story.append(Paragraph("Drie problemen die het ontwerp bepaald hebben", H1))

story.append(Paragraph("1. Timing verraadt waar een kaart ligt", H2))
story.append(Paragraph(
    "Welke rollen meedoen is openbaar — dat kiest de host en dat ziet iedereen. "
    "Wat geheim is, is of de Alfawolf-kaart bij een speler ligt of in het midden. "
    "Als niemand die rol speelt en het spel dat venster dus meteen afrondt, weet "
    "de Mystieke Wolf uit die korte wachttijd precies waar de kaart ligt.", BODY))
story.append(Paragraph(
    "Daarom loopt <b>elk venster altijd zijn volle lengte</b>, of er nu iemand "
    "iets doet of niet. Dat kost geen extra tijd: het venster was er toch al. "
    "Elke tijdsconstante wordt berekend uit de openbare rollenlijst, en niets in "
    "dat pad mag naar de kaartverdeling kijken. Er is een test die dat controleert "
    "met 200 willekeurige verdelingen.", BODY))

story.append(Paragraph("2. Het verraad aan tafel", H2))
story.append(Paragraph(
    "Alle zorgvuldigheid in de software doet niets tegen het lek in de kámer. Als "
    "de meeste mensen na acht seconden klaar zijn en alleen de Dubbelganger op "
    "seconde twintig nog zit te tikken, weet iedereen die even rondkijkt genoeg.", BODY))
story.append(Paragraph(
    "Daarom is <b>op een speler tikken om zijn statistieken te zien</b> het "
    "standaardscherm van de nacht. Tikken is dan wat iedereen doet, niet iets wat "
    "opvalt. Dat het ook nog leuk is om te lezen, is het punt: cover die niemand "
    "gebruikt is geen cover.", BODY))

story.append(Paragraph("3. Schermlicht verandert", H2))
story.append(Paragraph(
    "Nacht en dag zien er in de app <b>identiek</b> uit. Geen kleurwissel bij een "
    "faseovergang — de gloed op iemands gezicht verandert namelijk ook als hij "
    "niet naar zijn scherm kijkt, en een scherm dat oplicht tijdens een "
    "vervolgvenster wijst precies de speler aan die aan zet is. Er staat één "
    "kleurenpalet in de code, zonder lichte modus, en er zijn tests die "
    "voorkomen dat daar later iets bij komt.", BODY))

story.append(Spacer(1, 3))
story.append(figure("/tmp/pdf-tablet.png", 148,
                    "De tablet: fase, open venster en tijd. Nooit iemands rol, "
                    "en nooit wie er nog moet handelen.",
                    crop=(0.0, 0.90)))

story.append(PageBreak())

# ---------------------------------------------------------------- rules
story.append(Paragraph("Huisregels die vastliggen", H1))
story.append(panel([
    ["Dubbelganger", "Voert de gekopieerde actie uit op zijn eigen plek in de volgorde, wat hij ook kopieert. Geen ketting op een andere Dubbelganger."],
    ["Dorpsgek", "De kaart van de handelende speler blijft liggen; een beschermde kaart ook, de rest draait eromheen. Kopieert de Dubbelganger deze rol, dan blijft zíjn kaart liggen en schuift die van de echte Dorpsgek gewoon mee."],
    ["Heks", "Kiest uit de <b>drie</b> middenkaarten, nooit de wolvenkaart. Haar voorwaardelijke regel splitst in drieën — Wolf, Looier, dorp — want de Looier is een derde team en zou anders ongemerkt bij “dorp” belanden."],
    ["Alfawolf", "Blijft blind: ze weet nooit welke kaart ze weghaalt. Dat hoort bij de rol en is geen bug. Idem de Dronkaard."],
    ["Medium", "Een wolf gaat niet open, al het andere wel. Mag ruilen met de Looier."],
    ["Bodyguard", "Krijgt hij de meeste stemmen, dan vervalt de stemming en gaat er niemand dood."],
    ["Looier", "Zijn eigen stem telt nooit mee."],
], [26 * mm, 128 * mm]))

story.append(Paragraph("Winvoorwaarden", H2))
story.append(panel([
    ["Looier gelyncht", "De Looier wint <b>alleen</b>. Dorp én wolven verliezen — ook als er in dezelfde stemming een wolf omkwam, wat de Jager kan veroorzaken."],
    ["Alle wolven in het midden", "De wolven kunnen niet winnen. Het dorp wint alleen als er niemand gelyncht wordt: lynch je een onschuldige, dan wint niemand."],
    ["Stemmen", "Verplicht. Zodra de klok om is en er niet is afgezien, wacht het spel tot iedereen gestemd heeft — niemand wordt overgeslagen."],
    ["Niet stemmen", "De knop staat de hele tijd aan en telt op <b>elk moment</b>: zodra een meerderheid niet wil stemmen, stopt het overleg meteen. Het is een gelijktijdig handopsteken — wie zijn knop weer uitzet, draait het terug."],
], [30 * mm, 124 * mm]))

story.append(PageBreak())

# ---------------------------------------------------------------- state
story.append(Paragraph("Wat er af is", H1))
story.append(panel([
    ["Onderdeel", "Staat"],
    ["Nachtmotor (alle rollen, volgorde, resolutie)", "Af · getest"],
    ["Dagfase (stemmen, gelijkspel, afzien, winvoorwaarden)", "Af · getest"],
    ["Tijdlijn + zelfkalibrerende venstertijden", "Af · getest"],
    ["Scheidsrechter-lus, host-pauze, bots", "Af · getest"],
    ["Testmodus (bots spelen, geen stats, geen kalibratie)", "Af · getest"],
    ["Firestore-schema + beveiligingsregels", "Af · geverifieerd, 33/33"],
    ["UI: tafel, statistieken, verdenkingen, stemmen, lobby, tablet", "Af"],
    ["Rolplaatjes", "Tijdelijke eigen tekeningen"],
    ["Firebase-project + live koppeling", "<b>Nog niet</b>"],
    ["Curator + voorwerpen", "Niet gebouwd — regels nog niet vastgelegd"],
], [104 * mm, 50 * mm], header=True))

story.append(Paragraph("De beveiligingsregels zijn echt getest", H2))
story.append(Paragraph(
    "De regels zijn geschreven als <i>aanvallen</i>, niet als gelukkige paden: "
    "elke test is iets wat een van ons met de ontwikkelaarsconsole open zou "
    "kunnen proberen. Alle 33 slagen. De belangrijkste is dat niemand zichzelf "
    "tot scheidsrechter kan bombarderen — wie dat kon, kon de hele verdeling "
    "lezen.", BODY))
story.append(Paragraph(
    "Wat op het gratis plan onvermijdelijk blijft: het apparaat dat de nacht "
    "uitrekent heeft alle kaarten in het geheugen. Laat dat de tablet zijn, die "
    "midden op tafel ligt en die niemand vasthoudt.", SMALL))

story.append(Spacer(1, 3))
story.append(figure("/tmp/pdf-stats.png", 66,
                    "Op een naam tikken toont zijn geschiedenis. Alleen eerdere "
                    "potjes — nooit iets over vanavond.",
                    crop=(0.44, 1.0)))

story.append(PageBreak())

# ---------------------------------------------------------------- todo
story.append(Paragraph("Wat er nog moet gebeuren", H1))
story.append(Paragraph(
    "De Firebase-kant is af. Wat overblijft is de app-schil en het uitrollen.", LEAD))

story.append(panel([
    ["✓", "Firebase-project aanmaken",
     "<i>Gedaan.</i> dageraad-fdb2d, europe-west4, anonieme login aan, config in de repo."],
    ["✓", "Beveiligingsregels uitrollen",
     "<i>Gedaan.</i> Gepubliceerd op 26 augustus, 38/38 groen in de emulator."],
    ["1", "De live app-schil bouwen",
     "Kamer maken en joinen, kaarten delen, de scheidsrechter op de tablet laten draaien, de schermen aan echte gegevens hangen. Dit is echt werk, geen knopje — en het is het enige dat nog tussen de code en een speelbaar potje staat."],
    ["2", "Hosting uitrollen",
     "<font face='Courier' size='8'>npm run build</font>, dan <font face='Courier' size='8'>firebase deploy --only hosting</font>. Daarna is er een link."],
    ["3", "Spelen", "Modus 1 tegen modus 2 — en de open regels beslissen."],
], [8 * mm, 44 * mm, 102 * mm]))

story.append(Paragraph("Nog open", H2))
story.append(panel([
    ["Gelijkspel → wolven winnen", "Voorlopig zo. Uitspelen."],
    ["De 50%-drempel om af te zien", "Weegt nu zwaarder: het is de enige manier waarop het dorp een potje zonder wolven wint."],
    ["Curator en voorwerpen", "Alleen bouwen als de groep ze wil; de regels liggen nergens vast."],
], [56 * mm, 98 * mm]))

story.append(Spacer(1, 8))
story.append(Paragraph(
    "<i>De motor en alle tests draaien nog steeds zonder cloudaccount — </i>"
    "<font face='Courier' size='8'>npm install &amp;&amp; npm test</font>"
    "<i> werkt op elke machine. Alleen </i>"
    "<font face='Courier' size='8'>npm run test:rules</font>"
    "<i> heeft Java nodig, en alleen het uitrollen heeft het Firebase-project "
    "nodig.</i>", SMALL))

doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=20 * mm, bottomMargin=18 * mm,
                      title="Dageraad — projectstatus",
                      author="Dageraad")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame],
                                   onPage=header_footer)])
doc.build(story)
print("wrote", OUT)
