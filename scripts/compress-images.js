// Converts PNG/JPG images to WebP using sharp (frontend/node_modules/sharp).
// Skips any image that already has a .webp sibling.
// Usage: node scripts/compress-images.js <directory>

const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const targetDir = process.argv[2]
if (!targetDir || !fs.existsSync(targetDir)) {
    console.error(`Error: directory not found: ${targetDir}`)
    process.exit(1)
}

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

function walk(dir) {
    const results = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) results.push(...walk(full))
        else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) results.push(full)
    }
    return results
}

async function main() {
    const images = walk(targetDir)
    if (images.length === 0) {
        console.log('No images found.')
        return
    }

    let converted = 0
    let skipped = 0

    for (const img of images) {
        const webp = img.replace(/\.(png|jpe?g)$/i, '.webp')
        if (fs.existsSync(webp)) {
            console.log(`SKIP  ${path.relative(targetDir, img)}  (webp already exists)`)
            skipped++
            continue
        }
        const before = fs.statSync(img).size
        await sharp(img).webp({ quality: 85 }).toFile(webp)
        const after = fs.statSync(webp).size
        const pct = Math.round(100 - (after * 100) / before)
        console.log(`OK    ${path.relative(targetDir, img)}  ->  .webp  ${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB  (${pct}% smaller)`)
        converted++
    }

    console.log(`\nDone: ${converted} converted, ${skipped} skipped.`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
