# Bouwberichten.nl: scraper en import voorbereiden

De skill `web-scraping` staat met alle upstream workflows, voorbeelden en MIT-licentie onder `.agents/skills/web-scraping`. `UPSTREAM.json` legt de oorspronkelijke versie vast. De aangepaste ingang gebruikt de beschikbare hulpmiddelen in deze omgeving; de upstream Proxy-MCP-tools worden niet door deze installatie toegevoegd.

De beveiligde import, afzonderlijke filterbronnen en een aparte Railway-scraper zijn geïmplementeerd. Het aangemelde portaal is bekeken: de aangeleverde filterlink selecteert **Gegund vanaf 01-01-2026** en toonde op 24 november 2026 1.094 resultaten. De login is noodzakelijk. De API-mapping is gecontroleerd aan de publieke portalcode. Een echte aanmelding en extractie gelden pas als gevalideerd wanneer de proef in het dashboard is geslaagd; unit- en integratietests gebruiken fictieve records.

## Automatisch ophalen activeren

1. Open als hoofdbeheerder de gewenste Bouwberichten-filterbron en kies **Automatisch ophalen**. Sla eerst de volledige filterlink op als die nog ontbreekt.
2. Vul daar de Bouwberichten-gebruikersnaam en het bronwachtwoord in. **Beveiligd verbinden en proef starten** slaat de aanmelding versleuteld op en plant één proef met maximaal vijf echte projecten. Het formulier vraagt om de bronlogin, niet de dashboardlogin. De browser maakt het wachtwoordveld direct leeg na verzending.
3. De aparte scraperdienst pakt de opdracht op. Controleer de status en de vijf geïmporteerde projecten, inclusief beschikbare contactgegevens. Bij een extra aanmeldcontrole, CAPTCHA, verlopen toegang of onbekende bronstructuur stopt de opdracht met een melding. Er wordt geen beveiligingscontrole omzeild.
4. Na een geslaagde proef wordt **Volledig ophalen** beschikbaar. Een volledige selectie is maximaal 5000 projecten; bij een grotere selectie stopt de opdracht en moet het filter kleiner worden gemaakt. Een gedeeltelijke selectie wordt niet als volledige import gepresenteerd.
5. Schakel **Dagelijks ophalen** in om deze selectie iedere 24 uur te laten verwerken. De eerste geplande uitvoering is 24 uur na inschakelen. Voor direct ophalen gebruik je de volledige import. Elke filterbron heeft een eigen planning en status.

**Import pauzeren**, de importtoegang intrekken, de bron verwijderen of het filter wijzigen annuleert lopende opdrachten en schakelt de planning uit. Het wijzigen van filters vereist een nieuwe proef. **Bronaanmelding verwijderen** wist de opgeslagen bronlogin en stopt de planning, met behoud van leads en opvolging. Een mislukte scrape verwijdert geen bestaande projecten.

De scraper draait los van de webservice. Het dashboard bewaart de bronlogin met AES-256-GCM in SQLite; de sleutel staat alleen in Railway Variables als `SCRAPER_ENCRYPTION_KEY` (32 willekeurige bytes, base64url). `SCRAPER_WORKER_TOKEN` is een aparte willekeurige machinesleutel van minimaal 43 URL-veilige tekens, ingesteld op beide diensten. Sleutels en bronwachtwoorden staan nooit in GitHub. Hoofdbeheerders zien alleen de gebruikersnaam en verbindingsstatus; de opgeslagen wachtwoorden worden niet teruggegeven. Andere rollen krijgen geen scraperconfiguratie.

De worker heeft `DASHBOARD_URL` (de publieke HTTPS-origin) en `SCRAPER_WORKER_TOKEN` nodig. Stel in Railway rechtstreeks Dockerfile `scraper/Dockerfile`, startopdracht `node worker.mjs`, één replica en herstart bij fouten in. De buildcontext blijft de repository-root. De oude Config-as-Code-koppeling is voor beide diensten leeg; `railway.json` is geen actief configuratiebestand meer. De Playwright-versie staat vast in `scraper/package-lock.json`. Er is geen openbaar workeradres of gedeeld databasevolume nodig. De worker vraagt elke 15 seconden om een opdracht, gebruikt een tijdelijke browsercontext voor bronlogin en houdt toegangstokens uitsluitend in het geheugen. Bronverzoeken worden na elkaar uitgevoerd met minstens één seconde tussenruimte. Een opdracht stopt na maximaal een uur.

De machine-opdrachten lopen via `/api/scraper/claim` en de brongebonden, tijdelijk geleasede `/api/scraper/jobs/:id/{progress,batch,finish,fail}`. Batches worden server-side via dezelfde gevalideerde importlogica verwerkt als onderstaande losse import-API. Een bestaande importsleutel blijft geldig; bij de eerste scraperconfiguratie zonder importsleutel wordt interne importtoegang aangemaakt. Een machinesleutel geeft geen browserlogin, gebruikersbeheer of toegang tot bedrijfsnotities.

## Meerdere filters als bronnen

Voeg bij **Bronnen & koppelingen → Bron toevoegen** een bron van type **Bouwberichten.nl** toe. Geef ieder filter een herkenbare naam en plak de volledige link uit het projectoverzicht, inclusief het gedeelte na `#`. Je kunt ook **Filter als nieuwe bron** op een bestaande bronkaart kiezen en de gekopieerde selectie aanpassen. Alleen opslaan wijzigt nog geen selectie in Bouwberichten.nl en start geen import.

De eerste selectie is:

```text
https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BlastPublishedAt%5D%5Bstart%5D=2025-12-31T23%3A00%3A00.000Z&projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund
```

De UTC-starttijd in deze link is 1 januari 2026 om 00:00 in Nederland. De datumfilter gaat over **publicatie**, niet noodzakelijk over de datum van gunning. Het dashboard toont de leesbare samenvatting bij de bron. Gebruik expliciete filtercriteria: alleen een opgeslagen zoekopdracht-ID is onvoldoende, omdat het portaal dan een eerder gebruikte selectie kan overnemen. Tijdelijke loginlinks, wachtwoorden en toegangstokens worden hier niet opgeslagen.

Iedere filterbron heeft een eigen importadres, token, pauzestand en importgeschiedenis. De scraper moet de opgeslagen selectie uitvoeren; de importserver haalt de filterlink niet zelf op en controleert geen publicatiedatum aan de hand van `sourceUpdatedAt`. Dat veld beschrijft een bronwijziging, geen publicatiedatum.

Gebruik voor hetzelfde Bouwberichten-project in elk filter hetzelfde `externalId`. De import koppelt dat project dan aan meerdere bronnen, met één centrale lead en één gedeelde belwachttijd. Bedrijfsopvolging en oorspronkelijke aanmaakdatum blijven behouden. Het brontotaal kan door overlap hoger zijn dan het unieke totaal; een rapport met een gekozen bron rekent alleen de projecten uit die bron mee. Andere brontypen behouden een eigen identiteit per bron. Bestaande dubbele leads worden niet automatisch samengevoegd.

## Een eigen externe scraper aansluiten

1. Log in als hoofdbeheerder en open **Bronnen & koppelingen → de gewenste filterbron → Import instellen**. Controleer de bronnaam en filtersamenvatting.
2. Kies **Importtoken maken**. Kopieer het getoonde importadres en token. Het token is alleen nu zichtbaar; de database bewaart alleen de hash.
3. Bewaar bij de scraper twee geheime omgevingsvariabelen: `BOUWBERICHTEN_IMPORT_URL` en `BOUWBERICHTEN_IMPORT_TOKEN`. Dit kan later bij de Apify-job of een aparte scraper-service. Het dashboard heeft hiervoor geen nieuwe globale Railway-variabele nodig.
4. Bewaar een eventuele Bouwberichten-login afzonderlijk in de geheimen van de externe scraper. De meegeleverde Railway-scraper gebruikt het beveiligde formulier hierboven. Het importtoken is uitsluitend voor het dashboard, niet voor inloggen op Bouwberichten.nl.
5. Valideer eerst een kleine batch echte projecten. Controleer lokaal met `node scripts/import-leads.mjs --file projecten.json --dry-run`. Een dry run verzendt niets.
6. Importeer de gecontroleerde batch met `node scripts/import-leads.mjs --file projecten.json`. Het script leest URL en token uit zijn omgeving; geef het token niet als opdrachtregelargument mee.
7. Herhaal hetzelfde bestand. De bestaande projecten moeten dezelfde lead-ID behouden. Controleer daarna een wijziging terwijl de lead notities, een verkoper en een Kanban-status heeft.

**Import pauzeren** weigert nieuwe aanleveringen. Hervatten gebruikt dezelfde sleutel. **Importtoken vernieuwen** maakt de oude sleutel direct ongeldig. **Token intrekken** verwijdert de sleutel. Een bron verwijderen stopt eveneens de import; bestaande leads en opvolging blijven bewaard.

## HTTP-contract

`POST /api/import/sources/:sourceId/leads`

Headers:

```text
Content-Type: application/json
Authorization: Bearer <brongebonden importtoken>
```

Het exacte adres staat in het dashboard. Een browsercookie, hoofdbeheerderwachtwoord of CSRF-token is niet nodig voor deze machinekoppeling. De beheeracties voor tokens blijven wel gewone aangemelde hoofdbeheerderacties met CSRF-controle.

Voorbeeld van de structuur, met fictieve gegevens; dit is geen echte Bouwberichten-export:

```json
{
  "runId": "voorbeeld-batch-1",
  "items": [
    {
      "externalId": "project-123",
      "title": "Voorbeeld renovatieproject",
      "organization": "Voorbeeldorganisatie",
      "city": "Utrecht",
      "sourceUrl": "https://www.bouwberichten.nl/project/voorbeeld-123",
      "description": "Projectomschrijving uit de bron"
    }
  ]
}
```

`runId` is een vaste identificatie van één batch, 1–128 tekens. Herhaling met hetzelfde run-ID en dezelfde inhoud geeft hetzelfde antwoord; andere inhoud onder hetzelfde run-ID geeft HTTP 409. Eén aanvraag bevat 1–100 projecten en is maximaal 1 MiB. Het script splitst grotere lijsten vooraf op in stabiele batches en leidt zonder expliciet run-ID een identificatie uit het bestand af. Een expliciet client-run-ID is maximaal 100 tekens om ruimte voor batchnummers te houden.

Per project is `title` verplicht. Gebruik een stabiel `externalId` van maximaal 128 tekens. Ontbreekt dat, dan is een stabiele `sourceUrl` verplicht; de server leidt daarvan een identificatie af. Bronlinks gebruiken HTTP(S), bevatten geen gebruikersnaam of wachtwoord en worden nooit door de importserver opgehaald. Geef geen tijdelijke loginlinks of toegangstokens als bronlink op.

Optioneel: `organization`, `city`, `contact`, `phone`, `email`, `description`, `phase`, `budget`, `sourceUrl`, `sourceUpdatedAt`. Ontbrekende contactgegevens blijven bij nieuwe leads leeg. Vul geen fictieve contactgegevens in om een import te laten slagen.

Bij updates blijven weggelaten velden behouden. Expliciet `null` of een lege tekst wist de vorige bronwaarde alleen als die waarde niet handmatig is aangepast. Oudere brongegevens met een eerdere `sourceUpdatedAt` overschrijven nieuwere brongegevens niet.

Een geslaagde import geeft:

```json
{
  "sourceId": "bouw",
  "runId": "voorbeeld-batch-1",
  "counts": {"created": 1, "updated": 0, "unchanged": 0},
  "importedAt": "2026-11-24T08:00:00.000Z"
}
```

De bronstatus in het dashboard toont de laatste geslaagde import, aantallen en een gesaniteerde foutmelding. **Import gereed** betekent dat een sleutel klaarstaat; **Import actief** verschijnt pas na een geslaagde aanlevering. Dat is nog geen bewijs dat een automatische scrapeplanning draait.

## Gegevensbehoud en fouten

Identiteit is bij gewone bronnen gebonden aan bron plus extern project-ID; Bouwberichten-filterbronnen herkennen hetzelfde externe project gezamenlijk. Een import bewaart de lead-ID, oorspronkelijke aanmaakdatum en rapportageperiode. Bedrijfsgebonden Kanban-statussen, verkopers, notities, belgeschiedenis, terugbelafspraken en conversievinkjes blijven behouden. Nieuwe geïmporteerde leads worden niet automatisch aan de hoofdbeheerder toegewezen. Een eerder herkend project blijft historisch aan zijn filterbronnen gekoppeld: een latere lege of kleinere selectie verwijdert geen lidmaatschappen. Hiervoor is nog geen volledige synchronisatie met afmeldingen ingericht.

Een ongeldige batch schrijft geen projecten, projectkoppelingen of geslaagde run weg. Een foutmelding mag wel op de bron worden geregistreerd. Een lege of mislukte scrape verwijdert geen bestaande leads; een lege invoerlijst wordt door het clientscript niet verzonden. Alleen het dashboard schrijft naar het persistente SQLite-volume.

HTTP 400: invoer ongeldig. HTTP 401: sleutel ongeldig, ingetrokken, voor een andere bron of bron niet beschikbaar. HTTP 403: import gepauzeerd. HTTP 409: run-ID gebruikt voor andere inhoud. HTTP 413: aanvraag te groot. HTTP 429: te veel aanvragen. Het clientscript herhaalt tijdelijke netwerk- en serverfouten beperkt met dezelfde batch; bij blijvende fouten stopt het zonder het token of de invoer te loggen.

## De echte scraper vervolgen

Gebruik de geïnstalleerde skill voor onderzoek van het aangeleverde projectoverzicht. Begin met een officiële export/API of beschikbare HTML, gebruik een browser wanneer de gegevens dat vereisen, en test iedere gevonden extractiemethode. Koppel de bronvelden vervolgens aan bovenstaand JSON-contract. Zet pas na een geslaagde beperkte proef een Apify-job en eventuele planning aan. De importkoppeling kan ook vanuit een andere scraperomgeving worden gebruikt.
