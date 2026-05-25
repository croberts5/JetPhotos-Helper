const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(get(res.headers.location));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function parseRow(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

function parseCSV(text) {
    const lines = text.split('\n');
    const headers = parseRow(lines[0]);
    const out = {};

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = parseRow(line);
        const row = Object.fromEntries(headers.map((h, idx) => [h, fields[idx] ?? '']));

        const icao = row['ident']?.trim();
        const iata = row['iata_code']?.trim();
        const name = row['name']?.trim();
        const city = row['municipality']?.trim();

        if (!icao || icao.length !== 4 || !iata || iata.length !== 3) continue;
        out[icao] = [iata, name, city];
    }

    return out;
}

async function main() {
    console.log('Fetching airports.csv from OurAirports...');
    const csv = await get('https://davidmegginson.github.io/ourairports-data/airports.csv');
    const airports = parseCSV(csv);
    console.log(`Parsed ${Object.keys(airports).length} airports with ICAO + IATA codes.`);
    const outPath = path.join(__dirname, '..', 'airports.json');
    fs.writeFileSync(outPath, JSON.stringify(airports));
    console.log(`Written to airports.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
