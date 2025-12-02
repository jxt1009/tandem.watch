const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const imagesDir = path.join(__dirname, 'chrome-extension', 'images');

const sizes = [
  { input: 'icon16.svg', output: 'icon16.png', size: 16 },
  { input: 'icon48.svg', output: 'icon48.png', size: 48 },
  { input: 'icon128.svg', output: 'icon128.png', size: 128 }
];

async function convertSvgToPng() {
  for (const { input, output, size } of sizes) {
    const inputPath = path.join(imagesDir, input);
    const outputPath = path.join(imagesDir, output);
    
    console.log(`Converting ${input} to ${output}...`);
    
    try {
      await sharp(inputPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Created ${output}`);
    } catch (error) {
      console.error(`✗ Error converting ${input}:`, error.message);
    }
  }
  
  console.log('\nConversion complete!');
}

convertSvgToPng();
