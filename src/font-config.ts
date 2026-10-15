import {fileURLToPath} from 'node:url';
// Loaded before sharp; bundled font discovery also works on fontless cloud images.
process.env.FONTCONFIG_FILE??=fileURLToPath(new URL('../assets/fonts/fonts.conf',import.meta.url));
