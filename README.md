# Bouwberichten Dashboard

Nederlandstalig leadbeheer met een centrale leadvoorraad en eigen opvolging per bedrijf. Leads openen in een gecentreerde pop-up. De applicatie bevat Kanban, notities, bellijsten, terugbelafspraken, conversierapportages, bedrijfsbeheer en echte gebruikersaccounts.

Open een lead door op de hele Kanban-kaart te klikken, of gebruik Enter of de spatiebalk. De kolom Opvolgen sorteert op het vroegste open terugbelmoment van het actieve bedrijf. Afgehandelde afspraken tellen niet mee; leads zonder afspraak staan onderaan. Slepen blijft beschikbaar om een status te wijzigen.

## Aanmelden

Op het inlogscherm kun je **Aangemeld blijven** aanvinken. De aanmelding blijft dan maximaal 30 dagen op hetzelfde apparaat bewaard. Zonder vinkje gebruikt de app een sessiecookie en vervalt de toegang op de server na 12 uur. Uitloggen beëindigt de betreffende sessie direct. Een geldige sessie opent het dashboard ook wanneer je opnieuw naar `/login` gaat.

Met **Tonen / Verbergen** kun je het wachtwoord zichtbaar maken en weer afschermen. Deze knoppen staan ook bij beide wachtwoordvelden tijdens accountactivatie. Het wachtwoord wordt hiervoor niet apart opgeslagen.

## Belwachttijd

De hoofdbeheerder kan bij **Instellingen → Belwachttijd tussen bedrijven** kiezen tussen uren en dagen. Wisselen rekent de bestaande duur om (48 uur = 2 dagen); sla de instelling op om duur en gekozen eenheid voor alle bedrijven te bewaren. De maximale wachttijd is 365 dagen. De uitzondering voor de eigen terugbelafspraak blijft gelden.

## Uitnodigen

1. Meld je aan via `/login` met de beheerlogin uit Railway Variables. Zonder ingesteld beheerwachtwoord kun je het eerste beheeraccount via een eenmalige activatielink activeren.
2. Open **Bedrijven & gebruikers** en kies **Gebruiker uitnodigen**.
3. Vul naam en e-mailadres in, kies precies één bedrijf en een rol, en genereer de link.
4. Kopieer en deel de link zelf met de bedoelde persoon. De applicatie verstuurt geen e-mail.
5. De ontvanger kiest een naam en wachtwoord en activeert het account. De link werkt één keer en is zeven dagen geldig.

Een nieuwe link maken maakt de vorige link ongeldig. Een uitnodiging kan ook worden ingetrokken. Bedrijfsbeheerders beheren uitnodigingen voor het eigen bedrijf; alleen de hoofdbeheerder kan een hoofdbeheerder uitnodigen of mensen naar een ander bedrijf overplaatsen. Bestaande gespreksgeschiedenis blijft bij het oorspronkelijke bedrijf.

## Bedrijfsnaam en logo

Open **Bedrijven & mensen → Bewerken** om een bedrijfsnaam aan te passen, een logo te uploaden of het bestaande logo te verwijderen. De hoofdbeheerder kan ieder bedrijf bewerken; een bedrijfsbeheerder alleen het eigen bedrijf. Verkopers zien geen bewerkknop.

De upload accepteert PNG, JPEG en WebP tot 5 MB. De browser verkleint de afbeelding automatisch voor opslag. Het opgeslagen logo verschijnt op de bedrijfskaart, in de zijbalk en in de bovenbalk van de eigen werkplek, ook na opnieuw inloggen. Zonder logo verschijnen de bedrijfsinitialen. Een naamswijziging behoudt gebruikers, Kanban-kolommen en geschiedenis.

Logo's staan als binaire afbeeldingen in de SQLite-database op het persistente volume. Alleen aangemelde gebruikers van het betreffende bedrijf en de hoofdbeheerder kunnen ze opvragen. De server controleert formaat, afmetingen en bestandsgrootte; afbeeldingen van externe URL's en SVG-bestanden worden niet geaccepteerd.

## Railway

De app draait als één Node.js 24-service met de meegeleverde Dockerfile. Mount een persistent Railway-volume op `/data`. De SQLite-database, wachtwoordhashes, sessies en uitnodigingshashes staan op dat volume, buiten de broncode.

Benodigde omgevingsvariabelen:

| Variabele | Betekenis |
| --- | --- |
| `NODE_ENV` | `production` op Railway |
| `PORT` | Bijvoorbeeld `3000`; de server luistert op alle interfaces |
| `DATA_DIR` | `/data`, op het persistente volume |
| `APP_URL` | De exacte publieke HTTPS-origin van de app, zonder pad |
| `ADMIN_EMAIL` | E-mailadres voor het eerste beheeraccount |
| `ADMIN_NAME` | Voorgestelde naam voor het eerste beheeraccount |
| `ADMIN_PASSWORD` | Beheerwachtwoord van 12–256 tekens; activeert de eigenaar rechtstreeks voor aanmelden via `/login` |
| `BOOTSTRAP_TOKEN` | Een willekeurig geheim van minstens 32 URL-veilige tekens voor de eerste activatie |
| `DEMO_CLEANUP_ID` | Optioneel: unieke naam voor een eenmalige opruiming van demoleads bij het opstarten; normaal leeg |

Met `ADMIN_PASSWORD` ingesteld beheert Railway de bestaande eigenaarlogin. De server bewaart het wachtwoord gehasht in de database en behoudt diens bedrijf en geschiedenis. Een gewijzigd beheerwachtwoord of e-mailadres wordt bij de volgende deployment toegepast en trekt bestaande beheerderssessies in. Een ongewijzigde instelling behoudt bestaande sessies. Dit eigenaaraccount blijft hoofdbeheerder. Bewaar de werkelijke waarden uitsluitend in Railway Variables; zet ze nooit in GitHub.

Als alternatief zonder `ADMIN_PASSWORD` heeft de eerste activatielink de vorm `APP_URL/#activate=BOOTSTRAP_TOKEN`. Verstrek deze alleen aan de eigenaar. De server maakt de eerste uitnodiging één keer aan en heractiveert haar niet bij een herstart. Een rechtstreeks ingestelde beheerlogin maakt een nog openstaande eigenaaruitnodiging ongeldig. Uitnodigingsgeheimen staan in een URL-fragment en worden door de client na het openen uit de adresbalk verwijderd.

Gebruik één replica: SQLite en het volume horen bij dezelfde service. Gezondheidscontrole: `/health`.

## Lokaal ontwikkelen en testen

Node.js 24 is vereist. Er zijn geen externe runtimepakketten nodig. Stel de variabelen voor een lokale omgeving in en start met `npm start`. Gebruik een aparte lege datamap voor ontwikkeling. Zet `NODE_ENV` lokaal niet op `production` wanneer je HTTP op localhost gebruikt.

`npm test` controleert de domeinregels en de HTTP-API, waaronder uitnodiging, activatie, sessies, rollen, bedrijfsafscheiding, belwachttijd en opslag na herstart.

## Huidige grenzen

Nieuwe installaties starten zonder demoleads. Handmatig toegevoegde leads en opvolging worden gedeeld opgeslagen. Bestaande demoleads kunnen door een hoofdbeheerder worden opgeruimd via de onderhoudsactie `demo.remove`. Ook de beheerder van de Railway-omgeving kan hiervoor een eenmalige `DEMO_CLEANUP_ID` instellen. De opruiming, het privéarchief en de registratie van de uitgevoerde onderhoudsstap worden samen opgeslagen; dezelfde naam voert de stap bij een herstart niet nogmaals uit. Alleen records met `demo === true` worden verwijderd. Accounts, uitnodigingen, instellingen en handmatige leads blijven behouden. Er is hiervoor geen extra openbaar onderhoudsendpoint. Bouwberichten.nl, hotels, VvE en Outlook zijn nog niet aangesloten; de app bewaart geen bronwachtwoorden. Terugbelmeldingen verschijnen in een geopend tabblad en worden iedere 30 seconden ververst. Er is nog geen automatische e-mailverzending of e-mailgestuurde wachtwoordherstelprocedure.

Accounts gebruiken gehashte wachtwoorden en willekeurige, gehashte sessie- en uitnodigingstokens. De server controleert rollen en bedrijfsrechten bij iedere wijziging. Cookies zijn in productie HttpOnly, Secure en SameSite=Lax; schrijfacties vereisen een sessiegebonden CSRF-token.
