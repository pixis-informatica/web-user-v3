const fs = require('fs');
const path = require('path');

const productsPath = path.join(__dirname, '../data/products.json');
const categoriesPath = path.join(__dirname, '../data/categories.json');
const sitePath = path.join(__dirname, '../data/site.json');

console.log('--- INICIANDO AUDITORÍA SEO ---');

// 1. Cargar productos
if (!fs.existsSync(productsPath)) {
  console.error('❌ No se encontró products.json');
  process.exit(1);
}
const products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
const totalProducts = products.length;
console.log(`Total de productos: ${totalProducts}`);

// Validaciones por producto
let sinTitle = 0;
let sinPrice = 0;
let sinImg = 0;
let sinDesc = 0;
let sinCategory = 0;
let sinSlug = 0;
const emptyFields = [];

products.forEach((p, index) => {
  const missing = [];
  if (!p.title) { sinTitle++; missing.push('title'); }
  if (p.price === undefined || p.price === null || p.price === '') { sinPrice++; missing.push('price'); }
  if (!p.img) { sinImg++; missing.push('img'); }
  if (!p.desc) { sinDesc++; missing.push('desc'); }
  if (!p.category) { sinCategory++; missing.push('category'); }
  if (!p.slug) { sinSlug++; missing.push('slug'); }
  
  if (missing.length > 0) {
    emptyFields.push({ id: p.id || `index-${index}`, title: p.title || 'SIN TÍTULO', missing });
  }
});

console.log(`- Sin título: ${sinTitle}`);
console.log(`- Sin precio: ${sinPrice}`);
console.log(`- Sin imagen principal: ${sinImg}`);
console.log(`- Sin descripción: ${sinDesc}`);
console.log(`- Sin categoría principal: ${sinCategory}`);
console.log(`- Sin slug (URL amigable): ${sinSlug}`);

if (emptyFields.length > 0) {
  console.log('\nDetalle de productos incompletos (primeros 10):');
  console.log(emptyFields.slice(0, 10));
} else {
  console.log('✅ ¡Todos los productos tienen los metadatos básicos completos!');
}

// 2. Cargar categorías
if (fs.existsSync(categoriesPath)) {
  const categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf-8'));
  console.log(`Total de categorías: ${categories.length}`);
} else {
  console.log('❌ No se encontró categories.json');
}

// 3. Cargar site.json
if (fs.existsSync(sitePath)) {
  const site = JSON.parse(fs.readFileSync(sitePath, 'utf-8'));
  console.log('✅ site.json cargado correctamente');
} else {
  console.log('❌ No se encontró site.json');
}
