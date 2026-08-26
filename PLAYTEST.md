# Eerste Speeltest

Deze checklist is voor de eerste echte avond aan tafel. Doe rustig een korte
testronde voordat iemand een rol serieus neemt.

## Vooraf

- [ ] Laat op de computer die gaat deployen eerst `npm run test:rules` lopen.
  Dit moet slagen voordat de regels naar Firebase mogen.
- [ ] Deploy daarna bewust de nieuwe regels, want de regels die nu live staan
  zijn te oud voor `members` en `rounds`:
  `npx firebase deploy --only firestore:rules`.
- [ ] Bouw en publiceer de app: `npm run build` gevolgd door
  `npx firebase deploy --only hosting`.
- [ ] Open de Hosting-link op minstens twee apparaten voordat iedereen gaat
  zitten. Laat elk apparaat internet houden en zet slaapstand zo nodig uit.
- [ ] Controleer in Firebase Authentication dat **Anonymous** is ingeschakeld.
  Zonder anonieme login krijgt niemand toegang tot een kamer.
- [ ] Kies bij het aanmaken van de kamer één vaste spelbegeleider:
  **tafelapparaat** is een extra tablet/laptop/telefoon die niet meespeelt en
  alle rollen technisch kan lezen; **vertrouwde host** is een speler die zijn
  eigen telefoon gebruikt en daarom ook technisch alle rollen kan lezen. De
  keuze is blijvend voor die kamer.
- [ ] Noteer de room code en bepaal wie de tafelapparaat-tab open houdt. Sluit
  of herlaad die tab niet midden in een nacht.

## Korte Testronde

- [ ] Maak een kamer met 3 tot 12 spelers en laat alle spelers de link openen
  en aansluiten.
- [ ] Controleer dat ieder alleen zijn eigen rol ziet. Op het tafelapparaat is
  alle spelinformatie beschikbaar; op de telefoons van spelers niet.
- [ ] Start een ronde en doorloop de nachtstappen op het tafelapparaat. De
  openbare tafelweergave mag geen geheime rollen of nachtkeuzes tonen.
- [ ] Kijk overdag of de neutrale toestand op alle apparaten meeloopt.
- [ ] Laat tijdens de discussie desnoods een meerderheid kiezen om niet te
  stemmen. Dat moet de stemming direct overslaan. Bij een gewone stemming
  kiest iedere speler een doelwit of stemt expliciet niet; stemmen op jezelf
  mogen niet lukken.
- [ ] Rond de uitslag af. De ronde moet precies eenmaal worden vastgelegd en
  de score/stand moet op alle apparaten hetzelfde zijn.

## Elke Volgende Ronde

- [ ] Controleer vóór het starten wie er deze ronde werkelijk aan tafel zit.
  Iemand die later binnenkomt of weggaat, verandert alleen aan een
  rondegrens, nooit midden in een lopende ronde.
- [ ] Start de volgende ronde pas als de tafelapparaat-tab nog open, wakker en
  online is.
- [ ] Doorloop nacht, bespreking en stemming zoals in de testronde.
- [ ] Controleer na de uitslag dat de ronde niet dubbel verschijnt en dat de
  stand één keer is bijgewerkt.
- [ ] Kijk bij een late binnenkomer naar de stand: die persoon begint op de
  huidige laagste score van de tafel, niet op nul en niet op een zelfgekozen
  hogere score.

## Let Extra Op

- [ ] **Anonieme login werkt niet:** aansluiten of schrijven wordt geweigerd.
  Controleer Firebase Authentication, vernieuw de pagina en probeer opnieuw.
- [ ] **Tafelapparaat-tab sluit of ververst:** stop de ronde. Open de kamer
  opnieuw op het aangewezen apparaat en controleer eerst of iedereen dezelfde
  openbare toestand ziet voordat je verdergaat.
- [ ] **Late speler op verkeerde grens:** laat die speler niet midden in een
  ronde meedoen. Noteer ronde en tijd; controleer vóór de volgende ronde de
  zitplaatsen en beginscore.
- [ ] **Verkeerde beginscore voor late speler:** noteer de laagste score van
  vóór de ronde en vergelijk die met de getoonde beginscore van de nieuwkomer.
- [ ] **Ronde dubbel na verversen:** stop, maak geen extra uitslag aan en
  controleer of dezelfde ronde twee keer in de lijst/stand staat.

## Als Iets Breekt

Leg meteen vast:

- [ ] de room code;
- [ ] welk apparaat het was en of het tafelapparaat of spelerstelefoon was;
- [ ] welke ronde en welke stap (nacht, bespreking, stem of uitslag);
- [ ] een screenshot van wat zichtbaar is;
- [ ] de browserconsole: open ontwikkelaarstools, kopieer foutmeldingen in de
  Console en maak daarvan ook een screenshot;
- [ ] of het probleem na vernieuwen terugkomt, zonder opnieuw een uitslag te
  versturen.

Een fout is nuttige testinformatie. Stop bij twijfel liever één minuut om dit
te noteren dan door te spelen met een onduidelijke score of geheime rol die
zichtbaar kan zijn geweest.
