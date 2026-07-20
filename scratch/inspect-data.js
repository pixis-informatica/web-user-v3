const fs = require('fs');
const products = JSON.parse(fs.readFileSync('data/products.json', 'utf-8'));
console.log('Product keys:', Object.keys(products[0]));
console.log('First product (trimmed):', JSON.stringify(products[0], null, 2).substring(0, 600));
console.log('\nTotal products:', products.length);

try {
  const site = JSON.parse(fs.readFileSync('data/site.json', 'utf-8'));
  console.log('\nSite keys:', Object.keys(site));
  if (site.tasasCuotas) console.log('tasasCuotas:', site.tasasCuotas);
  if (site.tasas) console.log('tasas:', site.tasas);
  if (site.cuotas) console.log('cuotas:', site.cuotas);
  // Search for any key containing "tasa" or "cuota" or "recargo"
  for (const k of Object.keys(site)) {
    if (/tasa|cuota|recargo|surcharge/i.test(k)) {
      console.log(`  site.${k}:`, JSON.stringify(site[k]).substring(0, 200));
    }
  }
} catch(e) { console.log('No site.json or error:', e.message); }
