# Bouwberichten Dashboard

Nederlandstalig leadbeheer met een centrale leadvoorraad en eigen opvolging per bedrijf. Leads openen in een gecentreerde pop-up. De applicatie bevat Kanban, notities, bellijsten, terugbelafspraken, conversierapportages, bedrijfsbeheer en echte gebruikersaccounts.

## Uitnodigen

1. Activeer het eerste beheeraccount met de afzonderlijk verstrekte eenmalige activatielink.
2. Open **Bedrijven & gebruikers** en kies **Gebruiker uitnodigen**.
3. Vul naam en e-mailadres in, kies precies één bedrijf en een rol, en genereer de link.
4. Kopieer en deel de link zelf met de bedoelde persoon. De applicatie verstuurt geen e-mail.
5. De ontvanger kiest een naam en wachtwoord en activeert het account. De link werkt één keer en is zeven dagen geldig.

Een nieuwe link maken maakt de vorige link ongeldig. Een uitnodiging kan ook worden ingetrokken. Bedrijfsbeheerders beheren uitnodigingen voor het eigen bedrijf; alleen de hoofdbeheerder kan een hoofdbeheerder uitnodigen of mensen naar een ander bedrijf overplaatsen. Bestaande gespreksgeschiedenis blijft bij het oorspronkelijke bedrijf.

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
| `BOOTSTRAP_TOKEN` | Een willekeurig geheim van minstens 32 URL-veilige tekens voor de eerste activatie |

De eerste activatielink heeft de vorm `APP_URL/#activate=BOOTSTRAP_TOKEN`. Verstrek deze alleen aan de eigenaar; neem de werkelijke waarde nooit op in GitHub. De server maakt de eerste uitnodiging één keer aan en heractiveert haar niet bij een herstart. Uitnodigingsgeheimen staan in een URL-fragment en worden door de client na het openen uit de adresbalk verwijderd.

Gebruik één replica: SQLite en het volume horen bij dezelfde service. Gezondheidscontrole: `/health`.

## Lokaal ontwikkelen en testen

Node.js 24 is vereist. Er zijn geen externe runtimepakketten nodig. Stel de variabelen voor een lokale omgeving in en start met `npm start`. Gebruik een aparte lege datamap voor ontwikkeling. Zet `NODE_ENV` lokaal niet op `production` wanneer je HTTP op localhost gebruikt.

`npm test` controleert de domeinregels en de HTTP-API, waaronder uitnodiging, activatie, sessies, rollen, bedrijfsafscheiding, belwachttijd en opslag na herstart.

## Huidige grenzen

De meegeleverde 18 leads zijn fictieve voorbeelden. Handmatig toegevoegde leads en opvolging worden gedeeld opgeslagen. Bouwberichten.nl, hotels, VvE en Outlook zijn nog niet aangesloten; de app bewaart geen bronwachtwoorden. Terugbelmeldingen verschijnen in een geopend tabblad en worden iedere 30 seconden ververst. Er is nog geen automatische e-mailverzending of e-mailgestuurde wachtwoordherstelprocedure.

Accounts gebruiken gehashte wachtwoorden en willekeurige, gehashte sessie- en uitnodigingstokens. De server controleert rollen en bedrijfsrechten bij iedere wijziging. Cookies zijn in productie HttpOnly, Secure en SameSite=Lax; schrijfacties vereisen een sessiegebonden CSRF-token.
