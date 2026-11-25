# Bouwberichten Dashboard

Nederlandstalig leadbeheer met een centrale leadvoorraad en eigen opvolging per bedrijf. Leads openen in een gecentreerde pop-up. De applicatie bevat Kanban, notities, bellijsten, terugbelafspraken, conversierapportages, bedrijfsbeheer en echte gebruikersaccounts.

De hoofdbeheerder start op de **Controlekamer** (`#dashboard`), met de kop **Alles in één oogopslag**. De bedrijfschips filteren gezondheid, acties, kerncijfers, team, tekstsignalen, uuractiviteit, pijplijn en tijdlijn. De chips komen uit de werkelijk aanwezige bedrijven; Flamestop, Flameguard en Flameseal krijgen hun vaste huisstijlkleuren. Inter wordt lokaal geleverd. De Controlekamer gebruikt uitsluitend de bestaande, toegestane gegevens uit `/api/state` en wijzigt die gegevens niet om een overzicht te maken.

De gezondheid toont verlopen terugbelafspraken, hoge prioriteit zonder eigenaar en hoeveel actieve medewerkers vandaag een belregistratie hebben. **Bronmeldingen verschijnen alleen bij Alle bedrijven**; bij een bedrijfsfilter staat dat deze informatie gedeeld is. **Nu doen** opent de bestaande bedrijfswerkplek, Kanban-kolom, terugbelplanning, belrapportage of het logboek. Een tekstsignaal voor terugbellen zonder open afspraak wordt als mogelijke opvolging getoond, nooit automatisch ingepland. Het team bevat ook medewerkers zonder belmoment. Een centrale lead kan per bedrijf een andere status hebben; de pijplijn telt daarom per bedrijfswerkplek en maakt dat zichtbaar.

| Onderdeel | Bestaande gegevens |
| --- | --- |
| Bedrijven en kleuren | `companies.id`, `name`, `color`, `columns` |
| Belcijfers, chips en team | `callLog` en `workspaces[companyId][leadId].calls`, met dezelfde ontdubbeling als `buildCallReport`; `users.id`, `companyId`, `status`, `name` |
| Notities en tekstsignalen | Eigen bedrijfsnotities met `createdAt`, `authorId`, `authorName`, `text` |
| Statuswijzigingen | Werkelijke `feed`-gebeurtenissen met `type: status`, `at`, `companyId`, `authorId`, `authorName`, `statusChange` |
| Opvolging en acties | Open `callbacks` met `dueAt`, `assigneeId`, `done`; `priority`, `ownerId`; actieve leads en daadwerkelijke kolommen |
| Brongezondheid | `sources.lastImportError`, `scraper.lastError` en foutstatus |
| Uuractiviteit en tijdlijn | Vandaag opgeslagen notities en statuswijzigingen, ingedeeld in `Europe/Amsterdam` |
| Pijplijn | Actieve centrale `leads` met per bedrijf `workspace.status`, of de bestaande eerste kolom wanneer er nog geen eigen opvolging is |

Telefoontjes zijn afzonderlijke geregistreerde belmomenten, inclusief onbeantwoorde pogingen; het zijn geen verzonnen geslaagde gesprekken. Historische telefoontjes, notities en statuswijzigingen van verwijderde leads blijven meetellen, maar die leads leveren geen actieve opvolgacties op. Alleen actieve medewerkers die aan de geselecteerde bedrijfswerkplek zijn gekoppeld tellen mee in de verhouding actieve bellers. Woorden als `mail`, `tb`, `terugbellen`, `al geregeld` en `opgeleverd` zijn tekstsignalen uit vandaag vastgelegde notities, geen bewijs van verstuurde e-mail of bevestigde projectuitkomst. Oude algemene gebeurtenissen worden niet achteraf als statuswijziging geïnterpreteerd.

De Controlekamer haalt iedere 30 seconden één nieuwe state op. De aftelling, voortgangsring en knop **Nu vernieuwen** delen die planning. **Bijgewerkt** verschijnt na een geslaagde reactie; fouten worden als verbindingsprobleem getoond. Open formulieren blijven staan tijdens verversen. Nieuwe tijdlijnitems lichten kort op; tellers bewegen bij filterwissels van hun oude naar hun nieuwe waarde. Bij `prefers-reduced-motion` worden decoratieve animaties uitgeschakeld. Op mobiel staan navigatie en kaarten onder elkaar. De bestaande eigen dashboardpagina van verkopers en bedrijfsbeheerders blijft behouden.

Het eerdere uitgebreide overzicht staat nog onder **Beheer → Alle bedrijven** (`#all-companies`). **Nu aandacht nodig** staat daar bovenaan, gevolgd door belmomenten per bedrijf en medewerker met **Vandaag** of **Deze week**. De samenvatting toont vandaag, de huidige kalenderweek en medewerkers met belmomenten in de gekozen periode. Een klik opent de passende belrapportage. Deze week begint op maandag in `Europe/Amsterdam`.

De tijdlijn toont standaard **Notities en statuswijzigingen** van de laatste zeven dagen, met bedrijf, medewerker, lead en tijdstip. De filters gelden alleen voor deze tijdlijn; urgente aandachtspunten en de belvergelijking blijven over alle bedrijven zichtbaar. Nieuwe statuswijzigingen krijgen een eigen gebeurtenis met de oorspronkelijke en nieuwe kolomnaam. Een gelijktijdig opgeslagen notitie blijft een afzonderlijke gebeurtenis. Oudere algemene wijzigingen blijven beschikbaar onder **Alle gebeurtenissen**; onbekende oude statusdetails worden niet ingevuld of afgeleid. Centrale bronupdates worden één keer opgenomen.

De bestaande bedrijfskaarten staan onder het uitklapbare **Volledige bedrijfsstatus** en tonen actuele opvolging, actieve accounts, afspraken, toezeggingen, calculaties, eigen Kanban-kolommen en laatste activiteit. Alleen beschikbare centrale leads bekijken telt niet als bedrijfsopvolging. Historische filters veranderen geen actuele resultaten.

Vanuit dit overzicht kan de hoofdbeheerder een bedrijfswerkplek of een lead in de juiste bedrijfscontext openen en terugkeren naar dezelfde selectie. Verkopers en bedrijfsbeheerders houden hun eigen dashboard en krijgen geen toegang tot het overzicht van andere bedrijven. Het overzicht ververst ongeveer iedere 30 seconden; open formulieren en filters blijven behouden.

Onder **Rapportages → Belactiviteit** ziet de hoofdbeheerder geregistreerde telefoontjes per gebruiker, gegroepeerd per **dag, week of maand**, met bedrijf-, gebruiker- en datumfilters en CSV-export. Standaard staan de laatste 30 dagen geselecteerd. Elke afzonderlijke belregistratie telt; dezelfde registratie in meerdere opslaglijsten telt één keer, meerdere belmomenten bij dezelfde lead tellen apart. Een gespreksuitkomst bijwerken is geen extra telefoontje. De indeling volgt `Europe/Amsterdam`; weken beginnen op maandag en gebruiken het ISO-weeknummer. Actieve gebruikers zonder gesprekken krijgen nul. Historische gesprekken blijven bij hun oorspronkelijke bedrijf en gebruiker, ook na overplaatsing. De bestaande conversierapportage staat op het tabblad **Conversie**.

Open een lead door op de hele Kanban-kaart te klikken, of gebruik Enter of de spatiebalk. De kolom Opvolgen sorteert op het vroegste open terugbelmoment van het actieve bedrijf. Afgehandelde afspraken tellen niet mee; leads zonder afspraak staan onderaan. Slepen blijft beschikbaar om een status te wijzigen.

Alleen de hoofdbeheerder ziet onderaan een leadpop-up **Verwijder lead compleet**. De bevestiging noemt de lead en de gevolgen voor alle bedrijven; een reden is optioneel. Na bevestiging verdwijnt de lead uit alle actieve overzichten, Kanban-borden, bellijsten, zoekresultaten en terugbelmeldingen. De pop-up sluit en het oorspronkelijke overzicht blijft op dezelfde positie en selectie. Annuleren bewaart onopgeslagen invoer; bevestigen bewaart de reeds opgeslagen historie en verwijdert resterende conceptinvoer.

Verwijderde leads worden centraal gearchiveerd met beheerder, tijdstip en eventuele reden. Historische telefoontjes, notities, bronverwijzingen en bedrijfsresultaten blijven bewaard; bel- en conversierapportages blijven hetzelfde tellen. De oorspronkelijke bronidentiteit wordt blijvend uitgesloten van import. Voor Bouwberichten geldt dit over alle filterbronnen heen, ook bij later toegevoegde filters. Bij overige bronnen geldt de uitsluiting binnen de betreffende bron. Herhaalde imports en reeds ingeplande ophaalrondes kunnen de lead niet opnieuw activeren. Het aantal **uitgesloten** projecten staat afzonderlijk in de importresultaten en het logboek; een selectie met alleen uitgesloten projecten kan normaal afronden. Alleen rapportagegegevens van de eigen bedrijfsopvolging worden voor gewone gebruikers beschikbaar gehouden. Verwijderde leads kunnen niet vanuit historische activiteit opnieuw worden geopend of gewijzigd.

Onder **Beheer → Verwijderde leads** ziet alleen de hoofdbeheerder de volledige verwijderhistorie voor alle bedrijven. Het overzicht toont projectnaam en bron-ID, de vastgelegde naam van de beheerder, datum met jaar en Nederlandse tijd, en de volledige reden. Zonder reden verschijnt **Geen reden opgegeven**. De nieuwste verwijderingen staan bovenaan. De zoekbalk doorzoekt project, ID, beheerder en reden zonder tijdens het typen de invoer te vervangen. Op mobiel worden de regels als kaarten getoond. Het overzicht is alleen-lezen; gewone gebruikers krijgen ook via de rechtstreekse URL geen verwijdergegevens te zien.

Gebruik rechtsonder in de leadpop-up **Opslaan en sluiten** om gewijzigde opvolgvelden en een nog niet toegevoegde gespreksnotitie samen op te slaan. Na bevestiging door de server sluit de pop-up en keert de gebruiker terug naar dezelfde zoekopdracht, filters en scrollpositie. Bij een opslagfout blijft de invoer beschikbaar in de pop-up. Een herhaalde opslag na een verbindingsfout maakt dezelfde notitie niet dubbel aan. **Notitie toevoegen** slaat de huidige opvolging en notitie op en houdt de pop-up open; sluiten met het kruisje annuleert de resterende conceptwijzigingen.

Onder **Contactpersoon** bij de opvolging kan iedere gebruiker één eigen contactpersoon per lead vastleggen voor het actieve bedrijf. Alleen een naam is voldoende; e-mailadres en rechtstreeks telefoonnummer zijn optioneel. Zodra een e-mailadres of nummer is ingevuld, is ook een naam nodig. De contactpersoon wordt samen met de andere opvolgvelden en eventuele notitie opgeslagen. Alle drie velden leegmaken verwijdert de contactpersoon na opslaan. Deze gegevens blijven binnen het bedrijf en worden niet door bronimports overschreven; de oorspronkelijke broncontacten en historische gespreksnamen blijven behouden. Opgeslagen e-mailadressen openen de mailapp en opgeslagen rechtstreekse nummers zijn klikbaar met dezelfde belregistratie, belwachttijd en terugbeluitzondering als de andere nummers. Terwijl de contactgegevens gewijzigd worden, komen deze links na opslaan beschikbaar.

Bij **Overige betrokken partijen** kiest een gebruiker **Selecteren als contact** om die partij in het groene blok **Contact voor deze lead** te zetten. Zijn daar al contactgegevens aanwezig, dan vraagt een pop-up eerst om bevestiging. Annuleren bewaart het huidige contact; een leeg blok met alleen onbekend-placeholders kan direct worden ingevuld. Iedere bedrijfswerkplek kiest dit onafhankelijk per lead. De keuze wordt direct opgeslagen, blijft na bronupdates behouden en vervangt de centrale brongegevens niet. Onopgeslagen notities en opvolgvelden blijven tijdens bevestigen beschikbaar. Gewijzigde bron- of collega-gegevens worden vóór opslaan opnieuw gecontroleerd, zodat een verouderde keuze geen nieuwer contact overschrijft. De handmatig vastgelegde contactpersoon bij de opvolging blijft een apart veld.

## Aanmelden

Op het inlogscherm kun je **Aangemeld blijven** aanvinken. De aanmelding blijft dan maximaal 30 dagen op hetzelfde apparaat bewaard. Zonder vinkje gebruikt de app een sessiecookie en vervalt de toegang op de server na 12 uur. Uitloggen beëindigt de betreffende sessie direct. Een geldige sessie opent het dashboard ook wanneer je opnieuw naar `/login` gaat.

**Mijn account → Uitloggen** trekt de huidige sessie in, verwijdert de aanmeldcookie en opent daarna de homepagina `/` met het inlogscherm. Dit werkt ook wanneer de sessie al verlopen is. Een wachtende achtergrondactie houdt het uitloggen niet tegen; late reacties kunnen de oude werkplek niet opnieuw tonen. De knop is tijdens het uitloggen geblokkeerd tegen dubbelklikken. Als de verbinding mislukt, blijft een duidelijke melding met de mogelijkheid opnieuw te proberen zichtbaar. Pas na bevestiging door de server wordt de homepagina geopend. Terugkeren via de browsergeschiedenis controleert de sessie opnieuw.

Met **Tonen / Verbergen** kun je het wachtwoord zichtbaar maken en weer afschermen. Deze knoppen staan ook bij beide wachtwoordvelden tijdens accountactivatie. Het wachtwoord wordt hiervoor niet apart opgeslagen.

Bij een uitnodigingslink staan onder de twee wachtwoordvelden de voorwaarden: **minimaal 12 en maximaal 256 tekens**, en **twee gelijke wachtwoorden**. Tijdens typen of plakken toont de lijst welke voorwaarden al kloppen. Ongeldige invoer krijgt een concrete melding en wordt niet verstuurd. Ook een lege naam wordt gemeld. Bij een geweigerde activatie blijven het formulier en de invoer beschikbaar voor correctie of opnieuw proberen; wachtwoorden worden niet in browseropslag bewaard. Er zijn geen verplichte combinaties van hoofdletters, cijfers of symbolen. Zowel activeren als gewoon inloggen ondersteunt de volledige lengte tot 256 tekens.

## Belwachttijd

De hoofdbeheerder kan bij **Instellingen → Belwachttijd tussen bedrijven** kiezen tussen uren en dagen. Wisselen rekent de bestaande duur om (48 uur = 2 dagen); sla de instelling op om duur en gekozen eenheid voor alle bedrijven te bewaren. De maximale wachttijd is 365 dagen. De uitzondering voor de eigen terugbelafspraak blijft gelden.

## Uitnodigen

1. Meld je aan via `/login` met de beheerlogin uit Railway Variables. Zonder ingesteld beheerwachtwoord kun je het eerste beheeraccount via een eenmalige activatielink activeren.
2. Open **Bedrijven & gebruikers** en kies **Gebruiker uitnodigen**.
3. Vul naam en e-mailadres in, kies precies één bedrijf en een rol, en genereer de link.
4. Kopieer en deel de link zelf met de bedoelde persoon. De applicatie verstuurt geen e-mail.
5. De ontvanger kiest een naam en wachtwoord en activeert het account. De link werkt één keer en is zeven dagen geldig.

Een nieuwe link maken maakt de vorige link ongeldig. Een uitnodiging kan ook worden ingetrokken. Bedrijfsbeheerders beheren uitnodigingen voor het eigen bedrijf; alleen de hoofdbeheerder kan een hoofdbeheerder uitnodigen of mensen naar een ander bedrijf overplaatsen. Bestaande gespreksgeschiedenis blijft bij het oorspronkelijke bedrijf.

Bij **Uitnodigingslinks → Verwijderen** kun je na bevestiging een regel uit de lijst verwijderen, ook als de uitnodiging al is gebruikt, verlopen of ingetrokken. De link werkt daarna niet meer. Bestaande gebruikersaccounts, sessies en opvolgingsgeschiedenis blijven behouden. De hoofdbeheerder kan alle uitnodigingen verwijderen; een bedrijfsbeheerder alleen uitnodigingen binnen het eigen bedrijf, behalve voor hoofdbeheerders.

## Bedrijfsnaam en logo

Open **Bedrijven & mensen → Logo toevoegen / Logo wijzigen** of **Bewerken** om een bedrijfsnaam aan te passen, een logo te uploaden of het bestaande logo te verwijderen. De hoofdbeheerder kan ieder bedrijf bewerken; een bedrijfsbeheerder alleen het eigen bedrijf. Verkopers zien geen bewerkknop.

De upload accepteert PNG, JPEG en WebP tot 5 MB. De browser verkleint de afbeelding automatisch voor opslag. Het opgeslagen logo verschijnt op de bedrijfskaart, in de zijbalk en in de bovenbalk van de eigen werkplek, ook na opnieuw inloggen. Zonder logo verschijnen de bedrijfsinitialen. Een naamswijziging behoudt gebruikers, Kanban-kolommen en geschiedenis.

Logo's staan als binaire afbeeldingen in de SQLite-database op het persistente volume. Alleen aangemelde gebruikers van het betreffende bedrijf en de hoofdbeheerder kunnen ze opvragen. De server controleert formaat, afmetingen en bestandsgrootte; afbeeldingen van externe URL's en SVG-bestanden worden niet geaccepteerd.

De hoofdbeheerder kan via **Bedrijf verwijderen** een bedrijf zonder gekoppelde gebruikers verwijderen. Ook inactieve gebruikers tellen mee: verplaats hen eerst naar een ander bedrijf. Een bevestiging toont welk bedrijf wordt verwijderd. Open uitnodigingslinks voor dat bedrijf worden ingetrokken. Het bedrijf verdwijnt uit het beheer, de werkplekkeuze en de actieve overzichtspagina; eerdere telefoontjes, notities en resultaten blijven bewaard, inclusief de oorspronkelijke bedrijfsnaam in de rapportages. Verwijderen van de actieve werkplek kiest een beschikbaar ander bedrijf. Zonder bedrijven kan de hoofdbeheerder een nieuw bedrijf toevoegen.

## Bronnen beheren

De scraper-skill en beveiligde importvoorbereiding voor Bouwberichten.nl zijn beschikbaar. Zie [Scraper en import instellen](docs/SCRAPING_SETUP.md). Maak voor iedere selectie een aparte bron van type **Bouwberichten.nl** met een eigen naam en volledige filterlink, of kies **Filter als nieuwe bron** op een bestaande bronkaart. De samenvatting toont bijvoorbeeld **Gegund vanaf 01-01-2026**. Alleen een opgeslagen zoekopdracht-ID is onvoldoende; de link moet expliciete criteria bevatten.

Via **Import instellen** kan de hoofdbeheerder per bron een sleutel maken, vernieuwen, pauzeren of intrekken. Gebruik voor hetzelfde Bouwberichten-project in alle filters hetzelfde externe ID: het blijft dan één centrale lead met meerdere bronlabels, gedeelde belwachttijd en behouden bedrijfsopvolging. Rapporten per bron kunnen overlappen; het bedrijfstotaal telt een lead één keer. Lidmaatschappen blijven historisch bewaard wanneer een project later niet meer in een filter wordt gevonden. Andere brontypen behouden hun eigen projectidentiteit per bron.

Het aangemelde projectoverzicht en de opgegeven selectie zijn bekeken. Via **Automatisch ophalen** kan een hoofdbeheerder de Bouwberichten-aanmelding versleuteld opslaan en een proef met vijf projecten starten. Pas na een geslaagde proef worden volledig ophalen en dagelijks ophalen beschikbaar. De aparte Railway-worker gebruikt een tijdelijke browsercontext, verwerkt de selectie via de portal-API en levert gevalideerde batches terug aan het dashboard. Een opgeslagen filter alleen start geen scraper. Een echte verbinding is pas bewezen wanneer de bronproef slaagt.

Bij **Dagelijks ophalen** kan iedere bron een eigen tijdstip krijgen. Kies **Tijdstip (Nederlandse tijd)** en klik **Tijd opslaan**. Ook met de dagelijkse planning uit kan een tijdstip worden voorbereid; aanzetten vereist nog steeds een geslaagde proef. De planning volgt `Europe/Amsterdam`, inclusief zomer- en wintertijd. Een niet-bestaande tijd tijdens de zomertijdsprong schuift met het ontbrekende uur mee; een herhaalde wintertijd geeft hoogstens één automatische opdracht per bron per lokale dag. Na uitval wordt één inhaalronde gepland. Er wordt één bron tegelijk opgehaald, dus een lopende ronde kan de start van een andere bron uitstellen. De migratie bewaart bestaande eerstvolgende uitvoeringen; opnieuw verbinden bewaart het gekozen tijdstip.

De hoofdbeheerder ziet onder **Beheer → Logboek** de ophaalpogingen, standaard gefilterd op **Mislukt**. Filter op bron of status en bekijk start- en eindtijd, verwerkte aantallen en de veilige foutreden met een volgende stap. Nieuwe fouten vermelden onder meer onderbroken verbindingen, verlopen aanmelding, gewijzigde projectaantallen, dubbele projecten of een overschreden tijdslimiet. Diagnostiek bevat uitsluitend vaste foutcategorieën, stappen en begrensde aantallen/antwoordcodes; wachtwoorden, tokens, ruwe serverantwoorden en foutteksten worden niet opgenomen. Oudere pogingen zonder opgeslagen oorzaak worden als zodanig aangeduid. De lijst toont maximaal de laatste 100 pogingen per selectie, in pagina's van 20.

Met **Opnieuw proberen** wordt voor een mislukte poging een nieuwe opdracht van hetzelfde type ingepland. De oorspronkelijke fout blijft bewaard. Dubbelklikken of een herhaalde aanvraag levert dezelfde vervolgopdracht op. Al geïmporteerde leads en opvolging blijven behouden; bestaande projecten worden bij de nieuwe ronde herkend. De selectie en bronaanmelding moeten aantoonbaar ongewijzigd zijn en de bron moet actief zijn. Een verlopen login, gewijzigde selectie of ontkoppelde bron vraagt eerst om opnieuw verbinden of een nieuwe proef. Voor de meest recente oude fout kan alleen een aantoonbaar bij de huidige broninstellingen horende poging opnieuw worden gestart. Opnieuw proberen zet een na een fout uitgeschakelde dagelijkse planning niet automatisch aan. Het logboek en de herstartactie worden op de server uitsluitend aan de hoofdbeheerder toegestaan, ook bij rechtstreeks openen van de URL.

Projectfoto's worden aanvullend uit de bijbehorende projectpagina opgehaald en privé bij de lead opgeslagen. De worker brengt vertraagd geladen foto's eerst in beeld en gebruikt de volledige bronprojectnaam voor herkenning. Algemene categorieafbeeldingen van Bouwberichten worden niet als projectfoto opgeslagen. Als een foto ontbreekt of tijdelijk niet kan worden opgehaald, blijven de lead en een eventueel eerder opgeslagen foto behouden. Een nieuwe volledige ophaalronde kan ontbrekende foto's aanvullen zonder de bedrijfsopvolging te vervangen; een proef verwerkt alleen de eerste vijf projecten.

De hoofdbeheerder kan bij **Bronnen & koppelingen** bronnen toevoegen, configureren en na bevestiging verwijderen. Geef een naam op en eventueel een bron-URL en gebruikersnaam. Opslaan maakt nog geen verbinding; nieuwe bronnen staan op **Niet gekoppeld**. Wachtwoorden en toegangstokens horen niet in deze velden.

Actieve bronnen verschijnen bij het toevoegen van een lead, in filters en in rapportages en exports. Verwijderen haalt de bron uit het overzicht en uit de keuze voor nieuwe leads. Bestaande leads, notities, belgeschiedenis en conversies blijven aan de oorspronkelijke bron gekoppeld; die bron blijft met de aanduiding **verwijderd** beschikbaar in historische filters. De URL en gebruikersnaam worden bij verwijderen gewist. De toekomstige Outlook-koppeling kan eveneens uit het overzicht worden verwijderd.

## Railway

De app draait als één Node.js 24-service met de meegeleverde Dockerfile. Mount een persistent Railway-volume op `/data`. De SQLite-database, wachtwoordhashes, sessies en uitnodigingshashes staan op dat volume, buiten de broncode.

Benodigde omgevingsvariabelen:

| Variabele | Betekenis |
| --- | --- |
| `NODE_ENV` | `production` op Railway |
| `PORT` | Bijvoorbeeld `3000`; de server luistert op alle interfaces |
| `DATA_DIR` | `/data`, op het persistente volume |
| `APP_URL` | De exacte publieke HTTPS-origin van de app, zonder pad |
| `APP_URL_ALIASES` | Optioneel: extra vertrouwde origins, gescheiden door komma's. Houd hiermee tijdens een domeinoverstap het oude dashboardadres bereikbaar. Geen paden of wildcards. |
| `ADMIN_EMAIL` | E-mailadres voor het eerste beheeraccount |
| `ADMIN_NAME` | Voorgestelde naam voor het eerste beheeraccount |
| `ADMIN_PASSWORD` | Beheerwachtwoord van 12–256 tekens; activeert de eigenaar rechtstreeks voor aanmelden via `/login` |
| `BOOTSTRAP_TOKEN` | Een willekeurig geheim van minstens 32 URL-veilige tekens voor de eerste activatie |
| `DEMO_CLEANUP_ID` | Optioneel: unieke naam voor een eenmalige opruiming van demoleads bij het opstarten; normaal leeg |
| `SCRAPER_ENCRYPTION_KEY` | Voor automatisch ophalen: 32 willekeurige bytes als base64url; versleutelt bronwachtwoorden in het dashboardvolume |
| `SCRAPER_WORKER_TOKEN` | Voor automatisch ophalen: gedeelde machinesleutel van minstens 43 URL-veilige tekens voor de aparte worker; geeft geen dashboardlogin |

Met `ADMIN_PASSWORD` ingesteld beheert Railway de bestaande eigenaarlogin. De server bewaart het wachtwoord gehasht in de database en behoudt diens bedrijf en geschiedenis. Een gewijzigd beheerwachtwoord of e-mailadres wordt bij de volgende deployment toegepast en trekt bestaande beheerderssessies in. Een ongewijzigde instelling behoudt bestaande sessies. Dit eigenaaraccount blijft hoofdbeheerder. Bewaar de werkelijke waarden uitsluitend in Railway Variables; zet ze nooit in GitHub.

Als alternatief zonder `ADMIN_PASSWORD` heeft de eerste activatielink de vorm `APP_URL/#activate=BOOTSTRAP_TOKEN`. Verstrek deze alleen aan de eigenaar. De server maakt de eerste uitnodiging één keer aan en heractiveert haar niet bij een herstart. Een rechtstreeks ingestelde beheerlogin maakt een nog openstaande eigenaaruitnodiging ongeldig. Uitnodigingsgeheimen staan in een URL-fragment en worden door de client na het openen uit de adresbalk verwijderd.

Gebruik één replica: SQLite en het volume horen bij dezelfde service. Gezondheidscontrole: `/health`.

Bij een eigen domein beheert Cloud86 de DNS en blijft Railway de app en database hosten. Voeg het domein toe aan de bestaande Railway-webservice op poort 3000 en neem de opgegeven CNAME- en verificatie-TXT-records over bij Cloud86. Zet `APP_URL` op de nieuwe HTTPS-origin en behoud het oude Railway-adres zo nodig in `APP_URL_ALIASES`. Een vertrouwde alias blijft zelfstandig werken; andere hosts verwijzen voor openbare pagina's naar `APP_URL`. Browserwijzigingen via een alias vereisen een Origin die bij de werkelijke Host hoort. De scraper-API en gezondheidscontrole worden niet doorgestuurd. De worker mag zijn bestaande `DASHBOARD_URL` behouden. Sessiecookies gelden per host, dus op het nieuwe domein melden gebruikers zich eenmalig opnieuw aan.

De aparte worker gebruikt `scraper/Dockerfile`, zonder publiek domein of datavolume. Railway gebruikt rechtstreeks ingestelde service-instellingen (startopdracht `node worker.mjs`, één replica, herstart bij fouten); de oude Config-as-Code-koppeling is leeg en de oude `railway.json` is verwijderd. Stel `DASHBOARD_URL`, dezelfde `SCRAPER_WORKER_TOKEN` en `RAILWAY_DOCKERFILE_PATH=scraper/Dockerfile` in. De webservice blijft de enige schrijver van SQLite. Zie de scraperhandleiding voor aanmelding, proef, planning, limieten en intrekken van toegang.

De worker wordt automatisch gepubliceerd bij wijzigingen aan `/scraper/worker.mjs`, `/scraper/bouwberichten-*.mjs`, `/scraper/package*.json`, `/scraper/Dockerfile`, `/public/bouwberichten-filters.mjs` en `/.dockerignore`. De broker draait in de webservice; wijzigingen aan alleen `scraper/broker.mjs` herstarten de worker niet, zodat een lopende import kan doorgaan. Werk deze lijst bij wanneer de worker nieuwe runtimebestanden gaat gebruiken.

## Lokaal ontwikkelen en testen

Node.js 24 is vereist. Er zijn geen externe runtimepakketten nodig. Stel de variabelen voor een lokale omgeving in en start met `npm start`. Gebruik een aparte lege datamap voor ontwikkeling. Zet `NODE_ENV` lokaal niet op `production` wanneer je HTTP op localhost gebruikt.

`npm test` controleert de domeinregels en de HTTP-API, waaronder uitnodiging, activatie, sessies, rollen, bedrijfsafscheiding, belwachttijd en opslag na herstart.

## Huidige grenzen

Nieuwe installaties starten zonder demoleads. Handmatig toegevoegde leads en opvolging worden gedeeld opgeslagen. Bestaande demoleads kunnen door een hoofdbeheerder worden opgeruimd via de onderhoudsactie `demo.remove`. Ook de beheerder van de Railway-omgeving kan hiervoor een eenmalige `DEMO_CLEANUP_ID` instellen. De opruiming, het privéarchief en de registratie van de uitgevoerde onderhoudsstap worden samen opgeslagen; dezelfde naam voert de stap bij een herstart niet nogmaals uit. Alleen records met `demo === true` worden verwijderd. Accounts, uitnodigingen, instellingen en handmatige leads blijven behouden. Er is hiervoor geen extra openbaar onderhoudsendpoint. De Bouwberichten-scraper vereist een geslaagde proef met een echt bronaccount. Hotels, VvE en Outlook hebben nog geen ingebouwde extractor. Terugbelmeldingen verschijnen in een geopend tabblad en worden iedere 30 seconden ververst. Er is nog geen automatische e-mailverzending of e-mailgestuurde wachtwoordherstelprocedure.

Accounts gebruiken gehashte wachtwoorden en willekeurige, gehashte sessie- en uitnodigingstokens. De server controleert rollen en bedrijfsrechten bij iedere wijziging. Cookies zijn in productie HttpOnly, Secure en SameSite=Lax; schrijfacties vereisen een sessiegebonden CSRF-token.
