# calccad i webbläsaren

**https://qzos.github.io/calccad-web/**

calccad – ett Mathcad-inspirerat räkneblad i C99 – byggt till WebAssembly. Det här
repot innehåller bara den färdigbyggda webbappen (`make web` i calccad), som GitHub
Pages publicerar från grenen `main`. Källkoden finns i calccad; `version.txt` anger
vilken commit appen byggdes från. Filerna här skrivs över vid varje publicering: ändra
dem inte här.

Sidan registrerar en service worker (`sw.js`) vid första besöket och laddar om en gång:
GitHub Pages kan inte skicka huvudena för cross-origin-isolering, så service workern
lägger till dem och appen kan räkna i bakgrunden på en egen tråd. `?st=1` ger
varianten utan trådar.

Typsnitten är Liberation (SIL Open Font License 1.1) och DejaVu (Bitstream Vera-licens);
calccad själv är Apache License 2.0.
